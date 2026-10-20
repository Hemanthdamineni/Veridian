/**
 * Field-specific deterministic validators for ENERGY STAR records.
 * Impossible values fail visibly; no partial inserts become catalog facts.
 */

import type { NormalizedRecord } from "./types";
import {
  canonicalBrand,
  canonicalSkuCode,
  configurationSignature,
  deriveSeriesName,
  isPlaceholderNote,
  parseAdditionalModelInfo,
  stripEnumerationPrefix,
  type AdditionalModelInfo,
} from "./canonical";

/**
 * Resolve the canonical part number for a record.
 *
 * `model_number` is the source's primary identifier and is used as reported.
 * A small number of records put a wildcard legend there instead of an
 * identifier ("NC.**.##.##**** (*= A-Z or a-z or blank, #= 0-9)"); for those
 * the first additional part number is used, and failing that the model name.
 */
export function resolvePartNumber(
  modelNumber: string | null,
  additional: AdditionalModelInfo
): string | null {
  if (modelNumber && !isPlaceholderNote(modelNumber)) return modelNumber;
  if (additional.partNumbers.length > 0) return additional.partNumbers[0];
  return modelNumber;
}

export type FieldError = string;

function text(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result || null;
}

function number(raw: Record<string, unknown>, key: string, min: number, max: number, errors: string[]): number | null {
  const value = text(raw, key);
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    errors.push(`${key} '${value}' is outside [${min}, ${max}] or not finite`);
    return null;
  }
  return parsed;
}

function bool(raw: Record<string, unknown>, key: string, errors: string[]): boolean | null {
  const value = text(raw, key);
  if (value === null) return null;
  if (/^(yes|true|1)$/i.test(value)) return true;
  if (/^(no|false|0)$/i.test(value)) return false;
  errors.push(`${key} '${value}' is not a valid Yes/No value`);
  return null;
}

function date(raw: Record<string, unknown>, key: string, errors: string[]): string | null {
  const value = text(raw, key);
  if (value === null) return null;
  const iso = /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    errors.push(`${key} '${value}' is not a valid date`);
    return null;
  }
  return iso;
}

function cleanIdentity(value: string, key: string, errors: string[]): void {
  if (/[\u0000-\u001f\u007f]/.test(value)) errors.push(`${key} contains control characters`);
  if (value.length > 200) errors.push(`${key} exceeds 200 characters`);
}

/**
 * Product types the source reports that are laptops.
 *
 * The dataset also carries desktops, integrated desktops, tablets, thin
 * clients and workstations. Those are out of scope for a laptop catalog, so
 * they are rejected with a reason rather than silently mis-filed.
 */
export const LAPTOP_PRODUCT_TYPES = [
  "Notebook",
  "Two-In-One Notebook",
  "Ruggedized Notebook",
] as const;

const LAPTOP_PRODUCT_TYPE_SET = new Set<string>(LAPTOP_PRODUCT_TYPES);

