/**
 * Ingest laptop configurations from Wikidata into the Veridian catalog.
 *
 * The query lives in `data/wikidata-sparql.rq`, as data, so it can be
 * reviewed without reading code. The rows it returns are validated field by
 * field, and only rows that survive validation become catalog facts; every
 * row — accepted or rejected — is stored as an immutable raw observation with
 * a SHA-256 hash of its verbatim payload.
 *
 * Usage:
 *   npx tsx scripts/ingest-wikidata.ts --dry-run --limit 50
 *   npx tsx scripts/ingest-wikidata.ts
 *
 * Flags:
 *   --limit N    read only the first N source rows (development aid)
 *   --dry-run    fetch and validate, but write nothing to the database
 */

import { prisma } from "../src/lib/db";
import { buildWikidataReport, ingestWikidataReport } from "../src/lib/wikidata/ingest";
import {
  extractRows,
  loadQueryText,
  sortRows,
  WikidataClient,
  WikidataRateLimitError,
  WikidataRequestError,
} from "../src/lib/wikidata/sparql";

interface Options {
  limit: number | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  let limit: number | null = null;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--limit") {
      const raw = argv[index + 1];
      if (raw === undefined) throw new Error("--limit needs a number");
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`--limit must be a positive integer, got '${raw}'`);
      }
      limit = parsed;
      index += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const raw = arg.slice("--limit=".length);
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`--limit must be a positive integer, got '${raw}'`);
      }
      limit = parsed;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: npx tsx scripts/ingest-wikidata.ts [--limit N] [--dry-run]"
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument '${arg}'. Use --limit N, --dry-run or --help.`);
  }

  return { limit, dryRun };
}

/** How often each rejection reason occurred, most frequent first. */
function reasonHistogram(errors: string[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const error of errors) {
    // The reason carries the offending value; the histogram keeps the rule.
    const reason = error.replace(/'[^']*'/g, "'<value>'");
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const queryText = loadQueryText();

  const client = new WikidataClient();
  const results = await client.runQuery(queryText);
  // The service gives no order of its own, so the rows are put in a stable
  // order here: a repeated run then reads exactly the same rows.
  const rows = sortRows(extractRows(results));
  const selected = options.limit === null ? rows : rows.slice(0, options.limit);

  const report = buildWikidataReport(selected);

  let created = 0;
  let merged = 0;
  let unchanged = 0;
  let rejectedStored = 0;

  if (options.dryRun) {
    // Nothing is written. The canonical codes are still computed, so the run
    // shows how many configurations the accepted rows would produce.
    const codes = new Set(report.records.map((record) => record.skuCode));
    created = 0;
    merged = report.records.length - codes.size;
  } else {
    const persistence = await ingestWikidataReport(prisma, report);
    created = persistence.created;
    merged = persistence.merged;
    unchanged = persistence.unchanged;
    rejectedStored = persistence.rejectedStored;
  }

  const canonicalCodes = new Set(report.records.map((record) => record.skuCode));

  console.log(
    JSON.stringify(
      {
        source: report.source,
        endpoint: "https://query.wikidata.org/sparql",
        query: "data/wikidata-sparql.rq",
        license: "CC0 1.0 Universal (public domain dedication)",
        dryRun: options.dryRun,
        fetched: report.requested,
        accepted: report.accepted,
        rejected: report.rejected,
        canonicalSkusCreated: created,
        configurationsMerged: merged,
        canonicalSkuCandidates: canonicalCodes.size,
        alreadyPresent: unchanged,
        rejectedStored,
        rejectionReasons: reasonHistogram(
          report.rejectedRecords.flatMap((record) => record.errors)
        ),
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
  .catch((error: unknown) => {
    if (error instanceof WikidataRateLimitError) {
      console.error(
        `The Wikidata Query Service asked this client to slow down (HTTP ${error.status}). ` +
          `Stopping without retrying. Response body: ${error.body.slice(0, 500)}`
      );
      process.exitCode = 1;
      return;
    }
    if (error instanceof WikidataRequestError) {
      console.error(
        `The Wikidata Query Service returned HTTP ${error.status}. ` +
          `Response body: ${error.body.slice(0, 500)}`
      );
      process.exitCode = 1;
      return;
    }
    console.error("Wikidata ingestion failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
