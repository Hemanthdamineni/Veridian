import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildPriceHistory,
  computeAllWindowStatistics,
  filterObservations,
  loadPriceHistory,
  normalizeKind,
  parsePriceHistoryQuery,
  type PriceHistoryResponse,
  type PriceObservation,
  type PriceStatistic,
} from "@/lib/prices/stats";

/**
 * Price history and price statistics.
 *
 * The tests below are about the promises this layer makes to a reader:
 * a statistic that rests on too little evidence is refused rather than
 * dressed up, a gap is reported as a gap, and a manufacturer list price is
 * never presented as a street price.
 */

const NOW = new Date("2026-10-21T12:00:00.000Z");
const SKU_A = "sku-aaaaaaaaaaa";
const SKU_B = "sku-bbbbbbbbbbb";

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function observation(overrides: Partial<PriceObservation> = {}): PriceObservation {
  return {
    id: "obs-1",
    skuId: SKU_A,
    region: "US",
    currency: "USD",
    price: 1000,
    kind: "retail",
    sourceName: "Test Shop",
    sourceUrl: "https://example.test/price",
    retailer: "Test Shop",
    inStock: true,
    confidence: 0.9,
    timestamp: NOW,
    ...overrides,
  };
}

function historyOf(observations: PriceObservation[], window: PriceHistoryResponse["window"] = "all") {
  return buildPriceHistory({
    skuId: SKU_A,
    region: "US",
    currency: null,
    window,
    observations,
    currentPricing: null,
    asOf: NOW,
  });
}

function expectWellFormed(statistic: PriceStatistic) {
  expect(["ok", "insufficient_data"]).toContain(statistic.status);
  expect(typeof statistic.observationCount).toBe("number");
  expect(statistic.window.id).toBeTruthy();
  expect(statistic.evidence).toBeTruthy();
  expect(statistic.evidence.evidenceClass).toBeTruthy();
  expect(statistic.evidence.note.length).toBeGreaterThan(0);
  if (statistic.status === "ok") {
    expect(typeof statistic.value).toBe("number");
    expect(statistic.reason).toBeNull();
  } else {
    expect(statistic.value).toBeNull();
    expect(statistic.reason).toBeTruthy();
  }
}

describe("price statistics — insufficient evidence", () => {
  it("reports a statistic computed from a single observation as insufficient rather than as an average", () => {
    const history = historyOf([observation({ price: 1299 })]);

    const all = history.statistics.all;
    expect(all.observationCount).toBe(1);

    // A single observation is a reading, not a distribution.
    expect(all.mean.status).toBe("insufficient_data");
    expect(all.mean.value).toBeNull();
    expect(all.mean.observationCount).toBe(1);
    expect(all.mean.reason).toContain("only 1 observation");

    expect(all.min.status).toBe("insufficient_data");
    expect(all.min.value).toBeNull();
    expect(all.max.status).toBe("insufficient_data");
    expect(all.max.value).toBeNull();

    // The observation itself is still shown, with its count.
    expect(history.observationCount).toBe(1);
    expect(history.observations[0].price).toBe(1299);
  });

  it("reports an empty window as empty rather than as zero", () => {
    const history = historyOf([]);

    for (const id of ["7d", "30d", "90d", "all"] as const) {
      const block = history.statistics[id];
      expect(block.observationCount).toBe(0);
      expect(block.countedObservationCount).toBe(0);
      expect(block.min.value).toBeNull();
      expect(block.max.value).toBeNull();
      expect(block.mean.value).toBeNull();
      expect(block.min.status).toBe("insufficient_data");
      expect(block.min.observationCount).toBe(0);
    }

    expect(history.observationCount).toBe(0);
    expect(history.observations).toEqual([]);
  });

  it("keeps the response shape stable for a configuration with no observations at all", () => {
    const history = historyOf([]);

    expect(Object.keys(history).sort()).toEqual(
      [
        "coverage",
        "currency",
        "currentPricing",
        "excluded",
        "generatedAt",
        "notes",
        "observationCount",
        "observations",
        "region",
        "skuId",
        "statistics",
        "window",
      ].sort()
    );

    // Every field is present and meaningful; nothing is null or undefined.
    expect(history.skuId).toBe(SKU_A);
    expect(history.region).toBe("US");
    expect(history.currency).toBeNull();
    expect(history.window).toBe("all");
    expect(history.observationCount).toBe(0);
    expect(history.observations).toEqual([]);
    expect(history.currentPricing).toBeNull();
    expect(history.excluded).toEqual({ otherCurrency: 0, unusablePrice: 0 });
    expect(history.notes.length).toBeGreaterThan(0);

    expect(Object.keys(history.statistics).sort()).toEqual(["7d", "30d", "90d", "all"].sort());
    for (const id of ["7d", "30d", "90d", "all"] as const) {
      const block = history.statistics[id];
      expect(block.byCurrency).toEqual([]);
      expect(block.excluded).toEqual([]);
      expect(block.currencies).toEqual([]);
      expect(block.currency).toBeNull();
      expectWellFormed(block.min);
      expectWellFormed(block.max);
      expectWellFormed(block.mean);
    }

    expect(history.coverage.totalObservationCount).toBe(0);
    expect(history.coverage.firstObservedAt).toBeNull();
    expect(history.coverage.lastObservedAt).toBeNull();
    expect(history.coverage.daysSinceLastObservation).toBeNull();
    expect(history.coverage.gaps).toEqual([]);
  });
});

