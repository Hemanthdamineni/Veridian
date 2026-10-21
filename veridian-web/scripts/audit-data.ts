/**
 * Data quality audit for the Veridian catalog.
 *
 * Measures the things a buyer would be misled by, and prints them with the
 * evidence needed to act. Everything reported here is computed from the
 * database, never from a stored summary, so the report cannot drift from the
 * data it describes.
 *
 * The checks themselves live in `src/lib/data-quality.ts`, which the admin
 * dashboard API reads too. This file is the CLI front end: it runs the
 * shared checks, optionally repairs empty structural rows, and prints the
 * result. There is one implementation of every check, not two copies that
 * drift apart.
 *
 * Usage:
 *   npm run db:audit              # human-readable report
 *   npm run db:audit -- --json    # machine-readable report
 */

import { prisma } from "../src/lib/db";
import { runDataQualityAudit } from "../src/lib/data-quality";

async function main() {
  const audit = await runDataQualityAudit();

  // Only checks that actually found something are reported as findings.
  // A check that holds is not a finding; the dashboard reports it separately
  // so a reader can tell "measured and clean" from "not measured".
  const findings = audit.checks
    .filter((check) => check.count > 0)
    .map((check) => ({
      check: check.id,
      severity: check.severity,
      count: check.count,
      detail: check.message,
      samples: check.samples,
    }));

  // --- Report ---------------------------------------------------------------
  // Optionally remove empty structural rows. They carry no information and
  // only distort the browse hierarchy, so removing them is always safe.
  let repaired = null;
  if (process.argv.includes("--repair")) {
    const emptyModels = await prisma.model.findMany({
      where: { skus: { none: {} } },
      select: { id: true },
    });
    const emptySeries = await prisma.series.findMany({
      where: { models: { none: {} } },
      select: { id: true },
    });
    const emptyManufacturers = await prisma.manufacturer.findMany({
      where: { series: { none: {} } },
      select: { id: true },
    });
    const deleted = await prisma.$transaction([
      prisma.model.deleteMany({ where: { id: { in: emptyModels.map((m) => m.id) } } }),
      prisma.series.deleteMany({ where: { id: { in: emptySeries.map((s) => s.id) } } }),
      prisma.manufacturer.deleteMany({
        where: { id: { in: emptyManufacturers.map((m) => m.id) } },
      }),
    ]);
    repaired = { models: deleted[0].count, series: deleted[1].count, manufacturers: deleted[2].count };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    totals: audit.totals,
    provenance: audit.provenance,
    repaired,
    findings,
  };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("VERIDIAN DATA QUALITY AUDIT");
    console.log(`generated ${report.generatedAt}\n`);
    console.log("TOTALS");
    for (const [key, value] of Object.entries(report.totals)) {
      console.log(`  ${key.padEnd(24)} ${value}`);
    }
    console.log("\nPROVENANCE");
    for (const [key, value] of Object.entries(audit.provenance)) {
      console.log(`  ${key.padEnd(24)} ${value}`);
    }
    console.log("\nFINDINGS");
    if (findings.length === 0) {
      console.log("  none — every checked invariant holds");
    } else {
      for (const finding of findings) {
        const tag = finding.severity.toUpperCase().padEnd(8);
        console.log(`  [${tag}] ${finding.check} — ${finding.count} issue(s): ${finding.detail}`);
        for (const sample of finding.samples) console.log(`            ${sample}`);
      }
    }
    const errors = findings.filter((f) => f.severity === "error").length;
    console.log(
      `\n${findings.length} check(s) reported findings, ${errors} at error severity.`
    );
    if (repaired) {
      console.log(
        `Repair: removed ${repaired.models} empty model(s), ${repaired.series} empty series, ` +
          `${repaired.manufacturers} empty manufacturer(s).`
      );
    }
  }

  // A non-zero exit code lets CI fail on a broken catalog.
  if (findings.some((f) => f.severity === "error")) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Audit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
