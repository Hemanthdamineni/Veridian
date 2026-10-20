import { formatDate, formatPrice } from "@/lib/format";

interface Sku { id: string; skuCode: string; cpuModel: string; ramGb: number; weightKg: number | null; createdAt: Date; model: { name: string; series: { name: string; manufacturer: { name: string } } }; pricing: { region: string; currency: string; msrp: number }[] }

interface SkuListProps { skus: Sku[] }

export function SkuList({ skus }: SkuListProps) {
  if (skus.length === 0) {
    return <div className="rounded-[8px] border border-dashed border-[var(--line-strong)] p-8 text-center text-[13px] text-[var(--muted)]">No configurations yet. Add one using the form.</div>;
  }
  return (
    <ul className="max-h-[620px] divide-y divide-[var(--line)] overflow-y-auto">
      {skus.map((sku) => (
        <li key={sku.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">{sku.model.name}</p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--muted)]">{sku.skuCode}</p>
            </div>
            {sku.pricing[0] && <p className="shrink-0 font-mono text-[13px] font-medium">{formatPrice(sku.pricing[0].msrp, sku.pricing[0].currency)}</p>}
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--quiet)]">
            {sku.model.series.manufacturer.name} · {sku.cpuModel} · {sku.ramGb} GB · {sku.weightKg !== null ? `${sku.weightKg} kg` : "weight n/a"}
          </p>
          <p className="mt-1 font-mono text-[10px] text-[var(--quiet)]">Added {formatDate(sku.createdAt.toISOString())}</p>
        </li>
      ))}
    </ul>
  );
}