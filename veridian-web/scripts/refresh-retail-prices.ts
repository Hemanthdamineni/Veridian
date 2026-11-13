/**
 * Refresh retail prices from the configured retail sources.
 *
 * The mapping from a configuration to the retailer listing that quotes its
 * price lives in `data/retail-price-sources.csv`:
 *
 *   sku_code,seller,retailer_sku,region
 *
 * The retail source (e.g. the Best Buy Products API) needs a credential, read
 * from `BEST_BUY_API_KEY`. Without one the run skips every row rather than
 * failing, so an unconfigured environment is a safe no-op.
 *
 * By default the run is a DRY RUN: it prints what it would record and
 * touches nothing. Pass `--write` to actually record observations.
 *
 * Usage:
 *   npm run db:retail-prices                 # dry run
 *   npm run db:retail-prices -- --write      # record observations
 *   npm run db:retail-prices -- --limit 5
 */

import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/db";
import { createBestBuySource } from "../src/lib/prices/sources/bestbuy";
import {
  type RetailSourceRow,
  runRetailRefresh,
} from "../src/lib/prices/retail-refresh";

/** A row of `data/retail-price-sources.csv` as read from the file. */
interface RetailCsvRow {
  sku_code: string;
  seller: string;
  retailer_sku: string;
  region: string;
}

function parseCsv(text: string): RetailCsvRow[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const rows: RetailCsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim());
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? "";
    });
    // A row without a sku_code, seller or retailer_sku cannot be acted on.
    if (!record.sku_code || !record.seller || !record.retailer_sku) continue;
    rows.push({
      sku_code: record.sku_code,
      seller: record.seller,
      retailer_sku: record.retailer_sku,
      region: record.region || "US",
    });
  }
  return rows;
}

async function main() {
  const csvPath = path.join(process.cwd(), "data", "retail-price-sources.csv");
  if (!fs.existsSync(csvPath)) {
    console.log(`No retail price sources configured at ${csvPath}. Nothing to do.`);
    return;
  }

  const text = fs.readFileSync(csvPath, "utf8");
  const rows: RetailSourceRow[] = parseCsv(text).map((row) => ({
    skuCode: row.sku_code,
    seller: row.seller,
    retailerSku: row.retailer_sku,
    region: row.region,
  }));
  if (rows.length === 0) {
    console.log(`No retail price sources configured at ${csvPath}. Nothing to do.`);
    return;
  }

  // The credential. Without it the source reports no price and every row is
  // safely skipped; an unconfigured environment never fails the run.
  const apiKey = process.env.BEST_BUY_API_KEY ?? "";
  const source = createBestBuySource({ apiKey });

  const dryRun = !process.argv.includes("--write");

  let limit = Number.POSITIVE_INFINITY;
  const limitIndex = process.argv.indexOf("--limit");
  if (limitIndex !== -1) {
    const value = Number(process.argv[limitIndex + 1]);
    if (Number.isFinite(value) && value > 0) limit = value;
  }

  const result = await runRetailRefresh({
    prisma,
    source,
    rows: rows.slice(0, limit),
    dryRun,
  });

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "write",
        sources: result.sources,
        recorded: result.recorded,
        skipped: result.skipped,
        failed: result.failed,
        failures: result.failures,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });