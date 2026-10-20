import type { SkusQueryParams, SortOption, SkuListItem } from "@/types";

export function buildSkusQuery(params: SkusQueryParams): Record<string, unknown> {
  const where: Record<string, unknown> = {
    catalogVisible: true,
  };

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

  // Region selects which regional price to display — it is deliberately NOT an
  // existence requirement. Configurations with no price recorded for the region
  // (notably the ENERGY STAR certified records, which carry no retail price)
  // must stay in the catalog and be reported as "price not reported" rather
  // than being silently dropped. Only an explicit price bound requires a
  // recorded price, because a bound cannot be evaluated without one.
  if (params.region) {
    const priceFilter: { gte?: number; lte?: number } = {};
    if (params.priceMin) {
      const min = parseFloat(params.priceMin);
      if (!isNaN(min)) priceFilter.gte = min;
    }
    if (params.priceMax) {
      const max = parseFloat(params.priceMax);
      if (!isNaN(max)) priceFilter.lte = max;
    }

    if (Object.keys(priceFilter).length > 0) {
      where.pricing = {
        some: {
          region: params.region,
          available: true,
          msrp: priceFilter,
        },
      };
    }
  }

  // Provenance tier. The catalog deliberately mixes two tiers of record —
  // certified configurations that carry a cited source, and reference
  // configurations that do not — so the tier is an explicit filter.
  if (params.provenance) {
    const tiers = params.provenance.split(",").filter(Boolean);
    const wantCertified = tiers.includes("certified");
    const wantReference = tiers.includes("reference");
    if (wantCertified && !wantReference) {
      where.certifiedSpecs = { some: {} };
    } else if (wantReference && !wantCertified) {
      where.certifiedSpecs = { none: {} };
    }
  }

  // Text search (model name or SKU code)
  if (params.q) {
    where.OR = [
      // SQLite does not support Prisma's `mode` filter option; its default
      // NOCASE collation provides case-insensitive matching for catalog text.
      { skuCode: { contains: params.q } },
      { model: { name: { contains: params.q } } },
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
  ramType: string | null;
  ramSoldered: boolean | null;
  storageGb: number | null;
  storageType: string | null;
  displaySizeIn: number | null;
  displayResolution: string | null;
  displayType: string | null;
  displayRefreshHz: number | null;
  displayTouch: boolean | null;
  displayNits: number | null;
  weightKg: number | null;
  batteryWh: number | null;
  os: string;
  buildMaterial: string | null;
  model: {
    name: string;
    productUrl: string | null;
    series: {
      name: string;
      manufacturer: {
        name: string;
      };
    };
  };
  pricing: Array<{ region: string; currency: string; msrp: number }>;
  certifiedSpecs?: Array<{ id: string }>;
}

/**
 * Provenance of a catalog row.
 *
 * - `certified` — the row traces back to a cited certification record with a
 *   stored raw observation and payload hash.
 * - `reference` — the row is a reference configuration with no cited source.
 */
export type SkuProvenance = "certified" | "reference";

export interface PricedSkuLike {
  pricing: Array<{ region: string; msrp: number }>;
}

/**
 * Sort rows by the MSRP recorded for `region`.
 *
 * Rows with no price for the region sort last in BOTH directions. Treating a
 * missing price as `Infinity` would push priceless configurations to the top
 * of a "most expensive" list, which reads as a price claim the data does not
 * support.
 */
export function sortSkusByPrice<T extends PricedSkuLike>(
  skus: T[],
  region: string,
  direction: "asc" | "desc"
): T[] {
  const priceOf = (sku: T): number | null =>
    sku.pricing.find((p) => p.region === region)?.msrp ?? null;

  return [...skus].sort((a, b) => {
    const pa = priceOf(a);
    const pb = priceOf(b);
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return direction === "asc" ? pa - pb : pb - pa;
  });
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
    provenance: sku.certifiedSpecs && sku.certifiedSpecs.length > 0 ? "certified" : "reference",
    price: price
      ? {
          region: price.region,
          currency: price.currency,
          msrp: price.msrp,
          storeUrl: sku.model.productUrl || null, // link shown next to the price
        }
      : null,
    storeUrl: sku.model.productUrl || null, // also surfaced at top level for detail views
  };
}
