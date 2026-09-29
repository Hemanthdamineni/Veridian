import { SkuForm } from "@/components/admin/SkuForm";
import { SkuList } from "@/components/admin/SkuList";
import { AdminStatsPanel } from "@/components/AdminStatsPanel";

export const dynamic = "force-dynamic";

interface Manufacturer {
  id: string;
  name: string;
  series: {
    id: string;
    name: string;
    models: {
      id: string;
      name: string;
    }[];
  }[];
}

interface Sku {
  id: string;
  skuCode: string;
  cpuModel: string;
  ramGb: number;
  weightKg: number;
  createdAt: Date;
  model: {
    name: string;
    series: {
      name: string;
      manufacturer: {
        name: string;
      };
    };
  };
  pricing: {
    region: string;
    currency: string;
    msrp: number;
  }[];
}

async function getData() {
  try {
    const { prisma } = await import("@/lib/db");
    const [manufacturers, skus] = await Promise.all([
      prisma.manufacturer.findMany({
        include: {
          series: {
            include: {
              models: true,
            },
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.sku.findMany({
        include: {
          model: {
            include: {
              series: {
                include: { manufacturer: true },
              },
            },
          },
          pricing: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
    return { manufacturers, skus, error: null };
  } catch (error) {
    return {
      manufacturers: [] as Manufacturer[],
      skus: [] as Sku[],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export default async function AdminPage() {
  const { manufacturers, skus, error } = await getData();

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-8">
          Admin — SKU Management
        </h1>
        <div className="p-4 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg">
          <p className="font-medium">Database connection error</p>
          <p className="text-sm mt-1">{error}</p>
          <p className="text-sm mt-2">
            Please ensure DATABASE_URL is configured and the database is accessible.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-8">
        Admin — SKU Management
      </h1>

      <div className="mb-8">
        <AdminStatsPanel />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
            Add New SKU
          </h2>
          <SkuForm manufacturers={manufacturers} />
        </div>

        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
            Recent SKUs ({skus.length})
          </h2>
          <SkuList skus={skus} />
        </div>
      </div>
    </div>
  );
}
