import { prisma } from "@/lib/db";
import { buildSkusQuery, buildOrderBy, parsePagination, formatSkuListItem, sortSkusByPrice } from "@/lib/api";
import { CatalogApp } from "@/components/CatalogApp";

interface SearchParams {
  cpu_brand?: string; ram_min?: string; storage_min?: string; display_type?: string;
  refresh_min?: string; weight_max?: string; battery_min?: string; touch?: string;
  region?: string; price_min?: string; price_max?: string; provenance?: string;
  q?: string; sort?: string; page?: string; limit?: string;
}

async function getInitial(params: SearchParams) {
  // Resolve the price-display region once. The client always sends a region
  // (defaulting to US), so the server must use the same default — otherwise the
  // first paint renders a different currency than the first client fetch and
  // the prices visibly swap.
  const region = params.region || "US";

  const query = {
    cpuBrand: params.cpu_brand, ramMin: params.ram_min, storageMin: params.storage_min,
    displayType: params.display_type, refreshMin: params.refresh_min, weightMax: params.weight_max,
    batteryMin: params.battery_min, touch: params.touch, region, priceMin: params.price_min,
    priceMax: params.price_max, provenance: params.provenance, q: params.q, sort: params.sort,
    page: params.page, limit: "24",
  };
  const where = buildSkusQuery(query);
  const { page, limit, skip } = parsePagination(query);

  const [
    totalResults,
    manufacturerCount,
    catalogTotal,
    certifiedTotal,
    certifiedInResults,
    regionRows,
  ] = await Promise.all([
    prisma.sku.count({ where }),
    prisma.manufacturer.count(),
    prisma.sku.count({ where: { catalogVisible: true } }),
    prisma.sku.count({ where: { catalogVisible: true, certifiedSpecs: { some: {} } } }),
    prisma.sku.count({ where: { AND: [where, { certifiedSpecs: { some: {} } }] } }),
    prisma.skuRegionalPricing.findMany({
      distinct: ["region"],
      select: { region: true },
      orderBy: { region: "asc" },
    }),
  ]);
  const availableRegions = regionRows.map((r) => r.region);

  const include = {
    model: { include: { series: { include: { manufacturer: true } } } },
    pricing: { where: { region } },
    certifiedSpecs: { select: { id: true }, take: 1 },
  };

  let rows;
  if (params.sort === "price_asc" || params.sort === "price_desc") {
    const all = await prisma.sku.findMany({ where, orderBy: [{ createdAt: "desc" }], include });
    const sorted = sortSkusByPrice(all, region, params.sort === "price_asc" ? "asc" : "desc");
    rows = sorted.slice(skip, skip + limit);
  } else {
    rows = await prisma.sku.findMany({ where, orderBy: buildOrderBy(params.sort), skip, take: limit, include });
  }

  const results = rows.map((sku) => formatSkuListItem(sku as Parameters<typeof formatSkuListItem>[0], region));

  return {
    results,
    availableRegions,
    pagination: { page, limit, totalResults, totalPages: Math.ceil(totalResults / limit) },
    tiers: { certified: certifiedInResults, reference: totalResults - certifiedInResults },
    stats: {
      catalogTotal,
      certifiedTotal,
      manufacturerCount,
      regionCount: availableRegions.length,
    },
  };
}

export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const initial = await getInitial(params);
  return (
    <div>
      <section className="border-b border-[var(--line)] py-14 sm:py-20">
        <div className="container">
          <div className="max-w-3xl">
            <p className="eyebrow mb-5">Laptop intelligence, without the noise</p>
            <h1 className="font-display text-[clamp(42px,6vw,76px)] leading-[.98] tracking-[-.045em] text-balance">Make a shortlist<br /><em className="text-[var(--accent)]">you can trust.</em></h1>
            <p className="mt-7 max-w-xl text-[16px] leading-7 text-[var(--muted)]">Veridian turns scattered laptop specifications into clear, comparable decisions. Search the catalog by the details that actually matter to you.</p>
          </div>
          <div className="mt-12 grid max-w-3xl grid-cols-2 gap-6 border-t border-[var(--line)] pt-6 sm:grid-cols-4">
            <Stat value={initial.stats.catalogTotal.toLocaleString()} label="configurations cataloged" />
            <Stat value={initial.stats.certifiedTotal.toLocaleString()} label="with a cited certification" />
            <Stat value={String(initial.stats.manufacturerCount)} label="manufacturers" />
            <Stat value={String(initial.stats.regionCount)} label="regions with recorded prices" />
          </div>
        </div>
      </section>
      <section className="container py-10 sm:py-14" aria-label="Laptop catalog">
        <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="eyebrow mb-2">The catalog</p><h2 className="font-display text-[32px] tracking-[-.035em]">Find your next machine</h2></div>
          <p className="max-w-xs text-[12px] leading-5 text-[var(--muted)] sm:text-right">Filter by hard constraints. Every result stays tied to its source record.</p>
        </div>
        <CatalogApp initial={initial} />
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return <div><p className="font-mono text-[19px] font-semibold tabular-nums">{value}</p><p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">{label}</p></div>;
}
