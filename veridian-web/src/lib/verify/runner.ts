/**
 * Running the manufacturer-specification verification (ADR-005).
 *
 * This module does the I/O and the policy. `robots.txt` is consulted before
 * every page is fetched, and a path the policy disallows is refused rather
 * than fetched; a policy that cannot be read is not permission, so the fetch
 * is refused as well. At most one request per second is made to any one host,
 * and the request identifies itself honestly: Veridian does not impersonate a
 * browser and does not work around an access control.
 *
 * A page that cannot be reached produces an unconfirmed result. It is never a
 * pass and never a failure.
 */

import fs from "node:fs";

import { verifyRowAgainstTable } from "./compare";
import { parseSpecTable } from "./parse";
import type {
  PageFetch,
  ReferenceRow,
  RowResult,
  SourceEntry,
  UnconfirmedReason,
  VerifyReport,
} from "./types";

/** The honest user agent Veridian identifies itself with. */
export const DEFAULT_USER_AGENT =
  "VeridianBot/1.0 (+https://veridian.dev; contact@veridian.dev)";

/** The shortest gap between two requests to the same host. */
export const DEFAULT_MIN_INTERVAL_MS = 1000;

/** The default request timeout. */
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface RunnerOptions {
  /** The reference dataset, `veridian-web/data/laptops.csv`. */
  referencePath: string;
  /** The registered sources, `veridian-web/data/verify-sources.csv`. */
  sourcesPath: string;
  /** The user agent every request identifies itself with. */
  userAgent?: string;
  /** The request timeout in milliseconds. */
  timeoutMs?: number;
  /** The shortest gap between two requests to the same host. */
  minIntervalMs?: number;
  /** The fetch implementation, replaceable in tests. */
  fetchImpl?: typeof fetch;
  /** Check only these part numbers. Other rows are not even attempted. */
  only?: string[];
}

/* ---- CSV ---- */

/** Parse CSV text into rows of cells, honouring quoted cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => entry.length > 1 || (entry.length === 1 && entry[0] !== ""));
}

function quoteCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Read a CSV file into a list of records keyed by the header row. */
export function readCsvRecords(filePath: string): Array<Record<string, string>> {
  const rows = parseCsv(fs.readFileSync(filePath, "utf-8"));
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((name, index) => {
      record[name.trim()] = (cells[index] ?? "").trim();
    });
    return record;
  });
}

/** Write records back to a CSV file, preserving the header and the order. */
export function writeCsvRecords(
  filePath: string,
  header: string[],
  records: Array<Record<string, string>>,
  lineEnding = "\n"
): void {
  const lines = [header.map(quoteCell).join(",")];
  for (const record of records) {
    lines.push(header.map((name) => quoteCell(record[name] ?? "")).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join(lineEnding)}${lineEnding}`, "utf-8");
}

/* ---- robots.txt ---- */

interface RobotsRule {
  pattern: string;
  allow: boolean;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelay?: number;
}

/** Parse a `robots.txt` into its groups. */
export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let expectingAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!current || !expectingAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
        expectingAgent = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    expectingAgent = false;
    if (!current) continue;
    if (field === "disallow") current.rules.push({ pattern: value, allow: false });
    else if (field === "allow") current.rules.push({ pattern: value, allow: true });
    else if (field === "crawl-delay") {
      const delay = Number.parseFloat(value);
      if (Number.isFinite(delay)) current.crawlDelay = delay;
    }
  }
  return groups;
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`);
}

/**
 * The groups that apply to this agent (RFC 9309 section 2.2.2): the most
 * specific matching user-agent token wins, and the `*` group is only used when
 * no named group matches.
 */
function matchingGroups(groups: RobotsGroup[], userAgent: string): RobotsGroup[] {
  const token = userAgent.split("/")[0].trim().toLowerCase();
  let best = -1;
  let selected: RobotsGroup[] = [];
  for (const group of groups) {
    let specificity = -1;
    for (const agent of group.agents) {
      if (!agent) continue;
      if (agent === "*") specificity = Math.max(specificity, 0);
      else if (token.startsWith(agent)) specificity = Math.max(specificity, agent.length);
    }
    if (specificity < 0) continue;
    if (specificity > best) {
      best = specificity;
      selected = [group];
    } else if (specificity === best) {
      selected.push(group);
    }
  }
  return selected;
}

