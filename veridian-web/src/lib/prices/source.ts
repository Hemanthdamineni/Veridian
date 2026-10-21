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
 * What a published number means.
 *
 *   * `list` — the page states this price for the product.
 *   * `from` — the page states it as a *starting* price: the cheapest
 *     published configuration of the family, an `AggregateOffer`'s
 *     `lowPrice`, or the lowest of several published offers.
 *
 * A "from" price belongs to the product family. It is never the price of one
 * configuration, and the collector records it against the family for that
 * reason.
 */
export type PriceBasis = "list" | "from";

/** The structured shape a price was read from. */
export type PriceShape =
  | "offer"
  | "offer-array"
  | "aggregate-offer"
  | "price-specification";

export interface StructuredPrice {
  /** The price as published, as a number. */
  price: number;
  /** The ISO 4217 code of the currency the price is in. */
  currency: string;
  /** Whether the product was in stock when the page was read. */
  inStock: boolean;
  /** Whether the number is a list price or a starting price. */
  basis: PriceBasis;
  /** The structured shape the number was read from. */
  shape: PriceShape;
  /**
   * Whether the page itself stated the currency. When it did not, the
   * currency came from the source list and the reading is flagged, because a
   * currency the page did not publish is a weaker piece of evidence.
   */
  currencyStated: boolean;
  /** The product name the price was published against, when the page gave one. */
  productName: string | null;
  /**
   * Whether more than one priced product was published on the page and the
   * match to the page's own subject was not unambiguous. A reading that is
   * ambiguous is reported rather than presented as certain.
   */
  ambiguous: boolean;
}

export interface ExtractOptions {
  /**
   * The currency the source list declares for the page. It is used only when
   * the page itself states no currency, and the reading is then flagged as
   * not stating one. It never overrides what the page says.
   */
  expectedCurrency?: string;
}

/**
 * Extract a price from schema.org `Product` markup.
 *
 * Many manufacturers publish a JSON-LD `Product` block with an `offers`
 * entry. Reading structured data is far more reliable than scraping a price
 * string out of the rendered page, and it is what the source intended the
 * value to mean.
 *
 * The reader understands the shapes manufacturers actually publish:
 *
 *   * a single `Offer` with a `price`;
 *   * an `offers` **array** — several published offers, of which the cheapest
 *     is the family's starting price;
 *   * an `AggregateOffer`, whose `lowPrice` is a *starting* price and is
 *     reported as such (`basis: "from"`), never as the price of one
 *     configuration;
 *   * an `Offer` that carries its price in a `priceSpecification`;
 *   * a `Product` nested in a `@graph` or in a larger product graph.
 *
 * The block is not always in a `<script type="application/ld+json">` tag.
 * Some sites (HP among them) publish the same markup inside the JSON payload
 * their page framework streams, so the reader also looks for JSON-LD that is
 * embedded in the page as a string literal.
 *
 * Returns `null` when the page carries no usable structured price. It never
 * infers one from a "from $X" phrase, and it never assumes a currency the
 * page did not publish.
 */
