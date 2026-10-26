/**
 * Extended data-quality audit for the Veridian catalog.
 *
 * The base audit (scripts/audit-data.ts) answers "did the catalog break?".
 * This one answers "what is still wrong in it?": a product filed twice, a
 * weight that contradicts the screen it is sold with, a price in the wrong
 * currency for its region, a component nothing links to, a configuration no
 * page can reach.
 *
 * The two reports are meant to be read together. Every check here is
 * complementary to the base audit: it looks for defects the base audit does
 * not look for, so a clean base audit is not a clean catalog.
 *
 * This script is READ-ONLY. It never writes, repairs or deletes a row; it
 * only measures and reports. There is no `--repair` mode, by design.
 *
 * Usage:
 *   npx tsx scripts/audit-extended.ts            # human-readable report
 *   npx tsx scripts/audit-extended.ts --json     # machine-readable report
 */

import { prisma } from "../src/lib/db";
import { EXTRA_CHECKS, runExtraChecks, type Finding } from "../src/lib/audit/extra-checks";

async function main() {
  const [
    skuCount,
    visibleSkus,
    manufacturerCount,
    seriesCount,
    modelCount,
    certifiedSpecs,
    rawObservations,
    rejectedObservations,
    sources,
    priceObservations,
    regionalPricing,
    components,
    skuComponents,
    componentAliases,
    componentSpecs,
    sellers,
    listings,
  ] = await Promise.all([
    prisma.sku.count(),
    prisma.sku.count({ where: { catalogVisible: true } }),
    prisma.manufacturer.count(),
    prisma.series.count(),
    prisma.model.count(),
    prisma.certifiedSkuSpec.count(),
    prisma.rawObservation.count(),
    prisma.rawObservation.count({ where: { status: "rejected" } }),
    prisma.skuSource.count(),
    prisma.priceObservation.count(),
    prisma.skuRegionalPricing.count(),
    prisma.component.count(),
    prisma.skuComponent.count(),
    prisma.componentAlias.count(),
    prisma.componentSpec.count(),
    prisma.seller.count(),
    prisma.retailerListing.count(),
  ]);

  const totals = {
    skus: skuCount,
    visibleSkus,
    manufacturers: manufacturerCount,
    series: seriesCount,
    models: modelCount,
    certifiedSpecs,
    rawObservations,
    rejectedObservations,
    skuSourceRecords: sources,
    priceObservations,
    regionalPricing,
    components,
    skuComponentLinks: skuComponents,
    componentAliases,
    componentSpecs,
    sellers,
    retailerListings: listings,
  };

  const findings: Finding[] = await runExtraChecks(prisma);
  const withFindings = findings.filter((finding) => finding.count > 0);
  const withoutFindings = findings.filter((finding) => finding.count === 0);
  const errors = withFindings.filter((finding) => finding.severity === "error").length;

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    totals,
    checks: EXTRA_CHECKS.map((check) => ({
      id: check.id,
      description: check.description,
      findings: findings.filter((finding) => finding.check === check.id),
    })),
    findings: withFindings,
  };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("VERIDIAN EXTENDED DATA QUALITY AUDIT");
    console.log(`generated ${report.generatedAt}\n`);
    console.log("TOTALS");
    for (const [key, value] of Object.entries(totals)) {
      console.log(`  ${key.padEnd(24)} ${value}`);
    }

    console.log("\nFINDINGS");
    if (withFindings.length === 0) {
      console.log("  none — every check this report covers found nothing");
    } else {
      for (const finding of withFindings) {
        const tag = finding.severity.toUpperCase().padEnd(8);
        console.log(`  [${tag}] ${finding.check} — ${finding.count} issue(s): ${finding.detail}`);
        for (const sample of finding.samples) console.log(`            ${sample}`);
      }
    }

    // A check that found nothing is reported as such. Silence would read as
    // "clean", and the difference between "checked and clean" and "not
    // checked" is exactly what a reader of an audit needs.
    console.log("\nCHECKS THAT FOUND NOTHING");
    if (withoutFindings.length === 0) {
      console.log("  none");
    } else {
      for (const finding of withoutFindings) {
        console.log(`  ${finding.check} — 0 issue(s): ${finding.detail}`);
      }
    }

    console.log(
      `\n${findings.length} check(s) ran, ${withFindings.length} reported findings, ${errors} at error severity.`
    );
    console.log("This audit is read-only: it reports, it never repairs.");
  }

  // A non-zero exit code lets CI fail on a broken catalog.
  if (findings.some((finding) => finding.severity === "error" && finding.count > 0)) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Extended audit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
