/**
 * Audit the reference dataset in `data/laptops.csv`.
 *
 * The reference rows are real, purchasable retail part numbers with a US and
 * an IN list price. Nothing in the repository re-checks them, so a typo, a
 * duplicated part number or a price that drifted away from the machine it
 * describes would sit in the catalog and be served as fact.
 *
 * This audit re-runs the internal checks on the file itself. It never touches
 * the network and never guesses: every check is computed from the CSV.
 *
 * Findings come in two kinds:
 *
 *   * `error`   - a defect that must be fixed. The script exits non-zero.
 *   * `flagged` - a defect that is documented but not resolvable from the
 *     file alone. Each one is listed in ACCEPTED_FINDINGS together with the
 *     check that would settle it, and is reported with that reason.
 *   * `info`    - coverage notes. They never fail the run.
 *
 * A finding whose key is not in ACCEPTED_FINDINGS is an error, so a defect
 * introduced after this audit was written fails the run instead of rotting.
 *
 * Usage:
 *   npx tsx scripts/audit-reference-dataset.ts
 *   npx tsx scripts/audit-reference-dataset.ts --csv path/to/laptops.csv
 *   npx tsx scripts/audit-reference-dataset.ts --json
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { pathToFileURL } from "url";

/**
 * The column order the seed script reads. It is fixed by
 * `scripts/seed.ts` and must not change: the header is the contract between
 * the file and the loader.
 */
export const EXPECTED_HEADER = [
  "manufacturer",
  "series",
  "model",
  "sku_code",
  "cpu_brand",
  "cpu_model",
  "cpu_cores",
  "gpu_model",
  "ram_gb",
  "ram_type",
  "ram_soldered",
  "storage_gb",
  "storage_type",
  "storage_slots",
  "display_size",
  "display_resolution",
  "display_type",
  "display_refresh",
  "display_touch",
  "display_nits",
  "weight_kg",
  "battery_wh",
  "battery_life_hours",
  "npu_tops",
  "os",
  "build_material",
  "linux_compat",
  "price_usd",
  "price_inr",
  "region_us",
  "region_in",
  "source_url",
  "verified",
] as const;

/**
 * Part-number formats each manufacturer publishes.
 *
 * ASUS is the one format that is confirmed against the manufacturer's own
 * pages (see docs/REFERENCE_DATASET.md). The others are the formats the
 * dataset uses consistently; they are checked for internal consistency and
 * are NOT a claim about what the manufacturer publishes, because those hosts
 * are blocked or unvalidated in docs/DATA_SOURCES.md.
 */
export const PART_NUMBER_FORMATS: Record<
  string,
  { pattern: RegExp; confirmed: boolean; note: string }
> = {
  ASUS: {
    // ASUS publishes `<model><variant>-<2 letters><2 digits>[<1-2 letters]>`,
    // e.g. UX3405CA-ES99T, UX3407QA-PS76, UX8406CA-PS99T, UM5606GA-PS99T.
    pattern: /^[A-Z]{2}\d{4}[A-Z]{1,3}-[A-Z]{2}\d{2}[A-Z]{0,2}$/,
    confirmed: true,
    note: "confirmed against ASUS store and where-to-buy listings, 2026-10-21",
  },
  Lenovo: {
    // `<5 character product code><3 character configuration><2 character country>`
    pattern: /^[A-Z0-9]{5}[A-Z0-9]{3}[A-Z]{2}$/,
    confirmed: false,
    note: "the format used consistently by every Lenovo row; not confirmed against lenovo.com (blocked)",
  },
  HP: {
    // `<5 character product code><2 character variant>UA#<country>`
    pattern: /^[0-9A-Z]{5}[0-9A-Z]{2}#[A-Z]{3}$/,
    confirmed: false,
    note: "the format used consistently by every HP row; not confirmed against hp.com (extraction unvalidated)",
  },
  Dell: {
    // `<4 digit platform>-<4 digit configuration><3 character country>`
    pattern: /^\d{4}-\d{4}[A-Z]{3}$/,
    confirmed: false,
    note: "the format used consistently by every Dell row; not confirmed against dell.com (blocked)",
  },
  Apple: {
    // `<4-5 character code><2 character country>/<2 character region>`
    pattern: /^[A-Z0-9]{4,5}[A-Z]{2}\/[A-Z]$/,
    confirmed: true,
    note: "confirmed against Apple US store listings",
  },
};

