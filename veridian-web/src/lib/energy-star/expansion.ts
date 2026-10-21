/**
 * The ENERGY STAR expansion: more cited laptop configurations from the same
 * official EPA open-data sources (ADR-003, ADR-004, ADR-005).
 *
 * The base pipeline reads three product types out of one EPA dataset. The
 * expansion reads a fourth laptop product type out of that same dataset,
 * and it reads the two other EPA datasets that carry laptop rows.
 *
 * The discipline is inherited, not reinvented:
 *
 * - **One host allowlist.** Only `data.energystar.gov` is reachable, and
 *   only on the exact path registered for the source being read.
 * - **One SSRF guard.** `assertSsrf` is imported from the base adapter; a
 *   second, weaker guard is not written.
 * - **One user agent.** `VERIDIAN_USER_AGENT` is imported from the base
 *   types; the request never impersonates a browser.
 * - **One pagination discipline.** `$limit`/`$offset` against the Socrata
 *   endpoint, with a page size the endpoint actually caps at 1000.
 * - **One field validation and one identity rule.** The expanded validator
 *   delegates every field check to `validateEnergyStarRecord` and reuses
 *   `canonical.ts` unchanged. There is no second parser.
 * - **One request per second per host.**
 */

import { createHash } from "node:crypto";
import { assertSsrf } from "./adapter";
import { LAPTOP_PRODUCT_TYPES, validateEnergyStarRecord } from "./validate";
import { VERIDIAN_USER_AGENT, type NormalizedRecord, type RawPayloadRow, type RejectedRecord } from "./types";
import { assertRegisteredSourceUrl, type EnergyStarSource } from "./sources";

/** The Socrata endpoint caps a single page at 1000 rows. */
export const MAX_PAGE_SIZE = 1000;

/** At most one request per second per host. */
export const MIN_REQUEST_INTERVAL_MS = 1000;

/** The product types the base pipeline already ingests. */
export const BASE_LAPTOP_PRODUCT_TYPES = LAPTOP_PRODUCT_TYPES;

const BASE_LAPTOP_PRODUCT_TYPE_SET = new Set<string>(BASE_LAPTOP_PRODUCT_TYPES);

/**
 * Every product type in the ENERGY STAR Certified Computers dataset that is
 * a laptop, as the dataset itself enumerates them.
 *
 * `Mobile Workstation` is the addition. It is a portable workstation: all
 * 12 of its rows carry an integrated display diagonal and a battery
 * capacity, while the dataset's separate `Workstation` type (70 rows, all
 * marked as a workstation) carries neither.
 */
export const EXPANDED_LAPTOP_PRODUCT_TYPES = [
  "Notebook",
  "Two-In-One Notebook",
  "Ruggedized Notebook",
  "Mobile Workstation",
] as const;

const EXPANDED_LAPTOP_PRODUCT_TYPE_SET = new Set<string>(EXPANDED_LAPTOP_PRODUCT_TYPES);

/** The product types that the base pipeline did not already ingest. */
export const NEW_LAPTOP_PRODUCT_TYPES = EXPANDED_LAPTOP_PRODUCT_TYPES.filter(
  (type) => !BASE_LAPTOP_PRODUCT_TYPE_SET.has(type)
);

/** True when the type is a laptop in the expanded enumeration. */
export function isExpandedLaptopProductType(type: string): boolean {
  return EXPANDED_LAPTOP_PRODUCT_TYPE_SET.has(type);
}

/** True when the type was already covered by the base pipeline. */
export function isBaseLaptopProductType(type: string): boolean {
  return BASE_LAPTOP_PRODUCT_TYPE_SET.has(type);
}

// =============================================================================
// FIELD VALIDATION
// =============================================================================

/**
 * Read the product type a source row reported.
 */
function reportedProductType(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>).type;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

/**
 * Validate a source row against the *expanded* laptop product-type set.
 *
 * The field rules are the base validator's field rules: this function does
 * not re-implement a single check. It delegates to
 * `validateEnergyStarRecord`, which is the single source of truth for
 * required fields, numeric ranges, whole-GB memory, date parsing, control
 * characters, placeholder model names and the canonical identity rules.
 *
 * The only thing that changes is the product-type allowlist:
 *
 * - A row whose type is a base laptop type is validated by the base
 *   validator, unchanged and unwrapped.
 * - A row whose type is a new laptop type (`Mobile Workstation`) is
 *   validated by the base validator with the type field replaced by a
 *   permitted type, because the type is the *only* field the base
 *   validator treats differently. The source-reported type is then written
 *   back onto the result, so the catalog still shows what the source said.
 * - A row whose type is not a laptop at all is rejected by the base
 *   validator with the base validator's own reason.
 */
