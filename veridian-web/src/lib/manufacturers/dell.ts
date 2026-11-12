import type { SpecTable } from "../verify/types";
import { parseSpecTable } from "../verify/parse";

/**
 * Dell specification verification.
 *
 * Dell's XPS and Latitude 'Tech Specs' pages render a native specification
 * table with one column per Dell part number. The parsing of a Dell
 * specification table lives in `src/lib/verify/parse.ts` (`parseDellTable`,
 * reachable through `parseSpecTable`), next to the ASUS, Apple and Lenovo
 * adapters. This module adds the `ManufacturerSource` contract: a source
 * fetches one page through an injectable HTTP client and answers "what does
 * the manufacturer publish for these configurations?" It never decides pass
 * or fail — the runner compares the published values against the reference
 * row.
 */

/** The URL of the specification page the adapter should fetch. */
export interface DellTarget {
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
  read(target: DellTarget): Promise<ManufacturerReading>;
}

export interface DellSourceOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
}

export const DELL_SOURCE_NAME = "Dell Tech Specs";
export const DELL_TIMEOUT_MS = 30_000;

/**
 * Create a Dell specification source.
 *
 * `fetchImpl` is injectable so tests can feed it saved pages; it defaults to
 * the global fetch. The base URL defaults to Dell's product-specifications
 * host, where the 'Tech Specs' tables for XPS and Latitude live.
 */
export function createDellSource(
  options: DellSourceOptions = {}
): ManufacturerSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DELL_TIMEOUT_MS;
  const baseUrl = (options.baseUrl ?? "https://www.dell.com").replace(
    /\/+$/,
    ""
  );

  return {
    name: DELL_SOURCE_NAME,
    async read(target: DellTarget) {
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
      const table = parseSpecTable(html, url, "Dell");
      return table === null
        ? { table: null, reason: "no-spec-table" }
        : { table };
    },
  };
}