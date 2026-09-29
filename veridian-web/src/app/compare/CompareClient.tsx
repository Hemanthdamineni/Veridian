"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

interface ComparisonSku {
  id: string;
  sku_code: string;
  name: string;
  brand: string;
  series: string;
  specs: Record<string, unknown>;
  pricing: { region: string; currency: string; msrp: number; available: boolean }[];
  differences?: Record<string, string>;
}

interface ComparisonResponse {
  comparison: ComparisonSku[];
  analysis?: Record<string, { winner: string; explanation: string }>;
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

function valueText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not listed";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).filter(Boolean).join(" / ");
  return String(value);
}

export function CompareClient() {
  const searchParams = useSearchParams();
  const ids = searchParams.get("ids") || "";
  const [data, setData] = useState<ComparisonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ids) return;
    fetch(`/api/v1/compare?ids=${encodeURIComponent(ids)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Comparison failed");
        return body as ComparisonResponse;
      })
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [ids]);

  if (!ids) {
    return <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">Add at least two SKU IDs to the URL as ?ids=id1,id2</div>;
  }
  if (error) {
    return <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">{error}</div>;
  }
  if (!data) return <p className="text-zinc-500">Loading comparison...</p>;

  const skus = data.comparison;

  // Collect analysis winner labels
  const winners = new Map<string, string>();
  if (data.analysis) {
    for (const [category, { winner, explanation }] of Object.entries(data.analysis)) {
      winners.set(winner, (winners.get(winner) || "") + `\n• ${labels[category] || category}: ${explanation}`);
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50">
            <th className="sticky left-0 min-w-44 bg-zinc-50 px-4 py-4 text-left font-semibold text-zinc-600">Specification</th>
            {skus.map((item) => (
              <th key={item.id} className="min-w-60 px-4 py-4 text-left align-top">
                <div className="font-semibold text-zinc-900">{item.brand} {item.name}</div>
                <div className="mt-1 font-mono text-xs font-normal text-zinc-500">{item.sku_code}</div>
                {item.pricing[0] && (
                  <div className="mt-3 text-base font-bold text-blue-700">
                    {new Intl.NumberFormat("en-US", { style: "currency", currency: item.pricing[0].currency, maximumFractionDigits: 0 }).format(item.pricing[0].msrp)}
                  </div>
                )}
                {winners.has(item.id) && (
                  <div className="mt-2 whitespace-pre-line rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                    {winners.get(item.id)}
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(labels).flatMap(([group, groupLabel]) => {
            const first = skus[0];
            const keys = first ? Object.keys((first.specs[group] as Record<string, unknown>) || {}) : [];
            if (keys.length === 0) return [];
            return [
              <tr key={`${group}-heading`}>
                <th colSpan={skus.length + 1} className="bg-zinc-50 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-zinc-500">{groupLabel}</th>
              </tr>,
              ...keys.map((key) => {
                const values = skus.map((s) => valueText((s.specs[group] as Record<string, unknown>)?.[key]));
                const distinct = new Set(values).size > 1;
                return (
                  <tr key={`${group}-${key}`} className="border-t border-zinc-100">
                    <th className="sticky left-0 bg-white px-4 py-3 text-left font-medium capitalize text-zinc-500">{key.replaceAll("_", " ")}</th>
                    {skus.map((item) => {
                      const value = valueText((item.specs[group] as Record<string, unknown>)?.[key]);
                      return (
                        <td key={item.id} className={`px-4 py-3 ${distinct ? "bg-amber-50/60 font-medium text-zinc-900" : "text-zinc-700"}`}>
                          {value}
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
