/**
 * Field-specific deterministic validators for Wikidata laptop rows.
 *
 * The rules mirror `energy-star/validate.ts`: an impossible value fails
 * visibly with an exact, human-readable reason, and no partial row becomes a
 * catalog fact. A value the source did not publish stays absent — it is
 * never guessed, never defaulted and never carried over from another row.
 *
 * Units are part of the observation. Wikidata states a mass in gram or in
 * kilogram, a memory size in gigabyte or in gibibyte, and a screen diagonal
 * in inch; the conversion tables below turn the stated value into the units
 * the catalog stores (kilogram, whole GB, inch).
 */

import { createHash } from "node:crypto";

import { isPlaceholderModelName } from "../energy-star/canonical";
import { deriveWikidataIdentity } from "./canonical";
import type { NormalizedRecord, WikidataRow } from "./types";

export type FieldError = string;

/** The SHA-256 hash of a verbatim source payload. */
export function payloadHash(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

// =============================================================================
// UNIT TABLES
// =============================================================================

/**
 * Mass units, expressed in kilogram.
 *
 * Wikidata's default unit for mass (P2067) is the gram, so most rows arrive
 * in grams; kilograms, milligrams, pounds and ounces are converted exactly.
 */
export const MASS_UNIT_TO_KG: Record<string, number> = {
  Q41803: 0.001, // gram
  Q11570: 1, // kilogram
  Q3241121: 1e-6, // milligram
  Q100995: 0.45359237, // pound
  Q48013: 0.028349523125, // ounce
};

/**
 * Memory units, expressed in the catalog's GB.
 *
 * The catalog stores a whole-GB marketing figure, so each family is read at
 * its own anchor: a decimal unit keeps its decimal value (16 gigabyte is
 * 16 GB), and a binary unit is read as its binary counterpart (16 gibibyte
 * is 8 388 608 kibibyte, i.e. 16 GB the way a buyer is sold it). A byte
 * count is a binary count, so 8 589 934 592 byte is 8 GB. A row states one
 * unit, so the two families are never mixed inside one conversion.
 *
 * Anything that is not a whole number of GB fails validation rather than
 * being rounded: 256 kibibyte of memory is not a laptop configuration.
 */
export const RAM_UNIT_TO_GB: Record<string, number> = {
  Q8799: 1 / 1073741824, // byte
  Q79756: 1 / 1048576, // kibibyte
  Q79758: 1 / 1024, // mebibyte
  Q79765: 1, // gibibyte
  Q79747: 1024, // tebibyte
  Q79726: 1e-6, // kilobyte
  Q79735: 0.001, // megabyte
  Q79738: 1, // gigabyte
  Q79741: 1000, // terabyte
};

/** Display diagonal units, expressed in inch. */
export const DISPLAY_SIZE_UNIT_TO_IN: Record<string, number> = {
  Q218593: 1, // inch
  Q174728: 1 / 2.54, // centimetre
  Q174789: 1 / 25.4, // millimetre
};

// =============================================================================
// PLAUSIBILITY BOUNDS
// =============================================================================

/** A laptop weighs more than a paperback and less than a full suitcase. */
export const MASS_KG_RANGE: [number, number] = [0.05, 50];

/** The same display diagonal range the ENERGY STAR validator uses. */
export const DISPLAY_SIZE_IN_RANGE: [number, number] = [5, 32];

/** Whole GB of memory a laptop can have. */
export const RAM_GB_RANGE: [number, number] = [1, 2048];

/** Longest accepted identity string. */
export const MAX_TEXT_LENGTH = 200;

// =============================================================================
// CPU BRAND
// =============================================================================

/**
 * Processor families and the brand that makes them.
 *
 * The brand is read from the processor name, the same way the ENERGY STAR
 * adapter maps a `processor_brand` string onto the catalog's brand enum. A
 * name that does not start with a known maker is recorded as "Other" — the
 * name is still recorded in full as the CPU model.
 */
const CPU_BRAND_RULES: Array<[RegExp, string]> = [
  [/^(intel|core|celeron|pentium|xeon)\b/i, "Intel"],
  [/^(amd|ryzen|epyc|athlon)\b/i, "AMD"],
  [/^(apple|m\d)\b/i, "Apple"],
  [/^(qualcomm|snapdragon)\b/i, "Qualcomm"],
  [/^(mediatek|dimensity|helio)\b/i, "MediaTek"],
  [/^(samsung|exynos)\b/i, "Samsung"],
  [/^(nvidia|tegra)\b/i, "NVIDIA"],
  [/^arm\b/i, "ARM"],
  [/^via\b/i, "VIA"],
  [/^(kirin|huawei)\b/i, "Huawei"],
];

/** The catalog brand for a processor name. */
export function cpuBrandFromLabel(label: string): string {
  for (const [pattern, brand] of CPU_BRAND_RULES) {
    if (pattern.test(label.trim())) return brand;
  }
  return "Other";
}

// =============================================================================
// HELPERS
// =============================================================================

/** True when a label is only a Wikidata item id, e.g. "Q42530222". */
export function isWikidataIdLabel(value: string): boolean {
  return /^Q[1-9]\d*$/.test(value.trim());
}

/**
 * The reason a label is not a usable name, or null when it is fine.
 *
 * `noun` names what the label was supposed to be, so the reason reads in
 * plain language: "cpu 'Q98609806' is a Wikidata item id, not a processor
 * name".
 */
function placeholderReason(
  value: string,
  field: string,
  noun: string
): string | null {
  const trimmed = value.trim();
  if (isWikidataIdLabel(trimmed)) {
    return `${field} '${trimmed}' is a Wikidata item id, not ${noun}`;
  }
  if (isPlaceholderModelName(trimmed)) {
    return `${field} '${trimmed}' is a source placeholder, not ${noun}`;
  }
  return null;
}

/** Reject control characters and overlong text. */
function checkText(value: string | null, field: string, errors: string[]): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    errors.push(`${field} contains control characters`);
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    errors.push(`${field} exceeds ${MAX_TEXT_LENGTH} characters`);
  }
  return trimmed;
}