describe("price statistics — values", () => {
  it("computes the minimum, the maximum and the mean over two or more observations", () => {
    const history = historyOf([
      observation({ id: "a", price: 900, timestamp: daysAgo(20) }),
      observation({ id: "b", price: 1000, timestamp: daysAgo(10) }),
      observation({ id: "c", price: 1100, timestamp: daysAgo(2) }),
    ]);

    const all = history.statistics.all;
    expect(all.observationCount).toBe(3);
    expect(all.min.status).toBe("ok");
    expect(all.min.value).toBe(900);
    expect(all.max.status).toBe("ok");
    expect(all.max.value).toBe(1100);
    expect(all.mean.status).toBe("ok");
    expect(all.mean.value).toBe(1000);
  });

  it("states the window and the observation count next to every statistic", () => {
    const history = historyOf([
      observation({ id: "a", price: 900, timestamp: daysAgo(3) }),
      observation({ id: "b", price: 1100, timestamp: daysAgo(1) }),
    ]);

    for (const id of ["7d", "30d", "90d", "all"] as const) {
      const block = history.statistics[id];
      for (const statistic of [block.min, block.max, block.mean]) {
        expect(statistic.window.id).toBe(id);
        expect(statistic.observationCount).toBe(block.countedObservationCount);
        expect(statistic.currency).toBe("USD");
      }
    }
  });

  it("keeps an observation inside the window it belongs to and outside the shorter ones", () => {
    const history = historyOf([
      observation({ id: "old", price: 900, timestamp: daysAgo(45) }),
      observation({ id: "recent", price: 1000, timestamp: daysAgo(2) }),
    ]);

    expect(history.statistics["7d"].observationCount).toBe(1);
    expect(history.statistics["30d"].observationCount).toBe(1);
    expect(history.statistics["90d"].observationCount).toBe(2);
    expect(history.statistics.all.observationCount).toBe(2);

    // The 7 day window holds one observation, so it refuses a statistic.
    expect(history.statistics["7d"].mean.status).toBe("insufficient_data");
    expect(history.statistics["30d"].mean.value).toBeNull();
    // The 90 day window holds two, so it can be computed.
    expect(history.statistics["90d"].mean.status).toBe("ok");
    expect(history.statistics["90d"].mean.value).toBe(950);
  });

  it("returns the observations in chronological order", () => {
    const history = historyOf([
      observation({ id: "c", price: 3, timestamp: daysAgo(1) }),
      observation({ id: "a", price: 1, timestamp: daysAgo(30) }),
      observation({ id: "b", price: 2, timestamp: daysAgo(10) }),
    ]);

    expect(history.observations.map((o) => o.price)).toEqual([1, 2, 3]);
    expect(history.observations.map((o) => o.timestamp)).toEqual([
      daysAgo(30).toISOString(),
      daysAgo(10).toISOString(),
      daysAgo(1).toISOString(),
    ]);
  });

  it("carries the price, the currency, the source, the kind and the stock of every observation", () => {
    const history = historyOf([
      observation({
        price: 1234.5,
        currency: "USD",
        sourceName: "Test Shop",
        sourceUrl: "https://example.test/price",
        kind: "retail",
        inStock: false,
        timestamp: daysAgo(1),
      }),
    ]);

    const record = history.observations[0];
    expect(record.price).toBe(1234.5);
    expect(record.currency).toBe("USD");
    expect(record.sourceName).toBe("Test Shop");
    expect(record.sourceUrl).toBe("https://example.test/price");
    expect(record.kind).toBe("retail");
    expect(record.inStock).toBe(false);
    expect(record.timestamp).toBe(daysAgo(1).toISOString());
  });
});

