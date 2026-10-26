import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { runExtraChecks, type Finding } from "@/lib/audit/extra-checks";

/**
 * The extra audit runs against a throwaway SQLite database, the same way the
 * ingestion suite does: the schema is pushed onto a fresh file with the
 * Prisma CLI, the catalog is seeded from the test itself, and the file is
 * thrown away afterwards. Nothing here touches the real catalog.
 */

let prisma: PrismaClient;
let tempDir: string;

async function resetCatalog(client: PrismaClient) {
  await client.$transaction([
    client.contribution.deleteMany(),
    client.vote.deleteMany(),
    client.alert.deleteMany(),
    client.priceHistory.deleteMany(),
    client.priceObservation.deleteMany(),
    client.retailerListing.deleteMany(),
    client.skuPort.deleteMany(),
    client.skuComponent.deleteMany(),
    client.skuSource.deleteMany(),
    client.certifiedSkuSpec.deleteMany(),
    client.rawObservation.deleteMany(),
    client.skuRegionalPricing.deleteMany(),
    client.sku.deleteMany(),
    client.componentAlias.deleteMany(),
    client.componentSpec.deleteMany(),
    client.component.deleteMany(),
    client.model.deleteMany(),
    client.series.deleteMany(),
    client.manufacturer.deleteMany(),
    client.category.deleteMany(),
  ]);
}

/** A catalog that passes every extra check. */
async function seedHealthyCatalog(client: PrismaClient) {
  const manufacturer = await client.manufacturer.create({
    data: { name: "Acme", slug: "acme" },
  });
  const series = await client.series.create({
    data: { manufacturerId: manufacturer.id, name: "Acme Pro", slug: "acme-pro" },
  });
  const model = await client.model.create({
    data: {
      seriesId: series.id,
      name: "Acme Pro 14",
      slug: "acme-pro-14",
      launchDate: new Date("2024-01-15T00:00:00.000Z"),
    },
  });
  const sku = await client.sku.create({
    data: {
      modelId: model.id,
      skuCode: "ACME-14-1",
      cpuBrand: "Intel",
      cpuModel: "Core i7-1365U",
      cpuCores: 12,
      ramGb: 16,
      ramType: "DDR5",
      ramSoldered: false,
      displaySizeIn: 14,
      displayRefreshHz: 60,
      batteryWh: 65,
      weightKg: 1.4,
      os: "Windows 11",
      provenance: "certified",
      launchDate: new Date("2024-01-15T00:00:00.000Z"),
    },
  });
  await client.skuSource.create({
    data: {
      skuId: sku.id,
      source: "ENERGY STAR Certified Computers V9.0",
      kind: "certified",
      sourceUrl: "https://data.energystar.gov/",
    },
  });
  const component = await client.component.create({
    data: { kind: "cpu", canonicalName: "Intel Core i7-1365U", slug: "cpu-intel-core-i7-1365u" },
  });
  await client.skuComponent.create({
    data: { skuId: sku.id, componentId: component.id, role: "primary" },
  });
  return { manufacturer, series, model, sku, component };
}

async function runCheck(client: PrismaClient, check: string): Promise<Finding> {
  const findings = await runExtraChecks(client);
  const finding = findings.find((entry) => entry.check === check);
  if (!finding) throw new Error(`the check ${check} reported nothing at all`);
  return finding;
}

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "veridian-audit-extra-"));
  const dbPath = path.join(tempDir, "test.db");
  process.env.DATABASE_URL = `file:${dbPath}`;
  execSync(`npx prisma db push --skip-generate --accept-data-loss --force-reset`, {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env },
    stdio: "ignore",
  });
  const { PrismaClient: Client } = await import("@prisma/client");
  prisma = new Client();
});

afterAll(async () => {
  await prisma.$disconnect();
  delete process.env.DATABASE_URL;
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetCatalog(prisma);
});

describe("Extended audit — an empty catalog", () => {
  it("runs every check and reports zero for each of them", async () => {
    const findings = await runExtraChecks(prisma);
    expect(findings.length).toBeGreaterThanOrEqual(10);
    for (const finding of findings) {
      expect(finding.count).toBe(0);
      expect(finding.detail.length).toBeGreaterThan(0);
    }
    expect(findings.some((finding) => finding.detail.includes("could not be evaluated"))).toBe(false);
  });
});

describe("Extended audit — identity/duplicate-model-name", () => {
  it("finds nothing when each model in a series has its own name", async () => {
    await seedHealthyCatalog(prisma);
    const finding = await runCheck(prisma, "identity/duplicate-model-name");
    expect(finding.count).toBe(0);
  });

  it("reports two models in one series that share a name", async () => {
    const { series } = await seedHealthyCatalog(prisma);
    await prisma.model.create({
      data: { seriesId: series.id, name: "Acme Pro 14", slug: "acme-pro-14-again" },
    });
    const finding = await runCheck(prisma, "identity/duplicate-model-name");
    expect(finding.count).toBe(2);
    expect(finding.samples.join(" ")).toContain("acme-pro-14-again");
  });
});

