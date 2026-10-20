/**
 * Ingest the US EPA ENERGY STAR certified-computers dataset.
 *
 * The dataset is public-domain (data.gov Open Government Data Initiative) and
 * is the catalog's primary *cited* source: every configuration written by
 * this script traces back to a specific certification record with a stable
 * permalink and a SHA-256 hash of the verbatim payload.
 *
 * Usage:
 *   npm run db:ingest:es                 # full dataset, every laptop type
 *   ENERGY_STAR_LIMIT=100 npm run ...    # first N rows only (development)
 *   ENERGY_STAR_TYPES=Notebook npm run ...  # a single product type
 */

import { prisma } from "../src/lib/db";
import { EnergyStarAdapter } from "../src/lib/energy-star/adapter";
import { ingestReport } from "../src/lib/energy-star/ingest";
import { LAPTOP_PRODUCT_TYPES } from "../src/lib/energy-star/validate";

async function main() {
  const limitEnv = process.env.ENERGY_STAR_LIMIT;
  const typesEnv = process.env.ENERGY_STAR_TYPES;
  const types = typesEnv
    ? typesEnv.split(",").map((t) => t.trim()).filter(Boolean)
    : [...LAPTOP_PRODUCT_TYPES];

  for (const type of types) {
    if (!(LAPTOP_PRODUCT_TYPES as readonly string[]).includes(type)) {
      throw new Error(
        `ENERGY_STAR_TYPES contains an unsupported product type '${type}'. ` +
          `Supported: ${LAPTOP_PRODUCT_TYPES.join(", ")}`
      );
    }
  }

  const limit = limitEnv ? Number(limitEnv) : null;
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) {
    throw new Error("ENERGY_STAR_LIMIT must be an integer from 1 to 1000");
  }

  const adapter = new EnergyStarAdapter();
  const report = limit
    ? await adapter.run(0, limit, types[0])
    : await adapter.runAll(types);

  const persistence = await ingestReport(prisma, report);

  const totals = await prisma.$transaction([
    prisma.manufacturer.count(),
    prisma.series.count(),
    prisma.model.count(),
    prisma.sku.count({ where: { catalogVisible: true } }),
    prisma.sku.count({ where: { provenance: "certified" } }),
    prisma.rawObservation.count({ where: { source: report.source } }),
    prisma.certifiedSkuSpec.count(),
    prisma.skuSource.count(),
  ]);

  console.log(
    JSON.stringify(
      {
        source: report.source,
        endpoint: "https://data.energystar.gov/resource/rxdj-2c88.json",
        productTypes: types,
        license: "US Public Domain (data.gov Open Government Data Initiative)",
        pagesRead: report.pages ?? 1,
        recordsFetched: report.requested,
        accepted: report.accepted,
        rejected: report.rejected,
        canonicalSkusCreated: persistence.created,
        configurationsMerged: persistence.merged,
        alreadyPresent: persistence.unchanged,
        rejectedStored: persistence.rejectedStored,
        totals: {
          manufacturers: totals[0],
          series: totals[1],
          models: totals[2],
          visibleSkus: totals[3],
          certifiedSkus: totals[4],
          sourceRawObservations: totals[5],
          certifiedSpecRecords: totals[6],
          skuSourceRows: totals[7],
        },
        rejectedSamples: report.rejectedRecords.slice(0, 10).map(({ sourceRecordId, errors }) => ({
          sourceRecordId,
          errors,
        })),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("Energy Star ingestion failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
