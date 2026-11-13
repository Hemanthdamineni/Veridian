/**
 * Assert the catalog is populated.
 *
 * A schema that validates is not the same as a catalog that works. This
 * check runs against whatever database is configured — a live PostgreSQL
 * server in CI — and fails if the ingestion path did not actually produce
 * the records it claims to.
 *
 * Provenance is asserted by configuration, not by row: a configuration may
 * legitimately carry more than one provenance record (for example an ENERGY
 * STAR certified record plus an applied community correction on the same
 * SKU), so the invariant is that *every* configuration has at least one
 * provenance record, not that the counts match 1:1. The check also enforces
 * the unconfirmable allowlist: a provenance record with no source URL is
 * only acceptable when the configuration is allowlisted for a documented,
 * machine-readable reason (see `src/lib/allowlist.ts`).
 *
 * Usage: npm run db:assert
 */

import { prisma } from "../src/lib/db";
import { isAllowlistedSku, unconfirmableReasonForSku } from "../src/lib/allowlist";

async function main() {
  const [skus, certified, observations, components, links, sourceRows, provenanceSkus] =
    await Promise.all([
      prisma.sku.count(),
      prisma.sku.count({ where: { provenance: "certified" } }),
      prisma.rawObservation.count(),
      prisma.component.count(),
      prisma.skuComponent.count(),
      prisma.skuSource.count(),
      // Distinct configurations that carry at least one provenance record.
      prisma.skuSource.groupBy({ by: ["skuId"] }),
    ]);

  const summary = {
    skus,
    certified,
    observations,
    components,
    links,
    sources: sourceRows,
    configuredProvenance: provenanceSkus.length,
  };
  console.log(JSON.stringify(summary, null, 2));

  // Every no-URL provenance record must belong to an allowlisted configuration
  // with a documented reason; any other missing URL is an unexpected gap.
  const noSourceUrlRows = await prisma.skuSource.findMany({
    where: { sourceUrl: null },
    select: { sku: { select: { skuCode: true } }, source: true },
  });
  const unallowlisted = noSourceUrlRows.filter((row) => !isAllowlistedSku(row.sku.skuCode));
  const allowlisted = noSourceUrlRows.filter((row) => isAllowlistedSku(row.sku.skuCode));

  const failures: string[] = [];
  if (skus < 1000) failures.push(`expected at least 1000 configurations, found ${skus}`);
  if (certified < 1000) failures.push(`expected at least 1000 certified configurations, found ${certified}`);
  if (observations < 1000) failures.push(`expected at least 1000 raw observations, found ${observations}`);
  if (components < 100) failures.push(`expected at least 100 components, found ${components}`);
  if (links < 1000) failures.push(`expected at least 1000 component links, found ${links}`);
  // Every configuration must be backed by at least one provenance record.
  if (provenanceSkus.length !== skus) {
    failures.push(
      `every configuration must carry a provenance record: ${provenanceSkus.length} configured for ${skus} configurations`
    );
  }
  // A provenance record without a source URL is only acceptable when the
  // configuration is allowlisted for a machine-readable unconfirmable reason.
  if (unallowlisted.length > 0) {
    failures.push(
      `${unallowlisted.length} provenance records have no source URL and are not allowlisted: ` +
        unallowlisted.map((row) => row.sku.skuCode).join(", ")
    );
  }

  if (failures.length > 0) {
    console.error("Catalog assertions failed:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  const allowlistedReasons = allowlisted.map(
    (row) => `${row.sku.skuCode}:${unconfirmableReasonForSku(row.sku.skuCode) ?? "unknown"}`
  );
  console.log(
    `Catalog assertions passed. ${allowlistedReasons.length} unconfirmable provenance records allowlisted: ` +
      allowlistedReasons.join(", ")
  );
}

main()
  .catch((error) => {
    console.error("Catalog assertion failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });