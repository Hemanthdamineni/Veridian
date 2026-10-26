import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertSsrf } from "@/lib/energy-star/adapter";
import { validateEnergyStarRecord } from "@/lib/energy-star/validate";
import {
  EnergyStarExpansionAdapter,
  EXPANDED_LAPTOP_PRODUCT_TYPES,
  NEW_LAPTOP_PRODUCT_TYPES,
  runExpansion,
  validateExpandedEnergyStarRecord,
  type ExpansionReport,
} from "@/lib/energy-star/expansion";
import {
  ALLOWED_SOURCE_HOSTS,
  assertRegisteredSourceUrl,
  ENERGY_STAR_COMPUTERS_SOURCE,
  ENERGY_STAR_DISPLAYS_SOURCE,
  ENERGY_STAR_MODEL_INDEX_SOURCE,
  getSource,
  REGISTERED_SOURCES,
} from "@/lib/energy-star/sources";
import { ingestReport } from "@/lib/energy-star/ingest";

// =============================================================================
// FIXTURES - shaped exactly like the EPA Socrata rows, with the values the
// live dataset was measured to carry.
// =============================================================================

function computerRow(overrides: Record<string, unknown> = {}) {
  return {
    pd_id: "4519625",
    energy_star_partner: "Dell Inc.",
    brand_name: "DELL",
    model_name: "P143F",
    model_number: "P143F",
    additional_model_information: "P143F,Dell Pro Precision 7 16 PW716260",
    type: "Mobile Workstation",
    product_marketed_as_a_workstation: "No",
    installed_npu: "No",
    operating_system_name: "Windows 11",
    processor_brand: "Intel",
    processor_name: "Core Ultra 7 265H",
    physical_cpu_cores_count: "16",
    cpu_packages_count: "1",
    cpu_base_clock_speed_ghz: "2.2",
    cpu_maximum_clock_speed_ghz: "5.5",
    system_memory_ram_gb: "32.0",
    number_of_installed_storage_drives: "1",
    integrated_display_diagonal_screen_size_in: "16.00",
    integrated_display_resolution_megapixels: "3.84",
    integrated_display_viewable_screen_area_sq_in: "101.00",
    total_battery_capacity_watt_hours: "99.0",
    touch_screen: "No",
    storage_technology: "SSD",
    date_available_on_market: "2026-01-06T00:00:00.000",
    date_certified: "2026-01-06T00:00:00.000",
    markets: "United States, Canada",
    energy_star_model_identifier: "ES_29573_Dell Pro Precision 7 16 P_01062026105759_8020765",
    ...overrides,
  };
}

function notebookRow(overrides: Record<string, unknown> = {}) {
  return computerRow({
    pd_id: "4717594",
    type: "Notebook",
    brand_name: "ASUS",
    model_name: "CX9406CAA",
    model_number: "CX9406CAA",
    additional_model_information: "CX9406CAA",
    energy_star_model_identifier: "ES_41973_CX9406CAA_01062026105759_8020765",
    ...overrides,
  });
}

/** A Socrata-shaped row from the Model Index: no specifications at all. */
function modelIndexRow(overrides: Record<string, unknown> = {}) {
  return {
    pd_id: "3998238",
    energy_star_partner: "Lenovo Group Limited",
    product_category: "Computers",
    product_type: "Notebook",
    brand_name: "Lenovo",
    model_name: "ThinkPad T14 Gen 5",
    model_number: "21ML",
    upc: "197498975665",
    date_available_on_market: "2025-04-17T00:00:00.000",
    date_certified: "2025-04-22T00:00:00.000",
    markets: "United States, Canada",
    energy_star_model_identifier: "ES_1037540_21ML_04172025154450_8007970",
    ...overrides,
  };
}

/**
 * A stub Socrata endpoint.
 *
 * `rowsByType` answers a `type`/`product_type` filter with the rows that
 * the live dataset was measured to carry for that product type.
 */
