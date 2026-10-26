"use client";

import { useEffect, useRef } from "react";

/**
 * Plain-language search.
 *
 * The catalog already understands a sentence ("a light 14 inch OLED laptop
 * under 1500 dollars with 32 GB of RAM"). The parser behind `/api/search`
 * turns that into structured filters and returns them alongside the results,
 * so the interface can show exactly how the sentence was read. Showing the
 * interpretation is what makes the feature trustworthy: a user can see when
 * the parser misunderstood them and adjust.
 *
 * The endpoint also returns the words it could not interpret, the assumptions
 * it made and — when the sentence can genuinely be read two ways — the
 * alternative readings, so the reader can pick the one they meant.
 */

export interface AlternativeReading {
  /** What this reading assumes. */
  label: string;
  /** A sentence that re-parses into this reading. */
  query: string;
  /** How plausible this reading is, 0 – 1. */
  confidence: number;
  /** The filters this reading would apply. */
  filters?: Record<string, string | undefined>;
}

export interface ParsedFilters {
  q?: string;
  cpu_brand?: string;
  ram_min?: string;
  storage_min?: string;
  display_type?: string;
  weight_max?: string;
  price_max?: string;
  region?: string;
  sort?: string;
  touch?: string;
  // Added by the endpoint: the constraints that were applied beyond the
  // historical set, and the reasoning behind the reading.
  price_min?: string;
  refresh_min?: string;
  battery_min?: string;
  display_size?: string;
  nits_min?: string;
  gpu?: string;
  os?: string;
  cpu_family?: string;
  ignored_terms?: string[];
  assumptions?: string[];
  alternatives?: AlternativeReading[];
  confidence?: number;
}

interface Props {
  /** The current plain-language query, lifted so the URL can carry it. */
  value: string;
  onChange: (value: string) => void;
  /** Called when the user submits, so the parent can trigger a fetch. */
  onSubmit: (value: string) => void;
  /** The filters the parser extracted from the last submitted query. */
  parsed: ParsedFilters | null;
  /** True while a request is in flight. */
  loading: boolean;
  /** Number of results the last query produced. */
  resultCount: number | null;
}

const EXAMPLES = [
  "a light 14 inch OLED laptop with 32 GB of RAM",
  "gaming laptop with a dedicated GPU and 1 TB of storage",
  "under 1000 dollars, 16 GB RAM, full HD display",
  "cheapest laptop with the biggest screen",
];