describe("price statistics — the evidence class", () => {
  it("tags a statistic with the evidence class it was computed from", () => {
    const manufacturer = historyOf([
      observation({ id: "a", kind: "manufacturer", price: 1000, timestamp: daysAgo(2) }),
      observation({ id: "b", kind: "manufacturer", price: 1100, timestamp: daysAgo(1) }),
    ]);

    const evidence = manufacturer.statistics.all.evidence;
    expect(evidence.evidenceClass).toBe("manufacturer");
    expect(evidence.kinds).toEqual(["manufacturer"]);
    expect(evidence.observationCount).toBe(2);

    // The statistic carries the tag as well, not only the window around it.
    expect(manufacturer.statistics.all.min.evidence.evidenceClass).toBe("manufacturer");
    expect(manufacturer.statistics.all.max.evidence.evidenceClass).toBe("manufacturer");
    expect(manufacturer.statistics.all.mean.evidence.evidenceClass).toBe("manufacturer");
  });

  it("never presents a manufacturer list price as a street price", () => {
    const history = historyOf([
      observation({ id: "a", kind: "manufacturer", price: 1000, timestamp: daysAgo(2) }),
      observation({ id: "b", kind: "manufacturer", price: 1100, timestamp: daysAgo(1) }),
    ]);

    const evidence = history.statistics.all.evidence;
    expect(evidence.isStreetPrice).toBe(false);
    expect(evidence.note).toContain("not a street price");
    expect(history.notes.join(" ")).toContain("not street prices");
  });

  it("marks a window that holds only retail quotes as a street price", () => {
    const history = historyOf([
      observation({ id: "a", kind: "retail", price: 1000, timestamp: daysAgo(2) }),
      observation({ id: "b", kind: "retail", price: 1100, timestamp: daysAgo(1) }),
    ]);

    const evidence = history.statistics.all.evidence;
    expect(evidence.evidenceClass).toBe("retail");
    expect(evidence.isStreetPrice).toBe(true);
    expect(evidence.note).toContain("street price");
  });

  it("marks a window that mixes evidence classes as mixed", () => {
    const history = historyOf([
      observation({ id: "a", kind: "retail", price: 1000, timestamp: daysAgo(2) }),
      observation({ id: "b", kind: "manufacturer", price: 1100, timestamp: daysAgo(1) }),
    ]);

    const evidence = history.statistics.all.evidence;
    expect(evidence.evidenceClass).toBe("mixed");
    expect(evidence.kinds).toEqual(["retail", "manufacturer"]);
    expect(evidence.isStreetPrice).toBe(false);
  });

  it("does not relabel an evidence class it does not recognise", () => {
    expect(normalizeKind("auction")).toBe("unknown");
    expect(normalizeKind("RETAIL")).toBe("retail");
    expect(normalizeKind("Manufacturer")).toBe("manufacturer");
    expect(normalizeKind(null)).toBe("unknown");

    const history = historyOf([
      observation({ id: "a", kind: "unknown", price: 1000, timestamp: daysAgo(2) }),
      observation({ id: "b", kind: "unknown", price: 1100, timestamp: daysAgo(1) }),
    ]);

    const evidence = history.statistics.all.evidence;
    expect(evidence.evidenceClass).toBe("unknown");
    expect(evidence.isStreetPrice).toBe(false);
  });
});

