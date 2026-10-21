/**
 * Icecat open product data — parsing.
 *
 * Icecat publishes the specification of a product as a list of named
 * features. The names are stable inside the laptop category, but the unit a
 * feature is measured in is not written into the payload: Icecat leaves the
 * measure sign empty and expects the reader to know the category
 * convention.
 *
 * This module therefore only accepts a value when it can be read without
 * guessing:
 *
 *   * the feature name is one the connector knows;
 *   * the value is a single number, not a range and not a list;
 *   * and the unit, when the brand wrote one, is the unit the feature is
 *     defined in (or a unit that converts to it without loss).
 *
 * When the value is not published, or not published unambiguously, the field
 * stays `null`. A missing specification is never filled in from a guess.
 */

import type {
  IcecatFeature,
  IcecatFeaturesGroup,
  IcecatPrice,
  IcecatProduct,
  IcecatProductData,
  IcecatSpecs,
} from "./types";

/** The features the connector reads, and the unit each one is defined in. */
export type IcecatFeatureName =
  | "Internal memory"
  | "Total storage capacity"
  | "Storage media"
  | "Processor manufacturer"
  | "Processor family"
  | "Processor model"
  | "Display diagonal"
  | "Weight"
  | "Battery capacity";

/** The source name recorded on every observation this connector writes. */
export const ICECAT_SOURCE_NAME = "Icecat open product data";

/** An empty specification set. Every field starts out missing. */
export function emptySpecs(): IcecatSpecs {
  return {
    memoryGb: null,
    storageGb: null,
    storageType: null,
    processorBrand: null,
    processorModel: null,
    processorFamily: null,
    displaySizeIn: null,
    weightKg: null,
    batteryWh: null,
  };
}

/**
 * Parse a product payload into the shape Veridian stores.
 *
 * `sourceUrl` is the exact URL the payload was read from and is carried
 * through untouched, so every value can be traced back to the page it came
 * from.
 */
export function parseProduct(data: IcecatProductData, sourceUrl: string): IcecatProduct {
  const general = data.GeneralInfo ?? {};
  return {
    icecatId: general.IcecatId ? String(general.IcecatId) : "",
    productCode: general.BrandPartCode ?? "",
    brand: general.Brand ?? "",
    modelName: general.ProductName ?? "",
    title: general.Title ?? "",
    family: general.ProductFamily?.Value ?? null,
    series: general.ProductSeries?.Value ?? null,
    category: general.Category?.Name?.Value ?? null,
    categoryId: general.Category?.CategoryID ?? null,
    gtin: general.GTIN ?? [],
    sourceUrl,
    specs: parseSpecs(data.FeaturesGroups ?? []),
    price: parsePrice(data),
  };
}

/**
 * Read the specifications Veridian stores.
 *
 * The feature names are the ones Icecat uses in the laptop category:
 * `Internal memory` is gigabytes of installed memory, `Total storage
 * capacity` is gigabytes, `Display diagonal` is inches, `Battery capacity`
 * is watt-hours and `Weight` is grams.
 */
export function parseSpecs(groups: IcecatFeaturesGroup[]): IcecatSpecs {
  const specs = emptySpecs();
  const features = new Map<string, IcecatFeature>();
  for (const group of groups) {
    for (const feature of group.Features ?? []) {
      const name = feature.Feature?.Name?.Value;
      if (!name || features.has(name)) continue;
      features.set(name, feature);
    }
  }

  const memory = readNumber(features.get("Internal memory"));
  if (memory) {
    const gb = toGigabytes(memory.value, memory.unit);
    if (gb !== null && gb > 0 && gb <= 512) specs.memoryGb = gb;
  }

  const storage = readNumber(features.get("Total storage capacity"));
  if (storage) {
    const gb = toGigabytes(storage.value, storage.unit);
    if (gb !== null && gb > 0 && gb <= 65536) specs.storageGb = gb;
  }

  const storageMedia = readText(features.get("Storage media"));
  if (storageMedia) specs.storageType = storageMedia;

  const processorBrand = readText(features.get("Processor manufacturer"));
  if (processorBrand) specs.processorBrand = processorBrand;

  const processorFamily = readText(features.get("Processor family"));
  if (processorFamily) specs.processorFamily = processorFamily;

  const processorModel = readText(features.get("Processor model"));
  if (processorModel) specs.processorModel = processorModel;

  const diagonal = readNumber(features.get("Display diagonal"));
  if (diagonal) {
    const inches = toInches(diagonal.value, diagonal.unit);
    if (inches !== null && inches > 5 && inches <= 30) specs.displaySizeIn = inches;
  }

  const weight = readNumber(features.get("Weight"));
  if (weight) {
    const kg = toKilograms(weight.value, weight.unit);
    if (kg !== null && kg >= 0.2 && kg <= 8) specs.weightKg = kg;
  }

  const battery = readNumber(features.get("Battery capacity"));
  if (battery) {
    const wh = toWattHours(battery.value, battery.unit);
    if (wh !== null && wh > 0 && wh <= 500) specs.batteryWh = wh;
  }

  return specs;
}

