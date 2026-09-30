import { prisma } from "../src/lib/db";
import { EnergyStarAdapter } from "../src/lib/energy-star/adapter";
import { ingestReport } from "../src/lib/energy-star/ingest";

async function main() {
  const requested = Number(process.env.ENERGY_STAR_LIMIT ?? 100);
  if (!Number.isInteger(requested) || requested < 1 || requested > 1000) {
    throw new Error("ENERGY_STAR_LIMIT must be an integer from 1 to 1000");
  }

  const adapter = new EnergyStarAdapter();
  const report = await adapter.run(0, requested);
  const persistence = await ingestReport(prisma, report);

  const totals = await prisma.$transaction([
    prisma.manufacturer.count(),
    prisma.series.count(),
    prisma.model.count(),
    prisma.sku.count({ where: { catalogVisible: true } }),
    prisma.rawObservation.count({ where: { source: report.source } }),
    prisma.certifiedSkuSpec.count(),
  ]);

  console.log(JSON.stringify({
    source: report.source,
    endpoint: "https://data.energystar.gov/resource/rxdj-2c88.json?type=Notebook",
    license: "US Public Domain (data.gov Open Government Data Initiative)",
    recordsFetched: report.requested,
    accepted: report.accepted,
    rejected: report.rejected,
    created: persistence.created,
    skipped: persistence.skipped,
    rejectedStored: persistence.rejectedStored,
    totals: {
      manufacturers: totals[0],
      series: totals[1],
      models: totals[2],
      visibleSkus: totals[3],
      sourceRawObservations: totals[4],
      certifiedSpecRecords: totals[5],
    },
    rejectedSamples: report.rejectedRecords.slice(0, 10).map(({ sourceRecordId, errors }) => ({ sourceRecordId, errors })),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("Energy Star ingestion failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