export function extractJsonLdPrice(
  html: string,
  options: ExtractOptions = {}
): StructuredPrice | null {
  const title = pageTitle(html);
  const candidates: PriceCandidate[] = [];

  for (const document of collectJsonLdDocuments(html)) {
    collectProductCandidates(document, candidates);
  }
  if (candidates.length === 0) return null;

  // The page may publish the product it is about first and other products
  // afterwards (a comparison strip, a recommendation rail). The subject is
  // the one whose name the page's own title agrees with, so the reader picks
  // the best match instead of the first thing it finds.
  const scored = candidates.map((candidate) => ({
    candidate,
    score: titleScore(candidate.productName, title),
  }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runnerUp = scored[1];
  const ambiguous = scored.length > 1 && (!runnerUp || runnerUp.score === best.score);

  const read = readOffer(best.candidate.offers);
  if (!read) return null;

  const currency = read.currency ?? normalizeCurrency(options.expectedCurrency);
  if (!currency) return null; // a price without a currency is not a price we can record.

  return {
    price: read.price,
    currency,
    inStock: read.inStock,
    basis: read.basis,
    shape: read.shape,
    currencyStated: read.currency !== null,
    productName: best.candidate.productName,
    ambiguous,
  };
}

/**
 * The regions a currency is used in.
 *
 * A price is only honest if the region recorded beside it matches the
 * currency the page published. A euro price recorded for the "EU" region
 * says EUR; a pound price recorded for the "UK" says GBP; a rupee price
 * recorded for "IN" says INR. This map is what makes that check possible.
 *
 * The first region listed for a currency is the one used when a page's
 * currency has to be turned into a region of its own.
 */
export const REGIONS_BY_CURRENCY: Readonly<Record<string, readonly string[]>> = {
  AUD: ["AU"],
  BRL: ["BR"],
  CAD: ["CA"],
  CHF: ["CH"],
  CNY: ["CN"],
  CZK: ["CZ"],
  DKK: ["DK"],
  EUR: [
    "EU",
    "DE",
    "FR",
    "IT",
    "ES",
    "NL",
    "BE",
    "AT",
    "IE",
    "PT",
    "FI",
    "GR",
    "LU",
    "SK",
    "SI",
    "EE",
    "LV",
    "LT",
    "CY",
    "MT",
  ],
  GBP: ["UK"],
  HKD: ["HK"],
  HUF: ["HU"],
  IDR: ["ID"],
  ILS: ["IL"],
  INR: ["IN"],
  JPY: ["JP"],
  KRW: ["KR"],
  MXN: ["MX"],
  MYR: ["MY"],
  NOK: ["NO"],
  NZD: ["NZ"],
  PHP: ["PH"],
  PLN: ["PL"],
  RON: ["RO"],
  RUB: ["RU"],
  SAR: ["SA"],
  SEK: ["SE"],
  SGD: ["SG"],
  THB: ["TH"],
  TRY: ["TR"],
  TWD: ["TW"],
  UAH: ["UA"],
  USD: ["US"],
  VND: ["VN"],
  ZAR: ["ZA"],
};

/** The region a currency belongs to, or `null` when the currency is unknown. */
export function regionForCurrency(currency: string): string | null {
  const regions = REGIONS_BY_CURRENCY[currency.trim().toUpperCase()];
  return regions && regions.length > 0 ? regions[0] : null;
}

/**
 * Whether a currency is used in a region.
 *
 * A currency we do not know is never treated as a match: an unrecognised
 * currency means the region cannot be confirmed, and a price whose region
 * cannot be confirmed is reported rather than filed away.
 */
export function currencyMatchesRegion(currency: string, region: string): boolean {
  const regions = REGIONS_BY_CURRENCY[currency.trim().toUpperCase()];
  if (!regions) return false;
  const wanted = region.trim().toUpperCase();
  return regions.some((entry) => entry.toUpperCase() === wanted);
}

export interface RegionDecision {
  /** The currency the reading is recorded with. */
  currency: string;
  /** The region the reading is recorded for. */
  region: string;
  /** True when the page published a currency other than the declared one. */
  currencyCorrected: boolean;
  /** True when the page published no currency and the declared one was used. */
  currencyFromSourceList: boolean;
  /**
   * True when the declared region does not match the currency and was
   * replaced by the region the currency belongs to. A region that cannot be
   * corrected is left alone and reported.
   */
  regionCorrected: boolean;
  /** True when the region could not be confirmed against the currency. */
  regionUnconfirmed: boolean;
  /** The reasons the reading was adjusted, in plain words. */
  notes: string[];
}

/**
 * Decide the currency and the region a reading is recorded with.
 *
 * The page is believed over the source list: when a page publishes a
 * currency the list did not declare, the page's currency is recorded and the
 * difference is reported. A region that does not match the currency is
 * replaced by the region the currency belongs to, so a euro price recorded
 * for the "EU" region says EUR and a price published in pounds is recorded
 * for the "UK".
 */
export function resolveRegion(options: {
  /** The currency the source list declares for the page. */
  declaredCurrency?: string;
  /** The region the source list declares for the page. */
  declaredRegion: string;
  /** The reading taken from the page. */
  extracted: StructuredPrice;
}): RegionDecision {
  const declaredRegion = options.declaredRegion.trim().toUpperCase();
  const declaredCurrency = options.declaredCurrency?.trim().toUpperCase() ?? "";
  const notes: string[] = [];

  const currency = options.extracted.currency;
  let currencyCorrected = false;
  let currencyFromSourceList = false;

  if (!options.extracted.currencyStated) {
    currencyFromSourceList = true;
    notes.push(
      `the page did not state a currency; the declared ${currency} was used`
    );
  } else if (declaredCurrency && currency !== declaredCurrency) {
    currencyCorrected = true;
    notes.push(
      `the page publishes ${currency}, not the declared ${declaredCurrency}; the page was believed`
    );
  }

  let region = declaredRegion;
  let regionCorrected = false;
  let regionUnconfirmed = false;
  if (!currencyMatchesRegion(currency, region)) {
    const implied = regionForCurrency(currency);
    if (implied) {
      region = implied;
      regionCorrected = true;
      notes.push(
        `the region "${declaredRegion}" does not match ${currency}; the price was recorded for "${implied}"`
      );
    } else {
      regionUnconfirmed = true;
      notes.push(
        `the region "${declaredRegion}" does not match ${currency} and no region is known for that currency`
      );
    }
  }

  return {
    currency,
    region,
    currencyCorrected,
    currencyFromSourceList,
    regionCorrected,
    regionUnconfirmed,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Reading the markup
// ---------------------------------------------------------------------------

interface PriceCandidate {
  /** The product's name, when the page published one. */
  productName: string | null;
  /** The `offers` value, in whatever shape the page published it. */
  offers: unknown;
}

interface OfferReading {
  price: number;
  currency: string | null;
  inStock: boolean;
  basis: PriceBasis;
  shape: PriceShape;
}

/** The page's `<title>`, used to work out which published product the page is about. */
function pageTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1]) : "";
}

/**
 * Every JSON-LD document the page publishes.
 *
 * Two places are read: a `<script type="application/ld+json">` tag, and any
 * string literal in the page that decodes to a JSON-LD document. The second
 * covers the pages that publish their markup inside the payload their
 * framework streams rather than in a tag.
 */
function collectJsonLdDocuments(html: string): unknown[] {
  const documents: unknown[] = [];

  const scripts = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const script of scripts ?? []) {
    const body = script
      .replace(/^[\s\S]*?>/, "")
      .replace(/<\/script>$/i, "")
      .trim();
    const parsed = tryParseJson(body);
    if (parsed !== undefined) documents.push(parsed);
  }

  for (const match of html.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    const literal = match[1];
    if (!literal.includes("@context") || !literal.includes("@type")) continue;
    const decoded = tryParseJson(`"${literal}"`);
    if (typeof decoded !== "string" || !decoded.includes("@context")) continue;
    const parsed = tryParseJson(decoded);
    if (parsed !== undefined) documents.push(parsed);
  }

  return documents;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Every priced `Product` in a document, in the order the document publishes
 * them. A product is only a candidate when it carries an `offers` value.
 */
function collectProductCandidates(node: unknown, out: PriceCandidate[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectProductCandidates(item, out);
    return;
  }
  if (!node || typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  const type = record["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes("Product") && record.offers !== undefined && record.offers !== null) {
    out.push({
      productName: typeof record.name === "string" ? record.name : null,
      offers: record.offers,
    });
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === "object") collectProductCandidates(value, out);
  }
}

/**
 * Read the price out of an `offers` value.
 *
 * Returns `null` when the offers carry no usable number.
 */
function readOffer(offers: unknown): OfferReading | null {
  const list = Array.isArray(offers) ? offers : [offers];
  const readable: Array<{ reading: OfferReading; isAggregate: boolean }> = [];

  for (const offer of list) {
    if (!offer || typeof offer !== "object") continue;
    const record = offer as Record<string, unknown>;
    const types = Array.isArray(record["@type"])
      ? (record["@type"] as unknown[]).map((entry) => String(entry))
      : [String(record["@type"] ?? "")];
    const isAggregate = types.includes("AggregateOffer");

    const specification = readPriceSpecification(record.priceSpecification);
    const raw = isAggregate
      ? (record.lowPrice ?? record.price)
      : (record.price ?? record.lowPrice);

    const price = parsePriceValue(raw) ?? (specification ? specification.price : null);
    if (price === null) continue;

    const currency =
      normalizeCurrency(record.priceCurrency) ??
      (specification ? specification.currency : null);

    const availability = typeof record.availability === "string" ? record.availability : null;
    const inStock = availability ? !/outofstock/i.test(availability) : true;

    const shape: PriceShape = isAggregate
      ? "aggregate-offer"
      : specification && record.price === undefined
        ? "price-specification"
        : Array.isArray(offers)
          ? "offer-array"
          : "offer";

    readable.push({
      reading: {
        price,
        currency,
        inStock,
        // An aggregate is a range, and the low end of a range is a starting
        // price. So is the cheapest of several published offers.
        basis: isAggregate || Array.isArray(offers) ? "from" : "list",
        shape,
      },
      isAggregate,
    });
  }

  if (readable.length === 0) return null;

  // Several published offers may be in different currencies. Prices in
  // different currencies cannot be compared, so only offers in one currency
  // are considered, and the cheapest of them is the starting price.
  const currencies = new Set(
    readable.map((entry) => entry.reading.currency).filter((value): value is string => !!value)
  );
  let chosen = readable;
  if (currencies.size > 1) {
    const withCurrency = readable.filter((entry) => entry.reading.currency !== null);
    if (withCurrency.length === 0) return null;
    const first = withCurrency[0].reading.currency as string;
    chosen = withCurrency.filter((entry) => entry.reading.currency === first);
  }

  const lowest = chosen.reduce((best, entry) =>
    entry.reading.price < best.reading.price ? entry : best
  );
  return lowest.reading;
}

/** Read a `priceSpecification`, which carries the number and the currency. */
function readPriceSpecification(
  value: unknown
): { price: number; currency: string | null } | null {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const price = parsePriceValue(record.price);
    if (price === null) continue;
    return { price, currency: normalizeCurrency(record.priceCurrency) };
  }
  return null;
}

