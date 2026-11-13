import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  runRetailRefresh,
  type RetailSourceRow,
} from "@/lib/prices/retail-refresh";
import type { PriceReading, PriceSource, PriceTarget } from "@/lib/prices/source";

/**
 * The retail price refresh write path.
 *
 * These tests pin down the promise that matters most for a bulk refresh:
 * a DRY RUN performs zero database mutations, and a real run is append-only
 * — it never rewrites history. The Prisma client, the source and the rows
 * are all injected, so nothing here touches a network or a database.
 */

const NOW = new Date("2026-11-12T12:00:00.000Z");

const READING: PriceReading = {
  price: 899.99,
  currency: "USD",
  retailer: "Best Buy",
  sourceUrl: "https://api.bestbuy.com/v1/products/6495820.json?apiKey=test",
  sourceName: "Best Buy Products API",
  kind: "retail",
  confidence: 0.95,
  inStock: true,
  retailerSku: "6495820",
};

const ROW: RetailSourceRow = {
  skuCode: "RB14250-01-4a2f6992",
  seller: "Best Buy",
  retailerSku: "6495820",
  region: "US",
};

/** A source that returns a fixed reading, recording the targets it saw. */
function sourceReturning(
  reading: PriceReading | null
): PriceSource & { targets: PriceTarget[] } {
  const targets: PriceTarget[] = [];
  return {
    name: "Best Buy Products API",
    kind: "retail",
    targets,
    async read(target: PriceTarget) {
      targets.push(target);
      return reading;
    },
  };
}

/** Build a minimal Prisma double with per-model vi.fn() spies. */
function buildDb() {
  const mutations = {
    sellerUpsert: vi.fn(async (): Promise<{ id: string }> => ({ id: "seller-1" })),
    listingUpsert: vi.fn(async (): Promise<{ id: string }> => ({ id: "listing-1" })),
    observationFindFirst: vi.fn(
      async (): Promise<{ id: string } | null> => null
    ),
    observationCreate: vi.fn<(input: { data: Record<string, unknown> }) => Promise<{ id: string }>>(
      async () => ({ id: "obs-1" })
    ),
    historyCreate: vi.fn(async (): Promise<{ id: string }> => ({ id: "hist-1" })),
    skuFindUnique: vi.fn(
      async (): Promise<{ id: string } | null> => ({ id: "sku-1" })
    ),
  };
  const prisma = {
    sku: { findUnique: mutations.skuFindUnique },
    priceObservation: {
      findFirst: mutations.observationFindFirst,
      create: mutations.observationCreate,
    },
    seller: { upsert: mutations.sellerUpsert },
    retailerListing: { upsert: mutations.listingUpsert },
    priceHistory: { create: mutations.historyCreate },
  } as unknown as PrismaClient;
  return { prisma, mutations };
}

function mutationsCalled(m: ReturnType<typeof buildDb>["mutations"]): number {
  return (
    m.sellerUpsert.mock.calls.length +
    m.listingUpsert.mock.calls.length +
    m.observationCreate.mock.calls.length +
    m.historyCreate.mock.calls.length
  );
}

