import { SkuForm } from "@/components/admin/SkuForm";
import { SkuList } from "@/components/admin/SkuList";
import { AdminStatsPanel } from "@/components/AdminStatsPanel";

export const dynamic = "force-dynamic";

interface Manufacturer { id: string; name: string; series: { id: string; name: string; models: { id: string; name: string }[] }[] }
interface Sku { id: string; skuCode: string; cpuModel: string; ramGb: number; weightKg: number | null; createdAt: Date; model: { name: string; series: { name: string; manufacturer: { name: string } } }; pricing: { region: string; currency: string; msrp: number }[] }

async function getData() {
  try {
    const { prisma } = await import("@/lib/db");
    const [manufacturers, skus] = await Promise.all([
      prisma.manufacturer.findMany({ include: { series: { include: { models: true } } }, orderBy: { name: "asc" } }),
      prisma.sku.findMany({ include: { model: { include: { series: { include: { manufacturer: true } } } }, pricing: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    return { manufacturers, skus, error: null };
  } catch (error) {
    return { manufacturers: [] as Manufacturer[], skus: [] as Sku[], error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export default async function AdminPage() {
  const { manufacturers, skus, error } = await getData();
  return (
    <div className="container py-10 sm:py-14">
      <header className="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="eyebrow mb-2">Internal workspace</p><h1 className="font-display text-[40px] tracking-[-.04em]">Catalog curation</h1><p className="mt-2 text-[13px] text-[var(--muted)]">Review source data and add verified configurations.</p></div>
        <span className="font-mono text-[11px] text-[var(--quiet)]">{skus.length} recent records</span>
      </header>
      {error ? (
        <div className="surface border-[var(--danger)] p-6" role="alert"><p className="font-semibold">Database connection error</p><p className="mt-2 text-[13px] text-[var(--muted)]">{error}</p></div>
      ) : (
        <>
          <AdminStatsPanel />
          <div className="mt-8 grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <section className="surface p-6 sm:p-8"><div className="mb-6"><p className="eyebrow mb-2">New record</p><h2 className="font-display text-[25px] tracking-[-.025em]">Add a configuration</h2></div><SkuForm manufacturers={manufacturers} /></section>
            <section className="surface p-6 sm:p-8"><div className="mb-6 flex items-end justify-between gap-4"><div><p className="eyebrow mb-2">Recently added</p><h2 className="font-display text-[25px] tracking-[-.025em]">SKU records</h2></div><span className="font-mono text-[11px] text-[var(--muted)]">{skus.length} shown</span></div><SkuList skus={skus} /></section>
          </div>
        </>
      )}
    </div>
  );
}