/**
 * The neural-processing throughput each processor is published with.
 *
 * A row that names a processor and a different NPU figure describes a
 * machine that no manufacturer builds, so this is checked on every row that
 * carries a value.
 */
export const PUBLISHED_NPU_TOPS: Record<string, number> = {
  "Snapdragon X Elite X1E-78-100": 45,
  "Core Ultra 7 258V": 13,
  "Core Ultra 9 285H": 13,
  "Ryzen AI 9 HX 370": 50,
  "Ryzen AI 7 Pro 350": 50,
  "Ryzen AI 5 Pro 340": 50,
};

/**
 * The core count each processor is published with.
 *
 * A row that names a processor with a different core count describes a
 * machine that no manufacturer builds.
 */
export const PUBLISHED_CPU_CORES: Record<string, number> = {
  "Snapdragon X Elite X1E-78-100": 12,
  "Core Ultra 7 258V": 8,
  "Core Ultra 9 285H": 16,
  "Ryzen AI 9 HX 370": 12,
  "Ryzen AI 7 Pro 350": 8,
  "Ryzen AI 5 Pro 340": 6,
  "Ryzen 7 8845HS": 8,
  M4: 10,
  "M4 Pro": 14,
};

/**
 * Part-number series per manufacturer: the part of a part number that
 * identifies the product rather than the configuration.
 *
 * Only brands whose part number encodes the product are checked this way.
 * Dell reuses one platform number across different products, so the leading
 * digits are not a product identifier there.
 */
export const PART_NUMBER_SERIES: Record<string, (partNumber: string) => string> = {
  ASUS: (pn) => (pn.split("-")[0] ?? pn).trim(),
  Lenovo: (pn) => pn.slice(0, 4),
  HP: (pn) => pn.slice(0, 4),
  Apple: (pn) => pn.slice(0, 4),
};

/**
 * Findings that are documented but not resolvable from the dataset alone.
 *
 * Every entry records why the finding is still open and the check that would
 * settle it. A finding that is not listed here is an error and fails the
 * run.
 */
export const ACCEPTED_FINDINGS: Record<
  string,
  { reason: string; settlingCheck: string }
