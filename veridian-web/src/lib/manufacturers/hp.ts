import type { SpecTable } from "../verify/types";
import { parseSpecTable } from "../verify/parse";

/**
 * HP verification adapter.
 *
 * The manufacturer verification pipeline compares a reference row against the
 * values the manufacturer publishes on its own specification page. HP's
 * EliteBook, Spectre and OmniBook pages render one native specification table
 * with a header row of part numbers (such as `9G0Y0UA#ABA`) followed by rows
 * for `Processor`, `Memory`, `Storage`, `Display`, `Weight` and `Battery`.
 *
 * This adapter follows the same shape as the Dell adapter: an injectable
 * `fetchImpl` so the caller can run it against a saved page in tests, and a
 * `read` that never throws — a page that cannot be reached is reported as a
 * reason, never a failure.
 */

export interface HpTarget {
  url: string;
}

export type ManufacturerReading = { table: SpecTable } | { table: null; reason: string };

export interface ManufacturerSource {
  readonly name: string;
  read(target: HpTarget): Promise<ManufacturerReading>;
}

export interface HpSourceOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
}

export const HP_SOURCE_NAME = "HP Specifications";
export const HP_TIMEOUT_MS = 30_000;

export function createHpSource(options: HpSourceOptions = {}): ManufacturerSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? HP_TIMEOUT_MS;
  const baseUrl = (options.baseUrl ?? "https://www.hp.com").replace(/\/+$/, "");

  return {
    name: HP_SOURCE_NAME,
    async read(target) {
      const url = `${baseUrl}/${target.url.replace(/^\/+/, "")}`;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: {
            Accept: "text/html,application/json",
            "User-Agent": "VeridianBot/1.0 (+https://veridian.dev; contact@veridian.dev)",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { table: null, reason: "fetch-error" };
      }
      if (!response.ok) return { table: null, reason: `http-${response.status}` };
      let html: string;
      try {
        html = await response.text();
      } catch {
        return { table: null, reason: "unreadable-body" };
      }
      const table = parseSpecTable(html, url, "HP");
      if (table === null) return { table: null, reason: "no-spec-table" };
      return { table };
    },
  };
}