/**
 * Evaluate a `robots.txt` for one URL (RFC 9309 section 2.2): within the
 * matching group the longest matching pattern wins, and `Allow` wins a tie
 * against `Disallow`.
 */
export function robotsAllows(groups: RobotsGroup[], url: string, userAgent: string): boolean {
  const selected = matchingGroups(groups, userAgent);
  if (selected.length === 0) return true;
  const parsed = new URL(url);
  const target = parsed.pathname || "/";
  const query = parsed.search ? `${target}${parsed.search}` : target;
  let bestLength = -1;
  let allowed = true;
  for (const group of selected) {
    for (const rule of group.rules) {
      if (!rule.pattern) continue;
      const scope = rule.pattern.endsWith("$") ? target : query;
      if (!patternToRegExp(rule.pattern).test(scope)) continue;
      if (rule.pattern.length > bestLength) {
        bestLength = rule.pattern.length;
        allowed = rule.allow;
      } else if (rule.pattern.length === bestLength && rule.allow) {
        allowed = true;
      }
    }
  }
  return allowed;
}

/** The crawl delay the matched group declares, in milliseconds. */
export function robotsCrawlDelay(groups: RobotsGroup[], userAgent: string): number {
  const groups2 = matchingGroups(groups, userAgent);
  const delay = groups2.find((group) => group.crawlDelay !== undefined)?.crawlDelay;
  return delay === undefined ? 0 : Math.round(delay * 1000);
}

/* ---- Fetching ---- */

/** Keeps at most one request per second per host. */
export class HostRateLimiter {
  private lastRequest = new Map<string, number>();
  private minimums = new Map<string, number>();

  constructor(private readonly minIntervalMs: number = DEFAULT_MIN_INTERVAL_MS) {}

  /** Raise the gap for one host, as a `Crawl-delay` directive requires. */
  setMinimum(host: string, intervalMs: number): void {
    if (intervalMs > (this.minimums.get(host) ?? 0)) this.minimums.set(host, intervalMs);
  }

  async wait(host: string): Promise<void> {
    const interval = Math.max(this.minIntervalMs, this.minimums.get(host) ?? 0);
    const last = this.lastRequest.get(host);
    const now = Date.now();
    if (last !== undefined) {
      const due = last + interval;
      if (due > now) await new Promise((resolve) => setTimeout(resolve, due - now));
    }
    this.lastRequest.set(host, Date.now());
  }
}

export interface RobotsVerdict {
  allowed: boolean;
  reason?: UnconfirmedReason;
  detail?: string;
}

/**
 * Reads and evaluates the `robots.txt` of every host it is asked about. The
 * policy is consulted before every request and the answer is cached, so a
 * page is never fetched without a policy check.
 */
export class RobotsPolicy {
  private cache = new Map<string, RobotsGroup[] | null>();
  private failures = new Map<string, string>();

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly userAgent: string,
    private readonly limiter: HostRateLimiter,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {}

  /** Is the URL permitted for this agent? */
  async check(url: string): Promise<RobotsVerdict> {
    const origin = new URL(url).origin;
    const failure = this.failures.get(origin);
    if (failure) {
      return { allowed: false, reason: "robots-unavailable", detail: failure };
    }
    if (!this.cache.has(origin)) await this.load(origin);
    const groups = this.cache.get(origin);
    if (groups === undefined) {
      return { allowed: false, reason: "robots-unavailable", detail: "the policy could not be read" };
    }
    if (groups === null) return { allowed: true };
    if (!robotsAllows(groups, url, this.userAgent)) {
      return {
        allowed: false,
        reason: "robots-disallowed",
        detail: `robots.txt does not permit ${this.userAgent} to fetch ${url}`,
      };
    }
    return { allowed: true };
  }