describe("Extended audit — integrity/impossible-weight", () => {
  it("finds nothing for a weight that matches the screen it is sold with", async () => {
    await seedHealthyCatalog(prisma);
    const finding = await runCheck(prisma, "integrity/impossible-weight");
    expect(finding.count).toBe(0);
  });

  it("reports a weight no laptop can weigh", async () => {
    const { sku } = await seedHealthyCatalog(prisma);
    await prisma.sku.update({ where: { id: sku.id }, data: { weightKg: 0.05 } });
    const finding = await runCheck(prisma, "integrity/impossible-weight");
    expect(finding.count).toBe(1);
    expect(finding.samples.join(" ")).toContain("ACME-14-1");
  });

  it("reports a weight that contradicts the reported screen size", async () => {
    const { sku } = await seedHealthyCatalog(prisma);
    // A 3.5 kg machine is plausible for a workstation, not for a 14" laptop.
    await prisma.sku.update({ where: { id: sku.id }, data: { weightKg: 3.5, displaySizeIn: 14 } });
    const finding = await runCheck(prisma, "integrity/impossible-weight");
    expect(finding.count).toBe(1);
  });
});

describe("Extended audit — integrity/impossible-display", () => {
  it("finds nothing for a real display", async () => {
    await seedHealthyCatalog(prisma);
    const finding = await runCheck(prisma, "integrity/impossible-display");
    expect(finding.count).toBe(0);
  });

  it("reports an impossible diagonal, refresh rate and battery together", async () => {
    const { sku } = await seedHealthyCatalog(prisma);
    await prisma.sku.update({
      where: { id: sku.id },
      data: { displaySizeIn: 30, displayRefreshHz: 200, batteryWh: 500 },
    });
    const finding = await runCheck(prisma, "integrity/impossible-display");
    expect(finding.count).toBe(1);
    expect(finding.samples.join(" ")).toContain("30 in display");
  });

  it("does not flag a display size that no panel ships with twice", async () => {
    const { sku } = await seedHealthyCatalog(prisma);
    await prisma.sku.update({ where: { id: sku.id }, data: { displayRefreshHz: 120 } });
    const finding = await runCheck(prisma, "integrity/impossible-display");
    expect(finding.count).toBe(0);
  });
});

describe("Extended audit — consistency/ram-type-capacity", () => {
  it("finds nothing for a capacity and a soldered flag that agree", async () => {
    await seedHealthyCatalog(prisma);
    const finding = await runCheck(prisma, "consistency/ram-type-capacity");
    expect(finding.count).toBe(0);
  });

  it("reports a capacity no laptop ships", async () => {
    const { sku } = await seedHealthyCatalog(prisma);
    await prisma.sku.update({ where: { id: sku.id }, data: { ramGb: 512 } });
    const finding = await runCheck(prisma, "consistency/ram-type-capacity");
    expect(finding.count).toBe(1);
    expect(finding.samples.join(" ")).toContain("512 GB");
  });

  it("reports a replaceable flag on soldered-only memory", async () => {
    const { sku } = await seedHealthyCatalog(prisma);
    await prisma.sku.update({
      where: { id: sku.id },
      data: { ramType: "LPDDR5X", ramSoldered: false, ramGb: 32 },
    });
    const finding = await runCheck(prisma, "consistency/ram-type-capacity");
    expect(finding.count).toBe(1);
    expect(finding.samples.join(" ")).toContain("soldered memory");
  });
});

describe("Extended audit — coverage/missing-launch-date", () => {
  it("finds nothing when the product is placed in time", async () => {
    await seedHealthyCatalog(prisma);
    const finding = await runCheck(prisma, "coverage/missing-launch-date");
    expect(finding.count).toBe(0);
  });

  it("reports a product with no launch date anywhere", async () => {
    const { model, sku } = await seedHealthyCatalog(prisma);
    await prisma.model.update({ where: { id: model.id }, data: { launchDate: null } });
    await prisma.sku.update({ where: { id: sku.id }, data: { launchDate: null } });
    const finding = await runCheck(prisma, "coverage/missing-launch-date");
    expect(finding.count).toBe(1);
    expect(finding.samples.join(" ")).toContain("Acme Pro 14");
  });

  it("accepts a product whose configurations know the date even when the model does not", async () => {
    const { model } = await seedHealthyCatalog(prisma);
    await prisma.model.update({ where: { id: model.id }, data: { launchDate: null } });
    const finding = await runCheck(prisma, "coverage/missing-launch-date");
    expect(finding.count).toBe(0);
  });
});

describe("Extended audit — coverage/placeholder-identity", () => {
  it("finds nothing when every series and model carries a real name", async () => {
    await seedHealthyCatalog(prisma);
    const finding = await runCheck(prisma, "coverage/placeholder-identity");
    expect(finding.count).toBe(0);
  });

  it("reports a name made of nothing but punctuation", async () => {
    const { manufacturer } = await seedHealthyCatalog(prisma);
    const series = await prisma.series.create({
      data: { manufacturerId: manufacturer.id, name: '"-" "/"', slug: "" },
    });
    await prisma.model.create({
      data: { seriesId: series.id, name: '"-" "/"', slug: "" },
    });
    const finding = await runCheck(prisma, "coverage/placeholder-identity");
    expect(finding.count).toBe(2);
    expect(finding.samples.join(" ")).toContain("carries no product name");
  });
});