function stubSocrata(
  rowsByType: Record<string, unknown[]>,
  log: string[] = []
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    log.push(url.toString());
    const typeField = url.searchParams.get("type") ?? url.searchParams.get("product_type");
    const rows = typeField ? (rowsByType[typeField] ?? []) : [];
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

async function withTempDb(fn: (prisma: PrismaClient) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "veridian-es-expansion-test-"));
  const dbPath = path.join(dir, "test.db");
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${dbPath}`;
  const prisma = new PrismaClient();
  try {
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

function toIngestionReport(report: ExpansionReport) {
  return {
    source: report.source,
    adapterVersion: "2.0.0",
    observedAt: new Date().toISOString(),
    requested: report.recordsFetched,
    pages: report.pages,
    accepted: report.accepted,
    rejected: report.rejected,
    rejectedRecords: report.rejectedRecords,
    records: report.records,
    rawPayloads: report.rawPayloads,
  };
}

// =============================================================================
// A SOURCE THAT YIELDS LAPTOP ROWS PRODUCES CANONICAL CONFIGURATIONS
// =============================================================================

describe("ENERGY STAR expansion - a source with laptop rows produces configurations", () => {
  it("turns a laptop row into a canonical configuration", async () => {
    const fetchImpl = stubSocrata({
      Notebook: [notebookRow()],
      "Mobile Workstation": [computerRow()],
    });
    const report = await runExpansion(
      ENERGY_STAR_COMPUTERS_SOURCE,
      { types: ["Notebook", "Mobile Workstation"] },
      fetchImpl
    );

    expect(report.recordsFetched).toBe(2);
    expect(report.accepted).toBe(2);
    expect(report.rejected).toBe(0);
    expect(report.canonicalSkuCodes).toHaveLength(2);
    // The canonical code is the part number plus the configuration hash.
    expect(report.canonicalSkuCodes[0]).toMatch(/^[A-Z0-9-]+-[0-9a-f]{8}$/);
    // The source-reported product type is preserved.
    const mobile = report.records.find((record) => record.productType === "Mobile Workstation");
    expect(mobile).toBeDefined();
    expect(mobile?.skuCode).toBe(report.canonicalSkuCodes.find((code) => code.startsWith("P143F")));
    expect(mobile?.certifiedSpecs.energyStarId).toBe(
      "ES_29573_Dell Pro Precision 7 16 P_01062026105759_8020765"
    );
    expect(mobile?.certifiedSpecs.ramGb).toBe(32);
    expect(mobile?.certifiedSpecs.batteryWh).toBe(99);
  });

  it("adds the new product type on top of the base product types", async () => {
    const fetchImpl = stubSocrata({
      Notebook: [notebookRow()],
      "Two-In-One Notebook": [notebookRow({ pd_id: "2", model_number: "21LW" })],
      "Ruggedized Notebook": [notebookRow({ pd_id: "3", model_number: "21LS" })],
      "Mobile Workstation": [computerRow()],
    });
    const report = await runExpansion(ENERGY_STAR_COMPUTERS_SOURCE, {}, fetchImpl);

    expect(report.productTypes).toEqual([...EXPANDED_LAPTOP_PRODUCT_TYPES]);
    expect(report.accepted).toBe(4);
    // Three configurations come from the base product types, one is new.
    expect(report.baseSkuCodes).toHaveLength(3);
    expect(report.canonicalSkuCodes).toHaveLength(4);
    const added = report.canonicalSkuCodes.filter(
      (code) => !report.baseSkuCodes.includes(code)
    );
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/^P143F-/);
    expect(NEW_LAPTOP_PRODUCT_TYPES).toEqual(["Mobile Workstation"]);
  });

  it("writes the new configurations through the audited path", async () => {
    const fetchImpl = stubSocrata({
      Notebook: [notebookRow()],
      "Mobile Workstation": [computerRow()],
    });
    const report = await runExpansion(
      ENERGY_STAR_COMPUTERS_SOURCE,
      { types: ["Notebook", "Mobile Workstation"] },
      fetchImpl
    );

    await withTempDb(async (prisma) => {
      const result = await ingestReport(prisma, toIngestionReport(report));
      expect(result.created).toBe(2);

      const mobile = await prisma.sku.findUnique({
        where: { skuCode: report.records.find((r) => r.productType === "Mobile Workstation")!.skuCode },
        include: { certifiedSpecs: true, sources: true, observations: true },
      });
      expect(mobile).not.toBeNull();
      // Provenance is asserted by the write path, never inferred.
      expect(mobile?.provenance).toBe("certified");
      expect(mobile?.productType).toBe("Mobile Workstation");
      expect(mobile?.catalogVisible).toBe(true);
      expect(mobile?.mpn).toBe("P143F");
      expect(mobile?.ramGb).toBe(32);
      expect(mobile?.certifiedSpecs).toHaveLength(1);
      expect(mobile?.certifiedSpecs[0].energyStarId).toBe(
        "ES_29573_Dell Pro Precision 7 16 P_01062026105759_8020765"
      );
      // Every configuration carries an explicit provenance record.
      expect(mobile?.sources).toHaveLength(1);
      expect(mobile?.sources[0].kind).toBe("certified");
      expect(mobile?.sources[0].sourceUrl).toContain("data.energystar.gov");
      expect(mobile?.observations[0].status).toBe("accepted");
    });
  });
});

// =============================================================================
// A SOURCE THAT YIELDS NO LAPTOP ROWS PRODUCES ZERO CONFIGURATIONS
// =============================================================================

describe("ENERGY STAR expansion - a source with no laptop rows produces nothing", () => {
  it("reports zero for a source with no laptop product type", async () => {
    const log: string[] = [];
    const fetchImpl = stubSocrata({}, log);
    const report = await runExpansion(ENERGY_STAR_DISPLAYS_SOURCE, {}, fetchImpl);

    expect(report.recordsFetched).toBe(0);
    expect(report.accepted).toBe(0);
    expect(report.rejected).toBe(0);
    expect(report.canonicalSkuCodes).toEqual([]);
    // The source is not even asked for laptop rows.
    expect(log).toEqual([]);
    // And the reason is stated, not implied.
    expect(report.note).toContain("no laptop product type");
    expect(ENERGY_STAR_DISPLAYS_SOURCE.laptopProductTypes).toEqual([]);
  });

  it("reports zero configurations for a source that has laptop rows but no specifications", async () => {
    const fetchImpl = stubSocrata({ Notebook: [modelIndexRow()] });
    const report = await runExpansion(ENERGY_STAR_MODEL_INDEX_SOURCE, {}, fetchImpl);

    // The rows are read...
    expect(report.recordsFetched).toBe(1);
    // ...but none of them can become a configuration.
    expect(report.accepted).toBe(0);
    expect(report.rejected).toBe(1);
    expect(report.canonicalSkuCodes).toEqual([]);
    expect(report.rejectedRecords[0].errors.length).toBeGreaterThan(0);
  });

  it("never writes a configuration for a source with no laptop rows", async () => {
    const fetchImpl = stubSocrata({});
    const report = await runExpansion(ENERGY_STAR_DISPLAYS_SOURCE, {}, fetchImpl);
    await withTempDb(async (prisma) => {
      const result = await ingestReport(prisma, toIngestionReport(report));
      expect(result.accepted).toBe(0);
      expect(result.created).toBe(0);
      expect(await prisma.sku.count()).toBe(0);
    });
  });
});

// =============================================================================
// THE SSRF GUARD STILL REJECTS A NON-ALLOWLISTED HOST
// =============================================================================

describe("ENERGY STAR expansion - the network guard", () => {
  it("rejects a host that is not on the pinned allowlist", () => {
    expect(() =>
      assertRegisteredSourceUrl(
        ENERGY_STAR_COMPUTERS_SOURCE,
        "https://evil.example.com/resource/rxdj-2c88.json"
      )
    ).toThrow(/not the registered host/);
    expect(() =>
      assertRegisteredSourceUrl(
        ENERGY_STAR_COMPUTERS_SOURCE,
        "https://data.energystar.gov.evil.example/resource/rxdj-2c88.json"
      )
    ).toThrow(/not the registered host/);
  });

  it("rejects a registered host on an unregistered path", () => {
    expect(() =>
      assertRegisteredSourceUrl(
        ENERGY_STAR_COMPUTERS_SOURCE,
        "https://data.energystar.gov/api/views/rxdj-2c88"
      )
    ).toThrow(/not the registered path/);
  });

  it("rejects plain HTTP and loopback targets", () => {
    expect(() => assertSsrf("http://data.energystar.gov/resource/rxdj-2c88.json")).toThrow(/HTTPS/);
    expect(() => assertSsrf("https://localhost/resource/rxdj-2c88.json")).toThrow(/loopback/);
    expect(() => assertSsrf("https://127.0.0.1/resource/rxdj-2c88.json")).toThrow(/loopback/);
    expect(() => assertSsrf("https://192.168.1.1/resource/rxdj-2c88.json")).toThrow(/loopback/);
  });

  it("never calls the fetch implementation with an unallowlisted URL", async () => {
    const log: string[] = [];
    const adapter = new EnergyStarExpansionAdapter(
      ENERGY_STAR_COMPUTERS_SOURCE,
      stubSocrata({ Notebook: [notebookRow()] }, log)
    );
    await adapter.fetchPage("Notebook", 0, 10);
    expect(log).toHaveLength(1);
    const url = new URL(log[0]);
    expect(url.hostname).toBe("data.energystar.gov");
    expect(ALLOWED_SOURCE_HOSTS).toContain(url.hostname);
    expect(url.pathname).toBe("/resource/rxdj-2c88.json");
  });

  it("refuses to build a URL for an unregistered product type", () => {
    const adapter = new EnergyStarExpansionAdapter(
      ENERGY_STAR_COMPUTERS_SOURCE,
      stubSocrata({})
    );
    expect(() => adapter.buildUrl("Desktop", 0, 10)).toThrow(/Unregistered product type/);
    expect(() => adapter.buildUrl("Notebook", -1, 10)).toThrow(/offset/);
    expect(() => adapter.buildUrl("Notebook", 0, 1001)).toThrow(/limit/);
  });

  it("refuses to fetch a source that is not registered", () => {
    expect(() => getSource("not-a-dataset")).toThrow(/Unregistered ENERGY STAR source/);
  });
});

// =============================================================================
// THE INGESTION IS IDEMPOTENT
// =============================================================================

describe("ENERGY STAR expansion - the ingestion is idempotent", () => {
  it("creates nothing on a second run and changes no row", async () => {
    const fetchImpl = stubSocrata({
      Notebook: [notebookRow()],
      "Mobile Workstation": [computerRow()],
    });
    const report = await runExpansion(
      ENERGY_STAR_COMPUTERS_SOURCE,
      { types: ["Notebook", "Mobile Workstation"] },
      fetchImpl
    );

    await withTempDb(async (prisma) => {
      const first = await ingestReport(prisma, toIngestionReport(report));
      expect(first.created).toBe(2);
      expect(first.merged).toBe(0);
      const skus = await prisma.sku.count();
      const observations = await prisma.rawObservation.count();
      const specs = await prisma.certifiedSkuSpec.count();

      const second = await ingestReport(prisma, toIngestionReport(report));
      expect(second.created).toBe(0);
      expect(second.merged).toBe(0);
      expect(second.unchanged).toBe(2);
      expect(await prisma.sku.count()).toBe(skus);
      expect(await prisma.rawObservation.count()).toBe(observations);
      expect(await prisma.certifiedSkuSpec.count()).toBe(specs);
    });
  });

  it("merges a re-certification of the same configuration instead of duplicating it", async () => {
    const fetchImpl = stubSocrata({
      "Mobile Workstation": [
        computerRow(),
        computerRow({
          pd_id: "4519626",
          date_certified: "2026-02-06T00:00:00.000",
          energy_star_model_identifier:
            "ES_29573_Dell Pro Precision 7 16 P_02062026105759_8020766",
        }),
      ],
    });
    const report = await runExpansion(
      ENERGY_STAR_COMPUTERS_SOURCE,
      { types: ["Mobile Workstation"] },
      fetchImpl
    );
    expect(report.accepted).toBe(2);
    expect(report.canonicalSkuCodes).toHaveLength(1);

    await withTempDb(async (prisma) => {
      const result = await ingestReport(prisma, toIngestionReport(report));
      expect(result.created).toBe(1);
      expect(result.merged).toBe(1);
      expect(await prisma.sku.count()).toBe(1);
      // Both certification events are kept as immutable observations.
      expect(await prisma.rawObservation.count({ where: { status: "accepted" } })).toBe(2);
    });
  });
});

// =============================================================================
// THE EXPANDED VALIDATOR IS NOT A WEAKER VALIDATOR
// =============================================================================

describe("ENERGY STAR expansion - the validator is the base validator", () => {
  /**
   * The two validators stamp their own observation time, so that one
   * field is normalised away before the results are compared. Everything
   * else must be identical, field for field.
   */
  function withoutObservationTime(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(withoutObservationTime);
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "observedAt")
        .map(([key, entry]) => [key, withoutObservationTime(entry)]);
      return Object.fromEntries(entries);
    }
    return value;
  }

  it("behaves exactly like the base validator for the base product types", () => {
    for (const type of ["Notebook", "Two-In-One Notebook", "Ruggedized Notebook"]) {
      const row = notebookRow({ type });
      expect(withoutObservationTime(validateExpandedEnergyStarRecord(row))).toEqual(
        withoutObservationTime(validateEnergyStarRecord(row))
      );
    }
  });

  it("rejects the same rows for the same reasons on the base product types", () => {
    const bad = notebookRow({ system_memory_ram_gb: "0" });
    expect(validateExpandedEnergyStarRecord(bad).errors).toEqual(
      validateEnergyStarRecord(bad).errors
    );
    const wrongType = notebookRow({ type: "Desktop" });
    expect(validateExpandedEnergyStarRecord(wrongType).errors).toEqual(
      validateEnergyStarRecord(wrongType).errors
    );
  });

  it("rejects a non-laptop product type with the base validator's own reason", () => {
    const row = notebookRow({ type: "Desktop" });
    const result = validateExpandedEnergyStarRecord(row);
    expect(result.record).toBeNull();
    expect(result.errors).toContain("type 'Desktop' is not a laptop product type");
  });

  it("rejects a bad specification on a new product type exactly as the base validator does", () => {
    const row = computerRow({ system_memory_ram_gb: "0" });
    const result = validateExpandedEnergyStarRecord(row);
    expect(result.record).toBeNull();
    expect(result.errors.some((error) => error.includes("system_memory_ram_gb"))).toBe(true);
  });

  it("keeps the source-reported product type on an accepted new-type row", () => {
    const result = validateExpandedEnergyStarRecord(computerRow());
    expect(result.errors).toEqual([]);
    expect(result.record?.productType).toBe("Mobile Workstation");
  });
});

// =============================================================================
// THE REGISTER MATCHES THE CODE
// =============================================================================

describe("ENERGY STAR expansion - the source register is truthful", () => {
  const registerPath = path.resolve(__dirname, "../data/energy-star-source-register.json");

  it("registers exactly the sources the code can fetch", () => {
    const register = JSON.parse(readFileSync(registerPath, "utf8")) as {
      sources: Array<{
        datasetId: string;
        endpoint: string;
        laptopProductTypes: string[];
        httpStatus: number;
        termsUrl: string;
        license: string;
      }>;
    };
    expect(register.sources.map((source) => source.datasetId).sort()).toEqual(
      REGISTERED_SOURCES.map((source) => source.id).sort()
    );
    for (const source of register.sources) {
      const registered = getSource(source.datasetId);
      expect(source.endpoint).toBe(registered.endpoint);
      expect(source.laptopProductTypes).toEqual([...registered.laptopProductTypes]);
      expect(source.httpStatus).toBe(200);
      // Every registered source states its terms.
      expect(source.termsUrl).toBe(registered.termsUrl);
      expect(source.license).toBe(registered.license);
    }
  });

  it("records every ruled-out candidate with the status that was observed", () => {
    const register = JSON.parse(readFileSync(registerPath, "utf8")) as {
      ruledOut: Array<{ candidate: string; httpStatus: number; verdict: string; evidence: string }>;
    };
    expect(register.ruledOut.length).toBeGreaterThan(0);
    for (const candidate of register.ruledOut) {
      expect(candidate.candidate).toBeTruthy();
      expect(Number.isInteger(candidate.httpStatus)).toBe(true);
      expect(candidate.verdict).toBeTruthy();
      expect(candidate.evidence.length).toBeGreaterThan(20);
    }
    // The predecessor dataset is recorded as not publicly served.
    const predecessor = register.ruledOut.find((candidate) =>
      candidate.candidate.includes("ed9u-v8cw")
    );
    expect(predecessor?.httpStatus).toBe(403);
  });
});
