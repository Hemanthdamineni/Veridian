"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 30_000;

export function LiveCatalogRefresh() {
  const router = useRouter();
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      if (cancelled || refreshing) return;
      setRefreshing(true);
      try {
        const response = await fetch("/api/refresh", { method: "POST" });
        if (response.ok && !cancelled) {
          router.refresh();
          setLastUpdated(new Date());
        }
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    };

    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [router, refreshing]);

  return (
    <div className="mb-4 flex items-center justify-end gap-2 text-xs text-slate-700">
      <span aria-live="polite">
        {refreshing ? "Updating catalog..." : lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Live updates enabled"}
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="font-medium text-[#075e68] hover:underline"
      >
        Refresh
      </button>
    </div>
  );
}
