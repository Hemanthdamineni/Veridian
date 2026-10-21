/**
 * The audited write path for Wikidata rows.
 *
 * The ENERGY STAR adapter already defines how a source observation becomes a
 * catalog fact (`energy-star/ingest.ts`): a raw observation is stored
 * verbatim with a SHA-256 payload hash, rejected rows are kept with their
 * reasons, and the canonical entities are written as
 * Manufacturer -> Series -> Model -> Sku -> CertifiedSkuSpec with a SkuSource
 * row per source.
 *
 * That helper is written against the ENERGY STAR record type specifically: it
 * takes an `energy-star.NormalizedRecord`, writes `provenance: "certified"`
 * and fills the ENERGY STAR specific columns of `CertifiedSkuSpec`. Reusing
 * it directly would have meant filing Wikidata rows as ENERGY STAR
 * certifications. This module is therefore an equivalent written for the
 * Wikidata record type, with the same properties:
 *
 *   * every accepted row produces an immutable RawObservation with the
 *     verbatim payload and its SHA-256 hash;
 *   * every rejected row produces a RawObservation with status "rejected"
 *     and the exact reasons;
 *   * canonical entities are written Manufacturer -> Series -> Model -> Sku
 *     -> CertifiedSkuSpec;
 *   * one SkuSource row per source per configuration;
 *   * `Sku.provenance` is written explicitly, never inferred.
 *
 * Idempotency: an observation that is already stored with the same payload
 * hash is not stored twice, and a canonical SKU that already exists is
 * updated rather than duplicated, so running the ingestion twice produces the
 * same catalog.
 */

import type { PrismaClient } from "@prisma/client";

import { canonicalBrand } from "../energy-star/canonical";
import { payloadHash, validateWikidataRow } from "./validate";
import { ADAPTER_VERSION, WIKIDATA_SOURCE } from "./types";
import type {
  IngestionReport,
  NormalizedRecord,
  RawPayloadRow,
  RejectedRecord,
  WikidataRow,
} from "./types";
/** What happened to one record. */
export type IngestOutcome = "created" | "merged" | "unchanged";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Parse an ISO date the source published into a Date, or null. */
function parseDateIso(value: string | null): Date | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value.slice(0, 10);
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The SHA-256 hash of a verbatim payload. */
export { payloadHash };

/**
 * Persist one accepted record: Manufacturer -> Series -> Model -> Sku ->
 * CertifiedSkuSpec, plus an immutable RawObservation linking the canonical
 * entity to its verbatim source payload.
 *
 * Identity rules (ADR-002): the canonical SKU code is derived from the part
 * number and the configuration signature, so two Wikidata rows that describe
 * the *same* configuration collapse onto one SKU while two *different*
 * configurations of the same model stay separate. Every source row still
 * produces its own immutable RawObservation, so nothing is lost when records
 * merge.
 */