> = {
  // --- ASUS part numbers -------------------------------------------------
  ...Object.fromEntries(
    [
      "UX3407QA-QD123WS",
      "UX3407QA-QD124WS",
      "UX3405CA-UQ123WS",
      "UX3405CA-UQ124WS",
      "UM5606QA-MY123WS",
      "UX8406CA-MY123WS",
      "S3407QA-MY123WS",
      "S3507QA-MY123WS",
      "GA403UV-QS123WS",
      "GA403UV-QS124WS",
      "H7606WI-MY123WS",
      "UP3404VA-MY123WS",
    ].map((sku) => [
      `part-number/format:${sku}`,
      {
        reason:
          "The suffix is in a shape ASUS publishes for no product: ASUS retail " +
          "part numbers are <model><variant>-<2 letters><2 digits>[<1-2 letters>] " +
          "(UX3405CA-ES99T, UX3407QA-PS76, UX8406CA-PS99T, UM5606GA-PS99T, " +
          "H7606WP-PB99T). The configuration the row describes may still be real; " +
          "the identifier that names it is not attested.",
        settlingCheck:
          "read the retail part number for this configuration from the ASUS US store " +
          "listing or the ASUS 'where to buy' page for the family; shop.asus.com is " +
          "behind a bot challenge and cannot be read by the collector.",
      },
    ])
  ),

  // --- Provenance ---------------------------------------------------------
  "provenance/verified-part-number:UX3405CA-UQ123WS": {
    reason:
      "The row is published in the manufacturer tier, but the verification tool " +
      "reduces a part number to its family code (scripts/verify-reference-specs.py, " +
      "family_code()) and therefore never checked the part number itself.",
    settlingCheck:
      "extend scripts/verify-reference-specs.py to compare the full published part " +
      "number instead of the family code, then re-run it against the ASUS page.",
  },
  "provenance/verified-part-number:UX3405CA-UQ124WS": {
    reason:
      "The row is published in the manufacturer tier, but the verification tool " +
      "reduces a part number to its family code (scripts/verify-reference-specs.py, " +
      "family_code()) and therefore never checked the part number itself.",
    settlingCheck:
      "extend scripts/verify-reference-specs.py to compare the full published part " +
      "number instead of the family code, then re-run it against the ASUS page.",
  },
  "provenance/source-url": {
    reason:
      "Most rows carry no manufacturer page to check them against, so their " +
      "specifications cannot be re-verified and the catalog audit reports them " +
      "under coverage/source-url.",
    settlingCheck:
      "add the manufacturer product page for each row. lenovo.com and dell.com " +
      "answer 403 to the collector and hp.com/apple.com product extraction is " +
      "unvalidated (docs/DATA_SOURCES.md), so these have to come from a source " +
      "the register clears.",
  },

  // --- Part-number series -------------------------------------------------
  "identity/part-number-series:Lenovo:21M5": {
    reason:
      "One Lenovo part-number series (21M5) is used for two different products, " +
      "ThinkPad T14s Gen 6 and ThinkPad L14 Gen 6. Either the L14 row carries a " +
      "T14s part number or the two products share a series.",
    settlingCheck:
      "read the ThinkPad L14 Gen 6 part number from Lenovo's published part-number " +
      "list; lenovo.com is blocked for the collector, so use a distributor or " +
      "OEM catalogue that quotes the Lenovo part number.",
  },
  "identity/part-number-series:Lenovo:83A3": {
    reason:
      "One Lenovo part-number series (83A3) is used for two different products, " +
      "Yoga Slim 7i and Yoga Pro 7i.",
    settlingCheck:
      "read both part numbers from Lenovo's published part-number list; lenovo.com " +
      "is blocked for the collector, so use a distributor or OEM catalogue.",
  },

  // --- Displays -----------------------------------------------------------
  "display/aspect-ratio:21MU000UUS": {
    reason:
      "The 2560x2000 panel is a 16:12.5 display. Every other Lenovo row in the " +
      "dataset is 16:10, and Lenovo does not publish a 16:12.5 laptop panel.",
    settlingCheck:
      "read the display resolution of the ThinkPad X1 Fold Gen 2 from Lenovo's " +
      "published specification; lenovo.com is blocked for the collector, so use a " +
      "distributor or OEM catalogue.",
  },
};

export type Severity = "error" | "flagged" | "info";

export interface Finding {
  check: string;
  /** Stable identity of the finding, used to look it up in ACCEPTED_FINDINGS. */
  key: string;
  severity: Severity;
  detail: string;
  sample: string;
}

export interface ReferenceRow {
  [column: string]: string;
}

export interface AuditResult {
  rows: number;
  findings: Finding[];
  /** Findings that are not in ACCEPTED_FINDINGS. A non-empty list fails the run. */
  unresolved: Finding[];
  accepted: Finding[];
  informational: Finding[];
}

const REQUIRED_COLUMNS = [
  "manufacturer",
  "series",
  "model",
  "sku_code",
  "cpu_brand",
  "cpu_model",
  "cpu_cores",
  "gpu_model",
  "ram_gb",
  "ram_type",
  "ram_soldered",
  "storage_gb",
  "storage_type",
  "display_size",
  "display_resolution",
  "display_type",
  "display_refresh",
  "display_nits",
  "weight_kg",
  "battery_wh",
  "os",
  "build_material",
  "price_usd",
] as const;

const NUMERIC_RANGES: Record<string, { min: number; max: number }> = {
  cpu_cores: { min: 1, max: 128 },
  ram_gb: { min: 4, max: 256 },
  storage_gb: { min: 64, max: 8192 },
  storage_slots: { min: 1, max: 8 },
  display_size: { min: 8, max: 24 },
  display_refresh: { min: 24, max: 500 },
  display_nits: { min: 100, max: 5000 },
  weight_kg: { min: 0.3, max: 5 },
  battery_wh: { min: 20, max: 120 },
  battery_life_hours: { min: 1, max: 30 },
  npu_tops: { min: 1, max: 500 },
  price_usd: { min: 50, max: 20000 },
  price_inr: { min: 1000, max: 5000000 },
};

/** Plausible pixels per inch for a laptop panel. */
const PPI_RANGE = { min: 90, max: 320 };

/** Plausible aspect ratios for a laptop panel. */
const ASPECT_RATIO_RANGE = { min: 1.3, max: 1.85 };

/** Plausible range of the USD/INR rate a list price can imply. */
const EXCHANGE_RATE_RANGE = { min: 70, max: 120 };

