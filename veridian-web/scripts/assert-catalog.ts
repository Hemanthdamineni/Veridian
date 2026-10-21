/**
 * Assert the catalog is populated.
 *
 * A schema that validates is not the same as a catalog that works. This
 * check runs against whatever database is configured — a live PostgreSQL
 * server in CI — and fails if the ingestion path did not actually produce
 * the records it claims to.
 *
 * Usage: npm run db:assert
 */

import { prisma } from "../src/lib/db";

async function main() {
  const [skus, certified, observations, components, links, sources] = await Promise.all([
    prisma.sku.count(),
    prisma.sku.count({ where: { provenance: "certified" } }),
    prisma.rawObservation.count(),
    prisma.component.count(),
    prisma.skuComponent.count(),
    prisma.skuSource.count(),
  ]);

  const summary = { skus, certified, observations, components, links, sources };
  console.log(JSON.stringify(summary, null, 2));

  const failures: string[] = [];
  if (skus < 1000) failures.push(`expected at least 1000 configurations, found ${skus}`);
  if (certified < 1000) failures.push(`expected at least 1000 certified configurations, found ${certified}`);
  if (observations < 1000) failures.push(`expected at least 1000 raw observations, found ${observations}`);
  if (components < 100) failures.push(`expected at least 100 components, found ${components}`);
  if (links < 1000) failures.push(`expected at least 1000 component links, found ${links}`);
  if (sources !== skus) {
    failures.push(`every configuration must carry a provenance record: ${sources} sources for ${skus} configurations`);
  }

  if (failures.length > 0) {
    console.error("Catalog assertions failed:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("Catalog assertions passed.");
}

main()
  .catch((error) => {
    console.error("Catalog assertion failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
