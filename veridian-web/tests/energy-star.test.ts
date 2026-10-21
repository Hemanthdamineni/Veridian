import { describe, it, expect } from "vitest";
import { EnergyStarAdapter, assertSsrf } from "@/lib/energy-star/adapter";
import { validateEnergyStarRecord } from "@/lib/energy-star/validate";
import { ENERGY_STAR_SOURCE } from "@/lib/energy-star/types";
import { ingestReport } from "@/lib/energy-star/ingest";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function baseRecord(overrides: Record<string, unknown> = {}) {
  return {
    pd_id: "4711354",
    energy_star_partner: "Lenovo Group Limited",
    brand_name: "Lenovo",
    model_name: "IdeaPad Vibe 15AKP12",
    model_number: "IdeaPad Vibe 15AKP12",
    type: "Notebook",
    operating_system_name: "Windows 11",
    processor_brand: "AMD",
    processor_name: "Ryzen AI 7 350",
    physical_cpu_cores_count: "8",
    cpu_packages_count: "1",
    cpu_base_clock_speed_ghz: "2.0",
    cpu_maximum_clock_speed_ghz: "2.0",
    system_memory_ram_gb: "32.0",
    number_of_installed_storage_drives: "1",
    integrated_display_diagonal_screen_size_in: "15.30",
    integrated_display_resolution_megapixels: "2.92",
    integrated_display_viewable_screen_area_sq_in: "105.30",
    total_battery_capacity_watt_hours: "65.0",
    touch_screen: "No",
    installed_npu: "No",
    storage_technology: "SSD",
    date_available_on_market: "2026-09-28T00:00:00.000",
    date_certified: "2026-08-31T00:00:00.000",
    markets: "United States, Canada",
    energy_star_model_identifier: "ES_1037540_IdeaPad Vibe 15AKP12_09222026100039_1518519",
    ...overrides,
  };
}

describe("EnergyStarRecord validation — malformed payloads", () => {
  it("accepts a well-formed record", () => {
    const { record, errors } = validateEnergyStarRecord(baseRecord());
    expect(errors).toEqual([]);
    // The canonical code is the part number plus a hash of the configuration
    // signature, so it is stable, human-recognisable and unique.
    expect(record?.skuCode).toMatch(/^IDEAPAD-VIBE-15AKP12-[0-9a-f]{8}$/);
    expect(record?.certifiedSpecs.ramGb).toBe(32);
    expect(record?.brand).toBe("Lenovo");
    expect(record?.seriesName).toBe("IdeaPad Vibe 15");
  });

  it("rejects a non-object payload", () => {
    const { record, errors } = validateEnergyStarRecord("not-an-object");
    expect(record).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects an array payload", () => {
    const { errors } = validateEnergyStarRecord([baseRecord()]);
    expect(errors).toContain("record must be an object");
  });

  it("rejects a record with a product type that is not a laptop", () => {
    const { errors } = validateEnergyStarRecord(baseRecord({ type: "Desktop" }));
    expect(errors).toContain("type 'Desktop' is not a laptop product type");
  });

  it("accepts every laptop product type the source publishes", () => {
    for (const type of ["Notebook", "Two-In-One Notebook", "Ruggedized Notebook"]) {
      const { errors } = validateEnergyStarRecord(baseRecord({ type }));
      expect(errors).toEqual([]);
    }
  });

  it("rejects a record missing required identity fields", () => {
    const { record, errors } = validateEnergyStarRecord(
      baseRecord({ pd_id: "", brand_name: null })
    );
    expect(record).toBeNull();
    expect(errors).toContain("pd_id is required");
    expect(errors).toContain("brand_name is required");
  });
});

