/**
 * Ingest the *expanded* ENERGY STAR laptop configurations.
 *
 * The base script (`scripts/ingest-energy-star.ts`) reads three laptop
 * product types out of the US EPA ENERGY STAR Certified Computers dataset.
 * This script reads the same dataset through the same audited write path,
 * with a wider product-type allowlist, and it can also read the other EPA
 * datasets that carry laptop rows so that their contribution is measured
 * rather than assumed.
 *
 * The fetch discipline is inherited from the base adapter, not reinvented:
 * a pinned host allowlist, the shared SSRF guard, the shared descriptive
 * user agent, the same pagination, the same field validation and the same
 * canonical identity rules. There is no second parser.
 *
 * Usage:
 *   npx tsx scripts/ingest-energy-star-expanded.ts --dry-run --limit 25
 *   npx tsx scripts/ingest-energy-star-expanded.ts --limit 200
 *   npx tsx scripts/ingest-energy-star-expanded.ts --source 8wj2-sec8 --dry-run
 *
 * Flags:
 *   --dry-run          read and validate, write nothing
 *   --limit N          read at most N source rows in total
 *   --source <id>      the registered dataset to read (default rxdj-2c88)
 *   --types a,b,c      the product types to read
 *   --page-size N      rows per request (1..1000)
 *   --help             print this help
 */

import type { PrismaClient } from "@prisma/client";
import {
  BASE_LAPTOP_PRODUCT_TYPES,
  EXPANDED_LAPTOP_PRODUCT_TYPES,
  isExpandedLaptopProductType,
  NEW_LAPTOP_PRODUCT_TYPES,
  runExpansion,
  type ExpansionReport,
} from "../src/lib/energy-star/expansion";
import { ingestReport } from "../src/lib/energy-star/ingest";
import { getSource, REGISTERED_SOURCES } from "../src/lib/energy-star/sources";

