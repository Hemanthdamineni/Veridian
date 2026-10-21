/**
 * Icecat open product data — HTTP client.
 *
 * The service is the public demo store of Icecat's open product data. It is
 * read politely:
 *
 *   * one request per second, never two at once;
 *   * a descriptive User-Agent, so the operator can see who is calling;
 *   * a bounded number of retries, so a hiccup never becomes a request
 *     storm;
 *   * and an immediate stop on `403`/`429`, because that is the service
 *     telling us to stop, not something to retry.
 *
 * The API identifies a product by its Icecat id, or by the brand's product
 * code together with the brand name. The code alone is not enough — the
 * service rejects it with "Product identifier(s) is empty" — so every URL
 * this module builds carries a complete identifier.
 */

import type {
  IcecatErrorResponse,
  IcecatProductRef,
  IcecatProductResponse,
} from "./types";

/** The Icecat API root. */
export const ICECAT_API_BASE = "https://live.icecat.biz/api";

/** The public demo store. It carries the open (sponsor) brands of Icecat. */
export const ICECAT_SHOP_NAME = "openicecat-live";

/** The language the connector reads. */
export const ICECAT_LANG = "EN";

/** A descriptive, contactable User-Agent. No browser impersonation. */
export const ICECAT_USER_AGENT =
  "VeridianIcecatConnector/1.0 (+https://veridian.dev; contact@veridian.dev)";

/** The minimum gap between two requests, in milliseconds. */
export const ICECAT_MIN_INTERVAL_MS = 1000;

/** How long a single request may take before it is abandoned. */
export const ICECAT_TIMEOUT_MS = 30_000;

/** The bottom-level Icecat category that holds notebooks. */
export const ICECAT_LAPTOP_CATEGORY_ID = "151";

/** An error raised by the Icecat service. */
export class IcecatError extends Error {
  readonly status: number;
  /** Icecat's own status code, when the service sent one. */
  readonly code: number | null;
  /** The message Icecat sent, when the service sent one. */
  readonly icecatMessage: string;

  constructor(
    message: string,
    status: number,
    code: number | null = null,
    icecatMessage = ""
  ) {
    super(message);
    this.name = "IcecatError";
    this.status = status;
    this.code = code;
    this.icecatMessage = icecatMessage;
  }
}

/**
 * The service refused the request (403) or asked us to slow down (429).
 *
 * These are never retried: the connector stops and reports.
 */
export class IcecatAccessError extends IcecatError {
  constructor(message: string, status: number, code: number | null, icecatMessage: string) {
    super(message, status, code, icecatMessage);
    this.name = "IcecatAccessError";
  }
}

/** The exact URL a product is read from, by Icecat id. */
export function productUrlByIcecatId(icecatId: string | number): string {
  const params = new URLSearchParams({
    lang: ICECAT_LANG,
    shopname: ICECAT_SHOP_NAME,
    icecat_id: String(icecatId),
  });
  return `${ICECAT_API_BASE}?${params.toString()}`;
}

/**
 * The exact URL a product is read from, by the brand's product code.
 *
 * Icecat needs the brand with the code; a code on its own is refused.
 */
export function productUrlByBrandAndCode(brand: string, productCode: string): string {
  const params = new URLSearchParams({
    lang: ICECAT_LANG,
    shopname: ICECAT_SHOP_NAME,
    brand,
    productcode: productCode,
  });
  return `${ICECAT_API_BASE}?${params.toString()}`;
}

/** The Icecat id encoded in a product URL, when there is one. */
export function icecatIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const value = parsed.searchParams.get("icecat_id");
    return value && /^\d+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export interface IcecatClientOptions {
  /** Minimum gap between requests. Defaults to one second. */
  minIntervalMs?: number;
  /** Per-request timeout. Defaults to thirty seconds. */
  timeoutMs?: number;
  /** The User-Agent to send. */
  userAgent?: string;
  /** The fetch implementation, for tests. */
  fetchImpl?: typeof fetch;
  /** How many times a failed request may be repeated. Defaults to one. */
  maxRetries?: number;
}

/**
 * A polite reader for the Icecat open product data service.
 */
export class IcecatClient {
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private lastRequestAt = 0;
  /** The URLs this client has read, in order. Useful for reporting. */
  readonly requestedUrls: string[] = [];

  constructor(options: IcecatClientOptions = {}) {
    this.minIntervalMs = options.minIntervalMs ?? ICECAT_MIN_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? ICECAT_TIMEOUT_MS;
    this.userAgent = options.userAgent ?? ICECAT_USER_AGENT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? 1;
  }

  /** The number of requests this client has made. */
  get requestCount(): number {
    return this.requestedUrls.length;
  }

