import type { SkusQueryParams, SortOption, SkuListItem } from "@/types";

export function buildSkusQuery(params: SkusQueryParams): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  // CPU Brand filter (multi-select, comma-separated)
  if (params.cpuBrand) {
    const brands = params.cpuBrand.split(",").filter(Boolean);
    if (brands.length > 0) {
      where.cpuBrand = { in: brands };
    }
  }

  // RAM minimum
  if (params.ramMin) {
    const ramMin = parseInt(params.ramMin, 10);
    if (!isNaN(ramMin)) {
      where.ramGb = { gte: ramMin };
    }
  }

  // Storage minimum
  if (params.storageMin) {
    const storageMin = parseInt(params.storageMin, 10);
    if (!isNaN(storageMin)) {
      where.storageGb = { gte: storageMin };
    }
  }

  // Display type filter (multi-select)
  if (params.displayType) {
    const types = params.displayType.split(",").filter(Boolean);
    if (types.length > 0) {
      where.displayType = { in: types };
    }
  }

  // Refresh rate minimum
  if (params.refreshMin) {
    const refreshMin = parseInt(params.refreshMin, 10);
    if (!isNaN(refreshMin)) {
      where.displayRefreshHz = { gte: refreshMin };
    }
  }

  // Weight maximum
  if (params.weightMax) {
    const weightMax = parseFloat(params.weightMax);
    if (!isNaN(weightMax)) {
      where.weightKg = { lte: weightMax };
    }
  }

  // Battery minimum
  if (params.batteryMin) {
    const batteryMin = parseFloat(params.batteryMin);
    if (!isNaN(batteryMin)) {
      where.batteryWh = { gte: batteryMin };
    }
  }

  // Touch filter
  if (params.touch === "true") {
    where.displayTouch = true;
  } else if (params.touch === "false") {
    where.displayTouch = false;
  }

  // Region availability + price filter
  if (params.region) {
    const pricingFilter: Record<string, unknown> = {
      some: {
        region: params.region,
        available: true,
      },
    };

    if (params.priceMin || params.priceMax) {
      const priceFilter: { gte?: number; lte?: number } = {};
      if (params.priceMin) {
        const min = parseFloat(params.priceMin);
        if (!isNaN(min)) priceFilter.gte = min;
      }
      if (params.priceMax) {
        const max = parseFloat(params.priceMax);
        if (!isNaN(max)) priceFilter.lte = max;
      }
      (pricingFilter.some as Record<string, unknown>).msrp = priceFilter;
    }

    where.pricing = pricingFilter;
  }

  // Text search (model name or SKU code)
  if (params.q) {
    where.OR = [
      { skuCode: { contains: params.q, mode: "insensitive" } },
      { model: { name: { contains: params.q, mode: "insensitive" } } },
    ];
  }

  return where;
}

export function buildOrderBy(sort?: string): Record<string, unknown>[] {
  const sortOption = sort as SortOption | undefined;

  switch (sortOption) {
    // Price sorting is handled separately in the API route because
    // Prisma cannot directly sort by a relation's field.
    // The API route fetches with default ordering, then sorts by price in memory.
    case "price_asc":
    case "price_desc":
      return [{ createdAt: "desc" }]; // Default order; price sorting done in route
    case "weight_asc":
      return [{ weightKg: "asc" }];
    case "battery_desc":
      return [{ batteryWh: "desc" }];
    case "newest":
      return [{ launchDate: "desc" }];
    default:
      return [{ createdAt: "desc" }];
  }
}

export function parsePagination(params: SkusQueryParams): { page: number; limit: number; skip: number } {
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.limit || "24", 10) || 24));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

interface SkuWithRelations {
  id: string;
  skuCode: string;
  cpuBrand: string;
  cpuModel: string;
  cpuCores: number | null;
  gpuModel: string | null;
  ramGb: number;
  ramType: string;
  ramSoldered: boolean;
  storageGb: number;
  storageType: string;
  displaySizeIn: number;
  displayResolution: string;
  displayType: string;
  displayRefreshHz: number;
  displayTouch: boolean;
  displayNits: number | null;
  weightKg: number;
  batteryWh: number;
  os: string;
  buildMaterial: string;
  model: {
    name: string;
    series: {
      name: string;
      manufacturer: {
        name: string;
      };
    };
  };
  pricing: Array<{ region: string; currency: string; msrp: number }>;
}

export function formatSkuListItem(sku: SkuWithRelations, region?: string | undefined): SkuListItem {
  const price = region
    ? sku.pricing.find((p) => p.region === region) || null
    : sku.pricing[0] || null;

  return {
    id: sku.id,
    skuCode: sku.skuCode,
    modelName: sku.model.name,
    seriesName: sku.model.series.name,
    manufacturerName: sku.model.series.manufacturer.name,
    cpuBrand: sku.cpuBrand,
    cpuModel: sku.cpuModel,
    cpuCores: sku.cpuCores,
    gpuModel: sku.gpuModel,
    ramGb: sku.ramGb,
    ramType: sku.ramType,
    ramSoldered: sku.ramSoldered,
    storageGb: sku.storageGb,
    storageType: sku.storageType,
    display: {
      sizeIn: sku.displaySizeIn,
      resolution: sku.displayResolution,
      type: sku.displayType,
      refreshHz: sku.displayRefreshHz,
      touch: sku.displayTouch,
      nits: sku.displayNits,
    },
    weightKg: sku.weightKg,
    batteryWh: sku.batteryWh,
    os: sku.os,
    buildMaterial: sku.buildMaterial,
    price: price
      ? {
          region: price.region,
          currency: price.currency,
          msrp: price.msrp,
        }
      : null,
  };
}
