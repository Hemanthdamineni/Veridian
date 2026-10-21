/**
 * The Wikidata Query Service client.
 *
 * The endpoint is a public, shared service, so this client is deliberately
 * conservative:
 *
 *   * one request at a time, with at least `MIN_REQUEST_INTERVAL_MS` between
 *     requests;
 *   * a stable, descriptive User-Agent that identifies the project and a
 *     contact address — the service answers 403 to clients that send none;
 *   * a GET with the query carried in the `query=` parameter;
 *   * `Accept: application/sparql-results+json`;
 *   * no retry on HTTP 429: the run stops cleanly and reports the status.
 *
 * The query text itself lives in `data/wikidata-sparql.rq`, as data, so it
 * can be reviewed and pasted into the WDQS web UI without reading code.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { VERIDIAN_USER_AGENT } from "../energy-star/types";
import type { SparqlBinding, SparqlResults, WikidataRow } from "./types";

/** The only endpoint this adapter contacts. */
export const WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

/** Minimum delay between two requests to the endpoint, in milliseconds. */
export const MIN_REQUEST_INTERVAL_MS = 1000;

/** Timeout for a single request to the endpoint. */
export const REQUEST_TIMEOUT_MS = 60_000;

/** Pause before the retry of a dropped connection. */
export const RETRY_DELAY_MS = 2000;

/** How many times a dropped connection may be retried. */
export const MAX_CONNECTION_ATTEMPTS = 3;

/** Path of the query text, relative to the `veridian-web` directory. */
export const QUERY_FILE = path.join("data", "wikidata-sparql.rq");

/**
 * Read the SPARQL query from disk.
 *
 * The path is resolved against the working directory, the same way the other
 * scripts in this project read their data files (`data/laptops.csv`).
 */
