import { prisma } from "@/lib/db";
import { scoreLaptopForRecommendation, type RecommendationInput } from "@/lib/ai";

/**
 * The queries behind the public API.
 *
 * They live here rather than inside the route handlers so the browser
 * application and the public API answer the same question the same way.
 */

export interface PublicListParams {
  limit: number;
  page: number;
  region: string;
  provenance?: string;
  manufacturer?: string;
  q?: string;
  ramMin?: number;
  cpuBrand?: string;
  displayType?: string;
  weightMax?: number;
  batteryMin?: number;
  priceMax?: number;
}

export async function listConfigurations(params: PublicListParams) {
  const where: Record<string, unknown> = { catalogVisible: true };

  if (params.provenance) {
    const wanted = params.provenance
      .split(",")
      .map((tier) => tier.trim())
      .filter((tier) =>
        tier === "certified" || tier === "manufacturer" || tier === "unverified"
      );
    if (wanted.length === 1) where.provenance = wanted[0];
    else if (wanted.length > 1) where.provenance = { in: wanted };
  }
  if (params.manufacturer) {
    where.model = { series: { manufacturer: { slug: params.manufacturer } } };
  }
  if (params.q) {
    where.OR = [
      { skuCode: { contains: params.q } },
      { model: { name: { contains: params.q } } },
    ];
  }
  if (params.ramMin !== undefined) where.ramGb = { gte: params.ramMin };
  if (params.cpuBrand) {
    where.cpuBrand = { in: params.cpuBrand.split(",").map((value) => value.trim()) };
  }
  if (params.displayType) {
    where.displayType = {
      in: params.displayType.split(",").map((value) => value.trim()),
    };
  }
  if (params.weightMax !== undefined) where.weightKg = { lte: params.weightMax };
  if (params.batteryMin !== undefined) where.batteryWh = { gte: params.batteryMin };
  if (params.priceMax !== undefined) {
    where.pricing = {
      some: {
        region: params.region,
        available: true,
        msrp: { lte: params.priceMax },
      },
    };
  }

  const [total, rows] = await Promise.all([
    prisma.sku.count({ where }),
    prisma.sku.findMany({
      where,
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      orderBy: [{ launchDate: "desc" }, { createdAt: "desc" }],
      include: {
        model: { include: { series: { include: { manufacturer: true } } } },
        pricing: { where: { region: params.region } },
      },
    }),
  ]);

  return {
    total,
    rows,
  };
}

/** A configuration with everything a reader needs to judge it. */
export async function getConfiguration(id: string) {
  return prisma.sku.findFirst({
    where: { id, catalogVisible: true },
    include: {
      model: { include: { series: { include: { manufacturer: true } } } },
      pricing: true,
      certifiedSpecs: true,
      sources: true,
      components: { include: { component: true } },
    },
  });
}

export interface RecommendParams {
  budget?: number;
  currency?: string;
  min_ram?: number;
  preferred_size?: number;
  display_preference?: "IPS" | "OLED" | "Mini-LED";
  use_case?: RecommendationInput["use_case"];
  max_weight?: number;
  region: string;
  limit: number;
}

/** Rank configurations against a set of requirements, with the reasons shown. */
export async function recommend(params: RecommendParams) {
  const requirements: RecommendationInput = {
    budget: params.budget,
    currency: params.currency,
    min_ram: params.min_ram,
    preferred_size: params.preferred_size,
    display_preference: params.display_preference,
    use_case: params.use_case,
    max_weight: params.max_weight,
  };

  const where: Record<string, unknown> = { catalogVisible: true };
  if (params.budget) {
    where.pricing = {
      some: {
        region: params.region,
        available: true,
        msrp: { lte: params.budget * 1.2 },
      },
    };
  }
  if (params.min_ram) where.ramGb = { gte: params.min_ram };
  if (params.display_preference) where.displayType = params.display_preference;
  if (params.max_weight) where.weightKg = { lte: params.max_weight * 1.2 };

  const candidates = await prisma.sku.findMany({
    where,
    take: 60,
    orderBy: [{ launchDate: "desc" }, { createdAt: "desc" }],
    include: {
      model: { include: { series: { include: { manufacturer: true } } } },
      pricing: { where: { region: params.region } },
    },
  });

  const scored = candidates.map((sku) => {
    const laptop = {
      id: sku.id,
      name: `${sku.model.series.manufacturer.name} ${sku.model.name}`,
      price: sku.pricing[0]?.msrp ?? null,
      currency: sku.pricing[0]?.currency || "USD",
      ram_gb: sku.ramGb,
      display_size_in: sku.displaySizeIn,
      display_type: sku.displayType,
      weight_kg: sku.weightKg,
      battery_wh: sku.batteryWh,
      cpu_brand: sku.cpuBrand,
      brand: sku.model.series.manufacturer.name,
    };
    return {
      ...scoreLaptopForRecommendation(laptop, requirements),
      provenance: sku.provenance,
    };
  });

  return {
    requirements,
    recommendations: scored
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, params.limit),
    total_candidates: candidates.length,
  };
}

/** Read the shared filter parameters the public API accepts. */
export function readListParams(
  search: URLSearchParams
): { params: PublicListParams; error: string | null } {
  const number = (name: string): number | undefined => {
    const raw = search.get(name);
    if (raw === null || raw === "") return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const limit = Math.min(100, Math.max(1, number("limit") ?? 24));
  const page = Math.max(1, number("page") ?? 1);
  const region = search.get("region") ?? "US";

  return {
    params: {
      limit,
      page,
      region,
      provenance: search.get("provenance") ?? undefined,
      manufacturer: search.get("manufacturer") ?? undefined,
      q: search.get("q") ?? undefined,
      ramMin: number("ram_min"),
      cpuBrand: search.get("cpu_brand") ?? undefined,
      displayType: search.get("display_type") ?? undefined,
      weightMax: number("weight_max"),
      batteryMin: number("battery_min"),
      priceMax: number("price_max"),
    },
    error: null,
  };
}
