/**
 * Refresh the manufacturer's published list price for each product family.
 *
 * A manufacturer publishes one price for a product family, not one price per
 * configuration, so the figure is recorded on the family rather than on each
 * configuration. Attaching a "starting at" price to a specific
 * configuration would misstate what the buyer would pay, so it is never
 * done.
 *
 * The price is read from the structured `Product` markup the manufacturer
 * publishes, and the page it came from is stored with it, so the number can
 * be checked. Observations are appended to `PriceObservation` as well, so the
 * history of a family's price survives a refresh.
 *
 * The families to refresh are listed in `data/family-price-sources.csv`:
 *
 *   model_slug,manufacturer,region,url
 *
 * Usage:
 *   npm run db:prices
 *   npm run db:prices -- --limit 5
 */

import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/db";
import { extractJsonLdPrice } from "../src/lib/prices/source";

const USER_AGENT = "VeridianBot/1.0 (+https://veridian.dev; contact@veridian.dev)";
const TIMEOUT_MS = 30_000;

interface FamilyPriceSource {
  model_slug: string;
  manufacturer: string;
  region: string;
  url: string;
}

function parseCsv(text: string): FamilyPriceSource[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const rows: FamilyPriceSource[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim());
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? "";
    });
    if (!record.model_slug || !record.url) continue;
    rows.push({
      model_slug: record.model_slug,
      manufacturer: record.manufacturer || "manufacturer",
      region: record.region || "US",
      url: record.url,
    });
  }
  return rows;
}

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  const csvPath = path.join(process.cwd(), "data", "family-price-sources.csv");
  if (!fs.existsSync(csvPath)) {
    console.log(`No family price sources configured at ${csvPath}. Nothing to do.`);
    return;
  }

  const rows = parseCsv(fs.readFileSync(csvPath, "utf-8")).slice(0, limit);
  console.log(`Refreshing ${rows.length} family price source(s).`);

  const recorded: Array<{ model: string; price: number; currency: string; url: string }> = [];
  const failures: Array<{ model: string; reason: string }> = [];

  for (const row of rows) {
    const model = await prisma.model.findFirst({
      where: { slug: row.model_slug },
      select: { id: true, name: true, skus: { select: { id: true }, take: 1 } },
    });
    if (!model) {
      failures.push({ model: row.model_slug, reason: "no model with that slug" });
      continue;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let extracted: ReturnType<typeof extractJsonLdPrice> = null;
    try {
      const response = await fetch(row.url, {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": USER_AGENT,
        },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        failures.push({ model: row.model_slug, reason: `HTTP ${response.status}` });
        continue;
      }
      extracted = extractJsonLdPrice(await response.text());
    } catch (error) {
      failures.push({
        model: row.model_slug,
        reason: error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
      });
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (!extracted) {
      failures.push({ model: row.model_slug, reason: "the page published no structured price" });
      continue;
    }

    const observedAt = new Date();
    await prisma.model.update({
      where: { id: model.id },
      data: {
        priceFrom: extracted.price,
        priceFromCurrency: extracted.currency,
        priceFromUrl: row.url,
        priceFromObservedAt: observedAt,
        productUrl: row.url,
      },
    });

    // Append the reading to the price history of the family's first
    // configuration, so the price has the same provenance trail as every
    // other observation.
    const sku = model.skus[0];
    if (sku) {
      const existing = await prisma.priceObservation.findFirst({
        where: {
          skuId: sku.id,
          region: row.region,
          price: extracted.price,
          currency: extracted.currency,
          sourceUrl: row.url,
        },
        select: { id: true },
      });
      if (!existing) {
        await prisma.priceObservation.create({
          data: {
            skuId: sku.id,
            region: row.region,
            currency: extracted.currency,
            price: extracted.price,
            retailer: row.manufacturer,
            sourceUrl: row.url,
            sourceName: `${row.manufacturer} list price for the family`,
            kind: "manufacturer",
            inStock: extracted.inStock,
            confidence: 0.9,
            timestamp: observedAt,
          },
        });
      }
    }

    recorded.push({
      model: row.model_slug,
      price: extracted.price,
      currency: extracted.currency,
      url: row.url,
    });
  }

  console.log(
    JSON.stringify(
      { sources: rows.length, recorded: recorded.length, failures },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("Family price refresh failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
