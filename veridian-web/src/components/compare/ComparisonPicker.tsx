"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PROVENANCE_LABELS, type SkuProvenance } from "@/types";
import { COMPARE_MAX_CONFIGS, buildCompareUrl } from "@/lib/compare";

/**
 * The comparison picker.
 *
 * The selection lives in the URL, so a comparison is shareable: the same
 * `?ids=` link always rebuilds the same comparison. Every control here is a
 * real button or a real input, so the whole picker is reachable from the
 * keyboard, and the current selection is always on screen.
 */

export interface PickerSelection {
  id: string;
  /** The configuration's display name. */
  label: string;
  skuCode: string;
  provenance: SkuProvenance;
}

interface SearchResult {
  id: string;
  label: string;
  skuCode: string;
  provenance: SkuProvenance;
}

interface ComparisonPickerProps {
  selected: PickerSelection[];
  region: string;
  availableRegions: string[];
  max?: number;
}

export function ComparisonPicker({
  selected,
  region,
  availableRegions,
  max = COMPARE_MAX_CONFIGS,
}: ComparisonPickerProps) {
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ids = selected.map((entry) => entry.id);
  const atLimit = ids.length >= max;

  const navigate = useCallback(
    (nextIds: string[], nextRegion: string) => {
      router.push(buildCompareUrl(nextIds, nextRegion), { scroll: false });
    },
    [router]
  );

  const add = useCallback(
    (id: string) => {
      if (ids.includes(id) || ids.length >= max) return;
      navigate([...ids, id], region);
    },
    [ids, max, navigate, region]
  );

  const remove = useCallback(
    (id: string) => {
      navigate(
        ids.filter((entry) => entry !== id),
        region
      );
    },
    [ids, navigate, region]
  );

  // Debounced catalog search. The request is only started from the timeout,
  // so the effect body never sets state directly.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(
          `/api/skus?q=${encodeURIComponent(trimmed)}&limit=8&region=${encodeURIComponent(region)}`
        );
        if (!response.ok) {
          setResults([]);
          return;
        }
        const body = (await response.json()) as {
          results?: Array<{
            id: string;
            modelName: string;
            manufacturerName: string;
            skuCode: string;
            provenance: SkuProvenance;
          }>;
        };
        setResults(
          (body.results ?? []).map((entry) => ({
            id: entry.id,
            label: `${entry.manufacturerName} ${entry.modelName}`,
            skuCode: entry.skuCode,
            provenance: entry.provenance,
          }))
        );
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 260);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, region]);

  const trimmedQuery = query.trim();
  const showResults = trimmedQuery.length >= 2;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <section aria-labelledby="compare-picker-heading" className="surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="compare-picker-heading" className="label mb-0">
          Configurations in this comparison
        </h2>
        <p className="text-[12px] text-[var(--muted)]">
          {ids.length} of {max} selected
        </p>
      </div>

      {availableRegions.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="label mb-0" id="compare-region-label">
            Price region
          </span>
          <div
            className="flex flex-wrap gap-1"
            role="radiogroup"
            aria-labelledby="compare-region-label"
          >
            {availableRegions.map((code) => (
              <button
                key={code}
                type="button"
                role="radio"
                aria-checked={region === code}
                onClick={() => navigate(ids, code)}
                className={`rounded-[5px] border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                  region === code
                    ? "border-[var(--ink)] bg-[var(--ink)] text-white"
                    : "border-[var(--line-strong)] text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
                }`}
              >
                {code}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The current selection is always visible. */}
      <ul className="mt-3 flex flex-wrap gap-2">
        {selected.length === 0 && (
          <li className="text-[12px] text-[var(--muted)]">
            Nothing selected yet. Search below to add the first configuration.
          </li>
        )}
        {selected.map((entry) => (
          <li key={entry.id}>
            <span className="flex items-center gap-2 rounded-[5px] border border-[var(--line-strong)] bg-[var(--surface-soft)] py-1 pl-2.5 pr-1">
              <span className="min-w-0">
                <span className="block max-w-[220px] truncate text-[12px] font-medium">
                  {entry.label}
                </span>
                <span className="block font-mono text-[10px] text-[var(--quiet)]">
                  {entry.skuCode} · {PROVENANCE_LABELS[entry.provenance]}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(entry.id)}
                aria-label={`Remove ${entry.label} from the comparison`}
                className="rounded-[4px] px-1.5 py-1 text-[12px] text-[var(--muted)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
              >
                <span aria-hidden="true">×</span>
              </button>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="compare-search">
            Add a configuration
          </label>
          <input
            id="compare-search"
            className="field"
            type="search"
            placeholder="Search a model name or SKU code"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={copyLink}>
            Copy share link
          </button>
          {ids.length > 0 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate([], region)}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {copyState === "copied"
          ? "The comparison link was copied to the clipboard."
          : copyState === "failed"
            ? "The link could not be copied. Copy it from the address bar instead."
            : ""}
      </p>

      {showResults && (
        <div className="mt-3">
          {searching ? (
            <p className="text-[12px] text-[var(--muted)]" aria-live="polite">
              Searching…
            </p>
          ) : results.length === 0 ? (
            <p className="text-[12px] text-[var(--muted)]" aria-live="polite">
              No configurations match “{trimmedQuery}”.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {results.map((entry) => {
                const alreadySelected = ids.includes(entry.id);
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => (alreadySelected ? remove(entry.id) : add(entry.id))}
                      disabled={!alreadySelected && atLimit}
                      className="flex w-full items-center justify-between gap-4 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">
                          {entry.label}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-[var(--quiet)]">
                          {entry.skuCode} · {PROVENANCE_LABELS[entry.provenance]}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded-[5px] px-2 py-1 text-[11px] font-medium ${
                          alreadySelected
                            ? "bg-[var(--ink)] text-white"
                            : "border border-[var(--line-strong)] text-[var(--muted)]"
                        }`}
                      >
                        {alreadySelected ? "Remove" : "Add"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {atLimit && (
        <p className="mt-3 text-[12px] text-[var(--muted)]">
          A comparison holds at most {max} configurations. Remove one to add another.
        </p>
      )}
    </section>
  );
}
