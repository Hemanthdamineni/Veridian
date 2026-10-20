"use client";

import { useEffect, useState } from "react";

interface AdminStats { skuCount: number; priceObservationCount: number; manufacturerCount: number; totalPricing: number; staleObservations: number; observationsWithoutSource: number; qualityScore: number }

export function AdminStatsPanel() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetch("/api/admin/stats").then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error || "Could not load stats"); return b as AdminStats; }).then(setStats).catch((e: Error) => setError(e.message)); }, []);
  if (error) return <div className="surface border-[var(--danger)] p-5 text-[13px] text-[var(--danger)]" role="alert">Could not load data quality stats: {error}</div>;
  if (!stats) return <div className="surface flex gap-6 p-6" aria-busy="true" aria-label="Loading statistics"><div className="h-6 w-20 animate-pulse rounded bg-[#ebe9e4]"/><div className="h-6 w-20 animate-pulse rounded bg-[#ebe9e4]"/><div className="h-6 w-20 animate-pulse rounded bg-[#ebe9e4]"/></div>;
  return (
    <section className="surface p-6 sm:p-8" aria-labelledby="quality-heading">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start"><div><p className="eyebrow mb-2">Catalog health</p><h2 id="quality-heading" className="font-display text-[25px] tracking-[-.025em]">Data quality</h2></div><div className={`rounded-[5px] border px-3 py-2 text-center ${stats.qualityScore >= 90 ? "border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]" : "border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]"}`}><p className="font-mono text-[20px] font-semibold">{stats.qualityScore}%</p><p className="text-[10px] uppercase tracking-[.08em]">quality score</p></div></div>
      <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-[var(--line)] pt-6 sm:grid-cols-4">
        <Metric label="SKUs" value={stats.skuCount.toLocaleString()} /><Metric label="Manufacturers" value={String(stats.manufacturerCount)} /><Metric label="Price records" value={stats.totalPricing.toLocaleString()} /><Metric label="Observations" value={stats.priceObservationCount.toLocaleString()} />
      </dl>
      <p className="mt-6 text-[11px] text-[var(--muted)]">{stats.staleObservations.toLocaleString()} stale observations · {stats.observationsWithoutSource.toLocaleString()} without source provenance</p>
    </section>
  );
}
function Metric({ label, value }: { label: string; value: string }) { return <div><dt className="label mb-1">{label}</dt><dd className="font-mono text-[18px] font-semibold">{value}</dd></div>; }
