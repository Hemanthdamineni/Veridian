import type { PrismaClient } from "@prisma/client";
import { ENERGY_STAR_SOURCE } from "./types";
import type { IngestionReport, NormalizedRecord, RejectedRecord } from "./types";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseDateIso(value: string | null): Date | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value.slice(0, 10);
  const d = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Map ENERGY STAR processor_brand to the catalog enum. */
function normalizeCpuBrand(raw: string | null): string {
  if (!raw) return "Other";
  if (/intel/i.test(raw)) return "Intel";
  if (/amd|ryzen|threadripper/i.test(raw)) return "AMD";
  if (/apple/i.test(raw)) return "Apple";
  if (/qualcomm|snapdragon/i.test(raw)) return "Qualcomm";
  return "Other";
}

/** Round a certified RAM figure to whole GB (the source reports exact values). */
function normalizeRamGb(raw: number | null): number | null {
  if (raw === null) return null;
  const rounded = Math.round(raw);
  if (rounded < 1 || rounded > 4096) return null;
  return rounded;
}

/**
 * Persist one accepted record: Manufacturer -> Series -> Model -> Sku ->
 * CertifiedSkuSpec, plus an immutable RawObservation linking the canonical
 * entity to its verbatim source payload. Idempotent per source record id.
 */
export async function ingestRecord(
  prisma: PrismaClient,
  record: NormalizedRecord,
  { rawPayload, payloadHash }: { rawPayload: string; payloadHash: string }
): Promise<{ created: boolean; skuId: string }> {
  const existingRaw = await prisma.rawObservation.findFirst({
    where: { source: ENERGY_STAR_SOURCE.name, rawRecordId: record.sourceRecordId },
    select: { id: true, payloadHash: true, skuId: true },
  });

  if (existingRaw?.payloadHash === payloadHash && existingRaw.skuId) {
    return { created: false, skuId: existingRaw.skuId };
  }

  const manufacturer = await prisma.manufacturer.upsert({
    where: { slug: slugify(record.brand) },
    update: {},
    create: { name: record.brand, slug: slugify(record.brand) },
  });

  const series = await prisma.series.upsert({
    where: { manufacturerId_slug: { manufacturerId: manufacturer.id, slug: slugify(record.seriesName) } },
    update: {},
    create: {
      manufacturerId: manufacturer.id,
      name: record.seriesName,
      slug: slugify(record.seriesName),
    },
  });

  const model = await prisma.model.upsert({
    where: { seriesId_slug: { seriesId: series.id, slug: slugify(record.modelName) } },
    update: { launchDate: parseDateIso(record.launchDate) ?? undefined },
    create: {
      seriesId: series.id,
      name: record.modelName,
      slug: slugify(record.modelName),
      launchDate: parseDateIso(record.launchDate),
    },
  });

  const specs = record.certifiedSpecs;
  const ramGb = normalizeRamGb(specs.ramGb);
  if (ramGb === null) throw new Error(`Missing or invalid validated RAM for ${record.sourceRecordId}`);
  const sku = await prisma.sku.upsert({
    where: { skuCode: record.skuCode },
    update: {
      cpuBrand: normalizeCpuBrand(specs.cpuBrand),
      cpuModel: specs.cpuModel ?? record.modelName,
      cpuCores: specs.cpuCores,
      ramGb,
      storageType: specs.storageType,
      displaySizeIn: specs.displaySizeIn,
      displayTouch: specs.touchScreen,
      batteryWh: specs.batteryWh,
      os: record.os,
      launchDate: parseDateIso(record.launchDate),
    },
    create: {
      modelId: model.id,
      skuCode: record.skuCode,
      cpuBrand: normalizeCpuBrand(specs.cpuBrand),
      cpuModel: specs.cpuModel ?? record.modelName,
      cpuCores: specs.cpuCores,
      ramGb,
      storageType: specs.storageType,
      displaySizeIn: specs.displaySizeIn,
      displayTouch: specs.touchScreen,
      batteryWh: specs.batteryWh,
      os: record.os,
      launchDate: parseDateIso(record.launchDate),
      catalogVisible: true,
    },
  });

  const existingSpec = await prisma.certifiedSkuSpec.findFirst({
    where: { skuId: sku.id, energyStarId: specs.energyStarId },
    select: { id: true },
  });
  if (!existingSpec) {
    await prisma.certifiedSkuSpec.create({
      data: {
      skuId: sku.id,
      source: ENERGY_STAR_SOURCE.name,
      sourceUrl: specs.sourceUrl,
      observedAt: new Date(specs.observedAt),
      certifiedAt: parseDateIso(specs.certifiedAt),
      marketDate: parseDateIso(specs.marketDate),
      energyStarId: specs.energyStarId,
      cpuBrand: specs.cpuBrand,
      cpuModel: specs.cpuModel,
      cpuCores: specs.cpuCores,
      cpuBaseClockGHz: specs.cpuBaseClockGHz,
      cpuMaxClockGHz: specs.cpuMaxClockGHz,
      cpuPackages: specs.cpuPackages,
      ramGb: specs.ramGb,
      storageType: specs.storageType,
      storageDrives: specs.storageDrives,
      displaySizeIn: specs.displaySizeIn,
      displayResolutionMp: specs.displayResolutionMp,
      displayAreaSqIn: specs.displayAreaSqIn,
      touchScreen: specs.touchScreen,
      batteryWh: specs.batteryWh,
      os: specs.os,
      npu: specs.npu,
      markets: specs.markets,
      },
    });
  }

  await prisma.rawObservation.create({
    data: {
      source: ENERGY_STAR_SOURCE.name,
      sourceUrl: ENERGY_STAR_SOURCE.recordUrl(record.sourceRecordId),
      observedAt: new Date(specs.observedAt),
      payloadHash,
      payload: rawPayload,
      status: "accepted",
      rawRecordId: record.sourceRecordId,
      skuId: sku.id,
    },
  });

  return { created: !existingRaw, skuId: sku.id };
}

