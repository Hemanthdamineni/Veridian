/**
 * Run the catalog's trust contract against the configured database.
 *
 * These are the properties that make the catalog worth trusting, stated as
 * executable checks: every configuration carries a source, a certified
 * configuration cites a page that can be checked, a displayed price is
 * backed by a recorded observation, a rejected observation keeps its
 * reason, and a component link points at something.
 *
 * The script is read-only. It never modifies the catalog.
 *
 * Usage:
 *   npm run db:contract
 *   npm run db:contract -- --json
 */

import { prisma } from "../src/lib/db";
import { runContractChecks } from "../src/lib/contracts";

async function main() {
  const asJson = process.argv.includes("--json");

  const findings = await runContractChecks(prisma);
  const errors = findings.filter((f) => f.severity === "error" && f.count > 0);
  const warnings = findings.filter((f) => f.severity === "warning" && f.count > 0);

  if (asJson) {
    console.log(JSON.stringify({ findings, errors: errors.length }, null, 2));
  } else {
    console.log("TRUST CONTRACT");
    console.log(
      `  ${findings.length} checks, ${errors.length} at error severity, ${warnings.length} at warning severity`
    );
    for (const finding of findings) {
      const marker = finding.count === 0 ? "  ok  " : finding.severity === "error" ? " FAIL " : " warn ";
      console.log(`${marker} ${finding.id} — ${finding.count} issue(s): ${finding.message}`);
      for (const sample of finding.samples) console.log(`          ${sample}`);
    }
  }

  if (errors.length > 0) {
    console.error(
      `\nThe catalog does not satisfy its trust contract: ${errors.length} check(s) failed.`
    );
    process.exitCode = 1;
    return;
  }
  console.log("\nThe catalog satisfies its trust contract.");
}

main()
  .catch((error) => {
    console.error("The trust contract could not be evaluated:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
