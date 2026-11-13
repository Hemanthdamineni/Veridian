/**
 * Retail price refresh (ADR-005).
 *
 * The write path that turns a retail `PriceSource` (e.g. the Best Buy
 * Products API) into stored observations. It is deliberately pure and
 * injectable so the behaviour can be tested without a network or a live
 * database:
 *
 *   * the source, the rows and the Prisma client are passed in;
 *   * every write is a unique, one-at-a-time mutation that can be replaced
 *     by a double;
 *   * a dry run performs zero database mutations — it reports the actions a
 *     real run would take.
 *
 * Invariants, matching the rest of the catalog:
 *
 *   * a price is appended, never overwritten — history survives a refresh;
 *   * a missing or failed price is reported and skipped, never guessed;
 *   * a failure never stops the run.
 *
 * The CLI front end is `scripts/refresh-retail-prices.ts`.
 */

import type { PrismaClient } from "@prisma/client";
import type { PriceReading, PriceSource, PriceTarget } from "./source";

/** One row of `data/retail-price-sources.csv`. */
export interface RetailSourceRow {
  /** The canonical configuration's part number. */
  skuCode: string;
  /** The seller name, used to look up or create the `Seller`. */
  seller: string;
  /** The retailer's own identifier for the listing. */
  retailerSku: string;
  /** ISO-ish region code, e.g. `US`. */
  region: string;
}

export interface RetailRefreshOptions {
  /** The Prisma client to write through. Injected so it can be doubled. */
  prisma: PrismaClient;
  /** The retail source to read prices from. */
  source: PriceSource;
  /** The configured source rows to process. */
  rows: RetailSourceRow[];
  /**
   * When true, plan the writes but do not touch the database.
   */
  dryRun: boolean;
  /** Clock for deterministic observation timestamps in tests. */
  now?: () => Date;
}

/** A write a dry run would have performed. */
export interface RetailPlanStep {
  skuCode: string;
  retailerSku: string;
  action:
    | "record-price"
    | "already-recorded"
    | "skip-unknown-sku"
    | "skip-no-price"
    | "skip-failed";
  price?: number;
  reason?: string;
}

export interface RetailRefreshResult {
  /** The name of the source that produced the readings. */
  sources: string[];
  /** How many observations were (or would be) recorded. */
  recorded: number;
  /** How many rows had no price and were skipped. */
  skipped: number;
  /** How many rows failed and were reported. */
  failed: number;
  /** Whether this run only planned writes. */
  dryRun: boolean;
  /** What the run did, or would do, per row. */
  plan: RetailPlanStep[];
  /** Failures, so the run can be audited after the fact. */
  failures: Array<{ skuCode: string; reason: string }>;
}

/** Derive a stable unique slug for a seller from its name. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A unique key for deduplicating an observation within a refresh. */
function observationKey(reading: PriceReading, skuId: string, region: string): {
  skuId: string;
  region: string;
  price: number;
  currency: string;
  sourceUrl: string;
} {
  return {
    skuId,
    region,
    price: reading.price,
    currency: reading.currency,
    sourceUrl: reading.sourceUrl,
  };
}

/**
 * Refresh retail prices for the configured rows.
 *
 * A dry run reports the plan without writing a single row. A real run
 * resolves each `skuCode` to a configuration, upserts the seller and its
 * listing, and appends a price observation plus a price-history row.
 *
 * The returned result never throws: every row is resolved, and any
 * unexpected error is captured in `failures`.
 */