/** A Wikidata item id must look like an item id. */
function checkItemId(value: string | null, field: string, errors: string[]): string | null {
  if (value === null || !value.trim()) return null;
  const trimmed = value.trim();
  if (!/^Q[1-9]\d*$/.test(trimmed)) {
    errors.push(`${field} '${trimmed}' is not a Wikidata item id`);
    return null;
  }
  return trimmed;
}

/** A date the source published, reduced to `YYYY-MM-DD`. */
function checkDate(value: string | null, field: string, errors: string[]): string | null {
  if (value === null || !value.trim()) return null;
  const raw = value.trim();
  const iso = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : raw;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    errors.push(`${field} '${raw}' is not a valid date`);
    return null;
  }
  return iso;
}

/**
 * A quantity as the source stated it: an amount and the unit it is in.
 *
 * Both halves are required. A value without a unit cannot be converted, and
 * a unit without a value carries no information.
 */
function checkQuantity(
  amount: number | null,
  unit: string | null,
  field: string,
  errors: string[]
): { amount: number; unit: string } | null {
  if (amount === null && unit === null) return null;
  if (amount === null) {
    errors.push(`${field} has a unit but no value`);
    return null;
  }
  if (unit === null) {
    errors.push(`${field} '${amount}' has no unit`);
    return null;
  }
  if (!Number.isFinite(amount)) {
    errors.push(`${field} '${amount}' is not a finite number`);
    return null;
  }
  return { amount, unit };
}

/** A number as it appears in a rejection reason: short and exact enough. */
function formatNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

/**
 * The reason a converted quantity is impossible, or null when it is fine.
 *
 * The message names the value as the source stated it and the value the
 * catalog would have stored, so the reason can be checked by hand.
 */
