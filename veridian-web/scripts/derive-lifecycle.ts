/**
 * Derive product lifecycle links and write them to the catalog.
 *
 * The catalog knows the product families and the models inside them, and it
 * knows the date every certified configuration reached the market. From
 * those two facts — and nothing else — Veridian derives which model is the
 * predecessor of which, and writes the answer into
 * `Model.predecessorId` / `Model.successorId`.
 *
 * The rules live in `src/lib/lifecycle.ts` and are the same ones the
 * `/lifecycle` page uses, so the page and the stored data can never
 * disagree. Every derived link carries the evidence that produced it, and
 * every candidate that could not be asserted is reported as ambiguous
 * rather than written.
 *
 * The run is idempotent: the script reconciles the two columns for every
 * model it examined, so a second run over unchanged data writes nothing
 * and changes nothing.
 *
 * Usage:
 *   npx tsx scripts/derive-lifecycle.ts --dry-run   # report only, write nothing
 *   npx tsx scripts/derive-lifecycle.ts             # derive and write
 */

import { prisma } from "../src/lib/db";
import {
  deriveLifecycle,
  lifecycleAssignments,
  type LifecycleModelInput,
} from "../src/lib/lifecycle";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const rows = await prisma.model.findMany({
    include: { series: { include: { manufacturer: true } } },
  });

  const models: LifecycleModelInput[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    seriesId: row.seriesId,
    seriesName: row.series.name,
    manufacturerName: row.series.manufacturer.name,
    launchDate: row.launchDate,
  }));

  const result = deriveLifecycle(models);
  const assignments = lifecycleAssignments(result, models);

  const current = new Map(rows.map((row) => [row.id, row]));
  const changes = assignments.filter((assignment) => {
    const row = current.get(assignment.modelId);
    if (!row) return false;
    return row.predecessorId !== assignment.predecessorId || row.successorId !== assignment.successorId;
  });

  if (!DRY_RUN && changes.length > 0) {
    await prisma.$transaction(
      changes.map((change) =>
        prisma.model.update({
          where: { id: change.modelId },
          data: { predecessorId: change.predecessorId, successorId: change.successorId },
        })
      )
    );
  }

  const ambiguityByKind: Record<string, number> = {};
  for (const ambiguity of result.ambiguities) {
    ambiguityByKind[ambiguity.kind] = (ambiguityByKind[ambiguity.kind] ?? 0) + 1;
  }

  const summary = {
    seriesExamined: result.seriesExamined,
    linksDerived: result.links.length,
    ambiguous: result.ambiguities.length,
    written: DRY_RUN ? 0 : changes.length,
  };

  // The machine-readable summary goes to stdout; the commentary goes to
  // stderr so the summary can be piped straight into a tool.
  console.error(
    [
      `families examined : ${result.seriesExamined}`,
      `models examined   : ${result.modelsExamined}`,
      `links derived     : ${result.links.length}`,
      `ambiguous cases   : ${result.ambiguities.length} (${Object.entries(ambiguityByKind)
        .map(([kind, count]) => `${kind}: ${count}`)
        .join(", ")})`,
      DRY_RUN
        ? `dry run — ${changes.length} model row(s) would change, nothing was written`
        : `models written   : ${changes.length}`,
    ].join("\n")
  );

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error("Lifecycle derivation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