export function validateExpandedEnergyStarRecord(raw: unknown): {
  record: NormalizedRecord | null;
  errors: string[];
} {
  const type = reportedProductType(raw);
  if (type === null) return validateEnergyStarRecord(raw);
  if (BASE_LAPTOP_PRODUCT_TYPE_SET.has(type)) return validateEnergyStarRecord(raw);
  if (!EXPANDED_LAPTOP_PRODUCT_TYPE_SET.has(type)) return validateEnergyStarRecord(raw);

  const probe = { ...(raw as Record<string, unknown>), type: BASE_LAPTOP_PRODUCT_TYPES[0] };
  const result = validateEnergyStarRecord(probe);
  if (!result.record) return { record: null, errors: result.errors };
  return { record: { ...result.record, productType: type }, errors: result.errors };
}

// =============================================================================
// FETCH
// =============================================================================

/** One HTTP response, as the adapter needs it. */
export type FetchLike = typeof fetch;

/** A clock, so the rate limit can be tested without sleeping. */
export type Sleeper = (ms: number) => Promise<void>;

const defaultSleeper: Sleeper = (ms) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Enforces "at most one request per second per host".
 *
 * The last request time is kept per host, so two different sources on the
 * same host still share one budget.
 */
export class HostRateLimiter {
  private readonly lastRequestAt = new Map<string, number>();

  constructor(
    private readonly minIntervalMs: number = MIN_REQUEST_INTERVAL_MS,
    private readonly sleep: Sleeper = defaultSleeper,
    private readonly now: () => number = () => Date.now()
  ) {}

  async wait(host: string): Promise<void> {
    const last = this.lastRequestAt.get(host);
    if (last !== undefined) {
      const elapsed = this.now() - last;
      const remaining = this.minIntervalMs - elapsed;
      if (remaining > 0) await this.sleep(remaining);
    }
    this.lastRequestAt.set(host, this.now());
  }
}

export interface ExpansionFetchOptions {
  /** Rows to read per request. The endpoint caps this at 1000. */
  pageSize?: number;
  /** Stop after this many source rows have been read (across all types). */
  limit?: number | null;
  /** The product types to read, in order. */
  types?: readonly string[];
}

/**
 * Reads a registered ENERGY STAR source with the base adapter's discipline.
 *
 * The host allowlist, the SSRF guard, the user agent, the redirect policy,
 * the timeout, the content-type check and the pagination are all the base
 * adapter's; only the product-type allowlist is wider.
 */
export class EnergyStarExpansionAdapter {
  private readonly rateLimiter: HostRateLimiter;

  constructor(
    private readonly source: EnergyStarSource,
    private readonly fetchImpl: FetchLike = fetch,
    rateLimiter?: HostRateLimiter
  ) {
    this.rateLimiter = rateLimiter ?? new HostRateLimiter();
  }

  /** Build the request URL for one page, after the allowlist has been applied. */
  buildUrl(type: string, offset: number, limit: number): URL {
    if (!Number.isInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer");
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new Error(`limit must be between 1 and ${MAX_PAGE_SIZE}`);
    }
    if (!EXPANDED_LAPTOP_PRODUCT_TYPE_SET.has(type)) {
      throw new Error(`Unregistered product type '${type}'`);
    }
    const url = new URL(this.source.endpoint);
    if (this.source.categoryFilter) {
      url.searchParams.set(this.source.categoryFilter.field, this.source.categoryFilter.value);
    }
    url.searchParams.set(this.source.productTypeField, type);
    url.searchParams.set("$limit", String(limit));
    url.searchParams.set("$offset", String(offset));
    // The registered-path and pinned-host check comes first, then the base
    // adapter's SSRF guard.
    assertRegisteredSourceUrl(this.source, url.toString());
    assertSsrf(url.toString());
    return url;
  }

