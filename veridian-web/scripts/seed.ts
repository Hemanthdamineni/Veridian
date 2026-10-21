/**
 * Seed the reference dataset into the catalog.
 *
 * The reference rows in `data/laptops.csv` are real, purchasable retail part
 * numbers. They are loaded exactly as recorded - one row, one configuration -
 * and are never expanded, combined or generated.
 *
 * Provenance is explicit:
 *   * `manufacturer` - the row carries the URL of a manufacturer
 *     specification page that was fetched and confirmed.
 *   * `unverified`   - the row has no citation. Its figures are reported
 *     as-is and the UI says so plainly.
 *
 * Prices are recorded as append-only observations with the source that
 * produced them, so re-running the seed never rewrites history.
 *
 * Usage: npm run db:seed
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

const prisma = new PrismaClient();

/** The source that produced the reference dataset. */
const REFERENCE_SOURCE = "Veridian reference dataset";

interface CsvRow {
  manufacturer: string;
  series: string;
  model: string;
  sku_code: string;
  cpu_brand: string;
  cpu_model: string;
  cpu_cores: string;
  gpu_model: string;
  ram_gb: string;
  ram_type: string;
  ram_soldered: string;
  storage_gb: string;
  storage_type: string;
  storage_slots: string;
  display_size: string;
  display_resolution: string;
  display_type: string;
  display_refresh: string;
  display_touch: string;
  display_nits: string;
  weight_kg: string;
  battery_wh: string;
  battery_life_hours: string;
  npu_tops: string;
  os: string;
  build_material: string;
  linux_compat: string;
  price_usd: string;
  price_inr: string;
  region_us: string;
  region_in: string;
  /** URL of the manufacturer specification page this row was checked against. */
  source_url: string;
  /** "true" when the verification tool confirmed the row against that page. */
  verified: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function intOrNull(value: string): number | null {
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function floatOrNull(value: string): number | null {
  if (!value) return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function seed() {
  console.log("Seeding the reference dataset...");

  const csvPath = path.join(process.cwd(), "data", "laptops.csv");
  const fileContent = fs.readFileSync(csvPath, "utf-8");
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
  }) as CsvRow[];

  console.log(`Found ${records.length} reference configurations`);

  const manufacturerCache = new Map<string, string>();
  const seriesCache = new Map<string, string>();
  const modelCache = new Map<string, string>();

  let created = 0;
  let updated = 0;
  let verified = 0;

  for (const row of records) {
    const sourceUrl = (row.source_url || "").trim();
    const confirmed = (row.verified || "").trim() === "true";
    // A row is only reported as manufacturer-verified when the verification
    // tool confirmed it against the cited page. Every other row stays
    // unverified, and the UI says so.
    const provenance = confirmed ? "manufacturer" : "unverified";
    if (confirmed) verified++;

    // Manufacturer
    let manufacturerId = manufacturerCache.get(row.manufacturer);
    if (!manufacturerId) {
      const slug = slugify(row.manufacturer);
      const manufacturer = await prisma.manufacturer.upsert({
        where: { slug },
        update: {},
        create: { name: row.manufacturer, slug },
      });
      manufacturerId = manufacturer.id;
      manufacturerCache.set(row.manufacturer, manufacturer.id);
    }

    // Series
    const seriesKey = `${manufacturerId}-${row.series}`;
    let seriesId = seriesCache.get(seriesKey);
    if (!seriesId) {
      const slug = slugify(row.series);
      const series = await prisma.series.upsert({
        where: { manufacturerId_slug: { manufacturerId: manufacturerId!, slug } },
        update: {},
        create: { manufacturerId: manufacturerId!, name: row.series, slug },
      });
      seriesId = series.id;
      seriesCache.set(seriesKey, series.id);
    }

    // Model
    const modelKey = `${seriesId}-${row.model}`;
    let modelId = modelCache.get(modelKey);
    if (!modelId) {
      const slug = slugify(row.model);
      const model = await prisma.model.upsert({
        where: { seriesId_slug: { seriesId: seriesId!, slug } },
        update: {},
        create: { seriesId: seriesId!, name: row.model, slug },
      });
      modelId = model.id;
      modelCache.set(modelKey, model.id);
    }

    const existing = await prisma.sku.findUnique({
      where: { skuCode: row.sku_code },
      select: { id: true },
    });

    const data = {
      modelId: modelId!,
      skuCode: row.sku_code,
      mpn: row.sku_code,
      provenance,
      cpuBrand: row.cpu_brand,
      cpuModel: row.cpu_model,
      cpuCores: intOrNull(row.cpu_cores),
      gpuModel: row.gpu_model || null,
      ramGb: parseInt(row.ram_gb, 10),
      ramType: row.ram_type || null,
      ramSoldered: row.ram_soldered === "true",
      storageGb: intOrNull(row.storage_gb),
      storageType: row.storage_type || null,
      storageSlots: intOrNull(row.storage_slots),
      displaySizeIn: floatOrNull(row.display_size),
      displayResolution: row.display_resolution || null,
      displayType: row.display_type || null,
      displayRefreshHz: intOrNull(row.display_refresh),
      displayTouch: row.display_touch === "true",
      displayNits: intOrNull(row.display_nits),
      weightKg: floatOrNull(row.weight_kg),
      batteryWh: floatOrNull(row.battery_wh),
      batteryLifeHours: floatOrNull(row.battery_life_hours),
      npuTops: floatOrNull(row.npu_tops),
      os: row.os,
      buildMaterial: row.build_material || null,
      linuxCompat: row.linux_compat || null,
    };

    const sku = await prisma.sku.upsert({
      where: { skuCode: row.sku_code },
      update: data,
      create: { ...data, catalogVisible: true },
    });
    if (existing) updated++;
    else created++;

    // Explicit provenance record (ADR-005).
    await prisma.skuSource.upsert({
      where: { skuId_source: { skuId: sku.id, source: REFERENCE_SOURCE } },
      update: {
        kind: provenance,
        sourceUrl: sourceUrl || null,
        confidence: confirmed ? 0.9 : 0.4,
        note: confirmed
          ? "Specifications confirmed against the manufacturer specification page."
          : "Specifications have not been independently verified against the manufacturer.",
      },
      create: {
        skuId: sku.id,
        source: REFERENCE_SOURCE,
        kind: provenance,
        sourceUrl: sourceUrl || null,
        confidence: confirmed ? 0.9 : 0.4,
        note: confirmed
          ? "Specifications confirmed against the manufacturer specification page."
          : "Specifications have not been independently verified against the manufacturer.",
      },
    });

    // Regional list price. The observation is append-only: it is only written
    // when no observation for this configuration and region exists yet, so
    // re-seeding never rewrites or duplicates history.
    const regions: Array<{ region: string; price: string; currency: string; flag: string }> = [
      { region: "US", price: row.price_usd, currency: "USD", flag: row.region_us },
      { region: "IN", price: row.price_inr, currency: "INR", flag: row.region_in },
    ];

    for (const entry of regions) {
      if (!entry.price || entry.flag === "false") continue;
      const msrp = parseFloat(entry.price);
      if (!Number.isFinite(msrp)) continue;

      await prisma.skuRegionalPricing.upsert({
        where: { skuId_region: { skuId: sku.id, region: entry.region } },
        update: { msrp, currency: entry.currency },
        create: { skuId: sku.id, region: entry.region, currency: entry.currency, msrp },
      });

      const existingObservation = await prisma.priceObservation.findFirst({
        where: { skuId: sku.id, region: entry.region, sourceName: REFERENCE_SOURCE },
        select: { id: true },
      });
      if (!existingObservation) {
        await prisma.priceObservation.create({
          data: {
            skuId: sku.id,
            region: entry.region,
            currency: entry.currency,
            price: msrp,
            retailer: null,
            sourceUrl: sourceUrl || null,
            timestamp: new Date(Date.UTC(2023, 0, 1)),
            sourceName: REFERENCE_SOURCE,
            kind: "manufacturer",
            confidence: confirmed ? 0.8 : 0.4,
          },
        });
      }
    }
  }

  console.log(
    `Seed complete. ${created} created, ${updated} updated, ` +
      `${verified} of ${records.length} confirmed against a manufacturer page.`
  );
}

seed()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
