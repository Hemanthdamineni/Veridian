import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import path from "path";
import { runContractChecks, CONTRACT_CHECKS } from "@/lib/contracts";

/**
 * The catalog's trust contract.
 *
 * These properties are what make the catalog worth trusting. They are
 * checked against a database that deliberately contains both a correct row
 * and a broken one, so a check that passes vacuously - because the table is
 * empty, or because the broken row is not there - fails the test.
 */

describe("catalog trust contract", () => {
  let prisma: PrismaClient;
  let tempDir: string;
  let databaseUrl: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "veridian-contract-"));
    databaseUrl = `file:${path.join(tempDir, "contract.db")}`;
    execFileSync(
      "npx",
      ["prisma", "db", "push", "--skip-generate", "--force-reset"],
      {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "ignore",
      }
    );
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Every test starts from a known state: the tables are emptied but the
    // schema stays, so each test can lay down exactly the rows it needs.
    await prisma.priceObservation.deleteMany();
    await prisma.skuRegionalPricing.deleteMany();
    await prisma.rawObservation.deleteMany();
    await prisma.skuSource.deleteMany();
    await prisma.certifiedSkuSpec.deleteMany();
    await prisma.skuComponent.deleteMany();
    await prisma.sku.deleteMany();
    await prisma.model.deleteMany();
    await prisma.series.deleteMany();
    await prisma.manufacturer.deleteMany();
  });

  /** A minimal, correct catalog: one certified configuration with a source. */
  async function seedHealthyCatalog() {
    const manufacturer = await prisma.manufacturer.create({
      data: { name: "Testco", slug: "testco" },
    });
    const series = await prisma.series.create({
      data: {
        manufacturerId: manufacturer.id,
        name: "Test Series",
        slug: "test-series",
      },
    });
    const model = await prisma.model.create({
      data: { seriesId: series.id, name: "Test Model", slug: "test-model" },
    });
    const sku = await prisma.sku.create({
      data: {
        modelId: model.id,
        skuCode: "TEST-001",
        mpn: "PN-001",
        provenance: "certified",
        cpuBrand: "Test",
        cpuModel: "Test CPU",
        ramGb: 16,
        os: "TestOS",
        sources: {
          create: {
            source: "A cited source",
            kind: "certified",
            sourceUrl: "https://example.invalid/record/1",
            confidence: 1,
          },
        },
        observations: {
          create: {
            source: "A cited source",
            sourceUrl: "https://example.invalid/record/1",
            payloadHash: "a".repeat(64),
            payload: '{"ok":true}',
            status: "accepted",
          },
        },
      },
    });
    return { manufacturer, series, model, sku };
  }

  async function findingsById() {
    const findings = await runContractChecks(prisma);
    return new Map(findings.map((f) => [f.id, f]));
  }

  it("passes on a catalog that satisfies every contract", async () => {
    await seedHealthyCatalog();
    const findings = await findingsById();
    for (const [id, finding] of findings) {
      expect(`${id}: ${finding.count}`).toBe(`${id}: 0`);
    }
  });

  it("passes on an empty catalog", async () => {
    // A check that fails on an empty database cannot be used while the
    // catalog is being built.
    const findings = await findingsById();
    for (const finding of findings.values()) {
      expect(finding.count).toBe(0);
    }
  });

  it("catches a configuration with no source", async () => {
    const { model } = await seedHealthyCatalog();
    await prisma.sku.create({
      data: {
        modelId: model.id,
        skuCode: "TEST-002",
        provenance: "unverified",
        cpuBrand: "Test",
        cpuModel: "Test CPU",
        ramGb: 8,
        os: "TestOS",
      },
    });
    const findings = await findingsById();
    expect(findings.get("provenance/no-source")?.count).toBe(1);
  });

  it("catches a provenance tier the product does not know about", async () => {
    const { model } = await seedHealthyCatalog();
    await prisma.sku.create({
      data: {
        modelId: model.id,
        skuCode: "TEST-003",
        provenance: "probably-fine",
        cpuBrand: "Test",
        cpuModel: "Test CPU",
        ramGb: 8,
        os: "TestOS",
      },
    });
    const findings = await findingsById();
    expect(findings.get("provenance/unknown-tier")?.count).toBe(1);
  });

  it("catches a certified configuration with nothing to check it against", async () => {
    const { model } = await seedHealthyCatalog();
    await prisma.sku.create({
      data: {
        modelId: model.id,
        skuCode: "TEST-004",
        provenance: "certified",
        cpuBrand: "Test",
        cpuModel: "Test CPU",
        ramGb: 8,
        os: "TestOS",
        sources: {
          create: {
            source: "An uncited source",
            kind: "certified",
            sourceUrl: null,
            confidence: 1,
          },
        },
      },
    });
    const findings = await findingsById();
    expect(findings.get("provenance/certified-without-citation")?.count).toBe(1);
  });

  it("catches a configuration whose tier understates its own sources", async () => {
    const { model } = await seedHealthyCatalog();
    await prisma.sku.create({
      data: {
        modelId: model.id,
        skuCode: "TEST-005",
        provenance: "unverified",
        cpuBrand: "Test",
        cpuModel: "Test CPU",
        ramGb: 8,
        os: "TestOS",
        sources: {
          create: {
            source: "A cited source",
            kind: "certified",
            sourceUrl: "https://example.invalid/record/2",
            confidence: 1,
          },
        },
      },
    });
    const findings = await findingsById();
    expect(findings.get("provenance/tier-understated")?.count).toBe(1);
  });

  it("catches a price published without a citation from an unknown source", async () => {
    const { sku } = await seedHealthyCatalog();
    await prisma.priceObservation.create({
      data: {
        skuId: sku.id,
        region: "US",
        currency: "USD",
        price: 999,
        sourceName: "A source with no URL",
        kind: "retail",
      },
    });
    const findings = await findingsById();
    expect(findings.get("provenance/uncited-price")?.count).toBe(1);
  });

  it("allows the reference dataset to publish an uncited price", async () => {
    const { sku } = await seedHealthyCatalog();
    await prisma.priceObservation.create({
      data: {
        skuId: sku.id,
        region: "US",
        currency: "USD",
        price: 999,
        sourceName: "Veridian reference dataset",
        kind: "manufacturer",
      },
    });
    const findings = await findingsById();
    expect(findings.get("provenance/uncited-price")?.count).toBe(0);
  });

  it("catches a price whose evidence class is unknown", async () => {
    const { sku } = await seedHealthyCatalog();
    await prisma.priceObservation.create({
      data: {
        skuId: sku.id,
        region: "US",
        currency: "USD",
        price: 999,
        sourceName: "A source",
        sourceUrl: "https://example.invalid/p/1",
        kind: "vibes",
      },
    });
    const findings = await findingsById();
    expect(findings.get("price/unknown-evidence")?.count).toBe(1);
  });

  it("catches a displayed price with no observation behind it", async () => {
    const { sku } = await seedHealthyCatalog();
    await prisma.skuRegionalPricing.create({
      data: {
        skuId: sku.id,
        region: "US",
        currency: "USD",
        msrp: 1234,
        available: true,
      },
    });
    const findings = await findingsById();
    expect(findings.get("price/snapshot-without-observation")?.count).toBe(1);
  });

  it("accepts a displayed price that an observation backs", async () => {
    const { sku } = await seedHealthyCatalog();
    await prisma.priceObservation.create({
      data: {
        skuId: sku.id,
        region: "US",
        currency: "USD",
        price: 1234,
        sourceName: "A cited source",
        sourceUrl: "https://example.invalid/p/2",
        kind: "retail",
      },
    });
    await prisma.skuRegionalPricing.create({
      data: {
        skuId: sku.id,
        region: "US",
        currency: "USD",
        msrp: 1234,
        available: true,
      },
    });
    const findings = await findingsById();
    expect(findings.get("price/snapshot-without-observation")?.count).toBe(0);
  });

  it("catches a rejected observation kept without its reason", async () => {
    await prisma.rawObservation.create({
      data: {
        source: "A source",
        payloadHash: "b".repeat(64),
        payload: "{}",
        status: "rejected",
        errors: null,
      },
    });
    const findings = await findingsById();
    expect(findings.get("observation/rejected-without-reason")?.count).toBe(1);
  });

  it("catches an accepted observation kept without its payload", async () => {
    await prisma.rawObservation.create({
      data: {
        source: "A source",
        payloadHash: "not-a-hash",
        payload: "",
        status: "accepted",
      },
    });
    const findings = await findingsById();
    expect(findings.get("observation/accepted-without-payload")?.count).toBe(1);
  });

  it("does not let a component link point at nothing", async () => {
    const { sku } = await seedHealthyCatalog();
    // The database refuses the dangling row, and the contract check is the
    // second line of defence for a database where the constraint is not
    // enforced. Both are asserted.
    await expect(
      prisma.skuComponent.create({
        data: {
          skuId: sku.id,
          componentId: "does-not-exist",
          role: "primary",
          source: "A source",
          confidence: 1,
        },
      })
    ).rejects.toThrow();

    const findings = await findingsById();
    expect(findings.get("graph/dangling-component-link")?.count).toBe(0);
  });

  it("gives every check a distinct id", () => {
    const ids = CONTRACT_CHECKS.map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports a finding for every check, even when it finds nothing", async () => {
    const findings = await runContractChecks(prisma);
    expect(findings.length).toBe(CONTRACT_CHECKS.length);
    for (const finding of findings) {
      expect(finding.id).toBeTruthy();
      expect(finding.message).toBeTruthy();
      expect(Array.isArray(finding.samples)).toBe(true);
    }
  });
});
