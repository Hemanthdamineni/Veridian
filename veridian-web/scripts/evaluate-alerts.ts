/**
 * Evaluate every enabled price alert against the recorded prices.
 *
 * The command reads the catalog, runs each enabled alert through the rules
 * in `src/lib/alerts.ts` and prints a report. It is deliberately a report
 * and nothing else: it sends no notification, and in `--dry-run` mode it
 * writes nothing at all.
 *
 * The report is JSON so that it can be read by a person and by a pipeline:
 *
 *   {
 *     "alertsEvaluated": 3,
 *     "fired": 1,
 *     "skippedInsufficientData": 1,
 *     "skippedNoPrice": 1,
 *     "skippedConditionNotMet": 0,
 *     "skippedAlreadyDispatched": 0,
 *     "alerts": [ { ...one alert, with its explanation... } ]
 *   }
 *
 * Usage:
 *   npx tsx scripts/evaluate-alerts.ts --dry-run
 *   npx tsx scripts/evaluate-alerts.ts --limit 10
 *
 * The data access here is shared with `scripts/dispatch-alerts.ts`, which
 * imports `loadAlerts` and `loadDispatchedFingerprints` from this file.
 */

import { prisma } from "../src/lib/db";
import {
  evaluateAlert,
  markDispatched,
  summarize,
  type AlertEvaluation,
  type AlertInput,
  type ListedPrice,
  type PriceObservationInput,
} from "../src/lib/alerts";
import { DISPATCH_SOURCE } from "../src/lib/notifications";

/** An alert together with everything the rules need to judge it. */
export interface LoadedAlert {
  alert: AlertInput;
  observations: PriceObservationInput[];
  listedPrice: ListedPrice | null;
  sku: {
    id: string;
    skuCode: string;
    modelName: string | null;
    manufacturerName: string | null;
  } | null;
  userEmail: string | null;
}

/** The result of one evaluation, with the catalog context attached. */
export interface AlertReportEntry extends AlertEvaluation {
  conditionType: string;
  channel: string;
  skuCode: string | null;
  modelName: string | null;
  manufacturerName: string | null;
  userEmail: string | null;
}

/**
 * The fingerprints of the firings that have already been delivered.
 *
 * A firing is recorded as a receipt in `RawObservation` under the
 * `alert-dispatch` source, so the record survives a restart. Only receipts
 * that were actually delivered count; a failed attempt is not a delivery and
 * does not silence a later retry.
 */
export async function loadDispatchedFingerprints(): Promise<Set<string>> {
  const receipts = await prisma.rawObservation.findMany({
    where: { source: DISPATCH_SOURCE, status: "accepted" },
    select: { payloadHash: true },
  });
  return new Set(receipts.map((receipt) => receipt.payloadHash));
}

/**
 * Load the enabled alerts and the prices they are judged against.
 *
 * Only the observations of the alerted SKU are loaded, and only the regions
 * the alert asks about are used by the rules.
 */