describe("price statistics — scope", () => {
  it("excludes observations from another region", () => {
    const selection = filterObservations(
      [
        observation({ id: "us", region: "US", price: 999 }),
        observation({ id: "in", region: "IN", price: 500 }),
      ],
      { skuId: SKU_A, region: "US", currency: null }
    );

    expect(selection.observations).toHaveLength(1);
    expect(selection.observations[0].price).toBe(999);
    expect(selection.excluded.otherRegion).toBe(1);
  });

  it("excludes observations from another configuration", () => {
    const selection = filterObservations(
      [
        observation({ id: "mine", skuId: SKU_A }),
        observation({ id: "theirs", skuId: SKU_B, price: 1 }),
      ],
      { skuId: SKU_A, region: "US", currency: null }
    );

    expect(selection.observations).toHaveLength(1);
    expect(selection.observations[0].id).toBe("mine");
    expect(selection.excluded.otherSku).toBe(1);
  });

  it("excludes observations in another currency when a currency is asked for", () => {
    const selection = filterObservations(
      [
        observation({ id: "usd", currency: "USD", price: 999 }),
        observation({ id: "eur", currency: "EUR", price: 950 }),
      ],
      { skuId: SKU_A, region: "US", currency: "USD" }
    );

    expect(selection.observations).toHaveLength(1);
    expect(selection.observations[0].currency).toBe("USD");
    expect(selection.excluded.otherCurrency).toBe(1);
  });

  it("never averages prices of two currencies together", () => {
    const history = historyOf([
      observation({ id: "a", currency: "USD", price: 1000, timestamp: daysAgo(2) }),
      observation({ id: "b", currency: "EUR", price: 900, timestamp: daysAgo(1) }),
    ]);

    const block = history.statistics.all;
    // The statistics are computed in the currency of the most recent observation.
    expect(block.currency).toBe("EUR");
    expect(block.countedObservationCount).toBe(1);
    expect(block.min.status).toBe("insufficient_data");
    expect(block.observationCount).toBe(2);
    expect(block.excluded).toHaveLength(1);
    expect(block.excluded[0].currency).toBe("USD");

    // Each currency is reported on its own, so nothing is lost and nothing is mixed.
    const currencies = block.byCurrency.map((entry) => entry.currency).sort();
    expect(currencies).toEqual(["EUR", "USD"]);
    const usd = block.byCurrency.find((entry) => entry.currency === "USD");
    expect(usd?.observationCount).toBe(1);
    expect(usd?.min.status).toBe("insufficient_data");
  });

  it("counts the observations left out of a currency once per currency", () => {
    const history = historyOf([
      observation({ id: "a", currency: "USD", price: 1000, timestamp: daysAgo(3) }),
      observation({ id: "b", currency: "EUR", price: 900, timestamp: daysAgo(2) }),
      observation({ id: "c", currency: "EUR", price: 950, timestamp: daysAgo(1) }),
    ]);

    const block = history.statistics.all;
    expect(block.excluded).toHaveLength(1);
    expect(block.excluded[0].currency).toBe("USD");
    expect(block.excluded[0].observationCount).toBe(1);
    expect(block.byCurrency.find((entry) => entry.currency === "EUR")?.observationCount).toBe(2);
  });
});

