/**
 * Database Setup Script for Local Development
 *
 * Creates SQLite database and seeds with sample data.
 *
 * Usage: npx tsx scripts/setup-db.ts
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

const prisma = new PrismaClient();

async function main() {
  console.log("Setting up Veridian database...");

  // Read CSV data
  const csvPath = path.join(process.cwd(), "data", "laptops.csv");
  if (!fs.existsSync(csvPath)) {
    console.error("CSV file not found at data/laptops.csv");
    process.exit(1);
  }

  const fileContent = fs.readFileSync(csvPath, "utf-8");
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];

  console.log(`Found ${records.length} laptop records`);

  const manufacturerCache = new Map<string, string>();
  const seriesCache = new Map<string, string>();
  const modelCache = new Map<string, string>();

  let created = 0;
  let errors = 0;

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
      const existingSku = await prisma.sku.findUnique({
        where: { skuCode: row.sku_code },
      });

      if (!existingSku) {
        const sku = await prisma.sku.create({
          data: {
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

        // Create pricing
        if (row.price_usd && row.region_us !== "false") {
          await prisma.skuRegionalPricing.create({
            data: {
              skuId: sku.id,
              region: "US",
              currency: "USD",
              msrp: parseFloat(row.price_usd),
            },
          });
        }

        if (row.price_inr && row.region_in !== "false") {
          await prisma.skuRegionalPricing.create({
            data: {
              skuId: sku.id,
              region: "IN",
              currency: "INR",
              msrp: parseFloat(row.price_inr),
            },
          });
        }

        created++;
        console.log(`✓ ${row.sku_code} - ${row.model}`);
      } else {
        console.log(`- ${row.sku_code} already exists`);
      }
    } catch (error) {
      errors++;
      console.error(`✗ Failed to import ${row.sku_code}:`, error);
    }
  }

  // Print summary
  const [manufacturerCount, seriesCount, modelCount, skuCount, pricingCount] = await Promise.all([
    prisma.manufacturer.count(),
    prisma.series.count(),
    prisma.model.count(),
    prisma.sku.count(),
    prisma.skuRegionalPricing.count(),
  ]);

  console.log("\n=== Database Setup Complete ===");
  console.log(`Manufacturers: ${manufacturerCount}`);
  console.log(`Series: ${seriesCount}`);
  console.log(`Models: ${modelCount}`);
  console.log(`SKUs: ${skuCount}`);
  console.log(`Pricing records: ${pricingCount}`);
  console.log(`New SKUs created: ${created}`);
  console.log(`Errors: ${errors}`);
}

main()
  .catch((error) => {
    console.error("Setup failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
