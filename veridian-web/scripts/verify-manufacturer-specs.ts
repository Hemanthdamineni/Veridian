/**
 * Verify the reference dataset against manufacturer specification pages.
 *
 * The reference rows in `data/laptops.csv` are real, purchasable retail part
 * numbers, but they were assembled by hand and some of them contradict the
 * manufacturer. This command checks each row against the manufacturer's own
 * technical-specification page, registered for that row in
 * `data/verify-sources.csv`, and reports:
 *
 *   * whether the row was confirmed against a page,
 *   * which fields the manufacturer states differently,
 *   * the corrected value and the citable page for every field it contradicts.
 *
 * Nothing is written back unless `--apply` is given. Without it the command
 * only reports. A row that cannot be confirmed is reported as unconfirmed; it
 * is never silently corrected and never quietly marked as verified.
 *
 * The rule the tool exists to enforce: a field is compared only when the
 * manufacturer states a single unambiguous value for it. A cell that lists
 * several options for a family is ambiguous, and an ambiguous cell can never
 * be used to claim that a reference row is wrong.
 *
 * Usage:
 *   npx tsx scripts/verify-manufacturer-specs.ts
 *   npx tsx scripts/verify-manufacturer-specs.ts --json report.json
 *   npx tsx scripts/verify-manufacturer-specs.ts --apply
 */

import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  applyCorrections,
  runVerification,
} from "../src/lib/verify/runner";
import type { Contradiction, RowResult, VerifyReport } from "../src/lib/verify/types";

interface Options {
  apply: boolean;
  json: string | null;
  only: string[];
  timeoutMs: number;
  userAgent: string;
}

function parseArguments(argv: string[]): Options {
  const options: Options = {
    apply: false,
    json: null,
    only: [],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    userAgent: DEFAULT_USER_AGENT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--apply":
        options.apply = true;
        break;
      case "--json":
        options.json = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--only":
        options.only = (argv[index + 1] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        index += 1;
        break;
      case "--timeout":
        options.timeoutMs = Number.parseInt(argv[index + 1] ?? "", 10) || DEFAULT_TIMEOUT_MS;
        index += 1;
        break;
      case "--user-agent":
        options.userAgent = argv[index + 1] ?? DEFAULT_USER_AGENT;
        index += 1;
        break;
      case "--help":
      case "-h":
        console.log(
          [
            "Usage: npx tsx scripts/verify-manufacturer-specs.ts [options]",
            "",
            "  --apply            write the confirmed manufacturer values back into",
            "                     data/laptops.csv and mark confirmed rows as verified",
            "  --json <path>      also write the JSON summary to a file",
            "  --only <sku,...>   check only these part numbers",
            "  --timeout <ms>     the request timeout in milliseconds",
            "  --user-agent <ua>  the user agent every request identifies itself with",
          ].join("\n")
        );
        process.exit(0);
        break;
      default:
        if (argument.startsWith("--")) {
          console.error(`unknown option: ${argument}`);
          process.exit(2);
        }
    }
  }
  return options;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function printRow(result: RowResult): void {
  const status = result.status.toUpperCase();
  console.log(`  ${pad(status, 13)} ${result.sku_code}  ${result.model}`);
  if (result.partNumber) console.log(`                manufacturer part number: ${result.partNumber}`);
  if (result.sourceUrl) console.log(`                page: ${result.sourceUrl}`);
  if (result.detail) console.log(`                ${result.detail}`);
  const observed = Object.entries(result.observed);
  if (observed.length > 0) {
    console.log(
      `                manufacturer states: ${observed.map(([field, value]) => `${field}=${value}`).join(", ")}`
    );
  }
  for (const contradiction of result.contradictions) {
    console.log(
      `                CONTRADICTION ${contradiction.field}: reference=${contradiction.reference} ` +
        `manufacturer=${contradiction.manufacturerValue}`
    );
  }
}

function printReport(report: VerifyReport): void {
  console.log("Manufacturer specification verification");
  console.log("======================================");
  console.log(`rows checked:            ${report.rowsChecked}`);
  console.log(`confirmed against a page: ${report.confirmed}`);
  console.log(`rows contradicting it:   ${report.contradicted}`);
  console.log(`rows unconfirmed:         ${report.unconfirmed}`);
  console.log(`  of which not attempted: ${report.notAttempted}`);
  console.log(`  of which errors:        ${report.errors}`);

  console.log("\nPages");
  console.log("-----");
  for (const page of report.pages) {
    console.log(`  ${pad(String(page.status), 5)} ${page.outcome.padEnd(20)} ${page.url}`);
    if (page.detail) console.log(`        ${page.detail}`);
  }

  const contradictions = report.contradictions;
  console.log(`\nContradictions (${contradictions.length})`);
  console.log("----------------");
  if (contradictions.length === 0) {
    console.log("  none");
  }
  for (const contradiction of contradictions) {
    printContradiction(contradiction);
  }

  console.log("\nRows");
  console.log("----");
  for (const result of report.results) {
    printRow(result);
  }
}

function printContradiction(contradiction: Contradiction): void {
  console.log(`  ${contradiction.sku_code}  (${contradiction.manufacturer})`);
  console.log(`    field:       ${contradiction.field}`);
  console.log(`    reference:   ${contradiction.reference}`);
  console.log(`    manufacturer:${contradiction.manufacturerValue}`);
  console.log(`    page:        ${contradiction.sourceUrl}`);
  console.log(`    part number: ${contradiction.partNumber}`);
}

async function main(): Promise<number> {
  const options = parseArguments(process.argv.slice(2));
  const packageRoot = process.cwd();
  const referencePath = path.join(packageRoot, "data", "laptops.csv");
  const sourcesPath = path.join(packageRoot, "data", "verify-sources.csv");

  if (!fs.existsSync(referencePath)) {
    console.error(
      `the reference dataset was not found at ${referencePath}. Run this command from the veridian-web directory.`
    );
    return 2;
  }

  const report = await runVerification({
    referencePath,
    sourcesPath,
    userAgent: options.userAgent,
    timeoutMs: options.timeoutMs,
    only: options.only,
  });

  printReport(report);

  if (options.apply) {
    const applied = applyCorrections(referencePath, report);
    console.log("\nApplied");
    console.log("-------");
    console.log(`  corrected fields: ${applied.corrected.length}`);
    for (const correction of applied.corrected) {
      console.log(
        `    ${correction.sku_code}  ${correction.field}: ${correction.from} -> ${correction.to}`
      );
    }
    console.log(`  rows marked verified: ${applied.verified.length}`);
    for (const sku of applied.verified) console.log(`    ${sku}`);
    console.log(`  rows given their citation: ${applied.cited.length}`);
    for (const sku of applied.cited) console.log(`    ${sku}`);
  } else {
    console.log("\nNothing was written. Run again with --apply to write the confirmed values back.");
  }

  const summary = {
    rowsChecked: report.rowsChecked,
    confirmed: report.confirmed,
    contradicted: report.contradicted,
    unconfirmed: report.unconfirmed,
    contradictions: report.contradictions,
  };

  if (options.json) {
    fs.writeFileSync(options.json, `${JSON.stringify({ ...summary, results: report.results }, null, 2)}\n`, "utf-8");
    console.log(`\nJSON report written to ${options.json}`);
  }

  console.log("\nJSON summary");
  console.log("------------");
  console.log(JSON.stringify(summary, null, 2));

  // A contradiction is a finding, not a failure of the tool: the run itself
  // succeeded, and the report says what was found.
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("verification failed:", error);
    process.exitCode = 2;
  });
