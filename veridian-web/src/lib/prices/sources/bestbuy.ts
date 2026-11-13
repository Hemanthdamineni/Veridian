import {
  parsePriceValue,
  type PriceReading,
  type PriceSource,
  type PriceTarget,
} from "@/lib/prices/source";

/**
 * Best Buy Products API source (ADR-005, retail price feed).
 *
 * Reads a per-configuration retail price from Best Buy's official Products
 * API (https://developer.bestbuy.com). The retailer feed is gated purely on
 * a developer credential (see `docs/PRICE_FEEDS.md`); no scraping is used.
 *
 * Every observation records the API URL it was read from and the moment it
 * was read. A missing or unreadable price returns `null` — a missing price
 * is never guessed, and a failed call never throws.
 *
 * The HTTP client is injectable so the source is fully testable without a
 * credential or a network connection (the test suite passes a fake `fetch`).
 * This mirrors the injectable-fetch pattern of `EnergyStarAdapter`.
 */

/** The source's stable name, stored on every observation it produces. */
export const BEST_BUY_SOURCE_NAME = "Best Buy Products API";

/** The seller this source reports prices for. */
export const BEST_BUY_RETAILER = "Best Buy";

/** Confidence of an observation read from the official API (0.8 default for retail). */
const BEST_BUY_CONFIDENCE = 0.95;

export interface BestBuySourceOptions {
  /** The Best Buy Developer Program API key. Empty means "not configured": the source reports nothing rather than failing. */
  apiKey: string;
  /** Injectable HTTP client. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** The Products API base URL. Defaults to the official US endpoint. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** The currency this endpoint reports in. The US endpoint reports USD. */
  currency?: string;
}

/**
 * Build a Best Buy retail `PriceSource`.
 *
 * `apiKey` is passed in rather than read from the environment so the same
 * factory is testable with any value and the secret stays out of this
 * module. The write-path CLI is what reads the secret from configuration.
 */
export function createBestBuySource(options: BestBuySourceOptions): PriceSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? "https://api.bestbuy.com/v1/products").replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const currency = options.currency ?? "USD";

  return {
    name: BEST_BUY_SOURCE_NAME,
    kind: "retail",

    async read(target: PriceTarget): Promise<PriceReading | null> {
      // No credential: report nothing, never fail the run.
      if (!options.apiKey) return null;
      if (!target.retailerSku) return null;

      const url = `${baseUrl}/${encodeURIComponent(target.retailerSku)}.json?apiKey=${encodeURIComponent(options.apiKey)}`;

      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "VeridianBot/1.0 (+https://veridian.dev; contact@veridian.dev)",
          },
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // A source that cannot be reached reports no price.
        return null;
      }
      if (!response.ok) return null;

      let product: Record<string, unknown>;
      try {
        product = (await response.json()) as Record<string, unknown>;
      } catch {
        return null;
      }

      const price = parsePriceValue(product.salePrice);
      if (price === null) return null;

      // An explicitly unavailable product has no sellable price right now.
      if (!bestBuyInStock(product)) return null;

      return {
        price,
        currency,
        retailer: BEST_BUY_RETAILER,
        sourceUrl: url,
        sourceName: BEST_BUY_SOURCE_NAME,
        kind: "retail",
        confidence: BEST_BUY_CONFIDENCE,
        inStock: true,
        retailerSku: target.retailerSku,
      };
    },
  };
}

/**
 * Whether the product was available at the moment of reading.
 *
 * The API publishes `onlineAvailability` and `inStoreAvailability`. When the
 * API states either is true the product is in stock; when both are stated
 * false it is not. When the API reports neither, a published price implies
 * the product was available at the moment of reading.
 */
function bestBuyInStock(product: Record<string, unknown>): boolean {
  const online = product.onlineAvailability;
  const instore = product.inStoreAvailability;
  if (online === true || instore === true) return true;
  if (online === false || instore === false) return false;
  return true;
}