/** How far the implied rate may spread inside one manufacturer. */
const EXCHANGE_RATE_SPREAD = 8;

/**
 * How far apart two prices of the same tier may be.
 *
 * Two configurations of the same series, processor, memory and storage tier
 * that differ only in the size of the screen are priced alike by their
 * manufacturers. The same-tier pairs this dataset records differ by at most
 * 7.7% (ASUS Zenbook 14 against the Zenbook 14 Flip), so a 12% tolerance
 * separates the real prices from the 14.3% gap the Apple pair carried, where
 * one of the two prices belonged to a different memory tier.
 */
const TIER_PRICE_TOLERANCE = 0.12;

/** Panel brightness ceilings. Apple's Liquid Retina XDR panels are brighter. */
const NITS_CEILING: Record<string, number> = { OLED: 2000, IPS: 600, TN: 500, VA: 500 };
const NITS_CEILING_BY_MANUFACTURER: Record<string, number> = { Apple: 1600 };

function numeric(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolutionParts(resolution: string): { width: number; height: number } | null {
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(resolution.trim());
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** A configuration signature: everything that makes two rows the same machine. */
function configurationSignature(row: ReferenceRow): string {
  return [
    row.manufacturer,
    row.model,
    row.cpu_model,
    row.ram_gb,
    row.storage_gb,
    row.display_size,
    row.display_resolution,
    row.display_type,
    row.display_refresh,
    row.display_touch,
  ].join("|");
}

/** A price ordering score: more memory and more storage must cost more. */
function configurationScore(row: ReferenceRow): number {
  return (numeric(row.ram_gb) ?? 0) + (numeric(row.storage_gb) ?? 0) / 8;
}

/**
 * Run every internal check against the dataset.
 *
 * The function is pure: it takes the file contents and returns the findings.
 * The command line wrapper below only prints them and sets the exit code.
 */
export function auditReferenceDataset(csvText: string): AuditResult {
  const matrix = parse(csvText, { skip_empty_lines: true }) as string[][];
  const header = matrix[0] ?? [];
  const body = matrix.slice(1);

  const findings: Finding[] = [];
  const add = (
    check: string,
    key: string,
    severity: Severity,
    detail: string,
    sample: string
  ) => {
    findings.push({ check, key, severity, detail, sample });
  };

  // --- structure ---------------------------------------------------------
  const headerMatches =
    header.length === EXPECTED_HEADER.length &&
    header.every((column, index) => column === EXPECTED_HEADER[index]);
  if (!headerMatches) {
    add(
      "structure/header",
      "structure/header",
      "error",
      "the header must be the exact column list the seed script reads, in order",
      header.join(",")
    );
    return {
      rows: body.length,
      findings,
      unresolved: findings,
      accepted: [],
      informational: [],
    };
  }

  const rows: ReferenceRow[] = [];
  body.forEach((cells, index) => {
    if (cells.length !== EXPECTED_HEADER.length) {
      add(
        "structure/row-width",
        `structure/row-width:${index + 2}`,
        "error",
        `every row must carry ${EXPECTED_HEADER.length} fields`,
        `line ${index + 2} carries ${cells.length}`
      );
      return;
    }
    const row: ReferenceRow = {};
    EXPECTED_HEADER.forEach((column, position) => {
      row[column] = (cells[position] ?? "").trim();
    });
    rows.push(row);
  });

  // --- per row checks ----------------------------------------------------
  for (const row of rows) {
    const sku = row.sku_code || "(no part number)";

    for (const column of REQUIRED_COLUMNS) {
      if (!row[column]) {
        add(
          "structure/required-fields",
          `structure/required-fields:${sku}`,
          "error",
          `the column "${column}" must not be empty`,
          sku
        );
      }
    }

    for (const [column, range] of Object.entries(NUMERIC_RANGES)) {
      const raw = row[column];
      if (raw === undefined || raw === "") continue;
      const value = numeric(raw);
      if (value === null) {
        add(
          "structure/numeric-fields",
          `structure/numeric-fields:${sku}:${column}`,
          "error",
          `the column "${column}" must be a number`,
          `${sku}: ${raw}`
        );
        continue;
      }
      if (value < range.min || value > range.max) {
        add(
          "structure/numeric-fields",
          `structure/numeric-fields:${sku}:${column}`,
          "error",
          `the column "${column}" must be between ${range.min} and ${range.max}`,
          `${sku}: ${raw}`
        );
      }
    }

    if (row.ram_soldered !== "true" && row.ram_soldered !== "false") {
      add(
        "structure/required-fields",
        `structure/required-fields:${sku}:ram_soldered`,
        "error",
        "ram_soldered must be either true or false",
        sku
      );
    }

    // A region flag and the price it stands for must agree.
    if (row.region_us === "true" && !row.price_usd) {
      add(
        "price/region-flag",
        `price/region-flag:${sku}:US`,
        "error",
        "the row is published for the US region but carries no US price",
        sku
      );
    }
    if (row.region_us === "false" && row.price_usd) {
      add(
        "price/region-flag",
        `price/region-flag:${sku}:US`,
        "error",
        "the row carries a US price but is not published for the US region",
        sku
      );
    }
    if (row.region_in === "true" && !row.price_inr) {
      add(
        "price/region-flag",
        `price/region-flag:${sku}:IN`,
        "error",
        "the row is published for the IN region but carries no IN price",
        sku
      );
    }
    if (row.region_in === "false" && row.price_inr) {
      add(
        "price/region-flag",
        `price/region-flag:${sku}:IN`,
        "error",
        "the row carries an IN price but is not published for the IN region",
        sku
      );
    }

    // --- identity -------------------------------------------------------
    const format = PART_NUMBER_FORMATS[row.manufacturer];
    if (!format) {
      add(
        "part-number/format",
        `part-number/format:${sku}`,
        "error",
        `no published part-number format is known for ${row.manufacturer}`,
        sku
      );
    } else if (!format.pattern.test(row.sku_code)) {
      add(
        "part-number/format",
        `part-number/format:${sku}`,
        "error",
        `the part number does not match the format ${row.manufacturer} publishes`,
        `${sku} (expected ${format.pattern.source})`
      );
    }

    const publishedNpu = PUBLISHED_NPU_TOPS[row.cpu_model];
    if (publishedNpu !== undefined && row.npu_tops !== "") {
      const claimed = numeric(row.npu_tops);
      if (claimed !== null && Math.abs(claimed - publishedNpu) > 0.5) {
        add(
          "processor/npu-tops",
          `processor/npu-tops:${sku}`,
          "error",
          `the NPU figure does not match the ${publishedNpu} TOPS published for ${row.cpu_model}`,
          `${sku}: ${row.npu_tops} TOPS recorded for ${row.cpu_model}`
        );
      }
    }

    const publishedCores = PUBLISHED_CPU_CORES[row.cpu_model];
    const claimedCores = numeric(row.cpu_cores);
    if (publishedCores !== undefined && claimedCores !== null) {
      if (Math.abs(claimedCores - publishedCores) > 0.5) {
        add(
          "processor/cpu-cores",
          `processor/cpu-cores:${sku}`,
          "error",
          `the core count does not match the ${publishedCores} cores published for ${row.cpu_model}`,
          `${sku}: ${row.cpu_cores} cores recorded for ${row.cpu_model}`
        );
      }
    }

    // --- displays -------------------------------------------------------
    const resolution = resolutionParts(row.display_resolution);
    const diagonal = numeric(row.display_size);
    if (resolution && diagonal) {
      const ppi =
        Math.sqrt(
          resolution.width * resolution.width + resolution.height * resolution.height
        ) / diagonal;
      if (ppi < PPI_RANGE.min || ppi > PPI_RANGE.max) {
        add(
          "display/resolution-vs-diagonal",
          `display/resolution-vs-diagonal:${sku}`,
          "error",
          `the resolution implies ${ppi.toFixed(0)} pixels per inch on a ${diagonal} inch panel`,
          sku
        );
      }
      const aspect = resolution.width / resolution.height;
      if (aspect < ASPECT_RATIO_RANGE.min || aspect > ASPECT_RATIO_RANGE.max) {
        add(
          "display/aspect-ratio",
          `display/aspect-ratio:${sku}`,
          "error",
          `the panel aspect ratio ${aspect.toFixed(3)} is not a ratio laptops are built with`,
          `${sku}: ${row.display_resolution}`
        );
      }
    }

    const nits = numeric(row.display_nits);
    const refresh = numeric(row.display_refresh);
    if (nits !== null) {
      const ceiling =
        NITS_CEILING_BY_MANUFACTURER[row.manufacturer] ??
        NITS_CEILING[row.display_type] ??
        600;
      if (nits > ceiling) {
        add(
          "display/nits-vs-panel",
          `display/nits-vs-panel:${sku}`,
          "error",
          `a ${row.display_type} panel is recorded at ${nits} nits, above the ${ceiling} nit ceiling`,
          sku
        );
      }
      if (row.display_type === "OLED" && nits < 250) {
        add(
          "display/nits-vs-panel",
          `display/nits-vs-panel:${sku}`,
          "error",
          "an OLED panel below 250 nits is not a panel any manufacturer ships",
          sku
        );
      }
    }
    if (refresh !== null && nits !== null && refresh > 120 && nits < 400) {
      add(
        "display/refresh-vs-panel",
        `display/refresh-vs-panel:${sku}`,
        "error",
        `a ${refresh} Hz panel rated at ${nits} nits is not a combination manufacturers ship`,
        sku
      );
    }

    // --- battery --------------------------------------------------------
    const battery = numeric(row.battery_wh);
    if (
      battery !== null &&
      diagonal !== null &&
      diagonal >= 15.5 &&
      refresh !== null &&
      refresh >= 120 &&
      battery < 45
    ) {
      add(
        "battery/capacity",
        `battery/capacity:${sku}`,
        "error",
        `a ${diagonal} inch ${refresh} Hz machine cannot be shipped with a ${battery} Wh battery`,
        sku
      );
    }

    // --- specification combinations --------------------------------------
    const ram = numeric(row.ram_gb);
    const storage = numeric(row.storage_gb);
    if (ram !== null && storage !== null && ram < 8 && storage > 1024) {
      add(
        "spec/impossible-combination",
        `spec/impossible-combination:${sku}`,
        "error",
        "no manufacturer ships a machine with less than 8 GB of memory and more than 1 TB of storage",
        sku
      );
    }
    if (row.ram_soldered === "false" && row.ram_type && row.ram_type !== "DDR5") {
      add(
        "spec/impossible-combination",
        `spec/impossible-combination:${sku}`,
        "error",
        "replaceable memory is never LPDDR; the memory type and the soldered flag disagree",
        `${sku}: ${row.ram_type} / ram_soldered=${row.ram_soldered}`
      );
    }
    if (ram !== null && ram > 32 && row.ram_soldered === "false") {
      add(
        "spec/impossible-combination",
        `spec/impossible-combination:${sku}`,
        "error",
        "replaceable memory above 32 GB is not a configuration manufacturers ship",
        sku
      );
    }

    // --- provenance ------------------------------------------------------
    if (row.verified === "true") {
      if (!row.source_url) {
        add(
          "provenance/verified-requires-source",
          `provenance/verified-requires-source:${sku}`,
          "error",
          "a row published in the manufacturer tier must carry the page it was checked against",
          sku
        );
      }
      const format = PART_NUMBER_FORMATS[row.manufacturer];
      if (format && !format.pattern.test(row.sku_code)) {
        add(
          "provenance/verified-part-number",
          `provenance/verified-part-number:${sku}`,
          "error",
          "a row published in the manufacturer tier carries a part number the manufacturer does not publish",
          sku
        );
      }
    }
    if (row.verified !== "true" && row.verified !== "false") {
      add(
        "provenance/verified-requires-source",
        `provenance/verified-requires-source:${sku}`,
        "error",
        "the verified column must be either true or false",
        `${sku}: ${row.verified}`
      );
    }
  }

  // --- duplicates --------------------------------------------------------
  const byPartNumber = new Map<string, string[]>();
  for (const row of rows) {
    const list = byPartNumber.get(row.sku_code) ?? [];
    list.push(row.model);
    byPartNumber.set(row.sku_code, list);
  }
  for (const [sku, models] of byPartNumber) {
    if (models.length > 1) {
      add(
        "identity/duplicate-part-number",
        `identity/duplicate-part-number:${sku}`,
        "error",
        "the same part number describes more than one configuration",
        `${sku} (${models.join(", ")})`
      );
    }
  }

  const byConfiguration = new Map<string, string[]>();
  for (const row of rows) {
    const signature = configurationSignature(row);
    const list = byConfiguration.get(signature) ?? [];
    list.push(row.sku_code);
    byConfiguration.set(signature, list);
  }
  for (const [signature, skus] of byConfiguration) {
    if (skus.length > 1) {
      add(
        "identity/duplicate-configuration",
        `identity/duplicate-configuration:${skus.join("+")}`,
        "error",
        "two part numbers describe the same configuration of the same model",
        `${skus.join(" and ")} (${signature.split("|").join(", ")})`
      );
    }
  }

  // --- part-number series ------------------------------------------------
  for (const [manufacturer, seriesOf] of Object.entries(PART_NUMBER_SERIES)) {
    const bySeries = new Map<string, Map<string, string[]>>();
    for (const row of rows) {
      if (row.manufacturer !== manufacturer) continue;
      const series = seriesOf(row.sku_code);
      const models = bySeries.get(series) ?? new Map<string, string[]>();
      const list = models.get(row.model) ?? [];
      list.push(row.sku_code);
      models.set(row.model, list);
      bySeries.set(series, models);
    }
    for (const [series, models] of bySeries) {
      if (models.size < 2) continue;
      const detail = [...models.entries()]
        .map(([model, skus]) => `${model} (${skus.join(", ")})`)
        .join("; ");
      add(
        "identity/part-number-series",
        `identity/part-number-series:${manufacturer}:${series}`,
        "error",
        `one ${manufacturer} part-number series names more than one product`,
        `${series}: ${detail}`
      );
    }
  }

  // --- prices ------------------------------------------------------------
  const byModel = new Map<string, ReferenceRow[]>();
  for (const row of rows) {
    const key = `${row.manufacturer}|${row.model}`;
    const list = byModel.get(key) ?? [];
    list.push(row);
    byModel.set(key, list);
  }
  for (const [, siblings] of byModel) {
    if (siblings.length < 2) continue;
    for (const row of siblings) {
      const price = numeric(row.price_usd);
      if (price === null) continue;
      for (const other of siblings) {
        if (other === row) continue;
        const otherPrice = numeric(other.price_usd);
        if (otherPrice === null) continue;
        if (configurationScore(row) > configurationScore(other) && price < otherPrice) {
          add(
            "price/model-ladder",
            `price/model-ladder:${row.sku_code}`,
            "error",
            "a better configured machine of the same model is priced below a worse one",
            `${row.sku_code} at ${row.price_usd} USD against ${other.sku_code} at ${other.price_usd} USD`
          );
        }
      }
    }
  }

  // Two configurations of the same series, processor and memory tier that
  // differ only in the size of the screen are priced alike by their
  // manufacturers. A wide gap means one of the two prices belongs to a
  // different tier.
  const byTier = new Map<string, ReferenceRow[]>();
  for (const row of rows) {
    const key = [
      row.manufacturer,
      row.series,
      row.cpu_model,
      row.ram_gb,
      row.storage_gb,
      row.display_type,
    ].join("|");
    const list = byTier.get(key) ?? [];
    list.push(row);
    byTier.set(key, list);
  }
  for (const [, siblings] of byTier) {
    if (siblings.length < 2) continue;
    for (const row of siblings) {
      const price = numeric(row.price_usd);
      if (price === null) continue;
      for (const other of siblings) {
        if (other === row) continue;
        const otherPrice = numeric(other.price_usd);
        if (otherPrice === null || otherPrice === 0) continue;
        const difference = Math.abs(price - otherPrice) / Math.max(price, otherPrice);
        if (difference > TIER_PRICE_TOLERANCE) {
          add(
            "price/tier-consistency",
            `price/tier-consistency:${row.sku_code}`,
            "error",
            `two configurations of the same tier are priced more than ${Math.round(
              TIER_PRICE_TOLERANCE * 100
            )}% apart`,
            `${row.sku_code} at ${row.price_usd} USD against ${other.sku_code} at ${other.price_usd} USD`
          );
        }
      }
    }
  }

  // --- exchange rate -----------------------------------------------------
  const rateByManufacturer = new Map<string, number[]>();
  for (const row of rows) {
    const usd = numeric(row.price_usd);
    const inr = numeric(row.price_inr);
    if (usd === null || inr === null || usd === 0) continue;
    const rate = inr / usd;
    if (rate < EXCHANGE_RATE_RANGE.min || rate > EXCHANGE_RATE_RANGE.max) {
      add(
        "price/exchange-rate",
        `price/exchange-rate:${row.sku_code}`,
        "error",
        `the two prices imply ${rate.toFixed(2)} INR per USD, outside the plausible range`,
        `${row.sku_code}: ${row.price_usd} USD and ${row.price_inr} INR`
      );
      continue;
    }
    const list = rateByManufacturer.get(row.manufacturer) ?? [];
    list.push(rate);
    rateByManufacturer.set(row.manufacturer, list);
  }
  for (const [manufacturer, rates] of rateByManufacturer) {
    if (rates.length < 2) continue;
    const spread = Math.max(...rates) - Math.min(...rates);
    if (spread > EXCHANGE_RATE_SPREAD) {
      add(
        "price/exchange-rate",
        `price/exchange-rate:${manufacturer}`,
        "error",
        `the implied exchange rate spreads ${spread.toFixed(1)} points across ${manufacturer} rows`,
        `${manufacturer}: ${Math.min(...rates).toFixed(2)} to ${Math.max(...rates).toFixed(2)} INR per USD`
      );
    }
  }

  // --- coverage ----------------------------------------------------------
  const withoutSource = rows.filter((row) => !row.source_url);
  if (withoutSource.length > 0) {
    add(
      "provenance/source-url",
      "provenance/source-url",
      "error",
      `${withoutSource.length} row(s) carry no manufacturer page to be checked against`,
      withoutSource
        .slice(0, 6)
        .map((row) => row.sku_code)
        .join(", ")
    );
  }

  const withoutNpu = rows.filter((row) => row.npu_tops === "");
  if (withoutNpu.length > 0) {
    add(
      "coverage/npu-tops",
      "coverage/npu-tops",
      "info",
      `${withoutNpu.length} row(s) record no NPU throughput`,
      withoutNpu
        .slice(0, 6)
        .map((row) => row.sku_code)
        .join(", ")
    );
  }

  // --- resolve the findings ---------------------------------------------
  const resolved: Finding[] = findings.map((finding) => {
    if (finding.severity === "info") return finding;
    const accepted = ACCEPTED_FINDINGS[finding.key];
    if (!accepted) return finding;
    return {
      ...finding,
      severity: "flagged",
      detail: `${finding.detail}. ${accepted.reason}`,
      sample: `${finding.sample}\n            settled by: ${accepted.settlingCheck}`,
    };
  });

  return {
    rows: rows.length,
    findings: resolved,
    unresolved: resolved.filter((f) => f.severity === "error"),
    accepted: resolved.filter((f) => f.severity === "flagged"),
    informational: resolved.filter((f) => f.severity === "info"),
  };
}

function resolveCsvPath(argv: string[]): string {
  const flag = argv.indexOf("--csv");
  if (flag !== -1 && argv[flag + 1]) return path.resolve(argv[flag + 1]);
  return path.join(process.cwd(), "data", "laptops.csv");
}

function main() {
  const argv = process.argv.slice(2);
  const csvPath = resolveCsvPath(argv);
  const csvText = fs.readFileSync(csvPath, "utf-8");
  const result = auditReferenceDataset(csvText);

  if (argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          file: csvPath,
          rows: result.rows,
          findings: result.findings,
          unresolved: result.unresolved.length,
          accepted: result.accepted.length,
          informational: result.informational.length,
        },
        null,
        2
      )
    );
  } else {
    console.log("VERIDIAN REFERENCE DATASET AUDIT");
    console.log(`file ${csvPath}`);
    console.log(`rows ${result.rows}\n`);
    console.log("FINDINGS");
    if (result.findings.length === 0) {
      console.log("  none — every checked invariant holds");
    } else {
      for (const finding of result.findings) {
        const tag = finding.severity.toUpperCase().padEnd(8);
        console.log(`  [${tag}] ${finding.check} — ${finding.detail}`);
        console.log(`            ${finding.sample}`);
      }
    }
    console.log(
      `\n${result.findings.length} finding(s): ${result.unresolved.length} unresolved, ` +
        `${result.accepted.length} documented and flagged, ` +
        `${result.informational.length} informational.`
    );
  }

  if (result.unresolved.length > 0) {
    console.error(
      `\n${result.unresolved.length} unresolved defect(s). The reference dataset is not clean.`
    );
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error("Reference dataset audit failed:", error);
    process.exitCode = 1;
  }
}
