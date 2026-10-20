"use client";

export const SORT_OPTIONS: { v: string; label: string }[] = [
  // The default order is ingestion order, not launch date — label it so the
  // two are not confused with the explicit "Launch: newest" option.
  { v: "", label: "Recently added" },
  { v: "price_asc", label: "Price: lowest" },
  { v: "price_desc", label: "Price: highest" },
  { v: "weight_asc", label: "Weight: lightest" },
  { v: "battery_desc", label: "Battery: largest" },
  { v: "newest", label: "Launch: newest" },
];

export function SortSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Sort results"
      className="field min-h-[36px] w-auto pr-8 text-[12px]"
    >
      {SORT_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );
}
