"use client";

import { CPU_BRANDS, DISPLAY_TYPES, REGIONS } from "@/types";
import type { FilterState } from "@/lib/catalog";

interface FilterControls {
  state: FilterState;
  onChange: (next: FilterState) => void;
  onClear: () => void;
  /** Regions for which at least one price is recorded. */
  availableRegions: string[];
}

const RAM_OPTIONS = [8, 16, 32, 64, 128];
const STORAGE_OPTIONS = [256, 512, 1024, 2048];
const WEIGHT_OPTIONS = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0];
const BATTERY_OPTIONS = [40, 50, 60, 70, 80, 90];

export function FilterPanel({ state, onChange, onClear, availableRegions }: FilterControls) {
  const set = (updates: Partial<FilterState>) => onChange({ ...state, ...updates });

  return (
    <div className="space-y-7">
      <section>
        <h2 className="label">Search</h2>
        <div className="mb-3 inline-flex rounded-[6px] border border-[var(--line-strong)] p-0.5" role="group" aria-label="Search mode">
          <ModeButton
            active={state.mode === "filters"}
            onClick={() => set({ mode: "filters" })}
            children="Exact filters"
          />
          <ModeButton
            active={state.mode === "plain"}
            onClick={() => set({ mode: "plain" })}
            children="Plain English"
          />
        </div>
        {state.mode === "plain" ? (
          <p className="text-[12px] leading-5 text-[var(--muted)]">
            Type what you want in the box at the top of the page. The sentence is parsed into
            filters and shown back to you, so you can check the reading before trusting it.
          </p>
        ) : (
          <input className="field" type="text" placeholder="Model name or SKU code…" value={state.q}
            onChange={(e) => set({ q: e.target.value })} aria-label="Search model or SKU" />
        )}
      </section>

      <section>
        <h2 className="label">Source</h2>
        <CheckList
          options={["certified", "manufacturer", "unverified"]}
          selected={state.provenance}
          onToggle={(v) =>
            set({
              provenance: state.provenance.includes(v)
                ? state.provenance.filter((x) => x !== v)
                : [...state.provenance, v],
            })
          }
          name="provenance"
          labels={{
            certified: "Certified — a cited certification record",
            manufacturer: "Manufacturer — checked against the maker's spec page",
            unverified: "Unverified — no cited source",
          }}
        />
      </section>

      <section>
        <h2 className="label">Processor</h2>
        <CheckList options={CPU_BRANDS as unknown as string[]} selected={state.cpuBrand} onToggle={(v) => toggleInArray(state.cpuBrand, v, (arr) => set({ cpuBrand: arr }))} name="cpu" />
      </section>

      <section>
        <h2 className="label">Minimum RAM</h2>
        <OptionSelect value={state.ramMin} options={RAM_OPTIONS.map((v) => ({ v: String(v), label: `${v} GB` }))} onChange={(v) => set({ ramMin: v })} id="ram" />
      </section>

      <section>
        <h2 className="label">Minimum storage</h2>
        <OptionSelect value={state.storageMin} options={STORAGE_OPTIONS.map((v) => ({ v: String(v), label: v >= 1024 ? `${v / 1024} TB` : `${v} GB` }))} onChange={(v) => set({ storageMin: v })} id="storage" />
      </section>

      <section>
        <h2 className="label">Display type</h2>
        <CheckList options={DISPLAY_TYPES as unknown as string[]} selected={state.displayType} onToggle={(v) => toggleInArray(state.displayType, v, (arr) => set({ displayType: arr }))} name="display" />
      </section>

      <section>
        <h2 className="label">Minimum refresh rate</h2>
        <OptionSelect value={state.refreshMin} options={[60, 90, 120, 144, 165, 240].map((v) => ({ v: String(v), label: `${v} Hz` }))} onChange={(v) => set({ refreshMin: v })} id="refresh" />
      </section>

      <section>
        <h2 className="label">Maximum weight</h2>
        <OptionSelect value={state.weightMax} options={WEIGHT_OPTIONS.map((v) => ({ v: String(v), label: `${v.toFixed(1)} kg` }))} onChange={(v) => set({ weightMax: v })} id="weight" />
      </section>

      <section>
        <h2 className="label">Minimum battery</h2>
        <OptionSelect value={state.batteryMin} options={BATTERY_OPTIONS.map((v) => ({ v: String(v), label: `${v} Wh` }))} onChange={(v) => set({ batteryMin: v })} id="battery" />
      </section>

      <section>
        <h2 className="label">Touch display</h2>
        <OptionSelect value={state.touch} options={[{ v: "", label: "Any" }, { v: "true", label: "Yes" }, { v: "false", label: "No" }]} onChange={(v) => set({ touch: v })} id="touch" />
      </section>

      <section className="border-t border-[var(--line)] pt-6">
        <h2 className="label mb-3">Price region</h2>
        <RegionPills value={state.region} onChange={(r) => set({ region: r })} availableRegions={availableRegions} />
        <p className="mt-3 text-[11px] leading-5 text-[var(--quiet)]">
          Picks the currency shown for each configuration. Configurations with no price recorded
          for that region stay in the results and are marked &ldquo;price not reported&rdquo;.
        </p>
      </section>

      <section className="border-t border-[var(--line)] pt-6">
        <h2 className="label mb-3">MSRP range</h2>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            className="field"
            placeholder="Min"
            aria-label="Minimum MSRP"
            value={state.priceMin}
            onChange={(e) => set({ priceMin: e.target.value })}
          />
          <span aria-hidden="true" className="text-[var(--quiet)]">–</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            className="field"
            placeholder="Max"
            aria-label="Maximum MSRP"
            value={state.priceMax}
            onChange={(e) => set({ priceMax: e.target.value })}
          />
        </div>
        <p className="mt-3 text-[11px] leading-5 text-[var(--quiet)]">
          Manufacturer suggested price, recorded per region. These are reference values from our
          seed dataset, not live retailer prices — filter on them for shape, not for a quote.
        </p>
      </section>

      <section className="border-t border-[var(--line)] pt-6">
        <button type="button" className="btn-quiet w-full" onClick={onClear}>Clear all filters</button>
      </section>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors ${
        active ? "bg-[var(--ink)] text-white" : "text-[var(--muted)] hover:text-[var(--ink)]"
      }`}
    >
      {children}
    </button>
  );
}

function toggleInArray(arr: string[], value: string, onNext: (next: string[]) => void) {
  onNext(arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]);
}

function CheckList({ options, selected, onToggle, name, labels }: { options: string[]; selected: string[]; onToggle: (v: string) => void; name: string; labels?: Record<string, string> }) {
  return (
    <div className="space-y-2" role="group">
      {options.map((opt) => {
        const id = `${name}-${opt}`;
        return (
          <label key={opt} htmlFor={id} className="flex cursor-pointer items-center gap-2.5 text-[13px]">
            <input id={id} type="checkbox" checked={selected.includes(opt)} onChange={() => onToggle(opt)}
              className="h-4 w-4 rounded-[4px] border border-[var(--line-strong)] accent-[var(--accent)] transition-colors checked:bg-[var(--ink)]" />
            <span>{labels?.[opt] ?? opt}</span>
          </label>
        );
      })}
    </div>
  );
}

function OptionSelect({ value, options, onChange, id }: { value: string; options: { v: string; label: string }[]; onChange: (v: string) => void; id: string }) {
  return (
    <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Any</option>
      {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );
}

function RegionPills({ value, onChange, availableRegions }: { value: string; onChange: (r: string) => void; availableRegions: string[] }) {
  // Only offer regions we actually hold prices for. Offering a region with no
  // recorded price guarantees an empty result set, which reads as a broken
  // product rather than an honest "no coverage" state.
  const regions = REGIONS.filter((r) => availableRegions.includes(r));
  const shown = regions.length > 0 ? regions : availableRegions;
  const selected = shown.includes(value) ? value : shown[0] ?? value;

  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Price region">
      {shown.map((r) => (
        <button key={r} type="button" role="radio" aria-checked={selected === r} onClick={() => onChange(r)}
          className={`rounded-[5px] px-2.5 py-1.5 text-[12px] font-medium transition-colors ${selected === r ? "bg-[var(--ink)] text-white" : "border border-[var(--line-strong)] text-[var(--muted)] hover:border-[var(--ink)]"}`}>
          {r}
        </button>
      ))}
    </div>
  );
}