describe("EnergyStarRecord validation — extreme / out-of-bound specs", () => {
  it("rejects zero or negative RAM", () => {
    expect(validateEnergyStarRecord(baseRecord({ system_memory_ram_gb: "0" })).errors.length).toBeGreaterThan(0);
    expect(validateEnergyStarRecord(baseRecord({ system_memory_ram_gb: "-4" })).errors.length).toBeGreaterThan(0);
  });

  it("rejects NaN / non-numeric RAM", () => {
    const { errors } = validateEnergyStarRecord(baseRecord({ system_memory_ram_gb: "NaN" }));
    expect(errors.some((e) => e.includes("system_memory_ram_gb"))).toBe(true);
  });

  it("rejects fractional RAM (would silently corrupt a whole-GB field)", () => {
    const { errors } = validateEnergyStarRecord(baseRecord({ system_memory_ram_gb: "32.5" }));
    expect(errors.some((e) => e.includes("whole number of GB"))).toBe(true);
  });

  it("rejects absurd clock speeds (8GHz and 0GHz)", () => {
    expect(validateEnergyStarRecord(baseRecord({ cpu_maximum_clock_speed_ghz: "8.0" })).errors.length).toBeGreaterThan(0);
    expect(validateEnergyStarRecord(baseRecord({ cpu_base_clock_speed_ghz: "0" })).errors.length).toBeGreaterThan(0);
  });

  it("rejects a physically impossible display diagonal", () => {
    expect(validateEnergyStarRecord(baseRecord({ integrated_display_diagonal_screen_size_in: "48" })).errors.length).toBeGreaterThan(0);
    expect(validateEnergyStarRecord(baseRecord({ integrated_display_diagonal_screen_size_in: "0" })).errors.length).toBeGreaterThan(0);
  });

  it("rejects impossible battery capacity", () => {
    expect(validateEnergyStarRecord(baseRecord({ total_battery_capacity_watt_hours: "-5" })).errors.length).toBeGreaterThan(0);
    expect(validateEnergyStarRecord(baseRecord({ total_battery_capacity_watt_hours: "5000" })).errors.length).toBeGreaterThan(0);
  });

  it("rejects a touch_screen value that is not Yes/No", () => {
    const { errors } = validateEnergyStarRecord(baseRecord({ touch_screen: "Maybe" }));
    expect(errors.some((e) => e.includes("touch_screen"))).toBe(true);
  });

  it("rejects an invalid date", () => {
    const { errors } = validateEnergyStarRecord(baseRecord({ date_certified: "not-a-date" }));
    expect(errors.some((e) => e.includes("date_certified"))).toBe(true);
  });
});

describe("EnergyStarRecord validation — injection / hostile characters", () => {
  it("rejects control characters in identity fields", () => {
    const { errors } = validateEnergyStarRecord(baseRecord({ model_name: "Lenovo\x00Pwned" }));
    expect(errors.some((e) => e.includes("control characters"))).toBe(true);
  });

  it("rejects an overlong OS string", () => {
    const { errors } = validateEnergyStarRecord(
      baseRecord({ operating_system_name: "X".repeat(201) })
    );
    expect(errors.some((e) => e.includes("operating_system_name exceeds 200"))).toBe(true);
  });
});

describe("EnergyStar adapter — extraction and variant collisions", () => {
  it("extracts raw payload hashes and rejected rows", () => {
    const adapter = new EnergyStarAdapter();
    const { records, rejected, raw } = adapter.extract([
      baseRecord(),
      baseRecord({ pd_id: "2", system_memory_ram_gb: "0" }),
      { not: "a valid object" },
    ]);
    expect(records).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    expect(raw).toHaveLength(3);
    expect(raw[0].payloadHash).toMatch(/^[a-f0-9]{64}$/);
    // distinct records get distinct hashes
    expect(raw[0].payloadHash).not.toBe(raw[1].payloadHash);
  });

  it("gives the same canonical code to the same configuration every time", () => {
    const adapter = new EnergyStarAdapter();
    const a = adapter.extract([baseRecord()]).records[0];
    const b = adapter.extract([baseRecord({ pd_id: "7" })]).records[0];
    // A different source record id for the same machine must not create a
    // second canonical configuration.
    expect(a.skuCode).toBe(b.skuCode);
  });

  it("gives different configurations of one part number different codes", () => {
    const adapter = new EnergyStarAdapter();
    const a = adapter.extract([baseRecord()]).records[0];
    const b = adapter.extract([
      baseRecord({ pd_id: "7", system_memory_ram_gb: "64.0" }),
    ]).records[0];
    expect(a.skuCode).not.toBe(b.skuCode);
  });

  it("uses the marketing model name when the source reports an internal code", () => {
    const adapter = new EnergyStarAdapter();
    const record = adapter.extract([
      baseRecord({
        pd_id: "9",
        brand_name: "DELL",
        model_name: "P112F",
        model_number: "Dell 15 D15260",
        additional_model_information: "Dell 15 D15260,Dell Pro Essential 15 PV15260",
      }),
    ]).records[0];
    expect(record.brand).toBe("Dell");
    expect(record.modelName).toBe("Dell Pro Essential 15 PV15260");
    expect(record.seriesName).toBe("Dell Pro Essential 15");
  });
});

describe("EnergyStar adapter — SSRF / hostile network targets", () => {
  it("asserts HTTPS for the registered endpoint", () => {
    expect(() => assertSsrf("http://data.energystar.gov/resource/rxdj-2c88.json")).toThrow(/HTTPS/);
  });

  it("blocks loopback and private-network hosts", () => {
    expect(() => assertSsrf("https://localhost/api")).toThrow(/loopback|blocked/);
    expect(() => assertSsrf("https://127.0.0.1/api")).toThrow(/loopback|blocked/);
    expect(() => assertSsrf("https://192.168.1.1/api")).toThrow(/loopback|blocked/);
    expect(() => assertSsrf("https://10.0.0.5/api")).toThrow(/loopback|blocked/);
  });

  it("core request is pinned to the public registry host", () => {
    // The fetch implementation must never be called with an unregistered origin.
    let requestedUrl: string | null = null;
    const adapter = new EnergyStarAdapter(async (url) => {
      requestedUrl = String(url);
      return new Response('[]', { status: 200, headers: { "content-type": "application/json" } });
    });
    return adapter.run(0, 1).then(() => {
      expect(requestedUrl).toBeTruthy();
      expect(requestedUrl).toContain(ENERGY_STAR_SOURCE.url);
    });
  });
});

