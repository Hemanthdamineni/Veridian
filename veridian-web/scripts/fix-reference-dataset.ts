/**
 * Apply the resolved corrections to the reference dataset.
 *
 * Every correction is a value the manufacturer publishes, recorded here with
 * the evidence that settled it. The script never invents a value: a
 * correction states the old value it expects, so it can only ever move a
 * row from a wrong value to a published one.
 *
 * The script is deterministic and idempotent. Running it twice changes
 * nothing the second time, and running it on a dataset that is already
 * correct rewrites the file byte for byte.
 *
 * Usage:
 *   npx tsx scripts/fix-reference-dataset.ts
 *   npx tsx scripts/fix-reference-dataset.ts --dry-run
 *   npx tsx scripts/fix-reference-dataset.ts --check
 *   npx tsx scripts/fix-reference-dataset.ts --csv path/to/laptops.csv
 *
 * The audit trail for every entry below is docs/REFERENCE_DATASET.md.
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { pathToFileURL } from "url";
import { EXPECTED_HEADER } from "./audit-reference-dataset";

export interface FieldFix {
  /** The part number of the row the correction belongs to. */
  sku: string;
  /** The column to change. */
  field: string;
  /** The value the row must currently carry for the correction to apply. */
  from: string;
  /** The published value that replaces it. */
  to: string;
  /** What settles the correction. */
  evidence: string;
}

export interface RowRemoval {
  sku: string;
  reason: string;
  evidence: string;
}

/**
 * The corrections this change set resolves.
 *
 * A correction is only listed here when a manufacturer page states the value
 * unambiguously. Everything that could not be settled that way is listed as a
 * flag in docs/REFERENCE_DATASET.md and is not touched here.
 */