export function PlainLanguageSearch({
  value,
  onChange,
  onSubmit,
  parsed,
  loading,
  resultCount,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses the search box, the way a search-first tool should.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "/" && !isTyping(event.target)) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const filters = describeFilters(parsed ?? {});
  const ignored = parsed?.ignored_terms ?? [];
  const assumptions = parsed?.assumptions ?? [];
  const alternatives = parsed?.alternatives ?? [];
  const confidence = parsed?.confidence;
  const applied = filters.length > 0;

  return (
    <div className="space-y-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
        role="search"
      >
        <label htmlFor="plain-language-search" className="label mb-2 block">
          Describe what you need
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="plain-language-search"
            ref={inputRef}
            className="field flex-1"
            type="search"
            value={value}
            placeholder="a light 14 inch OLED laptop with 32 GB of RAM"
            onChange={(event) => onChange(event.target.value)}
            aria-describedby="plain-language-help"
            autoComplete="off"
          />
          <button type="submit" className="btn-primary sm:w-auto" disabled={!value.trim() || loading}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
        <p id="plain-language-help" className="mt-2 text-[11px] leading-5 text-[var(--quiet)]">
          Press <kbd className="rounded border border-[var(--line-strong)] px-1">/</kbd> to focus. The
          sentence is turned into filters and shown back to you before you trust it.
        </p>
      </form>

      {!value.trim() && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-[.08em] text-[var(--quiet)]">Try</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="rounded-[5px] border border-[var(--line-strong)] px-2.5 py-1 text-[11px] text-[var(--muted)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)]"
              onClick={() => {
                onChange(example);
                onSubmit(example);
              }}
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {parsed && value.trim() && !loading && (
        <div className="surface p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="label mb-0">How that was read</p>
            {typeof confidence === "number" && (
              <span
                className="text-[11px] text-[var(--quiet)]"
                title="How confident the parser is in this reading of the sentence"
              >
                {confidence >= 0.66
                  ? "Confident reading"
                  : confidence >= 0.4
                    ? "Plausible reading"
                    : "Uncertain reading"}
              </span>
            )}
          </div>

          {resultCount !== null && (
            <p className="mb-3 text-[13px] text-[var(--ink)]">
              <strong className="font-semibold tabular-nums">{resultCount.toLocaleString()}</strong>{" "}
              {resultCount === 1 ? "configuration matches" : "configurations match"} this reading.
            </p>
          )}

          <ul className="flex flex-wrap gap-1.5">
            {filters.map((item) => (
              <li
                key={item.label}
                className="rounded-[5px] border border-[var(--line)] bg-[var(--surface-soft)] px-2 py-1 text-[11px] text-[var(--muted)]"
              >
                <span className="text-[var(--quiet)]">{item.label}:</span>{" "}
                <span className="font-medium text-[var(--ink)]">{item.value}</span>
              </li>
            ))}
            {!applied && (
              <li className="text-[12px] text-[var(--muted)]">
                No filters could be read from this sentence — the catalog is showing everything.
              </li>
            )}
          </ul>

          {ignored.length > 0 && (
            <p className="mt-3 text-[12px] leading-5 text-[var(--muted)]">
              <span className="text-[var(--quiet)]">I ignored these words:</span>{" "}
              <span className="font-medium text-[var(--ink)]">{ignored.join(", ")}</span> — the catalog
              has no filter that can act on them.
            </p>
          )}

          {assumptions.length > 0 && (
            <ul className="mt-3 space-y-1 text-[12px] leading-5 text-[var(--muted)]">
              <li className="text-[var(--quiet)]">I assumed:</li>
              {assumptions.map((assumption) => (
                <li key={assumption} className="pl-3">
                  {assumption}
                </li>
              ))}
            </ul>
          )}

          {alternatives.length > 0 && (
            <div className="mt-4 border-t border-[var(--line)] pt-3">
              <p className="text-[12px] text-[var(--muted)]">
                This sentence can be read more than one way. Read it as:
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {alternatives.map((alternative) => (
                  <li key={alternative.label}>
                    <button
                      type="button"
                      className="rounded-[5px] border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 py-1 text-[11px] text-[var(--muted)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)]"
                      onClick={() => {
                        onChange(alternative.query);
                        onSubmit(alternative.query);
                      }}
                    >
                      {alternative.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Human-readable rendering of the filters the parser extracted. */
export function describeFilters(parsed: ParsedFilters): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  if (parsed.cpu_brand) out.push({ label: "Processor", value: parsed.cpu_brand });
  if (parsed.cpu_family) out.push({ label: "Processor family", value: parsed.cpu_family });
  if (parsed.ram_min) out.push({ label: "RAM", value: `≥ ${parsed.ram_min} GB` });
  if (parsed.storage_min) out.push({ label: "Storage", value: `≥ ${parsed.storage_min} GB` });
  if (parsed.display_type) out.push({ label: "Display", value: parsed.display_type });
  if (parsed.display_size) out.push({ label: "Screen size", value: `${parsed.display_size} in` });
  if (parsed.refresh_min) out.push({ label: "Refresh rate", value: `≥ ${parsed.refresh_min} Hz` });
  if (parsed.nits_min) out.push({ label: "Brightness", value: `≥ ${parsed.nits_min} nits` });
  if (parsed.gpu) out.push({ label: "Graphics", value: parsed.gpu });
  if (parsed.os) out.push({ label: "Operating system", value: parsed.os });
  if (parsed.weight_max) out.push({ label: "Weight", value: `≤ ${parsed.weight_max} kg` });
  if (parsed.battery_min) out.push({ label: "Battery", value: `≥ ${parsed.battery_min} Wh` });
  if (parsed.price_min) out.push({ label: "Price", value: `≥ ${parsed.price_min}` });
  if (parsed.price_max) out.push({ label: "Price", value: `≤ ${parsed.price_max}` });
  if (parsed.touch) out.push({ label: "Touch", value: parsed.touch === "true" ? "Yes" : "No" });
  if (parsed.sort) out.push({ label: "Sorted by", value: describeSort(parsed.sort) });
  if (parsed.q) out.push({ label: "Text", value: parsed.q });
  return out;
}

/** A readable name for the order the results are shown in. */
export function describeSort(sort: string): string {
  switch (sort) {
    case "price_asc":
      return "cheapest first";
    case "price_desc":
      return "most expensive first";
    case "weight_asc":
      return "lightest first";
    case "battery_desc":
      return "longest battery life first";
    case "display_size_desc":
      return "largest screen first";
    case "ram_desc":
      return "most memory first";
    case "newest":
      return "newest first";
    default:
      return sort;
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}
