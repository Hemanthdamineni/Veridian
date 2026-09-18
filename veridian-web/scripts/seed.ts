/**
 * Seed script for Veridian database
 * Loads initial laptop data from CSV into PostgreSQL via Prisma
 *
 * Usage: npx tsx scripts/seed.ts
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

const prisma = new PrismaClient();

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
}

async function seed() {
  console.log("Starting seed...");

  const csvPath = path.join(process.cwd(), "data", "laptops.csv");
  const fileContent = fs.readFileSync(csvPath, "utf-8");
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
  }) as CsvRow[];

  console.log(`Found ${records.length} rows in CSV`);

  const manufacturerCache = new Map<string, string>();
  const seriesCache = new Map<string, string>();
  const modelCache = new Map<string, string>();

  for (const row of records) {
    try {
      // Get or create manufacturer
      let manufacturerId = manufacturerCache.get(row.manufacturer);
      if (!manufacturerId) {
        const slug = row.manufacturer.toLowerCase().replace(/[^a-z0-9]/g, "-");
        const manufacturer = await prisma.manufacturer.upsert({
          where: { slug },
          update: {},
          create: {
            name: row.manufacturer,
            slug,
          },
        });
        manufacturerId = manufacturer.id;
        manufacturerCache.set(row.manufacturer, manufacturerId);
      }

      // Get or create series
      const seriesKey = `${manufacturerId}-${row.series}`;
      let seriesId = seriesCache.get(seriesKey);
      if (!seriesId) {
        const slug = row.series.toLowerCase().replace(/[^a-z0-9]/g, "-");
        const series = await prisma.series.upsert({
          where: {
            manufacturerId_slug: {
              manufacturerId: manufacturerId!,
              slug,
            },
          },
          update: {},
          create: {
            manufacturerId: manufacturerId!,
            name: row.series,
            slug,
          },
        });
        seriesId = series.id;
        seriesCache.set(seriesKey, seriesId);
      }

      // Get or create model
      const modelKey = `${seriesId}-${row.model}`;
      let modelId = modelCache.get(modelKey);
      if (!modelId) {
        const slug = row.model.toLowerCase().replace(/[^a-z0-9]/g, "-");
        const model = await prisma.model.upsert({
          where: {
            seriesId_slug: {
              seriesId: seriesId!,
              slug,
            },
          },
          update: {},
          create: {
            seriesId: seriesId!,
            name: row.model,
            slug,
          },
        });
        modelId = model.id;
        modelCache.set(modelKey, modelId);
      }

      // Create SKU
      const sku = await prisma.sku.upsert({
        where: { skuCode: row.sku_code },
        update: {
          cpuBrand: row.cpu_brand,
          cpuModel: row.cpu_model,
          cpuCores: row.cpu_cores ? parseInt(row.cpu_cores) : null,
          gpuModel: row.gpu_model || null,
          ramGb: parseInt(row.ram_gb),
          ramType: row.ram_type,
          ramSoldered: row.ram_soldered === "true",
          storageGb: parseInt(row.storage_gb),
          storageType: row.storage_type,
          storageSlots: row.storage_slots ? parseInt(row.storage_slots) : null,
          displaySizeIn: parseFloat(row.display_size),
          displayResolution: row.display_resolution,
          displayType: row.display_type,
          displayRefreshHz: parseInt(row.display_refresh),
          displayTouch: row.display_touch === "true",
          displayNits: row.display_nits ? parseInt(row.display_nits) : null,
          weightKg: parseFloat(row.weight_kg),
          batteryWh: parseFloat(row.battery_wh),
          batteryLifeHours: row.battery_life_hours
            ? parseFloat(row.battery_life_hours)
            : null,
          npuTops: row.npu_tops ? parseFloat(row.npu_tops) : null,
          os: row.os,
          buildMaterial: row.build_material,
          linuxCompat: row.linux_compat || null,
        },
        create: {
          modelId: modelId!,
          skuCode: row.sku_code,
          cpuBrand: row.cpu_brand,
          cpuModel: row.cpu_model,
          cpuCores: row.cpu_cores ? parseInt(row.cpu_cores) : null,
          gpuModel: row.gpu_model || null,
          ramGb: parseInt(row.ram_gb),
          ramType: row.ram_type,
          ramSoldered: row.ram_soldered === "true",
          storageGb: parseInt(row.storage_gb),
          storageType: row.storage_type,
          storageSlots: row.storage_slots ? parseInt(row.storage_slots) : null,
          displaySizeIn: parseFloat(row.display_size),
          displayResolution: row.display_resolution,
          displayType: row.display_type,
          displayRefreshHz: parseInt(row.display_refresh),
          displayTouch: row.display_touch === "true",
          displayNits: row.display_nits ? parseInt(row.display_nits) : null,
          weightKg: parseFloat(row.weight_kg),
          batteryWh: parseFloat(row.battery_wh),
          batteryLifeHours: row.battery_life_hours
            ? parseFloat(row.battery_life_hours)
            : null,
          npuTops: row.npu_tops ? parseFloat(row.npu_tops) : null,
          os: row.os,
          buildMaterial: row.build_material,
          linuxCompat: row.linux_compat || null,
        },
      });

      // Create/update pricing
      if (row.price_usd && row.region_us !== "false") {
        await prisma.skuRegionalPricing.upsert({
          where: {
            skuId_region: {
              skuId: sku.id,
              region: "US",
            },
          },
          update: {
            msrp: parseFloat(row.price_usd),
            currency: "USD",
          },
          create: {
            skuId: sku.id,
            region: "US",
            currency: "USD",
            msrp: parseFloat(row.price_usd),
          },
        });
      }

      if (row.price_inr && row.region_in !== "false") {
        await prisma.skuRegionalPricing.upsert({
          where: {
            skuId_region: {
              skuId: sku.id,
              region: "IN",
            },
          },
          update: {
            msrp: parseFloat(row.price_inr),
            currency: "INR",
          },
          create: {
            skuId: sku.id,
            region: "IN",
            currency: "INR",
            msrp: parseFloat(row.price_inr),
          },
        });
      }

      console.log(`✓ ${row.sku_code} - ${row.model}`);
    } catch (error) {
      console.error(`✗ Failed to import ${row.sku_code}:`, error);
    }
  }

  console.log("\nSeed complete!");
}

seed()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
