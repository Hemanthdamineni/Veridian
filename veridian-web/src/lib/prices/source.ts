/**
 * Price sources (ADR-005).
 *
 * A price observation is only useful if it can be traced. Every observation
 * therefore carries the source that produced it, the URL it came from, the
 * currency, the moment it was observed and a confidence, and it is appended
 * rather than overwritten: history is never rewritten.
 *
 * This module defines the contract a price source implements and the
 * plumbing that turns one into stored observations.
 *
 * Two kinds of source exist:
 *
 *   * `manufacturer` — the list price the manufacturer publishes for its own
 *     product. It is authoritative for what the manufacturer asks, and it is
 *     not a street price.
 *   * `retail` — a price a seller quotes for a specific listing. It needs a
 *     listing, a seller and a timestamp, because that is what makes a retail
 *     price meaningful over time.
 *
 * The distinction is carried on every row, so a reader is never shown a
 * reference value and told it is a quote.
 */

/** The evidence class of a price observation. */
export type PriceKind = "retail" | "manufacturer" | "review";

export interface PriceTarget {
  /** The canonical configuration the price belongs to. */
  skuId: string;
  /** ISO-ish region code, e.g. `US`. */
  region: string;
  /** The page the price is read from. */
  url: string;
  /** The seller, for retail sources. `null` for a manufacturer list price. */
  sellerName?: string | null;
  /** The retailer's own identifier for the listing, when there is one. */
  retailerSku?: string | null;
}

export interface PriceReading {
  price: number;
  currency: string;
  /** The seller, for retail sources. */
  retailer: string | null;
  /** The URL the price was read from. */
  sourceUrl: string;
  /** The name of the source, shown to the reader. */
  sourceName: string;
  kind: PriceKind;
  confidence: number;
  /** Whether the product was in stock at the time of reading. */
  inStock: boolean;
  /** The retailer's own identifier, when there is one. */
  retailerSku: string | null;
}

export interface PriceSource {
  /** A stable name for the source, stored on every observation. */
  readonly name: string;
  /** The evidence class this source produces. */
  readonly kind: PriceKind;
  /**
   * Read the current price for a target. Returns `null` when the source has
   * no price for it — a missing price is never guessed.
   */
  read(target: PriceTarget): Promise<PriceReading | null>;
}

/**
 * Extract a price from schema.org `Product` markup.
 *
 * Many manufacturers publish a JSON-LD `Product` block with an `offers`
 * entry. Reading structured data is far more reliable than scraping a price
 * string out of the rendered page, and it is what the source intended the
 * value to mean.
 *
 * Returns `null` when the page carries no structured price. It never
 * infers one from a "from $X" phrase, because a starting price is a
 * different number from the price of the configuration being priced.
 */
export function extractJsonLdPrice(html: string): {
  price: number;
  currency: string;
  inStock: boolean;
} | null {
  const scripts = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  if (!scripts) return null;

  for (const script of scripts) {
    const body = script.replace(/^[\s\S]*?>/, "").replace(/<\/script>$/i, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    const found = findProductOffer(parsed);
    if (!found) continue;
    const price = Number(found.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    return {
      price,
      currency: (found.priceCurrency || "USD").toUpperCase(),
      inStock: found.availability !== "http://schema.org/OutOfStock",
    };
  }
  return null;
}

interface ProductOffer {
  price?: string | number;
  priceCurrency?: string;
  availability?: string;
}

function findProductOffer(node: unknown): ProductOffer | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProductOffer(item);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;

  const record = node as Record<string, unknown>;
  const type = record["@type"];
  const isProduct =
    type === "Product" || (Array.isArray(type) && type.includes("Product"));
  if (isProduct && record.offers) {
    const offers = record.offers;
    if (Array.isArray(offers)) {
      for (const offer of offers) {
        if (offer && typeof offer === "object") {
          const candidate = offer as ProductOffer;
          if (candidate.price !== undefined) return candidate;
        }
      }
    } else if (typeof offers === "object" && offers !== null) {
      return offers as ProductOffer;
    }
  }
  // The offer can also sit inside a graph node.
  if (record["@graph"]) {
    const found = findProductOffer(record["@graph"]);
    if (found) return found;
  }
  return null;
}