describe("runRetailRefresh", () => {
  it("is a dry run by default and performs zero database mutations", async () => {
    const { prisma, mutations } = buildDb();
    const source = sourceReturning(READING);
    const result = await runRetailRefresh({ prisma, source, rows: [ROW], dryRun: true, now: () => NOW });

    expect(result.dryRun).toBe(true);
    expect(result.recorded).toBe(1);
    expect(result.plan).toContainEqual({
      skuCode: ROW.skuCode,
      retailerSku: ROW.retailerSku,
      action: "record-price",
      price: 899.99,
    });
    expect(mutationsCalled(mutations)).toBe(0);
    expect(mutations.sellerUpsert).not.toHaveBeenCalled();
    expect(mutations.listingUpsert).not.toHaveBeenCalled();
    expect(mutations.observationCreate).not.toHaveBeenCalled();
    expect(mutations.historyCreate).not.toHaveBeenCalled();
  });

  it("does not write when a dry-run row has an unknown skuCode", async () => {
    const { prisma, mutations } = buildDb();
    mutations.skuFindUnique.mockResolvedValue(null);
    const source = sourceReturning(READING);

    const result = await runRetailRefresh({ prisma, source, rows: [ROW], dryRun: true, now: () => NOW });

    expect(result.recorded).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.failures).toEqual([{ skuCode: ROW.skuCode, reason: "unknown skuCode" }]);
    expect(mutationsCalled(mutations)).toBe(0);
  });

  it("is a no-op for an empty row set", async () => {
    const { prisma, mutations } = buildDb();
    const source = sourceReturning(READING);

    const result = await runRetailRefresh({ prisma, source, rows: [], dryRun: true, now: () => NOW });

    expect(result.recorded).toBe(0);
    expect(result.plan).toEqual([]);
    expect(mutationsCalled(mutations)).toBe(0);
  });

  it("records a price, its listing, its seller and its history in a real run", async () => {
    const { prisma, mutations } = buildDb();
    const source = sourceReturning(READING);

    const result = await runRetailRefresh({ prisma, source, rows: [ROW], dryRun: false, now: () => NOW });

    expect(result.dryRun).toBe(false);
    expect(result.recorded).toBe(1);
    expect(mutations.skuFindUnique).toHaveBeenCalledWith({
      where: { skuCode: ROW.skuCode },
      select: { id: true },
    });
    expect(mutations.observationFindFirst).toHaveBeenCalled();
    expect(mutations.sellerUpsert).toHaveBeenCalledTimes(1);
    expect(mutations.listingUpsert).toHaveBeenCalledTimes(1);
    expect(mutations.observationCreate).toHaveBeenCalledTimes(1);
    expect(mutations.historyCreate).toHaveBeenCalledTimes(1);

    // The observation and history rows are appended, not overwritten.
    const obsData = mutations.observationCreate.mock.calls[0][0].data;
    expect(obsData.price).toBe(899.99);
    expect(obsData.currency).toBe("USD");
    expect(obsData.kind).toBe("retail");
    expect(obsData.listingId).toBe("listing-1");
    expect(obsData.timestamp).toEqual(NOW);
  });

  it("does not write when the source reports no price", async () => {
    const { prisma, mutations } = buildDb();
    const source = sourceReturning(null);

    const result = await runRetailRefresh({ prisma, source, rows: [ROW], dryRun: false, now: () => NOW });

    expect(result.recorded).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mutationsCalled(mutations)).toBe(0);
  });

  it("does not re-record an observation that already exists (append-only)", async () => {
    const { prisma, mutations } = buildDb();
    mutations.observationFindFirst.mockResolvedValue({ id: "existing-obs" });
    const source = sourceReturning(READING);

    const result = await runRetailRefresh({ prisma, source, rows: [ROW], dryRun: false, now: () => NOW });

    expect(result.recorded).toBe(0);
    expect(result.plan).toContainEqual({
      skuCode: ROW.skuCode,
      retailerSku: ROW.retailerSku,
      action: "already-recorded",
      price: 899.99,
    });
    expect(mutations.observationCreate).not.toHaveBeenCalled();
    expect(mutations.historyCreate).not.toHaveBeenCalled();
  });

  it("reports a skipped row whose source read throws, and keeps going", async () => {
    const { prisma, mutations } = buildDb();
    const throwing: PriceSource = {
      name: "Best Buy Products API",
      kind: "retail",
      async read() {
        throw new Error("network down");
      },
    };

    const result = await runRetailRefresh({ prisma, source: throwing, rows: [ROW], dryRun: false, now: () => NOW });

    expect(result.recorded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failures[0].reason).toMatch(/source read failed/);
    expect(mutationsCalled(mutations)).toBe(0);
  });

  it("passes the skuId, region and retailer sku to the source target", async () => {
    const { prisma } = buildDb();
    const source = sourceReturning(READING);

    await runRetailRefresh({ prisma, source, rows: [ROW], dryRun: true, now: () => NOW });

    expect(source.targets).toHaveLength(1);
    expect(source.targets[0]).toMatchObject({
      skuId: "sku-1",
      region: "US",
      sellerName: "Best Buy",
      retailerSku: "6495820",
    });
  });
});