describe("price history — gaps", () => {
  it("reports a gap in the history instead of carrying a price across it", () => {
    const history = historyOf([
      observation({ id: "a", price: 1000, timestamp: daysAgo(200) }),
      observation({ id: "b", price: 1100, timestamp: daysAgo(3) }),
    ]);

    expect(history.coverage.gaps).toHaveLength(1);
    expect(history.coverage.gaps[0].days).toBe(197);
    expect(history.coverage.firstObservedAt).toBe(daysAgo(200).toISOString());
    expect(history.coverage.lastObservedAt).toBe(daysAgo(3).toISOString());
    expect(history.coverage.daysSinceLastObservation).toBe(3);
    expect(history.notes.join(" ")).toContain("gap");
  });
});

describe("the request", () => {
  it("reads the region, the window and the currency from the query string", () => {
    const parsed = parsePriceHistoryQuery(
      new URLSearchParams("region=in&window=30&currency=inr"),
      SKU_A
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.query.region).toBe("IN");
    expect(parsed.query.window).toBe("30d");
    expect(parsed.query.currency).toBe("INR");
    expect(parsed.query.skuId).toBe(SKU_A);
  });

  it("defaults to the US region and the whole history", () => {
    const parsed = parsePriceHistoryQuery(new URLSearchParams(), SKU_A);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.query.region).toBe("US");
    expect(parsed.query.window).toBe("all");
    expect(parsed.query.currency).toBeNull();
  });

  it("refuses a window it does not know", () => {
    const parsed = parsePriceHistoryQuery(new URLSearchParams("window=45"), SKU_A);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("window");
  });

  it("refuses a currency that is not a currency code", () => {
    const parsed = parsePriceHistoryQuery(new URLSearchParams("currency=dollars"), SKU_A);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("currency");
  });
});

