"use client";

import Link from "next/link";
import type { SkuListItem } from "@/types";

function formatPrice(msrp: number, currency: string): string {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
  return formatter.format(msrp);
}

function formatWeight(kg: number): string {
  return `${kg.toFixed(2)} kg`;
}

export function SkuCard({ sku }: { sku: SkuListItem }) {
  return (
    <Link
      href={`/skus/${sku.id}`}
      className="block bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 hover:shadow-lg hover:border-zinc-300 dark:hover:border-zinc-700 transition-all group"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            {sku.manufacturerName}
          </p>
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-50 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {sku.modelName}
          </h3>
          <p className="text-xs text-zinc-400 font-mono">{sku.skuCode}</p>
        </div>
        {sku.price && (
          <div className="text-right">
            <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
              {formatPrice(sku.price.msrp, sku.price.currency)}
            </p>
            <p className="text-xs text-zinc-500">{sku.price.region}</p>
          </div>
        )}
      </div>

      {/* Key Specs */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-400">CPU:</span>
          <span className="text-zinc-700 dark:text-zinc-300 truncate">
            {sku.cpuModel}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-400">RAM:</span>
          <span className="text-zinc-700 dark:text-zinc-300">
            {sku.ramGb} GB {sku.ramType}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-400">Display:</span>
          <span className="text-zinc-700 dark:text-zinc-300">
            {sku.display.sizeIn}&quot; {sku.display.type}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-400">Weight:</span>
          <span className="text-zinc-700 dark:text-zinc-300">
            {formatWeight(sku.weightKg)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-400">Storage:</span>
          <span className="text-zinc-700 dark:text-zinc-300">
            {sku.storageGb >= 1024
              ? `${sku.storageGb / 1024} TB`
              : `${sku.storageGb} GB`}{" "}
            {sku.storageType}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-400">Battery:</span>
          <span className="text-zinc-700 dark:text-zinc-300">
            {sku.batteryWh} Wh
          </span>
        </div>
      </div>

      {/* Footer Tags */}
      <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
        {sku.display.touch && (
          <span className="px-2 py-0.5 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
            Touch
          </span>
        )}
        <span className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded">
          {sku.os}
        </span>
        <span className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded">
          {sku.buildMaterial}
        </span>
        {!sku.ramSoldered && (
          <span className="px-2 py-0.5 text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
            Upgradeable RAM
          </span>
        )}
      </div>
    </Link>
  );
}

export function SkuCardSkeleton() {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 animate-pulse">
      <div className="h-3 w-20 bg-zinc-200 dark:bg-zinc-700 rounded mb-2" />
      <div className="h-5 w-48 bg-zinc-200 dark:bg-zinc-700 rounded mb-1" />
      <div className="h-3 w-32 bg-zinc-200 dark:bg-zinc-700 rounded mb-4" />
      <div className="grid grid-cols-2 gap-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded" />
        ))}
      </div>
    </div>
  );
}