  private async load(origin: string): Promise<void> {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      await this.limiter.wait(new URL(robotsUrl).host);
      const response = await this.fetchImpl(robotsUrl, {
        headers: { "User-Agent": this.userAgent },
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "follow",
      });
      if (response.status === 404 || response.status === 410) {
        // RFC 9309 section 2.3.1.3: no robots.txt means everything is allowed.
        this.cache.set(origin, null);
        return;
      }
      if (!response.ok) {
        this.failures.set(
          origin,
          `robots.txt for ${origin} returned HTTP ${response.status}; refusing to fetch`
        );
        return;
      }
      const groups = parseRobots(await response.text());
      this.cache.set(origin, groups);
      const delay = robotsCrawlDelay(groups, this.userAgent);
      if (delay > 0) this.limiter.setMinimum(new URL(robotsUrl).host, delay);
    } catch (error) {
      this.failures.set(
        origin,
        `robots.txt for ${origin} could not be retrieved: ${(error as Error).message}`
      );
    }
  }
}

/* ---- Running the verification ---- */

interface FetchedPage {
  url: string;
  status: number;
  outcome: PageFetch["outcome"];
  detail?: string;
  html?: string;
}

/** Load the reference rows and the registered sources. */
export function loadInputs(
  referencePath: string,
  sourcesPath: string
): { rows: ReferenceRow[]; sources: Map<string, SourceEntry> } {
  const rows = readCsvRecords(referencePath) as ReferenceRow[];
  const sources = new Map<string, SourceEntry>();
  if (fs.existsSync(sourcesPath)) {
    for (const record of readCsvRecords(sourcesPath)) {
      const entry: SourceEntry = {
        sku_code: record.sku_code ?? "",
        manufacturer: record.manufacturer ?? "",
        region: record.region ?? "",
        spec_url: record.spec_url ?? "",
        part_number: record.part_number ?? "",
      };
      if (entry.sku_code && entry.spec_url) sources.set(entry.sku_code, entry);
    }
  }
  return { rows, sources };
}

/** Build a row result for a row that could not be confirmed. */
function unconfirmed(
  row: ReferenceRow,
  reason: UnconfirmedReason,
  detail: string,
  sourceUrl?: string
): RowResult {
  return {
    sku_code: row.sku_code,
    manufacturer: row.manufacturer,
    model: row.model,
    status: reason === "no-source-page" ? "not-attempted" : "unconfirmed",
    sourceUrl,
    observed: {},
    contradictions: [],
    reason,
    detail,
  };
}

/**
 * Check every reference row against the manufacturer page registered for it.
 * Rows without a registered page are reported as not attempted; they stay
 * unverified.
 */
