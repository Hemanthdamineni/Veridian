import { prisma } from "@/lib/db";
import { FilterPanel } from "@/components/FilterPanel";
import { SkuCard } from "@/components/SkuCard";
import { Pagination } from "@/components/Pagination";
import { SortSelect } from "@/components/SortSelect";
import { buildSkusQuery, buildOrderBy, parsePagination, formatSkuListItem } from "@/lib/api";

interface HomePageProps {
  searchParams: Promise<{
    cpu_brand?: string;
    ram_min?: string;
    storage_min?: string;
    display_type?: string;
    refresh_min?: string;
    weight_max?: string;
    battery_min?: string;
    touch?: string;
    region?: string;
    price_min?: string;
    price_max?: string;
    q?: string;
    sort?: string;
    page?: string;
    limit?: string;
  }>;
}

async function getSkus(searchParams: Awaited<HomePageProps["searchParams"]>) {
  const params = {
    cpuBrand: searchParams.cpu_brand,
    ramMin: searchParams.ram_min,
    storageMin: searchParams.storage_min,
    displayType: searchParams.display_type,
    refreshMin: searchParams.refresh_min,
    weightMax: searchParams.weight_max,
    batteryMin: searchParams.battery_min,
    touch: searchParams.touch,
    region: searchParams.region,
    priceMin: searchParams.price_min,
    priceMax: searchParams.price_max,
    q: searchParams.q,
    sort: searchParams.sort,
    page: searchParams.page,
    limit: searchParams.limit,
  };

  const where = buildSkusQuery(params);
  const orderBy = buildOrderBy(params.sort);
  const { page, limit } = parsePagination(params);

  const totalResults = await prisma.sku.count({ where });

  let skus;

  if (params.sort === "price_asc" || params.sort === "price_desc") {
    const region = params.region || "US";
    const allSkus = await prisma.sku.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      include: {
        model: {
          include: {
            series: {
              include: {
                manufacturer: true,
              },
            },
          },
        },
        pricing: { where: { region } },
      },
    });

    const sorted = [...allSkus].sort((a, b) => {
      const priceA = a.pricing[0]?.msrp ?? Infinity;
      const priceB = b.pricing[0]?.msrp ?? Infinity;
      return params.sort === "price_asc" ? priceA - priceB : priceB - priceA;
    });

    const skip = (page - 1) * limit;
    skus = sorted.slice(skip, skip + limit);
  } else {
    const skip = (page - 1) * limit;
    skus = await prisma.sku.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        model: {
          include: {
            series: {
              include: {
                manufacturer: true,
              },
            },
          },
        },
        pricing: params.region
          ? { where: { region: params.region } }
          : true,
      },
    });
  }

  const results = skus.map((sku) =>
    formatSkuListItem(sku as Parameters<typeof formatSkuListItem>[0], params.region)
  );

  return {
    results,
    pagination: {
      page,
      limit,
      totalResults,
      totalPages: Math.ceil(totalResults / limit),
    },
  };
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const { results, pagination } = await getSkus(params);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-zinc-900">
          Find Your Laptop
        </h1>
        <p className="mt-2 text-zinc-600">
          Verified specs. Smart filters. Better decisions.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        <FilterPanel />

        <div className="flex-1">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-zinc-500">
              {pagination.totalResults} laptop{pagination.totalResults !== 1 ? "s" : ""}
            </p>
            <SortSelect />
          </div>

          {results.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-zinc-500 text-lg">
                No laptops match your filters.
              </p>
              <p className="text-zinc-400 mt-2">
                Try adjusting your criteria or clearing filters.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {results.map((sku) => (
                  <SkuCard key={sku.id} sku={sku} />
                ))}
              </div>
              <Pagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                totalResults={pagination.totalResults}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

