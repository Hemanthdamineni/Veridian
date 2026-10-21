/**
 * Refresh prices from the configured price sources.
 *
 * Every price source is a page the manufacturer or a seller publishes, and
 * every observation records the page it came from. Observations are
 * appended, never overwritten, so the history of a price survives a refresh.
 *
 * The mapping from a configuration to the page that quotes its price lives
 * in `data/price-sources.csv`:
 *
 *   sku_code,manufacturer,region,url
 *
 * A source that cannot be reached, or that carries no price, is reported and
 * skipped. It is never guessed, and a failure never stops the run.
 *
 * Usage:
 *   npm run db:prices            # refresh every configured source
 *   npm run db:prices -- --limit 5
 */

import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/db";
import {
  extractJsonLdPrice,
  type PriceKind,
  type PriceReading,
  type PriceTarget,
} from "../src/lib/prices/source";

const USER_AGENT =
  "VeridianBot/1.0 (+https://veridian.dev; contact@veridian.dev)";

const TIMEOUT_MS = 30_000;

interface PriceSourceRow {
  sku_code: string;
  manufacturer: string;
  region: string;
  url: string;
}

function parseCsv(text: string): PriceSourceRow[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const rows: PriceSourceRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim());
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? "";
    });
    if (!record.sku_code || !record.url) continue;
    rows.push({
      sku_code: record.sku_code,
      manufacturer: record.manufacturer || "manufacturer",
      region: record.region || "US",
      url: record.url,
    });
  }
  return rows;
}

/**
 * Read a price from a manufacturer or retailer product page.
 *
 * Only structured `Product` markup is read. A page that does not publish
 * one yields no price, which is recorded as a source failure rather than
 * turned into a guess.
 */
async function readPagePrice(target: PriceTarget): Promise<PriceReading | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(target.url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const html = await response.text();
    const extracted = extractJsonLdPrice(html);
    if (!extracted) return null;
    return {
      price: extracted.price,
      currency: extracted.currency,
      retailer: target.sellerName ?? null,
      sourceUrl: target.url,
      sourceName: target.sellerName ?? "Manufacturer list price",
      kind: "manufacturer" as PriceKind,
      confidence: 0.9,
      inStock: extracted.inStock,
      retailerSku: target.retailerSku ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  const csvPath = path.join(process.cwd(), "data", "price-sources.csv");
  if (!fs.existsSync(csvPath)) {
    console.log(`No price sources configured at ${csvPath}. Nothing to do.`);
    return;
  }

  const rows = parseCsv(fs.readFileSync(csvPath, "utf-8")).slice(0, limit);
  console.log(`Refreshing ${rows.length} configured price source(s).`);

  let recorded = 0;
  let skipped = 0;
  let failed = 0;
  const failures: Array<{ sku: string; reason: string }> = [];

  for (const row of rows) {
    const sku = await prisma.sku.findUnique({
      where: { skuCode: row.sku_code },
      select: { id: true },
    });
    if (!sku) {
      skipped++;
      failures.push({ sku: row.sku_code, reason: "no canonical configuration with that part number" });
      continue;
    }

    let reading: PriceReading | null = null;
    try {
      reading = await readPagePrice({
        skuId: sku.id,
        region: row.region,
        url: row.url,
        sellerName: row.manufacturer,
      });
    } catch (error) {
      failed++;
      failures.push({
        sku: row.sku_code,
        reason: error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
      });
      continue;
    }

    if (!reading) {
      failed++;
      failures.push({ sku: row.sku_code, reason: "the page published no structured price" });
      continue;
    }

    // Append-only. The same price read twice is not recorded twice: an
    // observation is identified by what it says, not by when it was read.
    const existing = await prisma.priceObservation.findFirst({
      where: {
        skuId: sku.id,
        region: row.region,
        price: reading.price,
        currency: reading.currency,
        sourceUrl: reading.sourceUrl,
      },
      select: { id: true },
    });
    if (!existing) {
      await prisma.priceObservation.create({
        data: {
          skuId: sku.id,
          region: row.region,
          currency: reading.currency,
          price: reading.price,
          retailer: reading.retailer,
          sourceUrl: reading.sourceUrl,
          sourceName: reading.sourceName,
          kind: reading.kind,
          inStock: reading.inStock,
          confidence: reading.confidence,
          timestamp: new Date(),
        },
      });
      recorded++;
    } else {
      skipped++;
    }

    // The current list price is also the snapshot the catalog shows.
    await prisma.skuRegionalPricing.upsert({
      where: { skuId_region: { skuId: sku.id, region: row.region } },
      update: { msrp: reading.price, currency: reading.currency },
      create: {
        skuId: sku.id,
        region: row.region,
        currency: reading.currency,
        msrp: reading.price,
      },
    });
  }

  console.log(
    JSON.stringify(
      { sources: rows.length, recorded, skipped, failed, failures },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("Price refresh failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
