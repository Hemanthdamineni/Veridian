// Catalog state and URL-sync helpers shared by the interactive catalog.

export interface FilterState {
  q: string;
  cpuBrand: string[];
  ramMin: string;
  storageMin: string;
  displayType: string[];
  refreshMin: string;
  weightMax: string;
  batteryMin: string;
  touch: string;
  region: string;
  priceMin: string;
  priceMax: string;
  provenance: string[];
  sort: string;
  page: number;
}

export const DEFAULT_FILTERS: FilterState = {
  q: "",
  cpuBrand: [],
  ramMin: "",
  storageMin: "",
  displayType: [],
  refreshMin: "",
  weightMax: "",
  batteryMin: "",
  touch: "",
  region: "US",
  priceMin: "",
  priceMax: "",
  provenance: [],
  sort: "",
  page: 1,
};

/** Build a query string (omitting defaults) from filter state. */
export function filtersToQuery(f: FilterState): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.cpuBrand.length) p.set("cpu_brand", f.cpuBrand.join(","));
  if (f.ramMin) p.set("ram_min", f.ramMin);
  if (f.storageMin) p.set("storage_min", f.storageMin);
  if (f.displayType.length) p.set("display_type", f.displayType.join(","));
  if (f.refreshMin) p.set("refresh_min", f.refreshMin);
  if (f.weightMax) p.set("weight_max", f.weightMax);
  if (f.batteryMin) p.set("battery_min", f.batteryMin);
  if (f.touch) p.set("touch", f.touch);
  if (f.region) p.set("region", f.region);
  if (f.priceMin) p.set("price_min", f.priceMin);
  if (f.priceMax) p.set("price_max", f.priceMax);
  if (f.provenance.length) p.set("provenance", f.provenance.join(","));
  if (f.sort) p.set("sort", f.sort);
  if (f.page > 1) p.set("page", String(f.page));
  return p.toString();
}

/** Parse URLSearchParams into a full filter state. */
export function queryToFilters(sp: URLSearchParams): FilterState {
  return {
    q: sp.get("q") ?? "",
    cpuBrand: split(sp.get("cpu_brand")),
    ramMin: sp.get("ram_min") ?? "",
    storageMin: sp.get("storage_min") ?? "",
    displayType: split(sp.get("display_type")),
    refreshMin: sp.get("refresh_min") ?? "",
    weightMax: sp.get("weight_max") ?? "",
    batteryMin: sp.get("battery_min") ?? "",
    touch: sp.get("touch") ?? "",
    region: sp.get("region") ?? "US",
    priceMin: sp.get("price_min") ?? "",
    priceMax: sp.get("price_max") ?? "",
    provenance: split(sp.get("provenance")),
    sort: sp.get("sort") ?? "",
    page: clampPage(parseInt(sp.get("page") ?? "1", 10)),
  };
}

function split(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

export function clampPage(n: number): number {
  return Number.isFinite(n) && n > 1 ? n : 1;
}

/** True when anything beyond the (US, page 1) defaults is active. */
export function hasActiveFilters(f: FilterState): boolean {
  return !!(f.q || f.cpuBrand.length || f.ramMin || f.storageMin || f.displayType.length ||
    f.refreshMin || f.weightMax || f.batteryMin || f.touch || f.region !== "US" ||
    f.priceMin || f.priceMax || f.provenance.length || f.sort);
}

/** Ordered list of human-readable filter chips for display + dismissal. */
export function activeChips(f: FilterState): { key: string; label: string; clear: Partial<FilterState> }[] {
  const chips: { key: string; label: string; clear: Partial<FilterState> }[] = [];
  if (f.q) chips.push({ key: "q", label: `“${f.q}”`, clear: { q: "" } });
  if (f.cpuBrand.length) chips.push({ key: "cpu", label: f.cpuBrand.join(", "), clear: { cpuBrand: [] } });
  if (f.ramMin) chips.push({ key: "ram", label: `≥ ${f.ramMin} GB RAM`, clear: { ramMin: "" } });
  if (f.storageMin) chips.push({ key: "storage", label: `≥ ${fmtGb(Number(f.storageMin))} storage`, clear: { storageMin: "" } });
  if (f.displayType.length) chips.push({ key: "display", label: f.displayType.join(" · "), clear: { displayType: [] } });
  if (f.refreshMin) chips.push({ key: "refresh", label: `≥ ${f.refreshMin} Hz`, clear: { refreshMin: "" } });
  if (f.weightMax) chips.push({ key: "weight", label: `≤ ${f.weightMax} kg`, clear: { weightMax: "" } });
  if (f.batteryMin) chips.push({ key: "battery", label: `≥ ${f.batteryMin} Wh`, clear: { batteryMin: "" } });
  if (f.touch === "true") chips.push({ key: "touch", label: "Touch", clear: { touch: "" } });
  if (f.touch === "false") chips.push({ key: "notouch", label: "No touch", clear: { touch: "" } });
  if (f.region !== "US") chips.push({ key: "region", label: `Region: ${f.region}`, clear: { region: "US" } });
  if (f.priceMin) chips.push({ key: "pmin", label: `From ${f.priceMin}`, clear: { priceMin: "" } });
  if (f.priceMax) chips.push({ key: "pmax", label: `Up to ${f.priceMax}`, clear: { priceMax: "" } });
  if (f.provenance.length) {
    chips.push({
      key: "provenance",
      label: f.provenance.map((p) => (p === "certified" ? "Certified" : "Reference")).join(", "),
      clear: { provenance: [] },
    });
  }
  return chips;
}

function fmtGb(gb: number): string {
  return gb >= 1024 ? `${gb / 1024} TB` : `${gb} GB`;
}