export async function runRetailRefresh(options: RetailRefreshOptions): Promise<RetailRefreshResult> {
  const { prisma, source, rows, dryRun } = options;
  const now = options.now ?? (() => new Date());

  const result: RetailRefreshResult = {
    sources: [source.name],
    recorded: 0,
    skipped: 0,
    failed: 0,
    dryRun,
    plan: [],
    failures: [],
  };

  for (const row of rows) {
    // Resolve the canonical configuration.
    let sku;
    try {
      sku = await prisma.sku.findUnique({
        where: { skuCode: row.skuCode },
        select: { id: true },
      });
    } catch (error) {
      result.failed += 1;
      result.failures.push({ skuCode: row.skuCode, reason: `sku lookup failed: ${String(error)}` });
      result.plan.push({ skuCode: row.skuCode, retailerSku: row.retailerSku, action: "skip-failed" });
      continue;
    }
    if (!sku) {
      result.skipped += 1;
      result.failures.push({ skuCode: row.skuCode, reason: "unknown skuCode" });
      result.plan.push({ skuCode: row.skuCode, retailerSku: row.retailerSku, action: "skip-unknown-sku" });
      continue;
    }

    // Read the current price. A missing price is never guessed.
    const target: PriceTarget = {
      skuId: sku.id,
      region: row.region,
      url: `(retail:${row.seller}:${row.retailerSku})`,
      sellerName: row.seller,
      retailerSku: row.retailerSku,
    };

    let reading: PriceReading | null;
    try {
      reading = await source.read(target);
    } catch (error) {
      result.failed += 1;
      result.failures.push({ skuCode: row.skuCode, reason: `source read failed: ${String(error)}` });
      result.plan.push({ skuCode: row.skuCode, retailerSku: row.retailerSku, action: "skip-failed" });
      continue;
    }

    if (!reading) {
      result.skipped += 1;
      result.failures.push({ skuCode: row.skuCode, reason: "no price reported by source" });
      result.plan.push({ skuCode: row.skuCode, retailerSku: row.retailerSku, action: "skip-no-price" });
      continue;
    }

    // In dry-run mode, record the planned write and stop.
    if (dryRun) {
      result.recorded += 1;
      result.plan.push({ skuCode: row.skuCode, retailerSku: row.retailerSku, action: "record-price", price: reading.price });
      continue;
    }

    try {
      // Append-only: only record when this exact observation is not present.
      const existing = await prisma.priceObservation.findFirst({
        where: observationKey(reading, sku.id, row.region),
        select: { id: true },
      });
      if (existing) {
        result.plan.push({ skuCode: row.skuCode, retailerSku: row.retailerSku, action: "already-recorded", price: reading.price });
        continue;
      }

      // Upsert the seller, keyed by its stable slug.
      const slug = slugify(row.seller);
      const seller = await prisma.seller.upsert({
        where: { slug },
        create: {
          name: row.seller,
          slug,
          region: row.region,
          baseUrl: "",
          scrapeMethod: "api",
        },
        update: {},
        select: { id: true },
      });

      // Upsert the retailer listing, keyed by seller + retailer sku.
      const listing = await prisma.retailerListing.upsert({
        where: { sellerId_retailerSkuString: { sellerId: seller.id, retailerSkuString: row.retailerSku } },
        create: {
          sellerId: seller.id,
          skuId: sku.id,
          retailerSkuString: row.retailerSku,
          region: row.region,
          currency: reading.currency,
          inStock: reading.inStock,
          url: reading.sourceUrl,
          matchConfidence: reading.confidence,
          matchMethod: "manual",
        },
        update: {
          lastSeenAt: now(),
          inStock: reading.inStock,
          url: reading.sourceUrl,
        },
        select: { id: true },
      });

      // Append the observation and the history row.
      const timestamp = now();
      await prisma.priceObservation.create({
        data: {
          skuId: sku.id,
          listingId: listing.id,
          region: row.region,
          currency: reading.currency,
          price: reading.price,
          retailer: reading.retailer,
          sourceUrl: reading.sourceUrl,
          sourceName: reading.sourceName,
          kind: reading.kind,
          inStock: reading.inStock,
          confidence: reading.confidence,
          timestamp,
        },
      });
      await prisma.priceHistory.create({
        data: {
          listingId: listing.id,
          skuId: sku.id,
          price: reading.price,
          currency: reading.currency,
          scrapedAt: timestamp,
        },
      });

      result.recorded += 1;
      result.plan.push({ skuCode: row.skuCode, retailerSku: row.retailerSku, action: "record-price", price: reading.price });
    } catch (error) {
      result.failed += 1;
      result.failures.push({ skuCode: row.skuCode, reason: `write failed: ${String(error)}` });
      result.plan.push({ skuCode: row.skuCode, retailerSku: row.retailerSku, action: "skip-failed" });
    }
  }

  return result;
}