export async function ingestRejected(
  prisma: PrismaClient,
  rejected: RejectedRecord[],
  rawPayloads: IngestionReport["rawPayloads"]
): Promise<number> {
  let inserted = 0;
  for (const item of rejected) {
    const rawRow = rawPayloads.find((row) => row.sourceRecordId === item.sourceRecordId);
    const payload = rawRow?.payload ?? JSON.stringify(item.raw);
    const hash = rawRow?.payloadHash ?? await sha256(payload);
    const existing = await prisma.rawObservation.findFirst({
      where: { source: ENERGY_STAR_SOURCE.name, rawRecordId: item.sourceRecordId },
      select: { id: true, payloadHash: true },
    });
    if (existing?.payloadHash === hash) continue;
    await prisma.rawObservation.create({
      data: {
        source: ENERGY_STAR_SOURCE.name,
        sourceUrl: item.sourceRecordId
          ? ENERGY_STAR_SOURCE.recordUrl(item.sourceRecordId)
          : ENERGY_STAR_SOURCE.url,
        payloadHash: hash,
        payload,
        status: "rejected",
        errors: JSON.stringify(item.errors),
        rawRecordId: item.sourceRecordId ?? undefined,
      },
    });
    inserted++;
  }
  return inserted;
}

async function sha256(input: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Run a full fetched report through the audited write path. */
export async function ingestReport(prisma: PrismaClient, report: IngestionReport) {
  let created = 0;
  let skipped = 0;
  for (const record of report.records) {
    const rawRow = report.rawPayloads.find((row) => row.sourceRecordId === record.sourceRecordId);
    if (!rawRow) throw new Error(`Missing raw payload for source record ${record.sourceRecordId}`);
    const result = await ingestRecord(prisma, record, {
      rawPayload: rawRow.payload,
      payloadHash: rawRow.payloadHash,
    });
    if (result.created) created++;
    else skipped++;
  }
  const rejectedStored = await ingestRejected(prisma, report.rejectedRecords, report.rawPayloads);
  return { accepted: report.records.length, created, skipped, rejectedStored };
}