export function loadQueryText(cwd: string = process.cwd()): string {
  const queryPath = path.join(cwd, QUERY_FILE);
  let text: string;
  try {
    text = readFileSync(queryPath, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read the Wikidata query from '${queryPath}'. ` +
        `Run the script from the veridian-web directory. (${String(error)})`
    );
  }
  if (!text.trim()) {
    throw new Error(`The Wikidata query at '${queryPath}' is empty.`);
  }
  return text;
}

/** A failed request to the endpoint, with the exact status and body. */
export class WikidataRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message?: string
  ) {
    super(
      message ??
        `The Wikidata Query Service returned HTTP ${status}: ${body.slice(0, 500)}`
    );
    this.name = "WikidataRequestError";
  }
}

/**
 * HTTP 429 — the endpoint is asking this client to back off.
 *
 * The run stops here. Retrying immediately is exactly what the service is
 * asking us not to do.
 */
export class WikidataRateLimitError extends WikidataRequestError {
  constructor(status: number, body: string) {
    super(status, body, `The Wikidata Query Service returned HTTP 429 (rate limited): ${body.slice(0, 500)}`);
    this.name = "WikidataRateLimitError";
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A client for the Wikidata Query Service.
 *
 * The fetch implementation and the clock are injected so the behaviour can be
 * tested without touching the network.
 */
export class WikidataClient {
  private lastRequestAt = 0;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly now: () => number = Date.now
  ) {}

  /** Wait until at least `MIN_REQUEST_INTERVAL_MS` has passed since the last request. */
  async throttle(): Promise<void> {
    const elapsed = this.now() - this.lastRequestAt;
    const wait = MIN_REQUEST_INTERVAL_MS - elapsed;
    if (this.lastRequestAt !== 0 && wait > 0) {
      await this.sleep(wait);
    }
  }

  /**
   * Run one SPARQL query and return the parsed result.
   *
   * The query travels in the `query=` parameter of a GET request, as the
   * service documents.
   *
   * A connection that never reaches the endpoint is retried once, after a
   * pause: the endpoint is a shared public service and a dropped connection
   * is not an answer. An HTTP response is never retried — a 429 in
   * particular stops the run.
   */
  async runQuery(
    queryText: string,
    { signal }: { signal?: AbortSignal } = {}
  ): Promise<SparqlResults> {
    for (let attempt = 1; attempt <= MAX_CONNECTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.request(queryText, signal);
      } catch (error) {
        // A connection that never reached the endpoint is not an answer: the
        // request is repeated, one at a time and after a pause. An HTTP
        // response is never repeated — a 429 in particular stops the run.
        if (!isConnectionError(error) || attempt === MAX_CONNECTION_ATTEMPTS) throw error;
        await this.sleep(RETRY_DELAY_MS);
      }
    }
    throw new Error("The Wikidata Query Service could not be reached.");
  }

  /** One request to the endpoint. */
  private async request(queryText: string, signal?: AbortSignal): Promise<SparqlResults> {
    await this.throttle();
    this.lastRequestAt = this.now();

    const url = new URL(WIKIDATA_SPARQL_ENDPOINT);
    url.searchParams.set("query", stripSparqlComments(queryText));

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": VERIDIAN_USER_AGENT,
      },
      // A redirect would take the request to an unregistered host.
      redirect: "error",
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const body = await response.text();

    if (response.status === 429) {
      throw new WikidataRateLimitError(response.status, body);
    }
    if (!response.ok) {
      throw new WikidataRequestError(response.status, body);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(
        `The Wikidata Query Service returned a body that is not JSON: ${body.slice(0, 500)}`
      );
    }

    return assertSparqlResults(parsed);
  }
}

/**
 * True when the failure was a connection that never reached the endpoint.
 *
 * An HTTP answer is never a connection error: the run must not repeat a
 * request the endpoint already answered.
 */
function isConnectionError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return false;
  const code = (cause as { code?: unknown }).code;
  return (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_SOCKET" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "EPIPE"
  );
}

/**
 * Remove SPARQL comments from a query.
 *
 * The query is kept as data in `data/wikidata-sparql.rq`, where it carries
 * the documentation a reviewer needs. The service takes the query in the URL
 * of a GET request, and a documented query does not fit in that URL, so the
 * comments are removed before the request is made. A `#` inside a string
 * literal is not a comment and is kept.
 */
export function stripSparqlComments(query: string): string {
  let out = "";
  let quote: '"' | "'" | null = null;
  let inComment = false;

  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];
    if (inComment) {
      if (char === "\n") {
        inComment = false;
        out += char;
      }
      continue;
    }
    if (quote) {
      out += char;
      if (char === "\\") {
        out += query[index + 1] ?? "";
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      continue;
    }
    if (char === "#") {
      inComment = true;
      continue;
    }
    out += char;
  }

  return out;
}

/**
 * How many specifications a row carries.
 *
 * A row without a manufacturer, a processor, an operating system and a
 * memory size cannot become a catalog fact, so the count says how far a row
 * can get.
 */
export function countSpecifications(row: WikidataRow): number {
  return [
    row.manufacturerLabel,
    row.cpuLabel,
    row.osLabel,
    row.ramAmount,
    row.massAmount,
    row.displaySizeAmount,
    row.releaseDate,
    row.ramTypeLabel,
    row.inventoryNumber,
    row.partNumber,
  ].filter((value) => value !== null && value !== undefined).length;
}

/**
 * Put the fetched rows in a deterministic order.
 *
 * The service gives no order of its own, and a stable order is what makes a
 * repeated run provably idempotent: the same rows are fetched, validated and
 * written every time. The rows that carry the most specifications come
 * first, so that a run limited to the first N rows shows the rows that can
 * actually become catalog facts; ties are broken by the row's own content.
 */
export function sortRows(rows: WikidataRow[]): WikidataRow[] {
  const key = (row: WikidataRow): string =>
    [
      row.itemLabel ?? "",
      row.itemId,
      row.cpuLabel ?? "",
      row.ramAmount ?? "",
      row.massAmount ?? "",
      row.displaySizeAmount ?? "",
      row.releaseDate ?? "",
      row.osLabel ?? "",
      row.ramUnit ?? "",
      row.massUnit ?? "",
      row.displaySizeUnit ?? "",
    ].join(" ");

  return [...rows].sort((a, b) => {
    const completeness = countSpecifications(b) - countSpecifications(a);
    if (completeness !== 0) return completeness;
    const left = key(a);
    const right = key(b);
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
}

/**
 * Check that a parsed body really is a SPARQL JSON result.
 *
 * A malformed payload is a failure, not an empty result: an empty catalog
 * must never be written because the endpoint answered with something else.
 */
export function assertSparqlResults(payload: unknown): SparqlResults {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("The Wikidata Query Service payload must be a JSON object");
  }
  const head = (payload as { head?: unknown }).head;
  const results = (payload as { results?: unknown }).results;
  if (typeof head !== "object" || head === null || !Array.isArray((head as { vars?: unknown }).vars)) {
    throw new Error("The Wikidata Query Service payload has no head.vars list");
  }
  if (
    typeof results !== "object" ||
    results === null ||
    !Array.isArray((results as { bindings?: unknown }).bindings)
  ) {
    throw new Error("The Wikidata Query Service payload has no results.bindings list");
  }
  return payload as SparqlResults;
}

// =============================================================================
// EXTRACTION
// =============================================================================

/** The value of one variable in one row, or null when it was not bound. */
function bindingValue(binding: SparqlBinding, name: string): string | null {
  const value = binding[name];
  if (!value || typeof value.value !== "string") return null;
  const text = value.value.trim();
  return text.length > 0 ? text : null;
}

/** The Q-id of an entity URI, or null when the value is not an entity. */
function entityId(value: string | null): string | null {
  if (!value) return null;
  const match = /\/(Q[1-9]\d*)$/.exec(value);
  return match ? match[1] : null;
}

/** A numeric value, or null when it was not bound or not a number. */
function bindingAmount(binding: SparqlBinding, name: string): number | null {
  const raw = bindingValue(binding, name);
  if (raw === null) return null;
  const parsed = Number(raw.replace(/^\+/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Turn the endpoint's rows into explicit source rows.
 *
 * Every field is an observation. A variable the endpoint did not bind stays
 * `null` — the source did not publish it, and nothing here fills the gap.
 */
export function extractRows(results: SparqlResults): WikidataRow[] {
  return results.results.bindings.map((binding) => ({
    itemId: entityId(bindingValue(binding, "item")) ?? bindingValue(binding, "item") ?? "",
    itemLabel: bindingValue(binding, "itemLabel"),

    manufacturerId: entityId(bindingValue(binding, "manufacturer")),
    manufacturerLabel: bindingValue(binding, "manufacturerLabel"),

    releaseDate: bindingValue(binding, "releaseDate"),

    cpuId: entityId(bindingValue(binding, "cpu")),
    cpuLabel: bindingValue(binding, "cpuLabel"),

    displaySizeAmount: bindingAmount(binding, "displayAmount"),
    displaySizeUnit: entityId(bindingValue(binding, "displayUnit")),

    massAmount: bindingAmount(binding, "massAmount"),
    massUnit: entityId(bindingValue(binding, "massUnit")),

    ramAmount: bindingAmount(binding, "ramAmount"),
    ramUnit: entityId(bindingValue(binding, "ramUnit")),
    ramTypeLabel: bindingValue(binding, "ramTypeLabel"),

    osId: entityId(bindingValue(binding, "os")),
    osLabel: bindingValue(binding, "osLabel"),

    inventoryNumber: bindingValue(binding, "inventoryNumber"),
    partNumber: bindingValue(binding, "partNumber"),

    predecessorId: entityId(bindingValue(binding, "predecessor")),
    predecessorLabel: bindingValue(binding, "predecessorLabel"),
    successorId: entityId(bindingValue(binding, "successor")),
    successorLabel: bindingValue(binding, "successorLabel"),
  }));
}
