// Veridian shared types

export interface SkuDisplay {
  sizeIn: number;
  resolution: string;
  type: string;
  refreshHz: number;
  touch: boolean;
  nits: number | null;
}

export interface SkuPrice {
  region: string;
  currency: string;
  msrp: number;
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
  ramType: string;
  ramSoldered: boolean;
  storageGb: number;
  storageType: string;
  display: SkuDisplay;
  weightKg: number;
  batteryWh: number;
  os: string;
  buildMaterial: string;
  price: SkuPrice | null;
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
  q?: string;
  sort?: string;
  page?: string;
  limit?: string;
}

export type SortOption = "price_asc" | "price_desc" | "weight_asc" | "battery_desc" | "newest";

export const CPU_BRANDS = ["Intel", "AMD", "Qualcomm", "Apple"] as const;
export const DISPLAY_TYPES = ["IPS", "OLED", "Mini-LED"] as const;
export const REGIONS = ["US", "IN", "UK", "EU", "CA"] as const;
