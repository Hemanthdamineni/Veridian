"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Plain-language search.
 *
 * The catalog already understands a sentence ("a light 14 inch OLED laptop
 * under 1500 dollars with 32 GB of RAM"). The parser behind `/api/search`
 * turns that into structured filters and returns them alongside the results,
 * so the interface can show exactly how the sentence was read. Showing the
 * interpretation is what makes the feature trustworthy: a user can see when
 * the parser misunderstood them and adjust.
 */

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
  const [focused, setFocused] = useState(false);

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
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
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
          <p className="label mb-2">How that was read</p>
          {resultCount !== null && (
            <p className="mb-3 text-[13px] text-[var(--ink)]">
              <strong className="font-semibold tabular-nums">{resultCount.toLocaleString()}</strong>{" "}
              {resultCount === 1 ? "configuration matches" : "configurations match"} this reading.
            </p>
          )}
          <ul className="flex flex-wrap gap-1.5">
            {describeFilters(parsed).map((item) => (
              <li
                key={item.label}
                className="rounded-[5px] border border-[var(--line)] bg-[var(--surface-soft)] px-2 py-1 text-[11px] text-[var(--muted)]"
              >
                <span className="text-[var(--quiet)]">{item.label}:</span>{" "}
                <span className="font-medium text-[var(--ink)]">{item.value}</span>
              </li>
            ))}
            {describeFilters(parsed).length === 0 && (
              <li className="text-[12px] text-[var(--muted)]">
                No structured constraints were recognised — the remaining words were matched against
                model names and part numbers.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Human-readable rendering of the filters the parser extracted. */
export function describeFilters(parsed: ParsedFilters): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  if (parsed.cpu_brand) out.push({ label: "Processor", value: parsed.cpu_brand });
  if (parsed.ram_min) out.push({ label: "RAM", value: `≥ ${parsed.ram_min} GB` });
  if (parsed.storage_min) out.push({ label: "Storage", value: `≥ ${parsed.storage_min} GB` });
  if (parsed.display_type) out.push({ label: "Display", value: parsed.display_type });
  if (parsed.weight_max) out.push({ label: "Weight", value: `≤ ${parsed.weight_max} kg` });
  if (parsed.price_max) out.push({ label: "Price", value: `≤ ${parsed.price_max}` });
  if (parsed.touch) out.push({ label: "Touch", value: parsed.touch === "true" ? "Yes" : "No" });
  if (parsed.q) out.push({ label: "Text", value: parsed.q });
  return out;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}