interface Options {
  dryRun: boolean;
  limit: number | null;
  sourceId: string;
  types: string[] | null;
  pageSize: number;
  help: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    dryRun: false,
    limit: null,
    sourceId: "rxdj-2c88",
    types: null,
    pageSize: 1000,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--limit": {
        if (next === undefined) throw new Error("--limit requires a value");
        const parsed = Number(next);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error("--limit must be a positive integer");
        }
        options.limit = parsed;
        index += 1;
        break;
      }
      case "--source": {
        if (next === undefined) throw new Error("--source requires a dataset id");
        options.sourceId = next;
        index += 1;
        break;
      }
      case "--types": {
        if (next === undefined) throw new Error("--types requires a value");
        options.types = next.split(",").map((type) => type.trim()).filter(Boolean);
        index += 1;
        break;
      }
      case "--page-size": {
        if (next === undefined) throw new Error("--page-size requires a value");
        const parsed = Number(next);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
          throw new Error("--page-size must be an integer between 1 and 1000");
        }
        options.pageSize = parsed;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown argument '${arg}'. Use --help.`);
    }
  }
  return options;
}

/**
 * The database client is created lazily.
 *
 * A dry run must work without a database at all, and `new PrismaClient()`
 * refuses to be constructed when `DATABASE_URL` is unset.
 */
let prismaClient: PrismaClient | null = null;

async function getPrisma(): Promise<PrismaClient> {
  if (!prismaClient) {
    const module = await import("../src/lib/db");
    prismaClient = module.prisma;
  }
  return prismaClient;
}

/**
 * Look up the canonical codes that already exist in the catalog.
 *
 * The comparison is chunked so a full-dataset run does not build a single
 * enormous `IN` list.
 */
async function existingSkuCodes(
  prisma: PrismaClient,
  codes: string[]
): Promise<Set<string>> {
  const known = new Set<string>();
  const chunkSize = 500;
  for (let index = 0; index < codes.length; index += chunkSize) {
    const chunk = codes.slice(index, index + chunkSize);
    const rows = await prisma.sku.findMany({
      where: { skuCode: { in: chunk } },
      select: { skuCode: true },
    });
    for (const row of rows) known.add(row.skuCode);
  }
  return known;
}

/**
 * Count the configurations a dry run would create, against the catalog as
 * it stands. When no database is configured, the count is the number of
 * distinct canonical configurations the fetched rows carry, and the summary
 * says so.
 */
async function dryRunCounts(report: ExpansionReport): Promise<{
  canonicalSkusCreated: number;
  configurationsMerged: number;
  database: { consulted: boolean; reachable: boolean; error: string | null };
}> {
  const codes = report.canonicalSkuCodes;
  if (!process.env.DATABASE_URL) {
    return {
      canonicalSkusCreated: codes.length,
      configurationsMerged: report.records.length - codes.length,
      database: { consulted: false, reachable: false, error: null },
    };
  }
  try {
    const prisma = await getPrisma();
    const known = await existingSkuCodes(prisma, codes);
    const created = codes.filter((code) => !known.has(code)).length;
    const merged = report.records.length - created;
    return {
      canonicalSkusCreated: created,
      configurationsMerged: merged,
      database: { consulted: true, reachable: true, error: null },
    };
  } catch (error) {
    return {
      canonicalSkusCreated: codes.length,
      configurationsMerged: report.records.length - codes.length,
      database: {
        consulted: true,
        reachable: false,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      [
        "Ingest the expanded ENERGY STAR laptop configurations.",
        "",
        "  --dry-run          read and validate, write nothing",
        "  --limit N          read at most N source rows in total",
        "  --source <id>      registered dataset to read (default rxdj-2c88)",
        "  --types a,b,c      product types to read",
        "  --page-size N      rows per request (1..1000)",
        "",
        "Registered datasets:",
        ...REGISTERED_SOURCES.map(
          (source) => `  ${source.id}  ${source.name}  (${source.status})`
        ),
      ].join("\n")
    );
    return;
  }

  const source = getSource(options.sourceId);
  // The product types the expansion adds are read first, so that a limited
  // run still exercises the expansion. A full run reads every type, and the
  // order does not change the result.
  const types = options.types ?? [
    ...NEW_LAPTOP_PRODUCT_TYPES,
    ...BASE_LAPTOP_PRODUCT_TYPES,
  ];
  for (const type of types) {
    if (!isExpandedLaptopProductType(type)) {
      throw new Error(
        `'${type}' is not a laptop product type. Supported: ${EXPANDED_LAPTOP_PRODUCT_TYPES.join(", ")}`
      );
    }
  }

  // A source with no laptop product type yields no rows at all: that is a
  // measured answer, not an error. `runExpansion` reports it.
  const report = await runExpansion(
    source,
    { types, limit: options.limit, pageSize: options.pageSize }
  );

  const newCodes = report.canonicalSkuCodes.filter(
    (code) => !report.baseSkuCodes.includes(code)
  );

  let canonicalSkusCreated: number;
  let configurationsMerged: number;
  let alreadyPresent: number | null = null;
  let database: { consulted: boolean; reachable: boolean; error: string | null };

  if (options.dryRun) {
    const counts = await dryRunCounts(report);
    canonicalSkusCreated = counts.canonicalSkusCreated;
    configurationsMerged = counts.configurationsMerged;
    database = counts.database;
  } else {
    const prisma = await getPrisma();
    const persistence = await ingestReport(prisma, {
      source: report.source,
      adapterVersion: "2.0.0",
      observedAt: new Date().toISOString(),
      requested: report.recordsFetched,
      pages: report.pages,
      accepted: report.accepted,
      rejected: report.rejected,
      rejectedRecords: report.rejectedRecords,
      records: report.records,
      rawPayloads: report.rawPayloads,
    });
    canonicalSkusCreated = persistence.created;
    configurationsMerged = persistence.merged;
    alreadyPresent = persistence.unchanged;
    database = { consulted: true, reachable: true, error: null };
  }

  console.log(
    JSON.stringify(
      {
        source: report.source,
        recordsFetched: report.recordsFetched,
        accepted: report.accepted,
        rejected: report.rejected,
        canonicalSkusCreated,
        configurationsMerged,
        datasetId: report.datasetId,
        endpoint: report.endpoint,
        license: source.license,
        termsUrl: source.termsUrl,
        dryRun: options.dryRun,
        productTypes: report.productTypes,
        rowsPerProductType: report.rowsPerType,
        pagesRead: report.pages,
        distinctCanonicalConfigurations: report.canonicalSkuCodes.length,
        newCanonicalConfigurationsVsBaseProductTypes: newCodes.length,
        newProductTypes: [...NEW_LAPTOP_PRODUCT_TYPES],
        alreadyPresent,
        note: report.note,
        database,
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
    console.error("ENERGY STAR expanded ingestion failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prismaClient) await prismaClient.$disconnect();
  });
