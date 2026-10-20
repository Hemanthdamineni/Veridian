// Veridian shared types

export interface SkuDisplay {
  sizeIn: number | null;
  resolution: string | null;
  type: string | null;
  refreshHz: number | null;
  touch: boolean | null;
  nits: number | null;
}

export interface SkuPrice {
  region: string;
  currency: string;
  msrp: number;
  storeUrl?: string | null;
}

export interface SkuListItem {
  id: string;
  skuCode: string;
  modelName: string;
  seriesName: string;
  manufacturerName: string;
  cpuBrand: string;
  cpuModel: string;
  cpuCores: number | null;
  gpuModel: string | null;
  ramGb: number;
  ramType: string | null;
  ramSoldered: boolean | null;
  storageGb: number | null;
  storageType: string | null;
  display: SkuDisplay;
  weightKg: number | null;
  batteryWh: number | null;
  os: string;
  buildMaterial: string | null;
  price: SkuPrice | null;
  storeUrl: string | null;
  /**
   * `certified` — the row carries a cited certification record.
   * `reference` — the row is a reference configuration with no cited source.
   */
  provenance: "certified" | "reference";
  catalogVisible?: boolean;
  certifiedSpecs?: Array<{
    source: string;
    sourceUrl: string | null;
    observedAt: string;
    certifiedAt: string | null;
    marketDate: string | null;
    energyStarId: string;
    cpuBrand: string | null;
    cpuModel: string | null;
    cpuCores: number | null;
    cpuBaseClockGHz: number | null;
    cpuMaxClockGHz: number | null;
    cpuPackages: number | null;
    ramGb: number | null;
    storageType: string | null;
    storageDrives: number | null;
    displaySizeIn: number | null;
    displayResolutionMp: number | null;
    displayAreaSqIn: number | null;
    touchScreen: boolean | null;
    batteryWh: number | null;
    os: string | null;
    npu: boolean | null;
    markets: string | null;
  }>;
}

export interface SkuDetail extends SkuListItem {
  storageSlots: number | null;
  batteryLifeHours: number | null;
  npuTops: number | null;
  linuxCompat: string | null;
  launchDate: string | null;
  discontinued: boolean;
  productUrl: string | null;
  price: SkuPrice | null;
  pricing: SkuPrice[];
  ports: SkuPort[];
}

export interface SkuPort {
  portType: string;
  count: number;
}

export interface Pagination {
  page: number;
  limit: number;
  totalResults: number;
  totalPages: number;
}

export interface SkusResponse {
  results: SkuListItem[];
  pagination: Pagination;
  /**
   * Regions for which at least one price is recorded. The catalog only offers
   * these as price-display regions — offering a region with no data would
   * guarantee an empty result set.
   */
  availableRegions?: string[];
  /**
   * How the current result set splits between certified configurations (with a
   * cited source) and reference configurations (without one).
   */
  tiers?: { certified: number; reference: number };
}

export interface ManufacturerItem {
  id: string;
  name: string;
  slug: string;
  country: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
}

export interface SkusQueryParams {
  cpuBrand?: string;
  ramMin?: string;
  storageMin?: string;
  displayType?: string;
  refreshMin?: string;
  weightMax?: string;
  batteryMin?: string;
  touch?: string;
  region?: string;
  priceMin?: string;
  priceMax?: string;
  provenance?: string;
  q?: string;
  sort?: string;
  page?: string;
  limit?: string;
}

export type SortOption = "price_asc" | "price_desc" | "weight_asc" | "battery_desc" | "newest";

export const CPU_BRANDS = ["Intel", "AMD", "Qualcomm", "Apple"] as const;
export const DISPLAY_TYPES = ["IPS", "OLED", "Mini-LED"] as const;
export const REGIONS = ["US", "IN", "UK", "EU", "CA"] as const;