export async function runVerification(options: RunnerOptions): Promise<VerifyReport> {
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const limiter = new HostRateLimiter(options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
  const policy = new RobotsPolicy(fetchImpl, userAgent, limiter, timeoutMs);
  const { rows, sources } = loadInputs(options.referencePath, options.sourcesPath);
  const wanted = options.only && options.only.length > 0 ? new Set(options.only) : null;
  const pages = new Map<string, FetchedPage>();
  const pageList: PageFetch[] = [];
  const results: RowResult[] = [];

  for (const row of rows) {
    if (wanted && !wanted.has(row.sku_code)) continue;
    const entry = sources.get(row.sku_code);
    if (!entry) {
      results.push(
        unconfirmed(
          row,
          "no-source-page",
          "no manufacturer specification page is registered for this row"
        )
      );
      continue;
    }
    const key = entry.spec_url.trim();
    let page = pages.get(key);
    if (!page) {
      page = await fetchPage(fetchImpl, policy, limiter, userAgent, timeoutMs, entry.spec_url);
      pages.set(key, page);
      pageList.push({ url: page.url, status: page.status, outcome: page.outcome, detail: page.detail });
    }
    if (page.outcome !== "ok") {
      results.push(
        unconfirmed(
          row,
          page.outcome === "robots-disallowed" ? "robots-disallowed" : "page-unreachable",
          page.detail ?? "the manufacturer page could not be reached",
          page.url
        )
      );
      continue;
    }
    const table = parseSpecTable(page.html ?? "", page.url, entry.manufacturer);
    if (!table) {
      results.push(
        unconfirmed(
          row,
          "no-spec-table",
          "no specification table was found on the manufacturer page",
          page.url
        )
      );
      continue;
    }
    const outcome = verifyRowAgainstTable(row, table);
    results.push({
      sku_code: row.sku_code,
      manufacturer: row.manufacturer,
      model: row.model,
      status: outcome.status,
      sourceUrl: table.sourceUrl,
      partNumber: outcome.partNumber,
      observed: outcome.observed,
      contradictions: outcome.contradictions,
      reason: outcome.reason,
      detail: outcome.detail,
    });
  }

  const confirmed = results.filter((result) => result.status === "confirmed").length;
  const contradicted = results.filter((result) => result.status === "contradicted").length;
  return {
    rowsChecked: results.length,
    confirmed,
    contradicted,
    unconfirmed: results.length - confirmed - contradicted,
    notAttempted: results.filter((result) => result.status === "not-attempted").length,
    errors: results.filter((result) => result.status === "error").length,
    contradictions: results.flatMap((result) => result.contradictions),
    results,
    pages: pageList,
  };
}

async function fetchPage(
  fetchImpl: typeof fetch,
  policy: RobotsPolicy,
  limiter: HostRateLimiter,
  userAgent: string,
  timeoutMs: number,
  url: string
): Promise<FetchedPage> {
  const verdict = await policy.check(url);
  if (!verdict.allowed) {
    return {
      url,
      status: 0,
      outcome: verdict.reason === "robots-disallowed" ? "robots-disallowed" : "robots-unavailable",
      detail: verdict.detail,
    };
  }
  await limiter.wait(new URL(url).host);
  try {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    const finalUrl = response.url || url;
    if (!response.ok) {
      return {
        url: finalUrl,
        status: response.status,
        outcome: "error",
        detail: `the manufacturer page returned HTTP ${response.status}`,
      };
    }
    if (finalUrl.replace(/\/$/, "") !== url.replace(/\/$/, "")) {
      return {
        url: finalUrl,
        status: response.status,
        outcome: "error",
        detail: `the page redirected to ${finalUrl}, which is not the registered specification page`,
      };
    }
    return { url: finalUrl, status: response.status, outcome: "ok", html: await response.text() };
  } catch (error) {
    return {
      url,
      status: 0,
      outcome: "error",
      detail: `the manufacturer page could not be reached: ${(error as Error).message}`,
    };
  }
}

/* ---- Applying the result to the reference dataset ---- */

/** What a write-back changed. */
export interface ApplyResult {
  /** Rows whose fields were corrected from a manufacturer value. */
  corrected: Array<{ sku_code: string; field: string; from: string; to: string }>;
  /** Rows that were marked as verified against a manufacturer page. */
  verified: string[];
  /** Rows whose citation was recorded. */
  cited: string[];
}

/**
 * Write the confirmed manufacturer values back into the reference dataset.
 *
 * Only a value the manufacturer states unambiguously is written, and only a
 * row the page confirmed without contradicting anything is marked as
 * verified. A value that was not confirmed is never changed.
 */
export function applyCorrections(referencePath: string, report: VerifyReport): ApplyResult {
  const text = fs.readFileSync(referencePath, "utf-8");
  const rows = parseCsv(text);
  const header = rows[0];
  const records = rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((name, index) => {
      record[name.trim()] = cells[index] ?? "";
    });
    return record;
  });
  const bySku = new Map(records.map((record) => [record.sku_code, record]));
  const result: ApplyResult = { corrected: [], verified: [], cited: [] };
  for (const row of report.results) {
    const record = bySku.get(row.sku_code);
    if (!record) continue;
    for (const contradiction of row.contradictions) {
      if (!contradiction.correction) continue;
      const current = (record[contradiction.field] ?? "").trim();
      if (!current || current === contradiction.correction) continue;
      record[contradiction.field] = contradiction.correction;
      result.corrected.push({
        sku_code: row.sku_code,
        field: contradiction.field,
        from: current,
        to: contradiction.correction,
      });
    }
    if (row.status === "confirmed" && row.sourceUrl) {
      if ((record.verified ?? "").trim() !== "true") result.verified.push(row.sku_code);
      record.verified = "true";
      if (record.source_url !== row.sourceUrl) {
        record.source_url = row.sourceUrl;
        result.cited.push(row.sku_code);
      }
    }
  }
  writeCsvRecords(referencePath, header, records, text.includes("\r\n") ? "\r\n" : "\n");
  return result;
}
