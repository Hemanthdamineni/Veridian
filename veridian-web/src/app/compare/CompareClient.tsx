"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatPrice } from "@/lib/format";
import { REGIONS } from "@/types";

interface CompareSku {
  id: string;
  sku_code: string;
  name: string;
  brand: string;
  series: string;
  specs: Record<string, unknown>;
  pricing: { region: string; currency: string; msrp: number; available: boolean }[];
}

interface ComparisonResponse {
  comparison: CompareSku[];
  analysis?: Record<string, { winner: string; explanation: string }>;
  availableRegions?: string[];
}

interface Candidate {
  id: string;
  modelName: string;
  manufacturerName: string;
  skuCode: string;
}

const labels: Record<string, string> = {
  cpu: "Processor",
  memory: "Memory",
  storage: "Storage",
  display: "Display",
  physical: "Physical",
  battery: "Battery",
  graphics: "Graphics",
};

const MAX = 5;

export function CompareClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawIds = searchParams.get("ids") || "";

  const [region, setRegion] = useState("US");
  const [availableRegions, setAvailableRegions] = useState<string[]>(["US"]);
  const [data, setData] = useState<ComparisonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchComparison = useCallback(
    async (ids: string, regionCode: string) => {
      if (!ids) {
        setData(null);
        setError(null);
        return;
      }
      setError(null);
      try {
        const res = await fetch(
          `/api/v1/compare?ids=${encodeURIComponent(ids)}&region=${encodeURIComponent(regionCode)}`
        );
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Comparison failed");
        setData(body as ComparisonResponse);
        if (body.availableRegions?.length) setAvailableRegions(body.availableRegions);
      } catch (err) {
        setData(null);
        setError(err instanceof Error ? err.message : "Could not load the comparison.");
      }
    },
    []
  );

  // URL and region are external navigation state; reload when either changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchComparison(rawIds, region);
  }, [rawIds, region, fetchComparison]);

  // Debounced catalog search for the picker.
  useEffect(() => {
    if (search.trim().length < 2) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/skus?q=${encodeURIComponent(search.trim())}&limit=8`);
        const body = await res.json();
        setCandidates(body.results ?? []);
      } catch {
        setCandidates([]);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search]);

  const ids = rawIds.split(",").filter(Boolean);

  const updateIds = useCallback(
    (next: string[]) => {
      router.replace(next.length ? `/compare?ids=${next.join(",")}` : "/compare", { scroll: false });
      setPickerOpen(false);
    },
    [router]
  );

  const toggle = (id: string) => {
    if (ids.includes(id)) updateIds(ids.filter((x) => x !== id));
    else if (ids.length < MAX) updateIds([...ids, id]);
  };

  const winners = new Map<string, string>();
  if (data?.analysis) {
    for (const [category, { winner, explanation }] of Object.entries(data.analysis)) {
      const label = labels[category] || category;
      winners.set(winner, (winners.get(winner) || "") + `${label}: ${explanation}`);
    }
  }

  return (
    <div className="space-y-8">
      {/* Toolbar */}
      <div className="flex flex-col justify-between gap-4 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] p-5 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="label mb-0">Price region</span>
            <div className="flex flex-wrap gap-1 rounded-[5px] p-0.5" role="radiogroup" aria-label="Price region">
              {REGIONS.filter((r) => availableRegions.includes(r)).map((r) => (
                <button key={r} type="button" onClick={() => setRegion(r)}
                  role="radio" aria-checked={region === r}
                  className={`rounded-[4px] px-2.5 py-1.5 text-[12px] font-medium transition-colors ${region === r ? "bg-[var(--ink)] text-white" : "text-[var(--muted)] hover:bg-[#eceae5]"}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[12px] text-[var(--muted)]">{ids.length}/{MAX} selected</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen} aria-controls="compare-picker">
          {pickerOpen ? "Done adding" : "+ Add a laptop"}
        </button>
      </div>

      {/* Picker */}
      {pickerOpen && (
        <section id="compare-picker" className="surface p-5">
          <label className="label" htmlFor="pick-search">Find a model or SKU</label>
          <input id="pick-search" className="field" type="text" placeholder="e.g. Zenbook, ThinkPad, XPS…" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
          <div className="mt-3">
            {searching ? (
              <p className="text-[12px] text-[var(--muted)]" aria-live="polite">Searching…</p>
            ) : candidates.length === 0 ? (
              search.trim().length >= 2 ? (
                <p className="text-[12px] text-[var(--muted)]">No matches found.</p>
              ) : (
                <p className="text-[12px] text-[var(--muted)]">Type at least two characters to search.</p>
              )
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {candidates.map((c) => {
                  const selected = ids.includes(c.id);
                  return (
                    <li key={c.id}>
                      <button type="button" onClick={() => toggle(c.id)} disabled={ids.length >= MAX && !selected}
                        className="flex w-full items-center justify-between gap-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-45">
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium">{c.manufacturerName} {c.modelName}</span>
                          <span className="block truncate font-mono text-[11px] text-[var(--muted)]">{c.skuCode}</span>
                        </span>
                        <span className={`shrink-0 rounded-[5px] px-2 py-1 text-[11px] font-medium ${selected ? "bg-[var(--ink)] text-white" : "border border-[var(--line-strong)] text-[var(--muted)]"}`}>
                          {selected ? "Added" : "Add"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* Body */}
      {!rawIds ? (
        <EmptyState />
      ) : ids.length < 2 && !error ? (
        <div className="surface p-8 text-center">
          <p className="font-display text-[20px] tracking-[-.02em]">Add one more laptop to compare</p>
          <p className="mt-2 text-[13px] text-[var(--muted)]">A comparison needs at least two configurations. Use &ldquo;Add a laptop&rdquo; to pick the next one.</p>
        </div>
      ) : error ? (
        <div className="surface p-10 text-center" role="alert">
          <p className="font-display text-[22px] tracking-[-.02em]">The comparison could not be loaded.</p>
          <p className="mt-2 text-[13px] text-[var(--muted)]">{error}</p>
        </div>
      ) : !data ? (
        <div className="surface p-8" aria-busy="true" aria-label="Loading comparison">
          <div className="h-4 w-44 animate-pulse rounded bg-[#ebe9e4]" />
          <div className="mt-5 h-64 animate-pulse rounded bg-[#f0efeb]" />
        </div>
      ) : (
        <ComparisonTable skus={data.comparison} winners={winners} region={region} />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="surface p-5 text-center sm:p-8 lg:p-12">
      <p className="eyebrow mb-3">Start comparing</p>
      <h2 className="font-display text-[26px] tracking-[-.03em]">Add at least two laptops</h2>
      <p className="mx-auto mt-3 max-w-md text-[13px] leading-6 text-[var(--muted)]">Use the &ldquo;Add a laptop&rdquo; button to build your shortlist, or revisit your catalog and open a few configuration pages.</p>
      <Link href="/" className="btn-secondary mt-6">Browse the catalog</Link>
    </div>
  );
}

function ComparisonTable({
  skus,
  winners,
  region,
}: {
  skus: CompareSku[];
  winners: Map<string, string>;
  region: string;
}) {
  return (
    <div className="overflow-x-auto rounded-[8px] border border-[var(--line)] bg-[var(--surface)]" data-allow-overflow>
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <caption className="sr-only">Side-by-side specification comparison</caption>
        <thead>
          <tr className="border-b border-[var(--line)]">
            <th scope="col" className="sticky left-0 min-w-[220px] bg-[var(--surface)] px-4 py-4 text-left align-bottom font-semibold text-[var(--muted)]">Specification</th>
            {skus.map((s) => {
              const price = s.pricing.find((p) => p.region === region) ?? s.pricing[0] ?? null;
              return (
                <th key={s.id} scope="col" className="min-w-[220px] border-l border-[var(--line)] px-4 py-4 text-left align-top">
                  <div className="font-medium leading-tight">{s.brand} {s.name}</div>
                  <div className="mt-1 font-mono text-[10px] text-[var(--muted)]">{s.sku_code}</div>
                  {price ? (
                    <>
                      <div className="mt-3 font-mono text-[13px] font-semibold tabular-nums">
                        {formatPrice(price.msrp, price.currency)}
                      </div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-[.08em] text-[var(--quiet)]">
                        MSRP · {price.region}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mt-3 text-[11px] font-medium text-[var(--muted)]">Price not reported</div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-[.08em] text-[var(--quiet)]">for this region</div>
                    </>
                  )}
                  {winners.has(s.id) && (
                    <div className="mt-2 space-y-1 text-[11px] text-[var(--success)]">
                      <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--quiet)]">Leads in</p>
                      <ul className="list-disc pl-4">{winners.get(s.id)!.split("\n").map((l, i) => <li key={i}>{l}</li>)}</ul>
                    </div>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {Object.entries(labels).flatMap(([group, groupLabel]) => {
            const keys = skus[0] ? Object.keys((skus[0].specs[group] as Record<string, unknown>) || {}) : [];
            if (keys.length === 0) return [];
            return [
              <tr key={`g-${group}`}>
                <th colSpan={skus.length + 1} scope="colgroup" className="bg-[var(--surface-soft)] px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[.1em] text-[var(--muted)]">{groupLabel}</th>
              </tr>,
              ...keys.map((key) => {
                const values = skus.map((s) => valueText((s.specs[group] as Record<string, unknown>)?.[key]));
                const distinct = new Set(values).size > 1;
                const label = key.replaceAll("_", " ");
                return (
                  <tr key={`${group}-${key}`} className="border-t border-[var(--line)]">
                    <th scope="row" className="sticky left-0 bg-[var(--surface)] px-4 py-2.5 font-medium capitalize text-[var(--muted)]">{label}</th>
                    {skus.map((s) => {
                      const v = valueText((s.specs[group] as Record<string, unknown>)?.[key]);
                      return (
                        <td key={s.id} className={`border-l border-[var(--line)] px-4 py-2.5 ${distinct ? "bg-[var(--accent-soft)] font-medium text-[var(--ink)]" : "text-[var(--muted)]"}`}>
                          {v === "" ? "—" : v}
                        </td>
                      );
                    })}
                  </tr>
                );
              }),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function valueText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([, v]) => String(v));
    return parts.join(" · ");
  }
  return String(value);
}