/**
 * Read a price, when the payload carries one.
 *
 * The open demo store publishes specifications, not prices, so this returns
 * `null` for the data Veridian reads today. It never derives a price from a
 * title, a description or a feature value: a price is either published as
 * one or it is absent.
 *
 * The evidence class follows what the record says. A record that names the
 * manufacturer as the source of the price is a manufacturer price; anything
 * else is the price a distributor quotes.
 */
export function parsePrice(data: IcecatProductData): IcecatPrice | null {
  const block = data.Price;
  if (!block) return null;

  const amount = firstNumber(block.amount, block.value, block.price);
  if (amount === null || amount <= 0) return null;

  const currency = block.currency ? block.currency.trim().toUpperCase() : "";
  if (!currency) return null;

  const brand = data.GeneralInfo?.Brand ?? "";
  const sourceName = block.sourceName ? block.sourceName.trim() : null;
  let kind: "retail" | "manufacturer";
  if (block.kind === "manufacturer" || block.kind === "retail") {
    kind = block.kind;
  } else if (sourceName && brand && sameBrand(sourceName, brand)) {
    // The record names the manufacturer as the source of the price.
    kind = "manufacturer";
  } else {
    kind = "retail";
  }

  return {
    amount,
    currency,
    region: block.region ? block.region.trim() : null,
    kind,
    sourceName,
  };
}

/** True when two brand names name the same brand. */
function sameBrand(a: string, b: string): boolean {
  const fold = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return fold(a) === fold(b);
}

/** A number the brand published, with the unit it wrote next to it. */
interface NumericValue {
  value: number;
  unit: string;
}

/**
 * Read a feature as a single number.
 *
 * Ranges ("0 - 95"), lists ("2x SO-DIMM") and free text are not numbers and
 * are rejected rather than guessed at.
 */
function readNumber(feature: IcecatFeature | undefined): NumericValue | null {
  if (!feature) return null;
  const raw = (feature.RawValue ?? feature.Value ?? "").toString().trim();
  if (!raw) return null;
  const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z%°/µ"']*)$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: match[2].toLowerCase() };
}

/** Read a feature as text, when the brand published text. */
function readText(feature: IcecatFeature | undefined): string | null {
  if (!feature) return null;
  const raw = (feature.RawValue ?? feature.Value ?? "").toString().trim();
  return raw ? raw : null;
}

function firstNumber(...values: Array<number | string | undefined>): number | null {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const parsed = typeof value === "number" ? value : Number(String(value).trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Convert to gigabytes.
 *
 * Icecat publishes memory and storage in gigabytes and leaves the unit
 * empty. A unit the brand did write is honoured when it converts exactly.
 */
function toGigabytes(value: number, unit: string): number | null {
  if (unit === "" || unit === "gb" || unit === "gbs") return value;
  if (unit === "mb") return value / 1024;
  if (unit === "tb") return value * 1024;
  return null;
}

/**
 * Convert to inches.
 *
 * Icecat publishes the display diagonal in inches. A brand that wrote
 * centimetres is converted, because the conversion is exact.
 */
function toInches(value: number, unit: string): number | null {
  if (unit === "" || unit === "in" || unit === "inch" || unit === "inches" || unit === '"') {
    return value;
  }
  if (unit === "cm") return value / 2.54;
  if (unit === "mm") return value / 25.4;
  return null;
}

/**
 * Convert to kilograms.
 *
 * Icecat publishes the weight of a notebook in grams and leaves the unit
 * empty. A brand that wrote kilograms is taken as it is; a brand that wrote
 * grams is converted. A value that cannot be a notebook weight in either
 * unit is rejected by the caller.
 */
function toKilograms(value: number, unit: string): number | null {
  if (unit === "" || unit === "g" || unit === "gr" || unit === "gram" || unit === "grams") {
    return value / 1000;
  }
  if (unit === "kg" || unit === "kgs" || unit === "kilogram" || unit === "kilograms") {
    return value;
  }
  return null;
}

/** Convert to watt-hours. Icecat publishes battery capacity in watt-hours. */
function toWattHours(value: number, unit: string): number | null {
  if (unit === "" || unit === "wh") return value;
  if (unit === "mwh") return value / 1000;
  return null;
}