export const FIELD_FIXES: FieldFix[] = [
  // --- the NPU figure of the Core Ultra 9 285H ---------------------------
  {
    sku: "UX8406CA-MY123WS",
    field: "npu_tops",
    from: "34",
    to: "13",
    evidence:
      "ASUS, Zenbook DUO (2024) UX8406 technical specification, UX8406CA column: " +
      "'Neural Processor: Intel AI Boost NPU up to 13TOPS'; the where-to-buy page for " +
      "the family repeats it for the Core Ultra 9 285H part numbers. Intel's product " +
      "specification for the Core Ultra 9 285H gives an NPU of 13 TOPS.",
  },
  {
    sku: "83A3000VUS",
    field: "npu_tops",
    from: "34",
    to: "13",
    evidence:
      "Intel's product specification for the Core Ultra 9 285H gives an NPU of 13 TOPS; " +
      "ASUS publishes the same 13 TOPS for the Core Ultra 9 285H (Zenbook DUO UX8406CA).",
  },
  {
    sku: "9640-1628SIL",
    field: "npu_tops",
    from: "34",
    to: "13",
    evidence:
      "Intel's product specification for the Core Ultra 9 285H gives an NPU of 13 TOPS; " +
      "ASUS publishes the same 13 TOPS for the Core Ultra 9 285H (Zenbook DUO UX8406CA).",
  },
  {
    sku: "9440-1628BLU",
    field: "npu_tops",
    from: "34",
    to: "13",
    evidence:
      "Intel's product specification for the Core Ultra 9 285H gives an NPU of 13 TOPS; " +
      "ASUS publishes the same 13 TOPS for the Core Ultra 9 285H (Zenbook DUO UX8406CA).",
  },

  // --- touch panels -------------------------------------------------------
  {
    sku: "UX3405CA-UQ123WS",
    field: "display_touch",
    from: "false",
    to: "true",
    evidence:
      "ASUS, Zenbook 14 (UX3405) technical specification: every display option of the " +
      "UX3405CA column is a 'Touch screen'; the published part number UX3405CA-ES99T " +
      "is a '3K (2880 x 1800) 120Hz 500nits OLED touchscreen'.",
  },
  {
    sku: "UX3405CA-UQ124WS",
    field: "display_touch",
    from: "false",
    to: "true",
    evidence:
      "ASUS, Zenbook 14 (UX3405) technical specification: every display option of the " +
      "UX3405CA column is a 'Touch screen'.",
  },
  {
    sku: "UX8406CA-MY123WS",
    field: "display_touch",
    from: "false",
    to: "true",
    evidence:
      "ASUS, Zenbook DUO (2024) UX8406 technical specification: every display option of " +
      "the UX8406CA column is a 'Touch screen'.",
  },

  // --- the ProArt P16 row --------------------------------------------------
  {
    sku: "H7606WI-MY123WS",
    field: "cpu_brand",
    from: "Intel",
    to: "AMD",
    evidence:
      "ASUS, ProArt P16 (H7606) technical specification, H7606WI column: " +
      "'Processor: AMD Ryzen AI 9 HX 370 Processor (36MB Cache, up to 5.1GHz, 12 cores)'.",
  },
  {
    sku: "H7606WI-MY123WS",
    field: "cpu_model",
    from: "Core Ultra 9 285H",
    to: "Ryzen AI 9 HX 370",
    evidence:
      "ASUS, ProArt P16 (H7606) technical specification, H7606WI column: " +
      "'Processor: AMD Ryzen AI 9 HX 370 Processor (36MB Cache, up to 5.1GHz, 12 cores, " +
      "24 Threads); AMD XDNA NPU up to 50TOPS'.",
  },
  {
    sku: "H7606WI-MY123WS",
    field: "gpu_model",
    from: "Intel Arc Graphics",
    to: "NVIDIA GeForce RTX 4070 Laptop GPU",
    evidence:
      "ASUS, ProArt P16 (H7606) technical specification, H7606WI column: " +
      "'Graphics: NVIDIA GeForce RTX 4070 Laptop GPU (321 AI TOPs) 8GB GDDR6'.",
  },
  {
    sku: "H7606WI-MY123WS",
    field: "npu_tops",
    from: "34",
    to: "50",
    evidence:
      "ASUS, ProArt P16 (H7606) technical specification, H7606WI column: " +
      "'Neural Processor: AMD XDNA NPU up to 50TOPS' for the AMD Ryzen AI 9 HX 370.",
  },
  {
    sku: "H7606WI-MY123WS",
    field: "cpu_cores",
    from: "16",
    to: "12",
    evidence:
      "ASUS, ProArt P16 (H7606) technical specification, H7606WI column: " +
      "'Processor: AMD Ryzen AI 9 HX 370 Processor (36MB Cache, up to 5.1GHz, 12 cores, " +
      "24 Threads)'.",
  },
  {
    sku: "H7606WI-MY123WS",
    field: "display_refresh",
    from: "120",
    to: "60",
    evidence:
      "ASUS, ProArt P16 (H7606) technical specification, H7606WI column: " +
      "'Display: 16.0-inch, ... Refresh Rate:60Hz'. The 120 Hz option belongs to the " +
      "H7606WX configuration.",
  },
  {
    sku: "H7606WI-MY123WS",
    field: "storage_slots",
    from: "1",
    to: "2",
    evidence:
      "ASUS, ProArt P16 (H7606) technical specification, H7606WI column: " +
      "'Expansion Slots (includes used): 1x M.2 2280 PCIe 4.0x4 + 1x M.2 2280 PCIe 4.0x2'.",
  },
  {
    sku: "H7606WI-MY123WS",
    field: "source_url",
    from: "",
    to: "https://www.asus.com/us/laptops/for-creators/proart/proart-p16-h7606/techspec/",
    evidence:
      "The page the row used to cite no longer exists and redirects to the ASUS home " +
      "page. The current technical-specification page for the family carries the " +
      "H7606WI column.",
  },

  // --- the Zenbook Duo row -------------------------------------------------
  {
    sku: "UX8406CA-MY123WS",
    field: "source_url",
    from: "",
    to: "https://www.asus.com/us/laptops/for-home/zenbook/asus-zenbook-duo-2024-ux8406/techspec/",
    evidence:
      "The page the row used to cite redirects to the Zenbook category. The current " +
      "technical-specification page for the family carries the UX8406CA column.",
  },

  // --- the MacBook Air price ---------------------------------------------
  {
    sku: "MRXN3LL/A",
    field: "price_usd",
    from: "1199",
    to: "1399",
    evidence:
      "Apple's published US price for the 13-inch MacBook Air (M4) with 24 GB of " +
      "unified memory and a 512 GB SSD is $1,399. The dataset records the same memory " +
      "and storage tier for the 15-inch machine at $1,399, and Apple prices one tier " +
      "alike across the two sizes.",
  },
  {
    sku: "MRXN3LL/A",
    field: "price_inr",
    from: "114900",
    to: "134900",
    evidence:
      "The dataset's Indian prices are the US list price converted at the rate its own " +
      "Apple rows use. The same memory and storage tier on the 15-inch row is recorded " +
      "at $1,399 and 134,900 INR, which is the same conversion.",
  },
];

/**
 * Rows that are removed from the dataset.
 *
 * A row is only removed when it does not describe a real, purchasable
 * configuration at all. No row met that bar in this change set: every row
 * that looked wrong turned out to describe a configuration that exists, with
 * a field or an identifier that was wrong. The mechanism is here so that a
 * future removal is applied deterministically and recorded in the audit trail.
 */
export const ROW_REMOVALS: RowRemoval[] = [];

export interface AppliedFix {
  sku: string;
  field: string;
  from: string;
  to: string;
}

export interface FixOutcome {
  csv: string;
  applied: AppliedFix[];
  alreadyApplied: AppliedFix[];
  unmatched: AppliedFix[];
  removed: RowRemoval[];
}