function quantityOutOfRangeReason(
  field: string,
  amount: number,
  unit: string,
  converted: number,
  convertedUnit: string,
  min: number,
  max: number
): string {
  return (
    `${field} '${amount} ${unitLabel(unit)}' (${formatNumber(converted)} ${convertedUnit}) ` +
    `is outside [${min}, ${max}] ${convertedUnit}`
  );
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate one Wikidata row.
 *
 * The row is rejected as a whole when any field fails: a configuration with
 * one impossible specification is not a configuration the catalog may carry.
 * The caller keeps the row as a rejected observation, with these reasons.
 */
export function validateWikidataRow(
  row: WikidataRow,
  { observedAt = new Date().toISOString() }: { observedAt?: string } = {}
): { record: NormalizedRecord | null; errors: string[] } {
  const errors: string[] = [];

  const itemId = checkItemId(row.itemId, "item id", errors);
  if (row.itemId === null || !row.itemId.trim()) errors.push("item id is required");

  const itemLabel = checkText(row.itemLabel, "item label", errors);
  if (!itemLabel) {
    errors.push("item label is required");
  } else {
    const reason = placeholderReason(itemLabel, "item label", "a product name");
    if (reason) errors.push(reason);
  }

  const manufacturerLabel = checkText(row.manufacturerLabel, "manufacturer", errors);
  if (!manufacturerLabel) {
    errors.push("manufacturer is required");
  } else {
    const reason = placeholderReason(manufacturerLabel, "manufacturer", "a manufacturer name");
    if (reason) errors.push(reason);
  }

  const cpuLabel = checkText(row.cpuLabel, "cpu", errors);
  if (!cpuLabel) {
    errors.push("cpu is required");
  } else {
    const reason = placeholderReason(cpuLabel, "cpu", "a processor name");
    if (reason) errors.push(reason);
  }

  const osLabel = checkText(row.osLabel, "operating system", errors);
  if (!osLabel) {
    errors.push("operating system is required");
  } else {
    const reason = placeholderReason(osLabel, "operating system", "an operating system name");
    if (reason) errors.push(reason);
  }

  // --- memory -------------------------------------------------------------
  const ramQuantity = checkQuantity(row.ramAmount, row.ramUnit, "ram capacity", errors);
  let ramGb: number | null = null;
  if (row.ramAmount === null && row.ramUnit === null) {
    errors.push("ram capacity is required");
  } else if (ramQuantity) {
    const factor = RAM_UNIT_TO_GB[ramQuantity.unit];
    if (factor === undefined) {
      errors.push(
        `ram capacity '${ramQuantity.amount}' is in an unknown unit '${ramQuantity.unit}'`
      );
    } else {
      const gb = ramQuantity.amount * factor;
      if (!Number.isInteger(gb)) {
        errors.push(
          `ram capacity '${ramQuantity.amount} ${unitLabel(ramQuantity.unit)}' ` +
            `(${formatNumber(gb)} GB) must be a whole number of GB`
        );
      } else if (gb < RAM_GB_RANGE[0] || gb > RAM_GB_RANGE[1]) {
        errors.push(
          quantityOutOfRangeReason(
            "ram capacity",
            ramQuantity.amount,
            ramQuantity.unit,
            gb,
            "GB",
            RAM_GB_RANGE[0],
            RAM_GB_RANGE[1]
          )
        );
      } else {
        ramGb = gb;
      }
    }
  }

  // --- mass ---------------------------------------------------------------
  const massQuantity = checkQuantity(row.massAmount, row.massUnit, "mass", errors);
  let weightKg: number | null = null;
  if (massQuantity) {
    const factor = MASS_UNIT_TO_KG[massQuantity.unit];
    if (factor === undefined) {
      errors.push(`mass '${massQuantity.amount}' is in an unknown unit '${massQuantity.unit}'`);
    } else {
      const kg = massQuantity.amount * factor;
      if (kg < MASS_KG_RANGE[0] || kg > MASS_KG_RANGE[1]) {
        errors.push(
          quantityOutOfRangeReason(
            "mass",
            massQuantity.amount,
            massQuantity.unit,
            kg,
            "kg",
            MASS_KG_RANGE[0],
            MASS_KG_RANGE[1]
          )
        );
      } else {
        weightKg = kg;
      }
    }
  }

  // --- display diagonal ---------------------------------------------------
  const displayQuantity = checkQuantity(
    row.displaySizeAmount,
    row.displaySizeUnit,
    "display size",
    errors
  );
  let displaySizeIn: number | null = null;
  if (displayQuantity) {
    const factor = DISPLAY_SIZE_UNIT_TO_IN[displayQuantity.unit];
    if (factor === undefined) {
      errors.push(
        `display size '${displayQuantity.amount}' is in an unknown unit '${displayQuantity.unit}'`
      );
    } else {
      const inches = displayQuantity.amount * factor;
      if (inches < DISPLAY_SIZE_IN_RANGE[0] || inches > DISPLAY_SIZE_IN_RANGE[1]) {
        errors.push(
          quantityOutOfRangeReason(
            "display size",
            displayQuantity.amount,
            displayQuantity.unit,
            inches,
            "in",
            DISPLAY_SIZE_IN_RANGE[0],
            DISPLAY_SIZE_IN_RANGE[1]
          )
        );
      } else {
        displaySizeIn = Math.round(inches * 100) / 100;
      }
    }
  }

  // --- optional identity --------------------------------------------------
  const releaseDate = checkDate(row.releaseDate, "release date", errors);
  const inventoryNumber = checkText(row.inventoryNumber, "inventory number", errors);
  const partNumber = checkText(row.partNumber, "part number", errors);
  const ramType = checkText(row.ramTypeLabel, "ram type", errors);
  const predecessorId = checkItemId(row.predecessorId, "predecessor id", errors);
  const successorId = checkItemId(row.successorId, "successor id", errors);

  if (errors.length > 0) {
    return { record: null, errors };
  }

  // Everything below is observed: the values above passed validation and
  // the four required fields are present.
  const item = itemId as string;
  const label = itemLabel as string;
  const manufacturer = manufacturerLabel as string;
  const cpu = cpuLabel as string;
  const os = osLabel as string;
  const memory = ramGb as number;

  const identity = deriveWikidataIdentity({
    rawBrand: manufacturer,
    rawModelName: label,
    partNumber: inventoryNumber ?? partNumber,
    cpuModel: cpu,
    ramGb: memory,
    displaySizeIn,
    os,
  });

  // The verbatim source row travels with the record, so the observation that
  // is stored later is exactly the row that was validated here.
  const rawPayload = JSON.stringify(row);

  return {
    errors,
    record: {
      sourceRecordId: item,
      rawPayload,
      rawPayloadHash: payloadHash(rawPayload),
      skuCode: identity.skuCode,
      brand: identity.brand,
      modelName: identity.modelName,
      seriesName: identity.seriesName,
      os,
      launchDate: releaseDate,
      partNumber: inventoryNumber ?? partNumber,
      predecessorId,
      successorId,
      observedSpecs: {
        source: "Wikidata",
        sourceUrl: `https://www.wikidata.org/wiki/${item}`,
        observedAt,
        itemId: item,
        itemLabel: label,
        manufacturerId: row.manufacturerId,
        releaseDate,
        cpuId: row.cpuId,
        cpuBrand: cpuBrandFromLabel(cpu),
        cpuModel: cpu,
        ramGb: memory,
        ramType,
        displaySizeIn,
        weightKg,
        osId: row.osId,
        osLabel: os,
        inventoryNumber,
        partNumber,
      },
    },
  };
}

/** A readable name for a unit id, used in error messages. */
function unitLabel(unitId: string): string {
  const known: Record<string, string> = {
    Q41803: "gram",
    Q11570: "kilogram",
    Q3241121: "milligram",
    Q100995: "pound",
    Q48013: "ounce",
    Q8799: "byte",
    Q79726: "kilobyte",
    Q79756: "kibibyte",
    Q79735: "megabyte",
    Q79758: "mebibyte",
    Q79738: "gigabyte",
    Q79765: "gibibyte",
    Q79741: "terabyte",
    Q79747: "tebibyte",
    Q218593: "inch",
    Q174728: "centimetre",
    Q174789: "millimetre",
  };
  return known[unitId] ?? unitId;
}