describe("Extended audit — coverage/orphan-component", () => {
  it("finds nothing when every component is linked to a configuration", async () => {
    await seedHealthyCatalog(prisma);
    const finding = await runCheck(prisma, "coverage/orphan-component");
    expect(finding.count).toBe(0);
  });

  it("reports a component no configuration links to", async () => {
    await seedHealthyCatalog(prisma);
    await prisma.component.create({
      data: { kind: "storage", canonicalName: "Unlinked SSD", slug: "storage-unlinked-ssd" },
    });
    const finding = await runCheck(prisma, "coverage/orphan-component");
    expect(finding.count).toBe(1);
    expect(finding.samples.join(" ")).toContain("Unlinked SSD");
  });
});

describe("Extended audit — graph/duplicate-component", () => {
  it("finds nothing when every component is filed once", async () => {
    await seedHealthyCatalog(prisma);
    const finding = await runCheck(prisma, "graph/duplicate-component");
    expect(finding.count).toBe(0);
  });

  it("reports two components whose names differ only in case and whitespace", async () => {
    await seedHealthyCatalog(prisma);
    await prisma.component.create({
      data: { kind: "cpu", canonicalName: "intel core  i7-1365u", slug: "cpu-intel-core-i7-1365u-copy" },
    });
    const finding = await runCheck(prisma, "graph/duplicate-component");
    expect(finding.count).toBe(1);
    expect(finding.samples.join(" ")).toContain("cpu-intel-core-i7-1365u-copy");
  });
});

describe("Extended audit — price/currency-region-mismatch", () => {
  it("finds nothing when the currency matches the region", async () => {
    const { sku } = await seedHealthyCatalog(prisma);
    await prisma.priceObservation.create({
      data: { skuId: sku.id, region: "US", currency: "USD", price: 1299, kind: "retail" },
    });
    const finding = await runCheck(prisma, "price/currency-region-mismatch");
    expect(finding.count).toBe(0);
  });

  it("reports a price recorded in the wrong currency for its region", async () => {
    const { sku } = await seedHealthyCatalog(prisma);
    await prisma.priceObservation.create({
      data: { skuId: sku.id, region: "US", currency: "INR", price: 74990, kind: "retail" },
    });
    const finding = await runCheck(prisma, "price/currency-region-mismatch");
    expect(finding.count).toBe(1);
    expect(finding.samples.join(" ")).toContain("USD expected");
  });

  it("reports a regional pricing row whose currency contradicts its region", async () => {
    const { sku } = await seedHealthyCatalog(prisma);
    await prisma.skuRegionalPricing.create({
      data: { skuId: sku.id, region: "IN", currency: "USD", msrp: 999 },
    });
    const finding = await runCheck(prisma, "price/currency-region-mismatch");
    expect(finding.count).toBe(1);
  });
});

describe("Extended audit — provenance/source-without-kind", () => {
  it("finds nothing when every source carries a known tier that matches the row", async () => {
    await seedHealthyCatalog(prisma);
    const finding = await runCheck(prisma, "provenance/source-without-kind");
    expect(finding.count).toBe(0);
  });

  it("reports a source whose evidence class is not a tier", async () => {
    const { sku } = await seedHealthyCatalog(prisma);
    await prisma.skuSource.create({
      data: { skuId: sku.id, source: "A blog post", kind: "blog" },
    });
    const finding = await runCheck(prisma, "provenance/source-without-kind");
    expect(finding.count).toBe(1);
  });

  it("reports a row that claims a tier none of its sources supports", async () => {
    const { sku } = await seedHealthyCatalog(prisma);
    await prisma.skuSource.updateMany({ where: { skuId: sku.id }, data: { kind: "retailer" } });
    const finding = await runCheck(prisma, "provenance/source-without-kind");
    // Two issues: the source class is not a tier the catalog knows, and the row
    // still claims the certified tier with no certified source behind it.
    expect(finding.count).toBe(2);
    expect(finding.detail).toContain("configurations whose provenance contradicts");
    expect(finding.samples.join(" ")).toContain("certified");
  });
});

describe("Extended audit — catalog/unreachable", () => {
  it("finds nothing when every visible configuration resolves to a manufacturer", async () => {
    await seedHealthyCatalog(prisma);
    const finding = await runCheck(prisma, "catalog/unreachable");
    expect(finding.count).toBe(0);
  });

  it("does not count a configuration that is not visible in the catalog", async () => {
    const { sku } = await seedHealthyCatalog(prisma);
    await prisma.sku.update({ where: { id: sku.id }, data: { catalogVisible: false } });
    const finding = await runCheck(prisma, "catalog/unreachable");
    expect(finding.count).toBe(0);
  });
});
