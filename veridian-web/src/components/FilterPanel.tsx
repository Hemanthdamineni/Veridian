"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { CPU_BRANDS, DISPLAY_TYPES, REGIONS } from "@/types";

interface FilterState {
  cpuBrand: string[];
  ramMin: string;
  storageMin: string;
  displayType: string[];
  refreshMin: string;
  weightMax: string;
  batteryMin: string;
  touch: string;
  region: string;
  priceMin: string;
  priceMax: string;
  q: string;
  sort: string;
}

const DEFAULT_FILTERS: FilterState = {
  cpuBrand: [],
  ramMin: "",
  storageMin: "",
  displayType: [],
  refreshMin: "",
  weightMax: "",
  batteryMin: "",
  touch: "",
  region: "US",
  priceMin: "",
  priceMax: "",
  q: "",
  sort: "",
};

export function FilterPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const getFilterState = useCallback((): FilterState => {
    return {
      cpuBrand: searchParams.get("cpu_brand")?.split(",") || [],
      ramMin: searchParams.get("ram_min") || "",
      storageMin: searchParams.get("storage_min") || "",
      displayType: searchParams.get("display_type")?.split(",") || [],
      refreshMin: searchParams.get("refresh_min") || "",
      weightMax: searchParams.get("weight_max") || "",
      batteryMin: searchParams.get("battery_min") || "",
      touch: searchParams.get("touch") || "",
      region: searchParams.get("region") || "US",
      priceMin: searchParams.get("price_min") || "",
      priceMax: searchParams.get("price_max") || "",
      q: searchParams.get("q") || "",
      sort: searchParams.get("sort") || "",
    };
  }, [searchParams]);

  const updateFilters = useCallback(
    (updates: Partial<FilterState>) => {
      const current = getFilterState();
      const newFilters = { ...current, ...updates };
      const params = new URLSearchParams();

      if (newFilters.cpuBrand.length > 0) {
        params.set("cpu_brand", newFilters.cpuBrand.join(","));
      }
      if (newFilters.ramMin) params.set("ram_min", newFilters.ramMin);
      if (newFilters.storageMin) params.set("storage_min", newFilters.storageMin);
      if (newFilters.displayType.length > 0) {
        params.set("display_type", newFilters.displayType.join(","));
      }
      if (newFilters.refreshMin) params.set("refresh_min", newFilters.refreshMin);
      if (newFilters.weightMax) params.set("weight_max", newFilters.weightMax);
      if (newFilters.batteryMin) params.set("battery_min", newFilters.batteryMin);
      if (newFilters.touch) params.set("touch", newFilters.touch);
      if (newFilters.region && newFilters.region !== "US") {
        params.set("region", newFilters.region);
      }
      if (newFilters.priceMin) params.set("price_min", newFilters.priceMin);
      if (newFilters.priceMax) params.set("price_max", newFilters.priceMax);
      if (newFilters.q) params.set("q", newFilters.q);
      if (newFilters.sort) params.set("sort", newFilters.sort);

      router.push(`/?${params.toString()}`);
    },
    [router, getFilterState]
  );

  const clearFilters = useCallback(() => {
    router.push("/");
  }, [router]);

  const filters = getFilterState();
  const hasActiveFilters = Object.entries(filters).some(([key, value]) => {
    if (key === "region") return value !== "US";
    if (Array.isArray(value)) return value.length > 0;
    return value !== "";
  });

  return (
    <aside className="w-full lg:w-72 space-y-6">
      {/* Search */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Search
        </label>
        <input
          type="text"
          placeholder="Model name or SKU..."
          value={filters.q}
          onChange={(e) => updateFilters({ q: e.target.value })}
          className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* CPU Brand */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          CPU Brand
        </label>
        <div className="space-y-2">
          {CPU_BRANDS.map((brand) => (
            <label key={brand} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filters.cpuBrand.includes(brand)}
                onChange={(e) => {
                  const newBrands = e.target.checked
                    ? [...filters.cpuBrand, brand]
                    : filters.cpuBrand.filter((b) => b !== brand);
                  updateFilters({ cpuBrand: newBrands });
                }}
                className="rounded border-zinc-300 dark:border-zinc-600"
              />
              <span className="text-zinc-700 dark:text-zinc-300">{brand}</span>
            </label>
          ))}
        </div>
      </div>

      {/* RAM */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Min RAM (GB)
        </label>
        <select
          value={filters.ramMin}
          onChange={(e) => updateFilters({ ramMin: e.target.value })}
          className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm"
        >
          <option value="">Any</option>
          <option value="8">8 GB</option>
          <option value="16">16 GB</option>
          <option value="32">32 GB</option>
          <option value="64">64 GB</option>
        </select>
      </div>

      {/* Storage */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Min Storage (GB)
        </label>
        <select
          value={filters.storageMin}
          onChange={(e) => updateFilters({ storageMin: e.target.value })}
          className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm"
        >
          <option value="">Any</option>
          <option value="256">256 GB</option>
          <option value="512">512 GB</option>
          <option value="1000">1 TB</option>
          <option value="2000">2 TB</option>
        </select>
      </div>

      {/* Display Type */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Display Type
        </label>
        <div className="space-y-2">
          {DISPLAY_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filters.displayType.includes(type)}
                onChange={(e) => {
                  const newTypes = e.target.checked
                    ? [...filters.displayType, type]
                    : filters.displayType.filter((t) => t !== type);
                  updateFilters({ displayType: newTypes });
                }}
                className="rounded border-zinc-300 dark:border-zinc-600"
              />
              <span className="text-zinc-700 dark:text-zinc-300">{type}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Weight */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Max Weight (kg)
        </label>
        <input
          type="number"
          step="0.1"
          placeholder="e.g., 1.5"
          value={filters.weightMax}
          onChange={(e) => updateFilters({ weightMax: e.target.value })}
          className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm"
        />
      </div>

      {/* Battery */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Min Battery (Wh)
        </label>
        <input
          type="number"
          step="5"
          placeholder="e.g., 60"
          value={filters.batteryMin}
          onChange={(e) => updateFilters({ batteryMin: e.target.value })}
          className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm"
        />
      </div>

      {/* Touch */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Touch Display
        </label>
        <select
          value={filters.touch}
          onChange={(e) => updateFilters({ touch: e.target.value })}
          className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm"
        >
          <option value="">Any</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </div>

      {/* Region */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Region
        </label>
        <select
          value={filters.region}
          onChange={(e) => updateFilters({ region: e.target.value })}
          className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm"
        >
          {REGIONS.map((region) => (
            <option key={region} value={region}>
              {region}
            </option>
          ))}
        </select>
      </div>

      {/* Price Range */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Price Range
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="Min"
            value={filters.priceMin}
            onChange={(e) => updateFilters({ priceMin: e.target.value })}
            className="w-1/2 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm"
          />
          <input
            type="number"
            placeholder="Max"
            value={filters.priceMax}
            onChange={(e) => updateFilters({ priceMax: e.target.value })}
            className="w-1/2 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm"
          />
        </div>
      </div>

      {/* Clear Filters */}
      {hasActiveFilters && (
        <button
          onClick={clearFilters}
          className="w-full px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          Clear All Filters
        </button>
      )}
    </aside>
  );
}