export async function loadAlerts(options: { limit?: number } = {}): Promise<LoadedAlert[]> {
  const alerts = await prisma.alert.findMany({
    where: { active: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...(typeof options.limit === "number" ? { take: options.limit } : {}),
    include: {
      sku: {
        select: {
          id: true,
          skuCode: true,
          model: {
            select: {
              name: true,
              series: { select: { manufacturer: { select: { name: true } } } },
            },
          },
        },
      },
      user: { select: { email: true } },
    },
  });

  const skuIds = [...new Set(alerts.map((alert) => alert.skuId))];
  if (skuIds.length === 0) return [];

  const [observations, pricing] = await Promise.all([
    prisma.priceObservation.findMany({ where: { skuId: { in: skuIds } } }),
    prisma.skuRegionalPricing.findMany({ where: { skuId: { in: skuIds } } }),
  ]);

  return alerts.map((alert) => {
    const sku = alert.sku;
    const listed = pricing.find(
      (entry) => entry.skuId === alert.skuId && entry.region === alert.region
    );
    return {
      alert: {
        id: alert.id,
        userId: alert.userId,
        skuId: alert.skuId,
        region: alert.region,
        conditionType: alert.conditionType,
        thresholdValue: alert.thresholdValue,
        channel: alert.channel,
        active: alert.active,
        lastTriggered: alert.lastTriggered,
      },
      observations: observations
        .filter((observation) => observation.skuId === alert.skuId)
        .map((observation) => ({
          id: observation.id,
          price: observation.price,
          currency: observation.currency,
          kind: observation.kind,
          sourceName: observation.sourceName,
          retailer: observation.retailer,
          sourceUrl: observation.sourceUrl,
          region: observation.region,
          timestamp: observation.timestamp,
          inStock: observation.inStock,
        })),
      listedPrice: listed
        ? {
            value: listed.msrp,
            currency: listed.currency,
            region: listed.region,
            updatedAt: listed.updatedAt,
          }
        : null,
      sku: sku
        ? {
            id: sku.id,
            skuCode: sku.skuCode,
            modelName: sku.model?.name ?? null,
            manufacturerName: sku.model?.series?.manufacturer?.name ?? null,
          }
        : null,
      userEmail: alert.user?.email ?? null,
    };
  });
}

/** The whole report the command prints. */
export interface EvaluationReport {
  evaluatedAt: string;
  dryRun: boolean;
  alertsEvaluated: number;
  fired: number;
  skippedInsufficientData: number;
  skippedNoPrice: number;
  skippedConditionNotMet: number;
  skippedAlreadyDispatched: number;
  alerts: AlertReportEntry[];
}

/**
 * Evaluate the loaded alerts and build the report.
 *
 * A firing that has already been delivered is reported as such rather than
 * as a new firing, so the report never overstates what is outstanding.
 */
export function buildReport(
  loaded: LoadedAlert[],
  dispatchedFingerprints: Iterable<string>,
  options: { dryRun: boolean; evaluatedAt?: Date } = { dryRun: true }
): EvaluationReport {
  const dispatched = new Set(dispatchedFingerprints);
  const evaluations = loaded.map((entry) =>
    markDispatched(
      evaluateAlert({
        alert: entry.alert,
        observations: entry.observations,
        listedPrice: entry.listedPrice,
        dispatchedFingerprints: dispatched,
      }),
      dispatched
    )
  );

  const alerts: AlertReportEntry[] = loaded.map((entry, index) => {
    const evaluation = evaluations[index];
    return {
      ...evaluation,
      conditionType: entry.alert.conditionType,
      channel: entry.alert.channel,
      skuCode: entry.sku?.skuCode ?? null,
      modelName: entry.sku?.modelName ?? null,
      manufacturerName: entry.sku?.manufacturerName ?? null,
      userEmail: entry.userEmail,
    };
  });

  const summary = summarize(evaluations);
  return {
    evaluatedAt: (options.evaluatedAt ?? new Date()).toISOString(),
    dryRun: options.dryRun,
    ...summary,
    alerts,
  };
}

/** Parse the command line. */
export function parseArgs(argv: string[]): { dryRun: boolean; limit?: number } {
  const options: { dryRun: boolean; limit?: number } = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--limit" || argument.startsWith("--limit=")) {
      const inline = argument.startsWith("--limit=") ? argument.slice("--limit=".length) : argv[index + 1];
      const value = Number(inline);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`--limit needs a number of alerts, got "${inline}"`);
      }
      options.limit = Math.floor(value);
      if (!argument.startsWith("--limit=")) index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: npx tsx scripts/evaluate-alerts.ts [--dry-run] [--limit N]\n" +
          "\n" +
          "  --dry-run   evaluate and report without writing anything\n" +
          "  --limit N   evaluate at most N enabled alerts"
      );
      process.exit(0);
    }
    throw new Error(`unknown argument "${argument}"`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const loaded = await loadAlerts({ limit: options.limit });
  const dispatched = await loadDispatchedFingerprints();
  const report = buildReport(loaded, dispatched, { dryRun: options.dryRun });

  if (!options.dryRun) {
    // The condition was met. This is not a record of a delivery — the
    // dispatcher writes that — only the fact that the alert matched.
    const fired = report.alerts.filter((alert) => alert.outcome === "fired");
    for (const alert of fired) {
      await prisma.alert.update({
        where: { id: alert.alertId },
        data: { lastTriggered: new Date(report.evaluatedAt) },
      });
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

const isDirectRun =
  typeof require !== "undefined" &&
  typeof module !== "undefined" &&
  require.main === module;

if (isDirectRun) {
  main()
    .catch((error: unknown) => {
      console.error(
        `evaluate-alerts failed: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