describe("the price history loader", () => {
  async function withTempDb(fn: (prisma: PrismaClient) => Promise<void>) {
    const dir = mkdtempSync(path.join(tmpdir(), "veridian-price-stats-test-"));
    const dbPath = path.join(dir, "test.db");
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `file:${dbPath}`;
    const prisma = new PrismaClient({ datasourceUrl: `file:${dbPath}` });
    try {
      const { execSync } = await import("node:child_process");
      execSync("npx prisma db push --skip-generate --accept-data-loss --force-reset", {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env },
        stdio: "ignore",
      });
      await fn(prisma);
    } finally {
      await prisma.$disconnect();
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async function createSku(prisma: PrismaClient, code: string) {
    const slug = code.toLowerCase();
    const manufacturer = await prisma.manufacturer.create({
      data: { name: `Maker ${code}`, slug: `maker-${slug}` },
    });
    const series = await prisma.series.create({
      data: { manufacturerId: manufacturer.id, name: `Series ${code}`, slug: `series-${slug}` },
    });
    const model = await prisma.model.create({
      data: { seriesId: series.id, name: `Model ${code}`, slug: `model-${slug}` },
    });
    return prisma.sku.create({
      data: {
        modelId: model.id,
        skuCode: code,
        cpuBrand: "Test",
        cpuModel: "T1",
        ramGb: 16,
        os: "Linux",
      },
    });
  }

  it("reads only the observations of the requested configuration and region", async () => {
    await withTempDb(async (prisma) => {
      const mine = await createSku(prisma, "PRICE-STATS-A");
      const other = await createSku(prisma, "PRICE-STATS-B");

      const now = new Date();
      const ago = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      await prisma.priceObservation.create({
        data: {
          skuId: mine.id,
          region: "US",
          currency: "USD",
          price: 999,
          sourceName: "Test Shop",
          sourceUrl: "https://example.test/one",
          kind: "retail",
          inStock: true,
          confidence: 0.9,
          timestamp: ago(5),
        },
      });
      await prisma.priceObservation.create({
        data: {
          skuId: mine.id,
          region: "US",
          currency: "USD",
          price: 1099,
          sourceName: "Test Shop",
          sourceUrl: "https://example.test/two",
          kind: "retail",
          inStock: true,
          confidence: 0.9,
          timestamp: ago(1),
        },
      });
      // Another region, and another configuration. Neither may leak.
      await prisma.priceObservation.create({
        data: {
          skuId: mine.id,
          region: "IN",
          currency: "INR",
          price: 500,
          sourceName: "Test Shop",
          sourceUrl: "https://example.test/in",
          kind: "retail",
          inStock: true,
          confidence: 0.9,
          timestamp: ago(1),
        },
      });
      await prisma.priceObservation.create({
        data: {
          skuId: other.id,
          region: "US",
          currency: "USD",
          price: 7,
          sourceName: "Test Shop",
          sourceUrl: "https://example.test/other",
          kind: "retail",
          inStock: true,
          confidence: 0.9,
          timestamp: ago(1),
        },
      });

      const history = await loadPriceHistory(
        { skuId: mine.id, region: "US", window: "all", currency: null },
        prisma
      );

      expect(history.skuId).toBe(mine.id);
      expect(history.region).toBe("US");
      expect(history.observationCount).toBe(2);
      expect(history.observations.map((o) => o.price)).toEqual([999, 1099]);
      expect(history.observations.every((o) => o.currency === "USD")).toBe(true);
      expect(history.observations.map((o) => o.price)).not.toContain(500);
      expect(history.observations.map((o) => o.price)).not.toContain(7);

      expect(history.statistics.all.min.value).toBe(999);
      expect(history.statistics.all.max.value).toBe(1099);
      expect(history.statistics.all.mean.value).toBe(1049);
      expect(history.statistics.all.evidence.evidenceClass).toBe("retail");
      expect(history.statistics.all.evidence.isStreetPrice).toBe(true);

      // A configuration with no observations answers with the same shape.
      const empty = await loadPriceHistory(
        { skuId: other.id, region: "IN", window: "all", currency: null },
        prisma
      );
      expect(empty.observationCount).toBe(0);
      expect(empty.observations).toEqual([]);
      expect(empty.statistics.all.min.status).toBe("insufficient_data");
      expect(empty.statistics.all.min.value).toBeNull();
      expect(empty.notes.length).toBeGreaterThan(0);
    });
  });

  it("computes the statistics of every window", async () => {
    await withTempDb(async (prisma) => {
      const sku = await createSku(prisma, "PRICE-STATS-C");
      const now = new Date();
      const ago = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      for (const [index, days] of [40, 20, 3].entries()) {
        await prisma.priceObservation.create({
          data: {
            skuId: sku.id,
            region: "US",
            currency: "USD",
            price: 1000 + index,
            sourceName: "Test Shop",
            sourceUrl: `https://example.test/${index}`,
            kind: "retail",
            inStock: true,
            confidence: 0.9,
            timestamp: ago(days),
          },
        });
      }

      const history = await loadPriceHistory(
        { skuId: sku.id, region: "US", window: "all", currency: null },
        prisma
      );

      expect(history.statistics["7d"].observationCount).toBe(1);
      expect(history.statistics["30d"].observationCount).toBe(2);
      expect(history.statistics["90d"].observationCount).toBe(3);
      expect(history.statistics.all.observationCount).toBe(3);
      expect(history.statistics["7d"].mean.status).toBe("insufficient_data");
      expect(history.statistics["30d"].mean.status).toBe("ok");
      expect(history.statistics.all.mean.status).toBe("ok");
    });
  });
});

describe("the pure statistics", () => {
  it("computes every window from the same observations", () => {
    const statistics = computeAllWindowStatistics(
      [
        observation({ id: "a", price: 100, timestamp: daysAgo(100) }),
        observation({ id: "b", price: 200, timestamp: daysAgo(50) }),
        observation({ id: "c", price: 300, timestamp: daysAgo(1) }),
      ],
      NOW
    );

    expect(statistics["7d"].observationCount).toBe(1);
    expect(statistics["30d"].observationCount).toBe(1);
    expect(statistics["90d"].observationCount).toBe(2);
    expect(statistics.all.observationCount).toBe(3);
    expect(statistics.all.mean.value).toBe(200);
  });
});
