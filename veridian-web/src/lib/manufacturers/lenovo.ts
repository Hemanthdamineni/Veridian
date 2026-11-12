import type { SpecTable } from "../verify/types";
import { parseSpecTable } from "../verify/parse";

/**
 * Lenovo specification verification.
 *
 * Lenovo's ThinkPad and Yoga technical-specification pages are rendered
 * client-side, so the values are not always in the server-rendered HTML.
 * The parsing of a Lenovo specification table lives in
 * `src/lib/verify/parse.ts` (`parseLenovoTable`, reachable through
 * `parseSpecTable`), next to the ASUS and Apple adapters. This module adds
 * the `ManufacturerSource` contract: a source fetches one page through an
 * injectable HTTP client and answers "what does the manufacturer publish
 * for these configurations?" It never decides pass or fail — the runner
 * compares the published values against the reference row.
 */

/** The URL of the specification page the adapter should fetch. */
export interface LenovoTarget {
  url: string;
}

/** The outcome of a fetch+parse: a table, or a documented reason it has none. */
export type ManufacturerReading =
  | { table: SpecTable }
  | { table: null; reason: string };

/**
 * A manufacturer specification source.
 *
 * `read` returns what the manufacturer publishes; it never guesses and it
 * never throws. A page that cannot be fetched is a documented `reason`, not
 * a pass or a fail.
 */
export interface ManufacturerSource {
  readonly name: string;
  read(target: LenovoTarget): Promise<ManufacturerReading>;
}

export interface LenovoSourceOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
}

export const LENOVO_SOURCE_NAME = "Lenovo PSREF / product specs";
export const LENOVO_TIMEOUT_MS = 30_000;

/**
 * Create a Lenovo specification source.
 *
 * `fetchImpl` is injectable so tests can feed it saved pages; it defaults to
 * the global fetch. The base URL defaults to Lenovo's PSREF (product
 * specification reference) host, the stable home of the per-part-number
 * specification tables.
 */
export function createLenovoSource(
  options: LenovoSourceOptions = {}
): ManufacturerSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? LENOVO_TIMEOUT_MS;
  const baseUrl = (options.baseUrl ?? "https://psref.lenovo.com/").replace(
    /\/+$/,
    ""
  );

  return {
    name: LENOVO_SOURCE_NAME,
    async read(target: LenovoTarget) {
      const url = `${baseUrl}/${target.url.replace(/^\//, "")}`;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            "User-Agent":
              "VeridianBot/1.0 (+https://veridian.dev; contact@veridian.dev)",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { table: null, reason: "fetch-error" };
      }
      if (!response.ok) {
        return { table: null, reason: `http-${response.status}` };
      }
      let html: string;
      try {
        html = await response.text();
      } catch {
        return { table: null, reason: "unreadable-body" };
      }
      const table = parseSpecTable(html, url, "Lenovo");
      return table === null
        ? { table: null, reason: "no-spec-table" }
        : { table };
    },
  };
}