"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FilterPanel } from "@/components/FilterPanel";
import { PlainLanguageSearch, type ParsedFilters } from "@/components/PlainLanguageSearch";
import { SkuCard, SkuCardSkeleton } from "@/components/SkuCard";
import { Pagination } from "@/components/Pagination";
import { SortSelect } from "@/components/SortSelect";
import {
  DEFAULT_FILTERS,
  activeChips,
  filtersToQuery,
  hasActiveFilters,
  queryToFilters,
  type FilterState,
} from "@/lib/catalog";
import type { SkuListItem } from "@/types";

interface CatalogResponse {
  results: SkuListItem[];
  pagination: { page: number; limit: number; totalResults: number; totalPages: number };
  availableRegions?: string[];
  tiers?: { certified: number; manufacturer: number; unverified: number };
  /** Only present on the plain-language endpoint. */
  parsed_filters?: Record<string, string | undefined>;
}

const LIMIT = 24;

export function CatalogApp({ initial }: { initial: CatalogResponse }) {
  const urlParams = useSearchParams();
  const urlKey = urlParams.toString();

  const [filters, setFilters] = useState<FilterState>(() => ({
    ...DEFAULT_FILTERS,
    ...queryToFilters(new URLSearchParams(urlKey)),
  }));
  const [data, setData] = useState<CatalogResponse>(initial);
  const [availableRegions, setAvailableRegions] = useState<string[]>(
    initial.availableRegions ?? [DEFAULT_FILTERS.region]
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [parsed, setParsed] = useState<Record<string, string | undefined> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounce only the text search; every other change fetches immediately.
  const [debouncedQ, setDebouncedQ] = useState(filters.q);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q), 320);
    return () => clearTimeout(t);
  }, [filters.q]);

  const plainMode = filters.mode === "plain";

  const query = useMemo(
    () => filtersToQuery({ ...filters, q: debouncedQ }),
    [filters, debouncedQ]
  );

  // Fetch whenever the effective query changes.
  useEffect(() => {
    // In plain-language mode the sentence is sent to the search endpoint,
    // which parses it into filters and returns them with the results.
    const endpoint = plainMode ? "/api/search" : "/api/skus";
    const url = `${endpoint}${query ? `?${query}&limit=${LIMIT}` : `?limit=${LIMIT}`}`;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // This effect owns the request lifecycle; reset the visible state before a new query.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    let settled = true;

    fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Catalog request failed (${res.status})`);
        return (await res.json()) as CatalogResponse;
      })
      .then((body) => {
        if (!settled) return;
        setData(body);
        if (body.availableRegions?.length) setAvailableRegions(body.availableRegions);
        if (plainMode) setParsed(body.parsed_filters ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!settled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load the catalog.");
        setLoading(false);
      });
    return () => {
      settled = false;
    };
  }, [query, plainMode]);

  // Keep the address bar in sync so results stay shareable and bookmarkable.
  //
  // This uses the native History API rather than `router.replace`. The catalog
  // already fetches its own data from /api/skus, so a router navigation would
  // make the server re-render the whole page for a URL that the client has
  // already resolved — doubling the work on every filter change and delaying
  // the URL update. Native replaceState integrates with the Next.js Router and
  // stays in sync with useSearchParams, without that round trip.
  const displayedQuery = useRef<string>("");
  useEffect(() => {
    if (query === displayedQuery.current) return;
    displayedQuery.current = query;
    const href = query ? `/?${query}` : "/";
    window.history.replaceState(null, "", href);
  }, [query]);

  const onChange = useCallback((next: FilterState) => {
    setFilters({ ...next, page: 1 });
  }, []);

  const onPage = useCallback((page: number) => {
    setFilters((f) => ({ ...f, page }));
    document.getElementById("results-heading")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const onClear = useCallback(() => setFilters(DEFAULT_FILTERS), []);
  const dismissChip = useCallback(
    (clear: Partial<FilterState>) => setFilters((f) => ({ ...f, ...clear, page: 1 })),
    []
  );

  const active = hasActiveFilters({ ...filters, q: debouncedQ });
  const chips = activeChips({ ...filters, q: debouncedQ });
  const showingSkeleton = loading && data.results.length === 0;

  return (
    <div className="flex flex-col gap-8 lg:flex-row">
      {/* Mobile filter toggle */}
      <div className="lg:hidden">
        <button
          type="button"
          className="btn-secondary min-h-[44px] w-full"
          aria-expanded={mobileFiltersOpen}
          aria-controls="catalog-filters"
          onClick={() => setMobileFiltersOpen((v) => !v)}
        >
          {mobileFiltersOpen ? "Hide filters" : `Show filters${active ? ` (${chips.length})` : ""}`}
        </button>
      </div>

      <aside
        id="catalog-filters"
        aria-label="Catalog filters"
        className={`surface shrink-0 p-6 lg:sticky lg:top-6 lg:h-fit lg:w-[268px] ${
          mobileFiltersOpen ? "block" : "hidden lg:block"
        }`}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold">Filters</h2>
          {active && (
            <button type="button" className="text-[12px] font-medium text-[var(--muted)] underline hover:text-[var(--ink)]" onClick={onClear}>
              Clear all
            </button>
          )}
        </div>
        <FilterPanel
          state={filters}
          onChange={onChange}
          onClear={onClear}
          availableRegions={availableRegions}
        />
      </aside>

      <div className="min-w-0 flex-1">
        {plainMode && (
          <div className="surface mb-6 p-6">
            <PlainLanguageSearch
              value={filters.q}
              onChange={(value) => setFilters((f) => ({ ...f, q: value, page: 1 }))}
              onSubmit={(value) => setFilters((f) => ({ ...f, q: value, page: 1 }))}
              parsed={(parsed ?? {}) as ParsedFilters}
              loading={loading}
              resultCount={data.pagination.totalResults}
            />
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p id="results-heading" tabIndex={-1} className="text-[13px] text-[var(--muted)]" role="status" aria-live="polite" aria-atomic="true">
            {loading && data.results.length > 0 ? (
              "Updating results…"
            ) : (
              <>
                <strong className="font-semibold text-[var(--ink)]">{data.pagination.totalResults.toLocaleString()}</strong>{" "}
                result{data.pagination.totalResults === 1 ? "" : "s"}
                {data.pagination.totalResults > 0 && <> · page {data.pagination.page} of {data.pagination.totalPages}</>}
                {data.tiers && data.tiers.certified + data.tiers.manufacturer + data.tiers.unverified > 0 && (
                  <>
                    {" · "}
                    {data.tiers.certified.toLocaleString()} certified,{" "}
                    {data.tiers.manufacturer.toLocaleString()} manufacturer,{" "}
                    {data.tiers.unverified.toLocaleString()} unverified
                  </>
                )}
              </>
            )}
          </p>
          <SortSelect value={filters.sort} onChange={(sort) => setFilters((f) => ({ ...f, sort, page: 1 }))} />
        </div>

        {chips.length > 0 && (
          <ul className="mb-5 flex flex-wrap gap-1.5" aria-label="Active filters">
            {chips.map((chip) => (
              <li key={chip.key}>
                <button
                  type="button"
                  onClick={() => dismissChip(chip.clear)}
                  aria-label={`Remove filter: ${chip.label}`}
                  title={`Remove: ${chip.label}`}
                  className="group flex min-h-[32px] min-w-[32px] items-center justify-center gap-1.5 rounded-[5px] border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 py-1 text-[12px] font-medium transition-colors hover:border-[var(--ink)]"
                >
                  {chip.label}
                  <span aria-hidden="true" className="text-[var(--quiet)] group-hover:text-[var(--ink)]">×</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {error ? (
          <div className="surface p-10 text-center" role="alert">
            <p className="text-[15px] font-semibold">The catalog could not be loaded.</p>
            <p className="mt-2 text-[13px] text-[var(--muted)]">{error}</p>
            <button type="button" className="btn-secondary mt-5" onClick={() => window.location.reload()}>
              Retry
            </button>
          </div>
        ) : showingSkeleton ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="Loading results" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => <SkuCardSkeleton key={i} />)}
          </div>
        ) : data.results.length === 0 ? (
          <div className="surface p-12 text-center">
            <p className="font-display text-[22px] tracking-[-.02em]">No laptops match these filters</p>
            <p className="mx-auto mt-2 max-w-md text-[13px] text-[var(--muted)]">
              Try widening the price range, removing the newest constraint, or searching a broader
              model name. The catalog covers current ultrabooks only.
            </p>
            <button type="button" className="btn-secondary mt-6" onClick={onClear}>
              Clear all filters
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="Laptop results">
              {data.results.map((sku, i) => (
                <SkuCard key={sku.id} sku={sku} index={i} />
              ))}
            </div>
            <Pagination
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              totalResults={data.pagination.totalResults}
              onChange={onPage}
            />
          </>
        )}
      </div>
    </div>
  );
}