  /** Wait until the minimum gap between requests has passed. */
  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const wait = this.minIntervalMs - elapsed;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastRequestAt = Date.now();
  }

  /**
   * Read a URL from the service.
   *
   * Retries are bounded and only cover transport failures and the service's
   * transient "identifier is empty" answer. A `403` or `429` is never
   * retried: the connector stops and reports it.
   */
  async getJson(url: string): Promise<IcecatProductResponse> {
    let attempt = 0;
    for (;;) {
      await this.throttle();
      this.requestedUrls.push(url);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let status = 0;
      let body = "";
      try {
        const response = await this.fetchImpl(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": this.userAgent,
          },
          signal: controller.signal,
        });
        status = response.status;
        body = await response.text();
      } catch (error) {
        clearTimeout(timer);
        if (attempt < this.maxRetries) {
          attempt += 1;
          continue;
        }
        throw new IcecatError(
          `Icecat request failed: ${error instanceof Error ? error.message : "unknown error"}`,
          0
        );
      }
      clearTimeout(timer);

      if (status === 403 || status === 429) {
        const parsed = parseError(body);
        throw new IcecatAccessError(
          `Icecat refused the request (HTTP ${status}${
            parsed?.Message ? `: ${parsed.Message}` : ""
          }). Stopping.`,
          status,
          parsed?.Code ?? null,
          parsed?.Message ?? ""
        );
      }

      if (status !== 200) {
        const parsed = parseError(body);
        if (status === 400 && attempt < this.maxRetries) {
          // The demo store occasionally answers a valid request with an
          // empty-identifier error. One repeat is allowed; more would be a
          // request storm.
          attempt += 1;
          continue;
        }
        throw new IcecatError(
          `Icecat returned HTTP ${status}${parsed?.Message ? `: ${parsed.Message}` : ""}`,
          status,
          parsed?.Code ?? null,
          parsed?.Message ?? ""
        );
      }

      let parsed: IcecatProductResponse;
      try {
        parsed = JSON.parse(body) as IcecatProductResponse;
      } catch {
        throw new IcecatError("Icecat returned a body that is not JSON", status);
      }
      if (!parsed.data) {
        const error = parseError(body);
        throw new IcecatError(
          `Icecat returned no product data${error?.Message ? `: ${error.Message}` : ""}`,
          status,
          error?.Code ?? null,
          error?.Message ?? ""
        );
      }
      return parsed;
    }
  }

  /** Read a product by its Icecat id. */
  async getProductByIcecatId(icecatId: string | number): Promise<IcecatProductResponse> {
    return this.getJson(productUrlByIcecatId(icecatId));
  }

  /** Read a product by the brand's product code and the brand name. */
  async getProductByBrandAndCode(
    brand: string,
    productCode: string
  ): Promise<IcecatProductResponse> {
    return this.getJson(productUrlByBrandAndCode(brand, productCode));
  }

  /**
   * Read a product from a collected product-id list entry.
   *
   * The Icecat id in the URL is preferred: it is unambiguous. The brand and
   * the product code are the fallback.
   */
  async getProductByRef(ref: IcecatProductRef): Promise<IcecatProductResponse> {
    const icecatId = icecatIdFromUrl(ref.sourceUrl);
    if (icecatId) return this.getProductByIcecatId(icecatId);
    return this.getProductByBrandAndCode(ref.brand, ref.productCode);
  }

  /**
   * Discover the laptops Icecat carries, starting from a few known products.
   *
   * Icecat's product API answers one product per request, so the list of
   * what a store carries is reached through the product graph: every product
   * links to the products it is related to, and the accessories of a laptop
   * list the laptops they fit. Following that graph from a laptop yields the
   * laptops the store actually holds, with the identifiers the service
   * itself published.
   *
   * Products the demo account may not read are reported, not silently
   * skipped: `onInaccessible` is called with the reason.
   */
  async discoverLaptopProducts(
    seedIds: Array<string | number>,
    options: { limit?: number; onInaccessible?: (seed: string, error: IcecatError) => void } = {}
  ): Promise<IcecatProductRef[]> {
    const limit = options.limit ?? Number.POSITIVE_INFINITY;
    const found = new Map<string, IcecatProductRef>();
    const queue: string[] = seedIds.map(String);

    while (queue.length > 0 && found.size < limit) {
      const current = queue.shift() as string;
      let payload: IcecatProductResponse;
      try {
        payload = await this.getProductByIcecatId(current);
      } catch (error) {
        if (error instanceof IcecatError) {
          options.onInaccessible?.(current, error);
          continue;
        }
        throw error;
      }

      const general = payload.data?.GeneralInfo;
      const categoryId = general?.Category?.CategoryID ?? null;
      if (categoryId === ICECAT_LAPTOP_CATEGORY_ID && general) {
        const icecatId = String(general.IcecatId ?? current);
        if (!found.has(icecatId)) {
          found.set(icecatId, {
            productCode: general.BrandPartCode ?? "",
            brand: general.Brand ?? "",
            name: general.ProductName ?? "",
            sourceUrl: productUrlByIcecatId(icecatId),
          });
        }
      }

      for (const related of payload.data?.ProductRelated ?? []) {
        const relatedId = related.IcecatID ? String(related.IcecatID) : null;
        if (!relatedId || found.has(relatedId)) continue;
        if (String(related.CategoryID) !== ICECAT_LAPTOP_CATEGORY_ID) continue;
        if (!related.ProductCode || !related.Brand) continue;
        found.set(relatedId, {
          productCode: related.ProductCode,
          brand: related.Brand,
          name: related.ProductName ?? "",
          sourceUrl: productUrlByIcecatId(relatedId),
        });
        queue.push(relatedId);
        if (found.size >= limit) break;
      }
    }

    return [...found.values()];
  }
}

/** Parse an Icecat error envelope, when the body is one. */
function parseError(body: string): IcecatErrorResponse | null {
  try {
    const parsed = JSON.parse(body) as IcecatErrorResponse;
    if (parsed && typeof parsed === "object" && ("Message" in parsed || "Code" in parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