/**
 * Parse a published price into a number.
 *
 * A price may be a number or a string, and the string may carry a currency
 * symbol, a thousands separator or a decimal comma. A price that cannot be
 * read is `null` — it is never guessed.
 */
export function parsePriceValue(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw !== "string") return null;

  let text = raw.trim();
  if (!text) return null;
  // Drop a currency code or symbol that was written into the number.
  text = text.replace(/[A-Za-z]{3}\s*$/, "").replace(/[^\d.,\-\s]/g, "").trim();
  if (!text) return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let decimalSeparator: "," | "." | null = null;

  if (lastComma >= 0 && lastDot >= 0) {
    decimalSeparator = lastComma > lastDot ? "," : ".";
  } else if (lastComma >= 0) {
    // A single comma is a decimal separator only when it is not grouping
    // three digits, e.g. "1,599" is a thousand and "1599,99" is a decimal.
    const tail = text.length - lastComma - 1;
    decimalSeparator = tail === 3 ? null : ",";
  } else if (lastDot >= 0) {
    // The same rule the other way round: "1.599" groups, "1.59" does not.
    const tail = text.length - lastDot - 1;
    decimalSeparator = tail === 3 ? null : ".";
  }

  let normalised: string;
  if (decimalSeparator === ",") {
    normalised = text.replace(/\./g, "").replace(",", ".");
  } else if (decimalSeparator === ".") {
    normalised = text.replace(/,/g, "");
  } else {
    normalised = text.replace(/[.,]/g, "");
  }

  const value = Number(normalised);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function normalizeCurrency(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(text) ? text : null;
}

// ---------------------------------------------------------------------------
// Matching the page's subject
// ---------------------------------------------------------------------------

/** Words that say nothing about which product a page is about. */
const STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "for",
  "of",
  "in",
  "a",
  "an",
  "pc",
  "laptop",
  "notebook",
  "computer",
  "copilot",
  "plus",
  "windows",
  "home",
  "pro",
  "black",
  "silver",
  "grey",
  "gray",
  "white",
  "blue",
  "inch",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

/**
 * How much a product's name agrees with the page's title.
 *
 * The score is the number of the product's words the title also carries. A
 * page about the "ASUS Zenbook A14 (UX3407)" that also lists the A16 and the
 * DUO scores the A14 highest, because the title names it.
 */
function titleScore(productName: string | null, title: string): number {
  if (!productName) return 0;
  const titleTokens = new Set(tokenize(title));
  if (titleTokens.size === 0) return 0;
  let score = 0;
  for (const token of tokenize(productName)) {
    if (titleTokens.has(token)) score++;
  }
  return score;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
