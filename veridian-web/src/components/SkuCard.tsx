"use client";

import Link from "next/link";
import type { SkuListItem, SkuProvenance } from "@/types";
import { PROVENANCE_DESCRIPTIONS, PROVENANCE_LABELS } from "@/types";
import { formatPrice, formatStorage, formatWeight } from "@/lib/format";

/**
 * The provenance badge. It is the fastest way for a reader to know how much
 * weight a row's figures deserve, so it is present on every card and it
 * always names the tier rather than implying a level of trust.
 */
export function ProvenanceBadge({ provenance }: { provenance: SkuProvenance }) {
  const tone =
    provenance === "certified"
      ? "bg-[var(--success-soft)] text-[var(--success)]"
      : provenance === "manufacturer"
        ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]"
        : "bg-[var(--warning-soft)] text-[var(--warning)]";
  return (
    <span
      className={`rounded px-2 py-1 text-[10px] font-medium ${tone}`}
      title={PROVENANCE_DESCRIPTIONS[provenance]}
    >
      {PROVENANCE_LABELS[provenance]}
    </span>
  );
}

export function SkuCard({ sku, index = 0 }: { sku: SkuListItem; index?: number }) {
  return (
    <article className="surface reveal group flex min-h-[254px] flex-col p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:shadow-[0_4px_16px_rgba(25,22,17,.05)]" style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-1">{sku.manufacturerName}</p>
          <h2 className="truncate text-[17px] font-semibold tracking-[-.02em]">{sku.modelName}</h2>
          <p className="mt-1 truncate font-mono text-[10px] text-[var(--quiet)]">{sku.skuCode}</p>
        </div>
        <div className="shrink-0 text-right">
          {sku.price ? (
            <>
              <p className="font-mono text-[15px] font-semibold tabular-nums">
                {formatPrice(sku.price.msrp, sku.price.currency)}
              </p>
              <p className="mt-0.5 text-[10px] uppercase tracking-[.1em] text-[var(--quiet)]">MSRP reference</p>
            </>
          ) : (
            <>
              <p className="text-[11px] font-medium text-[var(--muted)]">Price not reported</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-[.1em] text-[var(--quiet)]">for this region</p>
            </>
          )}
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-[var(--line)] py-4 text-[12px]">
        <Spec label="Processor" value={sku.cpuModel} />
        <Spec label="Memory" value={`${sku.ramGb} GB${sku.ramType ? ` ${sku.ramType}` : ""}`} />
        <Spec label="Display" value={`${sku.display.sizeIn ? `${sku.display.sizeIn}"` : "—"}${sku.display.type ? ` · ${sku.display.type}` : ""}`} />
        <Spec label="Weight" value={formatWeight(sku.weightKg)} />
        <Spec label="Storage" value={`${formatStorage(sku.storageGb)}${sku.storageType ? ` · ${sku.storageType}` : ""}`} />
        <Spec label="Battery" value={sku.batteryWh !== null ? `${sku.batteryWh} Wh` : "—"} />
      </dl>

      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <div className="flex flex-wrap gap-1.5">
          <ProvenanceBadge provenance={sku.provenance} />
          {sku.display.touch && <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-[10px] font-medium text-[var(--accent-dark)]">Touch</span>}
          {sku.display.refreshHz && sku.display.refreshHz > 60 && <span className="rounded bg-[var(--surface-soft)] px-2 py-1 text-[10px] text-[var(--muted)]">{sku.display.refreshHz} Hz</span>}
          {sku.ramSoldered === false && <span className="rounded bg-[var(--surface-soft)] px-2 py-1 text-[10px] text-[var(--muted)]">Upgradeable RAM</span>}
        </div>
        <Link
          href={`/skus/${sku.id}`}
          prefetch={false}
          aria-label={`Inspect ${sku.manufacturerName} ${sku.modelName}`}
          className="shrink-0 text-[12px] font-semibold text-[var(--accent-dark)] underline decoration-[var(--accent-soft)] underline-offset-4 transition-colors hover:text-[var(--ink)]"
        >
          Inspect <span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="mb-0.5 text-[10px] uppercase tracking-[.08em] text-[var(--quiet)]">{label}</dt><dd className="truncate font-medium text-[var(--ink)]" title={value}>{value || "—"}</dd></div>;
}

export function SkuCardSkeleton() {
  return <div className="surface min-h-[254px] animate-pulse p-5"><div className="flex justify-between"><div className="space-y-2"><div className="h-2.5 w-16 rounded bg-[#ebe9e4]"/><div className="h-4 w-40 rounded bg-[#ebe9e4]"/><div className="h-2.5 w-24 rounded bg-[#ebe9e4]"/></div><div className="h-5 w-16 rounded bg-[#ebe9e4]"/></div><div className="mt-7 border-y border-[var(--line)] py-4"><div className="grid grid-cols-2 gap-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="space-y-2"><div className="h-2 w-12 rounded bg-[#ebe9e4]"/><div className="h-3 w-20 rounded bg-[#ebe9e4]"/></div>)}</div></div></div>;
}