describe("EnergyStar ingestion — audited write path", () => {
  function makeAdapter(rows: unknown[]) {
    return new EnergyStarAdapter(async () => {
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  }

  async function withTempDb(fn: (prisma: PrismaClient) => Promise<void>) {
    const dir = mkdtempSync(path.join(tmpdir(), "veridian-es-test-"));
    const dbPath = path.join(dir, "test.db");
    process.env.DATABASE_URL = `file:${dbPath}`;
    const prisma = new PrismaClient();
    try {
      // Apply the same schema by pushing to a fresh sqlite file via Prisma CLI.
      const { execSync } = await import("node:child_process");
      execSync(`npx prisma db push --skip-generate --accept-data-loss --force-reset`, {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env },
        stdio: "ignore",
      });
      await fn(prisma);
    } finally {
      await prisma.$disconnect();
      delete process.env.DATABASE_URL;
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("persists raw observations, canonical entities, and certified specs", async () => {
    const adapter = makeAdapter([baseRecord()]);
    const report = await adapter.run(0, 1);
    expect(report.accepted).toBe(1);

    await withTempDb(async (prisma) => {
      const result = await ingestReport(prisma, report);
      expect(result.created).toBe(1);

      const skuCode = report.records[0].skuCode;
      const sku = await prisma.sku.findUnique({
        where: { skuCode },
        include: { certifiedSpecs: true, observations: true, sources: true },
      });
      expect(sku).not.toBeNull();
      expect(sku?.cpuBrand).toBe("AMD");
      expect(sku?.ramGb).toBe(32);
      expect(sku?.os).toBe("Windows 11");
      expect(sku?.catalogVisible).toBe(true);
      // Provenance is written by the ingestion path, never inferred downstream.
      expect(sku?.provenance).toBe("certified");
      expect(sku?.mpn).toBe("IdeaPad Vibe 15AKP12");
      expect(sku?.certifiedSpecs).toHaveLength(1);
      expect(sku?.certifiedSpecs[0].energyStarId).toBe(
        "ES_1037540_IdeaPad Vibe 15AKP12_09222026100039_1518519"
      );
      expect(sku?.observations[0].status).toBe("accepted");
      // Every configuration carries an explicit provenance record.
      expect(sku?.sources).toHaveLength(1);
      expect(sku?.sources[0].kind).toBe("certified");
      expect(sku?.sources[0].sourceUrl).toContain("data.energystar.gov");

      // Idempotent: re-ingesting removes none and skips.
      const again = await ingestReport(prisma, report);
      expect(again.created).toBe(0);
      expect(again.unchanged).toBe(1);
      expect(await prisma.sku.count()).toBe(1);
      expect(await prisma.certifiedSkuSpec.count()).toBe(1);
    });
  });

  it("merges two certifications of one configuration into one canonical entry", async () => {
    const adapter = makeAdapter([
      baseRecord(),
      // The same machine, certified again on another date.
      baseRecord({
        pd_id: "4711355",
        date_certified: "2026-09-30T00:00:00.000",
        energy_star_model_identifier: "ES_1037540_IdeaPad Vibe 15AKP12_09302026100039_1518520",
      }),
    ]);
    const report = await adapter.run(0, 2);
    expect(report.accepted).toBe(2);

    await withTempDb(async (prisma) => {
      const result = await ingestReport(prisma, report);
      expect(result.created).toBe(1);
      expect(result.merged).toBe(1);
      expect(await prisma.sku.count()).toBe(1);
      // Both certification events are kept as immutable observations.
      expect(await prisma.rawObservation.count({ where: { status: "accepted" } })).toBe(2);
      expect(await prisma.certifiedSkuSpec.count()).toBe(2);
    });
  });

  it("never stores rejected records as catalog facts", async () => {
    const adapter = makeAdapter([baseRecord({ system_memory_ram_gb: "0" })]);
    const report = await adapter.run(0, 1);
    expect(report.rejected).toBe(1);

    await withTempDb(async (prisma) => {
      const result = await ingestReport(prisma, report);
      expect(result.accepted).toBe(0);
      expect(result.rejectedStored).toBe(1);
      expect(await prisma.sku.count()).toBe(0);
      expect(await prisma.skuRegionalPricing.count()).toBe(0);
      const raw = await prisma.rawObservation.findFirst({ where: { status: "rejected" } });
      expect(raw).not.toBeNull();
      expect(raw?.errors).toContain("system_memory_ram_gb");

      const again = await ingestReport(prisma, report);
      expect(again.rejectedStored).toBe(0);
      expect(await prisma.rawObservation.count({ where: { status: "rejected" } })).toBe(1);
    });
  });
});

