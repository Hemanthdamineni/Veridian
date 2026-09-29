"use client";

import { useEffect, useState } from "react";

interface AdminStats {
  skuCount: number;
  priceObservationCount: number;
  manufacturerCount: number;
  totalPricing: number;
  staleObservations: number;
  observationsWithoutSource: number;
  qualityScore: number;
}

export function AdminStatsPanel() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to fetch stats");
        return body as AdminStats;
      })
      .then(setStats)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
        <p className="font-medium">Error loading stats</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  if (!stats) {
    return <p className="text-zinc-500">Loading stats...</p>;
  }

  const scoreColor =
    stats.qualityScore >= 90
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : stats.qualityScore >= 70
      ? "text-amber-700 bg-amber-50 border-amber-200"
      : "text-red-700 bg-red-50 border-red-200";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <h3 className="text-lg font-semibold text-zinc-900 mb-4">Data Quality Summary</h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-zinc-500">SKUs</p>
          <p className="text-2xl font-bold text-zinc-900">{stats.skuCount.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-zinc-500">Manufacturers</p>
          <p className="text-2xl font-bold text-zinc-900">{stats.manufacturerCount}</p>
        </div>
        <div>
          <p className="text-zinc-500">Price Observations</p>
          <p className="text-2xl font-bold text-zinc-900">{stats.priceObservationCount.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-zinc-500">Regional Pricing Records</p>
          <p className="text-2xl font-bold text-zinc-900">{stats.totalPricing.toLocaleString()}</p>
        </div>
        <div className="col-span-2">
          <p className="text-zinc-500">Data Quality Score</p>
          <div className={`inline-block mt-1 px-3 py-1 rounded-lg border ${scoreColor}`}>
            {stats.qualityScore}%
          </div>
        </div>
        <div>
          <p className="text-zinc-500">Stale Observations (&gt;30 days)</p>
          <p className="text-lg font-medium text-amber-700">{stats.staleObservations.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-zinc-500">Observations Without Source</p>
          <p className="text-lg font-medium text-amber-700">{stats.observationsWithoutSource.toLocaleString()}</p>
        </div>
      </div>
      <p className="text-xs text-zinc-400 mt-4">
        Quality score excludes stale observations and those without source provenance.
      </p>
    </div>
  );
}