export function validateEnergyStarRecord(raw: unknown): { record: NormalizedRecord | null; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { record: null, errors: ["record must be an object"] };
  }
  const row = raw as Record<string, unknown>;
  const id = text(row, "pd_id");
  const brand = text(row, "brand_name");
  const model = text(row, "model_name");
  const modelNumber = text(row, "model_number");
  const energyStarId = text(row, "energy_star_model_identifier");
  if (!id) errors.push("pd_id is required");
  if (!brand) errors.push("brand_name is required");
  if (!model) errors.push("model_name is required");
  if (!modelNumber) errors.push("model_number is required");
  if (!energyStarId) errors.push("energy_star_model_identifier is required");
  for (const [value, key] of [[id, "pd_id"], [brand, "brand_name"], [model, "model_name"], [modelNumber, "model_number"], [energyStarId, "energy_star_model_identifier"]] as const) {
    if (value) cleanIdentity(value, key, errors);
  }
  const type = text(row, "type");
  if (!type) {
    errors.push("type is required");
  } else if (!LAPTOP_PRODUCT_TYPE_SET.has(type)) {
    errors.push(`type '${type}' is not a laptop product type`);
  }

  const cpuCores = number(row, "physical_cpu_cores_count", 1, 512, errors);
  const cpuBaseClock = number(row, "cpu_base_clock_speed_ghz", 0.5, 6.5, errors);
  const cpuMaxClock = number(row, "cpu_maximum_clock_speed_ghz", 0.5, 7.5, errors);
  const cpuPackages = number(row, "cpu_packages_count", 1, 16, errors);
  const ramGb = number(row, "system_memory_ram_gb", 0.5, 2048, errors);
  if (ramGb === null && !errors.some((error) => error.startsWith("system_memory_ram_gb"))) {
    errors.push("system_memory_ram_gb is required");
  } else if (ramGb !== null && !Number.isInteger(ramGb)) {
    errors.push(`system_memory_ram_gb (${ramGb}) must be a whole number of GB`);
  }
  const storageDrives = number(row, "number_of_installed_storage_drives", 0, 16, errors);
  const displaySizeIn = number(row, "integrated_display_diagonal_screen_size_in", 5, 32, errors);
  const resolutionMp = number(row, "integrated_display_resolution_megapixels", 0.1, 100, errors);
  const displayAreaSqIn = number(row, "integrated_display_viewable_screen_area_sq_in", 1, 1200, errors);
  const batteryWh = number(row, "total_battery_capacity_watt_hours", 0.1, 300, errors);
  const touchScreen = bool(row, "touch_screen", errors);
  const npu = bool(row, "installed_npu", errors);
  const marketDate = date(row, "date_available_on_market", errors);
  const certifiedAt = date(row, "date_certified", errors);
  const cpuBrand = text(row, "processor_brand");
  const cpuModel = text(row, "processor_name");
  const storageType = text(row, "storage_technology");
  const os = text(row, "operating_system_name");
  const markets = text(row, "markets");
  if (os && os.length > 200) errors.push("operating_system_name exceeds 200 characters");

  // Identity fields. `model_number` is the source's own identifier for the
  // product; it is not always a part number (Microsoft uses a marketing
  // number shared across generations, Dell uses a platform code), so it is
  // kept as reported and the configuration signature disambiguates. For a
  // handful of records the source puts a wildcard legend in `model_number`
  // instead of an identifier; those fall back to the additional part number.
  const additionalRaw = text(row, "additional_model_information");
  const additional = parseAdditionalModelInfo(additionalRaw);
  const partNumber = resolvePartNumber(modelNumber, additional);
  const upc = text(row, "upc");

  const brandCanonical = canonicalBrand(brand);
  const canonicalModelName = stripEnumerationPrefix(model);
  const seriesName = deriveSeriesName(brandCanonical, canonicalModelName, additional);

  const signature = configurationSignature({
    cpuModel,
    cpuCores,
    cpuPackages,
    ramGb,
    storageType,
    storageDrives,
    displaySizeIn,
    displayResolutionMp: resolutionMp,
    touchScreen,
    batteryWh,
    os,
  });
  const skuCode = canonicalSkuCode(partNumber, canonicalModelName, signature);

  if (errors.length || !id || !brand || !model || !modelNumber || !energyStarId) {
    return { record: null, errors };
  }

  return {
    errors,
    record: {
      sourceRecordId: id,
      skuCode,
      brand: brandCanonical,
      modelName: canonicalModelName,
      seriesName,
      os: os ?? "Not reported",
      launchDate: marketDate,
      dateCertified: certifiedAt,
      partNumber: modelNumber,
      partNumbers: additional.partNumbers,
      upc,
      productType: type,
      markets,
      certifiedSpecs: {
        source: "US EPA ENERGY STAR Certified Computers V9.0",
        sourceUrl: `https://data.energystar.gov/resource/rxdj-2c88.json?pd_id=${encodeURIComponent(id)}`,
        observedAt: new Date().toISOString(),
        certifiedAt,
        marketDate,
        energyStarId,
        cpuBrand,
        cpuModel,
        cpuCores,
        cpuBaseClockGHz: cpuBaseClock,
        cpuMaxClockGHz: cpuMaxClock,
        cpuPackages,
        ramGb,
        storageType,
        storageDrives,
        displaySizeIn,
        displayResolutionMp: resolutionMp,
        displayAreaSqIn,
        touchScreen,
        batteryWh,
        os,
        npu,
        markets,
      },
    },
  };
}