export async function ingestWikidataRecord(
  prisma: PrismaClient,
  record: NormalizedRecord,
  { rawPayload, payloadHash: hash }: { rawPayload: string; payloadHash: string }
): Promise<{ outcome: IngestOutcome; skuId: string }> {
  const existingRaw = await prisma.rawObservation.findFirst({
    where: { source: WIKIDATA_SOURCE.name, payloadHash: hash },
    select: { id: true, payloadHash: true, skuId: true },
  });

  if (existingRaw?.payloadHash === hash && existingRaw.skuId) {
    return { outcome: "unchanged", skuId: existingRaw.skuId };
  }

  const brand = canonicalBrand(record.brand);
  const manufacturer = await prisma.manufacturer.upsert({
    where: { slug: slugify(brand) },
    update: { name: brand },
    create: { name: brand, slug: slugify(brand) },
  });

  // A SKU that already carries this canonical code is the same
  // configuration seen again. It keeps the model and series it was first
  // filed under, so a second observation cannot leave an empty series
  // behind.
  const existingSku = await prisma.sku.findUnique({
    where: { skuCode: record.skuCode },
    select: { id: true, modelId: true },
  });

  let modelId = existingSku?.modelId;
  if (!modelId) {
    const series = await prisma.series.upsert({
      where: {
        manufacturerId_slug: { manufacturerId: manufacturer.id, slug: slugify(record.seriesName) },
      },
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
    modelId = model.id;
  }

  const specs = record.observedSpecs;

  const sku = await prisma.sku.upsert({
    where: { skuCode: record.skuCode },
    update: {
      cpuBrand: specs.cpuBrand,
      cpuModel: specs.cpuModel,
      ramGb: specs.ramGb,
      ramType: specs.ramType,
      displaySizeIn: specs.displaySizeIn,
      weightKg: specs.weightKg,
      os: record.os,
      launchDate: parseDateIso(record.launchDate),
      // Provenance is asserted by the write path, never inferred downstream.
      provenance: "manufacturer",
      mpn: record.partNumber,
    },
    create: {
      modelId,
      skuCode: record.skuCode,
      cpuBrand: specs.cpuBrand,
      cpuModel: specs.cpuModel,
      ramGb: specs.ramGb,
      ramType: specs.ramType,
      displaySizeIn: specs.displaySizeIn,
      weightKg: specs.weightKg,
      os: record.os,
      launchDate: parseDateIso(record.launchDate),
      catalogVisible: true,
      provenance: "manufacturer",
      mpn: record.partNumber,
    },
  });

  // The observed specification of one configuration. `energyStarId` is the
  // column the schema gives the source's own identifier for a certified
  // configuration; a Wikidata row's identifier is its Q-id, which is what is
  // recorded here. The row is written once per configuration: a repeated
  // observation of the same configuration does not duplicate it.
  const existingSpec = await prisma.certifiedSkuSpec.findFirst({
    where: { skuId: sku.id, energyStarId: record.sourceRecordId },
    select: { id: true },
  });
  if (!existingSpec) {
    await prisma.certifiedSkuSpec.create({
      data: {
        skuId: sku.id,
        source: WIKIDATA_SOURCE.name,
        sourceUrl: specs.sourceUrl,
        observedAt: new Date(specs.observedAt),
        marketDate: parseDateIso(specs.releaseDate),
        energyStarId: record.sourceRecordId,
        cpuBrand: specs.cpuBrand,
        cpuModel: specs.cpuModel,
        ramGb: specs.ramGb,
        displaySizeIn: specs.displaySizeIn,
        os: specs.osLabel,
      },
    });
  }

  // Explicit provenance row (ADR-005): one per source per configuration.
  await prisma.skuSource.upsert({
    where: { skuId_source: { skuId: sku.id, source: WIKIDATA_SOURCE.name } },
    update: {
      kind: "manufacturer",
      sourceUrl: specs.sourceUrl,
      observedAt: new Date(specs.observedAt),
      confidence: 1,
    },
    create: {
      skuId: sku.id,
      source: WIKIDATA_SOURCE.name,
      kind: "manufacturer",
      sourceUrl: specs.sourceUrl,
      observedAt: new Date(specs.observedAt),
      confidence: 1,
      note: `Wikidata item ${record.sourceRecordId}`,
    },
  });

  await prisma.rawObservation.create({
    data: {
      source: WIKIDATA_SOURCE.name,
      sourceUrl: WIKIDATA_SOURCE.itemUrl(record.sourceRecordId),
      observedAt: new Date(specs.observedAt),
      payloadHash: hash,
      payload: rawPayload,
      status: "accepted",
      rawRecordId: record.sourceRecordId,
      skuId: sku.id,
    },
  });

  return { outcome: existingSku ? "merged" : "created", skuId: sku.id };
}

/**
 * Store the rejected rows as immutable observations, each with the exact
 * reasons it failed validation.
 *
 * A rejected row is never written to the catalog: it is kept so the run can
 * be audited and so a later fix can be re-run against the same payload.
 */
export async function ingestRejectedRows(
  prisma: PrismaClient,
  rejected: RejectedRecord[]
): Promise<number> {
  let inserted = 0;
  for (const item of rejected) {
    // The payload is rebuilt from the row itself, so a rejected row is never
    // confused with another row of the same item.
    const payload = JSON.stringify(item.raw);
    const hash = payloadHash(payload);
    const existing = await prisma.rawObservation.findFirst({
      where: { source: WIKIDATA_SOURCE.name, payloadHash: hash },
      select: { id: true, payloadHash: true },
    });
    if (existing?.payloadHash === hash) continue;
    await prisma.rawObservation.create({
      data: {
        source: WIKIDATA_SOURCE.name,
        sourceUrl: item.sourceRecordId
          ? WIKIDATA_SOURCE.itemUrl(item.sourceRecordId)
          : WIKIDATA_SOURCE.url,
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

/** Run a whole fetched report through the audited write path. */
export async function ingestWikidataReport(prisma: PrismaClient, report: IngestionReport) {
  let created = 0;
  let merged = 0;
  let unchanged = 0;
  for (const record of report.records) {
    const result = await ingestWikidataRecord(prisma, record, {
      rawPayload: record.rawPayload,
      payloadHash: record.rawPayloadHash,
    });
    if (result.outcome === "created") created++;
    else if (result.outcome === "merged") merged++;
    else unchanged++;
  }
  const rejectedStored = await ingestRejectedRows(prisma, report.rejectedRecords);
  return { accepted: report.records.length, created, merged, unchanged, rejectedStored };
}

/**
 * Validate every fetched row and assemble the report the write path consumes.
 *
 * Each row produces exactly one raw payload: the source row verbatim, with
 * the SHA-256 hash of that payload. A row that passes validation also
 * produces a canonical record; a row that fails produces a rejection with
 * the exact reasons. Nothing is dropped silently.
 */
export function buildWikidataReport(
  rows: WikidataRow[],
  { observedAt = new Date().toISOString() }: { observedAt?: string } = {}
): IngestionReport {
  const records: NormalizedRecord[] = [];
  const rejectedRecords: RejectedRecord[] = [];
  const rawPayloads: RawPayloadRow[] = rows.map((row) => {
    const result = validateWikidataRow(row, { observedAt });
    const sourceRecordId = row.itemId && row.itemId.length > 0 ? row.itemId : null;
    if (result.record) {
      // One item can produce several rows (one per published memory size or
      // processor). The record therefore carries its own payload, so a row
      // is never confused with another row of the same item.
      records.push(result.record);
    } else {
      rejectedRecords.push({ sourceRecordId, errors: result.errors, raw: row });
    }
    return {
      sourceRecordId,
      payloadHash: result.record?.rawPayloadHash ?? payloadHash(JSON.stringify(row)),
      payload: result.record?.rawPayload ?? JSON.stringify(row),
      errors: result.errors,
    };
  });

  return {
    source: WIKIDATA_SOURCE.name,
    adapterVersion: ADAPTER_VERSION,
    observedAt,
    requested: rows.length,
    accepted: records.length,
    rejected: rejectedRecords.length,
    rejectedRecords,
    records,
    rawPayloads,
  };
}
