import { createHash } from "node:crypto";
import { ADAPTER_VERSION, ENERGY_STAR_SOURCE, VERIDIAN_USER_AGENT, type IngestionReport, type NormalizedRecord, type RawPayloadRow, type RejectedRecord } from "./types";
import { LAPTOP_PRODUCT_TYPES, validateEnergyStarRecord } from "./validate";

const LAPTOP_PRODUCT_TYPE_SET = new Set<string>(LAPTOP_PRODUCT_TYPES);
const API_URL = new URL(ENERGY_STAR_SOURCE.url);

/** The only host/origin this adapter may contact (SSRF guard, ADR-003). */
export function assertSsrf(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Unparseable URL '${url}'`);
  }
  if (parsed.protocol !== "https:") throw new Error("Energy Star fetch must use HTTPS");
  if (parsed.hostname.toLowerCase() === "localhost" || /^\d/.test(parsed.hostname) || parsed.hostname.includes("127.")) {
    throw new Error("Energy Star fetch blocked loopback/SSRF host");
  }
}

/** Fetches only the registered official Socrata API host and dataset. */
export class EnergyStarAdapter {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /**
   * Fetch one page of a single product type.
   *
   * The Socrata endpoint caps a single page at 1000 rows, so the full
   * dataset is walked with `$offset`. The registered host and path are
   * re-checked on every call; a redirect is refused rather than followed.
   */
  async fetch(
    offset = 0,
    limit = 100,
    type: string = LAPTOP_PRODUCT_TYPES[0]
  ): Promise<unknown> {
    if (!Number.isInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer");
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("limit must be between 1 and 1000");
    if (!LAPTOP_PRODUCT_TYPE_SET.has(type)) throw new Error(`Unregistered product type '${type}'`);
    const url = new URL(ENERGY_STAR_SOURCE.url);
    if (url.origin !== API_URL.origin || url.pathname !== API_URL.pathname) {
      throw new Error("Unregistered Energy Star API endpoint");
    }
    url.searchParams.set("type", type);
    url.searchParams.set("$limit", String(limit));
    url.searchParams.set("$offset", String(offset));
    assertSsrf(url.toString());
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": VERIDIAN_USER_AGENT,
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Energy Star API returned HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("json")) throw new Error(`Unexpected Energy Star content type: ${contentType}`);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error("Energy Star API payload must be a JSON array");
    return payload;
  }

  /**
   * Walk every page of every laptop product type and return the combined
   * raw rows. Pagination is driven by the source's own row counts; the
   * adapter never assumes a fixed number of pages.
   */
  async fetchAll(
    types: readonly string[] = LAPTOP_PRODUCT_TYPES,
    pageSize = 1000
  ): Promise<{ rows: unknown[]; pages: number }> {
    const rows: unknown[] = [];
    let pages = 0;
    for (const type of types) {
      let offset = 0;
      for (;;) {
        const page = await this.fetch(offset, pageSize, type);
        const items = page as unknown[];
        pages += 1;
        rows.push(...items);
        if (items.length < pageSize) break;
        offset += items.length;
      }
    }
    return { rows, pages };
  }

  extract(payload: unknown): { records: NormalizedRecord[]; rejected: RejectedRecord[]; raw: RawPayloadRow[] } {
    if (!Array.isArray(payload)) throw new Error("Energy Star payload must be an array");
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
      const result = validateEnergyStarRecord(item);
      const row = typeof item === "object" && item !== null && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      const id = typeof row.pd_id === "string" || typeof row.pd_id === "number" ? String(row.pd_id) : null;
      if (result.record) records.push(result.record);
      else rejected.push({ sourceRecordId: id, errors: result.errors, raw: row as Record<string, string | null | undefined> });
      return { sourceRecordId: id, payloadHash: hash, payload: serialized, errors: result.errors };
    });
    return { records, rejected, raw };
  }

  async run(
    offset = 0,
    limit = 100,
    type: string = LAPTOP_PRODUCT_TYPES[0]
  ): Promise<IngestionReport> {
    const payload = await this.fetch(offset, limit, type);
    const extracted = this.extract(payload);
    return {
      source: ENERGY_STAR_SOURCE.name,
      adapterVersion: ADAPTER_VERSION,
      observedAt: new Date().toISOString(),
      requested: Array.isArray(payload) ? payload.length : 0,
      accepted: extracted.records.length,
      rejected: extracted.rejected.length,
      rejectedRecords: extracted.rejected,
      records: extracted.records,
      rawPayloads: extracted.raw,
    };
  }

  /**
   * Run the adapter across the complete laptop dataset: every page of every
   * laptop product type.
   */
  async runAll(
    types: readonly string[] = LAPTOP_PRODUCT_TYPES,
    pageSize = 1000
  ): Promise<IngestionReport> {
    const { rows, pages } = await this.fetchAll(types, pageSize);
    const extracted = this.extract(rows);
    return {
      source: ENERGY_STAR_SOURCE.name,
      adapterVersion: ADAPTER_VERSION,
      observedAt: new Date().toISOString(),
      requested: rows.length,
      pages,
      accepted: extracted.records.length,
      rejected: extracted.rejected.length,
      rejectedRecords: extracted.rejected,
      records: extracted.records,
      rawPayloads: extracted.raw,
    };
  }
}