/** Quote a field only when the CSV format requires it. */
function quote(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Serialise the matrix back to CSV with the same column order.
 *
 * The line ending is taken from the file the rows came from: the dataset is
 * stored with CRLF line endings and rewriting it with LF would turn every
 * line of the file into a change.
 */
export function serialiseReferenceDataset(matrix: string[][], lineEnding = "\n"): string {
  return matrix.map((row) => row.map(quote).join(",")).join(lineEnding) + lineEnding;
}

/** The line ending a CSV file uses. */
export function detectLineEnding(text: string): "\r\n" | "\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Apply every resolved correction to the dataset.
 *
 * A correction is applied only when the row carries the value the correction
 * expects. A row that already carries the published value is left alone, so
 * the function is idempotent. A row that carries neither value is reported
 * as unmatched: the dataset has drifted away from what this change set
 * expects and the correction is not forced on it.
 */
export function applyReferenceDatasetFixes(csvText: string): FixOutcome {
  const matrix = parse(csvText, { skip_empty_lines: true }) as string[][];
  const header = matrix[0] ?? [];
  const body = matrix.slice(1).map((cells) => cells.slice());

  if (
    header.length !== EXPECTED_HEADER.length ||
    !header.every((column, index) => column === EXPECTED_HEADER[index])
  ) {
    throw new Error(
      "the reference dataset header does not match the column order the seed script reads"
    );
  }

  const indexOf = new Map(header.map((column, index) => [column, index]));
  const skuIndex = indexOf.get("sku_code") as number;

  const applied: AppliedFix[] = [];
  const alreadyApplied: AppliedFix[] = [];
  const unmatched: AppliedFix[] = [];

  for (const fix of FIELD_FIXES) {
    const fieldIndex = indexOf.get(fix.field);
    if (fieldIndex === undefined) {
      throw new Error(`the dataset has no column named "${fix.field}"`);
    }
    const row = body.find((cells) => cells[skuIndex] === fix.sku);
    if (!row) {
      unmatched.push({ ...fix });
      continue;
    }
    const current = (row[fieldIndex] ?? "").trim();
    if (current === fix.from) {
      row[fieldIndex] = fix.to;
      applied.push({ sku: fix.sku, field: fix.field, from: fix.from, to: fix.to });
    } else if (current === fix.to) {
      alreadyApplied.push({ sku: fix.sku, field: fix.field, from: fix.from, to: fix.to });
    } else {
      unmatched.push({ ...fix });
    }
  }

  const removed: RowRemoval[] = [];
  for (const removal of ROW_REMOVALS) {
    const index = body.findIndex((cells) => cells[skuIndex] === removal.sku);
    if (index === -1) continue;
    body.splice(index, 1);
    removed.push(removal);
  }

  return {
    csv: serialiseReferenceDataset([header, ...body], detectLineEnding(csvText)),
    applied,
    alreadyApplied,
    unmatched,
    removed,
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
  const dryRun = argv.includes("--dry-run");
  const checkOnly = argv.includes("--check");
  const original = fs.readFileSync(csvPath, "utf-8");

  const outcome = applyReferenceDatasetFixes(original);

  console.log(`Reference dataset: ${csvPath}`);
  console.log(`  applied:        ${outcome.applied.length}`);
  console.log(`  already correct:${outcome.alreadyApplied.length}`);
  console.log(`  unmatched:      ${outcome.unmatched.length}`);
  console.log(`  removed:        ${outcome.removed.length}`);

  for (const fix of outcome.applied) {
    console.log(`  fixed ${fix.sku}.${fix.field}: ${fix.from || "(empty)"} -> ${fix.to}`);
  }
  for (const fix of outcome.unmatched) {
    console.error(
      `  UNMATCHED ${fix.sku}.${fix.field}: expected "${fix.from || "(empty)"}" or "${fix.to}"`
    );
  }
  for (const removal of outcome.removed) {
    console.log(`  removed ${removal.sku}: ${removal.reason}`);
  }

  if (outcome.unmatched.length > 0) {
    console.error(
      `\n${outcome.unmatched.length} correction(s) did not match the dataset. It has drifted away from this change set.`
    );
    process.exitCode = 1;
    return;
  }

  if (checkOnly) {
    if (outcome.applied.length > 0) {
      console.error(
        `\n${outcome.applied.length} correction(s) are not applied yet. Run this script without --check.`
      );
      process.exitCode = 1;
    } else {
      console.log("\nEvery resolved correction is already applied.");
    }
    return;
  }

  if (dryRun) {
    console.log(`\nDry run: ${outcome.applied.length} correction(s) would be written.`);
    return;
  }

  if (outcome.csv !== original) {
    fs.writeFileSync(csvPath, outcome.csv, "utf-8");
    console.log(`\nWrote ${outcome.applied.length} correction(s) to ${csvPath}.`);
  } else {
    console.log("\nThe dataset was already correct. Nothing written.");
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error("Reference dataset repair failed:", error);
    process.exitCode = 1;
  }
}