  /** Fetch one page of one product type. */
  async fetchPage(type: string, offset = 0, limit = MAX_PAGE_SIZE): Promise<unknown[]> {
    const url = this.buildUrl(type, offset, limit);
    await this.rateLimiter.wait(this.source.host);
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": VERIDIAN_USER_AGENT,
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`ENERGY STAR source ${this.source.id} returned HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("json")) {
      throw new Error(`Unexpected ENERGY STAR content type: ${contentType}`);
    }
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error("ENERGY STAR payload must be a JSON array");
    return payload;
  }

  /**
   * Walk every page of every requested product type.
   *
   * Pagination is driven by the source's own row counts: the walk stops
   * when a page comes back short, never on a guessed page count.
   */
  async fetchAll(options: ExpansionFetchOptions = {}): Promise<{
    rows: unknown[];
    pages: number;
    typesRead: string[];
    perTypeRows: Record<string, number>;
  }> {
    const pageSize = options.pageSize ?? MAX_PAGE_SIZE;
    const types = options.types ?? EXPANDED_LAPTOP_PRODUCT_TYPES;
    const limit = options.limit ?? null;
    const rows: unknown[] = [];
    const perTypeRows: Record<string, number> = {};
    const typesRead: string[] = [];
    let pages = 0;

    for (const type of types) {
      if (!EXPANDED_LAPTOP_PRODUCT_TYPE_SET.has(type)) {
        throw new Error(`Unregistered product type '${type}'`);
      }
      if (limit !== null && rows.length >= limit) break;
      typesRead.push(type);
      let offset = 0;
      for (;;) {
        const remaining = limit === null ? pageSize : limit - rows.length;
        if (remaining <= 0) break;
        const page = await this.fetchPage(type, offset, Math.min(pageSize, remaining));
        pages += 1;
        rows.push(...page);
        perTypeRows[type] = (perTypeRows[type] ?? 0) + page.length;
        if (page.length < Math.min(pageSize, remaining)) break;
        offset += page.length;
      }
    }

    return { rows, pages, typesRead, perTypeRows };
  }

  /**
   * Extract records from a fetched payload, hashing every row verbatim so
   * the raw observation can prove what was read.
   */
  extract(payload: unknown): {
    records: NormalizedRecord[];
    rejected: RejectedRecord[];
    raw: RawPayloadRow[];
  } {
    if (!Array.isArray(payload)) throw new Error("ENERGY STAR payload must be an array");
    const records: NormalizedRecord[] = [];
    const rejected: RejectedRecord[] = [];
    const raw: RawPayloadRow[] = payload.map((item) => {
      let serialized: string;
      try {
        serialized = JSON.stringify(item);
      } catch {
        serialized = "null";
      }
      const hash = createHash("sha256").update(serialized, "utf8").digest("hex");
      const result = validateExpandedEnergyStarRecord(item);
      const row =
        typeof item === "object" && item !== null && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {};
      const id =
        typeof row.pd_id === "string" || typeof row.pd_id === "number" ? String(row.pd_id) : null;
      if (result.record) records.push(result.record);
      else {
        rejected.push({
          sourceRecordId: id,
          errors: result.errors,
          raw: row as Record<string, string | null | undefined>,
        });
      }
      return { sourceRecordId: id, payloadHash: hash, payload: serialized, errors: result.errors };
    });
    return { records, rejected, raw };
  }
}

// =============================================================================
// EXPANSION REPORT
// =============================================================================

export interface ExpansionReport {
  /** The source that was read. */
  source: string;
  /** The dataset id that was read. */
  datasetId: string;
  /** The endpoint that was read. */
  endpoint: string;
  /** The product types that were read. */
  productTypes: string[];
  /** The number of source rows that were read. */
  recordsFetched: number;
  /** The number of source rows that were read, per product type. */
  rowsPerType: Record<string, number>;
  /** The number of source pages that were read. */
  pages: number;
  /** The number of rows that passed validation. */
  accepted: number;
  /** The number of rows that failed validation. */
  rejected: number;
  /** The validated records. */
  records: NormalizedRecord[];
  /** The rejected rows with their reasons. */
  rejectedRecords: RejectedRecord[];
  /** The verbatim payloads, with their hashes. */
  rawPayloads: RawPayloadRow[];
  /** The distinct canonical configuration codes the accepted records produce. */
  canonicalSkuCodes: string[];
  /**
   * The distinct canonical configuration codes the *base* product types
   * produce, out of the same fetch. The difference between the two is what
   * the expansion adds.
   */
  baseSkuCodes: string[];
  /** A plain-language note about what this run did or did not find. */
  note: string | null;
}

/**
 * Run the expansion over one source and produce a report the audited write
 * path can consume.
 *
 * A source that publishes no laptop product type is a measured answer, not
 * an error: the report comes back empty and says why.
 */
export async function runExpansion(
  source: EnergyStarSource,
  options: ExpansionFetchOptions = {},
  fetchImpl: FetchLike = fetch
): Promise<ExpansionReport> {
  const requestedTypes = options.types ?? [...source.laptopProductTypes];
  if (source.laptopProductTypes.length === 0) {
    return {
      source: source.name,
      datasetId: source.id,
      endpoint: source.endpoint,
      productTypes: [],
      recordsFetched: 0,
      rowsPerType: {},
      pages: 0,
      accepted: 0,
      rejected: 0,
      records: [],
      rejectedRecords: [],
      rawPayloads: [],
      canonicalSkuCodes: [],
      baseSkuCodes: [],
      note:
        "The source publishes no laptop product type, so it yields no laptop configurations. " +
        source.laptopTypeEvidence,
    };
  }
  const adapter = new EnergyStarExpansionAdapter(source, fetchImpl);
  const { rows, pages, typesRead, perTypeRows } = await adapter.fetchAll({
    ...options,
    types: requestedTypes,
  });
  const extracted = adapter.extract(rows);
  const canonicalSkuCodes = [...new Set(extracted.records.map((record) => record.skuCode))].sort();
  const baseSkuCodes = [
    ...new Set(
      extracted.records
        .filter((record) => record.productType !== null && isBaseLaptopProductType(record.productType))
        .map((record) => record.skuCode)
    ),
  ].sort();
  return {
    source: source.name,
    datasetId: source.id,
    endpoint: source.endpoint,
    productTypes: typesRead,
    recordsFetched: rows.length,
    rowsPerType: perTypeRows,
    pages,
    accepted: extracted.records.length,
    rejected: extracted.rejected.length,
    records: extracted.records,
    rejectedRecords: extracted.rejected,
    rawPayloads: extracted.raw,
    canonicalSkuCodes,
    baseSkuCodes,
    note: null,
  };
}
