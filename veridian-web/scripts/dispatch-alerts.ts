/**
 * Deliver the alerts that fired.
 *
 * The command evaluates every enabled alert against the recorded prices and
 * sends the ones that fired through the notification channel the alert
 * names. Nothing is sent twice: every delivery is recorded as an
 * append-only receipt, and a firing whose receipt already exists is
 * reported as already dispatched rather than sent again.
 *
 * A channel that is not configured reports that it skipped. A delivery that
 * fails is reported with the error and is not recorded as delivered, so it
 * can be tried again.
 *
 * Usage:
 *   npx tsx scripts/dispatch-alerts.ts --dry-run
 *   npx tsx scripts/dispatch-alerts.ts --limit 10
 */

import { prisma } from "../src/lib/db";
import { evaluateAlert, markDispatched, summarize, type AlertEvaluation } from "../src/lib/alerts";
import {
  DISPATCH_SOURCE,
  resolveChannel,
  type AlertNotification,
  type NotificationResult,
} from "../src/lib/notifications";
import { loadAlerts, loadDispatchedFingerprints, type LoadedAlert } from "./evaluate-alerts";

/** What happened to one alert's notification. */
interface DeliveryEntry {
  alertId: string;
  skuId: string;
  skuCode: string | null;
  region: string;
  rule: string | null;
  channel: string;
  outcome: "delivered" | "skipped" | "failed" | "would_deliver" | "would_skip";
  subject: string;
  targetUrl: string | null;
  reason?: string;
  error?: string;
  detail?: string;
  fingerprint: string;
  explanation: string;
}

/** The report the command prints. */
interface DispatchReport {
  dispatchedAt: string;
  dryRun: boolean;
  alertsEvaluated: number;
  fired: number;
  wouldDispatch: number;
  delivered: number;
  skipped: number;
  failed: number;
  alreadyDispatched: number;
  deliveries: DeliveryEntry[];
}

/** The URL an alert carries, when its channel names one. */
function carriedTargetUrl(channel: string): string | null {
  const name = channel.trim();
  if (!name.startsWith("webhook:")) return null;
  const url = name.slice("webhook:".length).trim();
  return url || null;
}

/** Turn an evaluation into the message a channel delivers. */
export function buildNotification(
  entry: LoadedAlert,
  evaluation: AlertEvaluation,
  firedAt: Date
): AlertNotification {
  const evidence = evaluation.currentPriceEvidence;
  const name = entry.sku?.modelName ?? entry.sku?.skuCode ?? evaluation.skuId;
  const price =
    evaluation.currentPrice === null
      ? "an unknown price"
      : `${evaluation.currentPrice.toFixed(2)} ${evaluation.currentPriceCurrency ?? ""}`.trim();

  const subject = `${name}: ${evaluation.rule ?? "price"} alert — ${price}`;

  const reference = evaluation.references[0];
  return {
    alertId: evaluation.alertId,
    userId: evaluation.userId,
    skuId: evaluation.skuId,
    region: evaluation.region,
    rule: evaluation.rule ?? "unknown",
    channel: entry.alert.channel,
    subject,
    body: evaluation.explanation,
    price: evaluation.currentPrice,
    currency: evaluation.currentPriceCurrency,
    evidenceClass: evaluation.evidenceClass,
    source: evidence?.source ?? null,
    sourceUrl: evidence?.sourceUrl ?? null,
    reference: reference
      ? {
          label: reference.label,
          value: reference.value,
          currency: reference.currency,
          kind: reference.kind,
          source: reference.source,
          observedAt: reference.observedAt.toISOString(),
        }
      : null,
    explanation: evaluation.explanation,
    fingerprint: evaluation.fingerprint,
    observedAt: evidence?.observedAt.toISOString() ?? null,
    firedAt: firedAt.toISOString(),
    targetUrl: carriedTargetUrl(entry.alert.channel),
  };
}

/**
 * Record a delivery attempt.
 *
 * A delivery is written as a receipt under the `alert-dispatch` source, so
 * the record survives a restart and a repeat of the same firing can be
 * recognised. Only a delivery that happened is recorded as `accepted`; a
 * failure is recorded as `rejected` and does not count as delivered.
 */
async function recordReceipt(
  evaluation: AlertEvaluation,
  notification: AlertNotification,
  result: NotificationResult
): Promise<void> {
  await prisma.rawObservation.create({
    data: {
      source: DISPATCH_SOURCE,
      sourceUrl: notification.sourceUrl,
      observedAt: new Date(notification.firedAt),
      payloadHash: evaluation.fingerprint,
      payload: JSON.stringify(notification),
      status: result.outcome === "delivered" ? "accepted" : "rejected",
      errors: result.error ?? null,
      rawRecordId: evaluation.alertId,
      skuId: evaluation.skuId,
    },
  });
}

/** Parse the command line. */
function parseArgs(argv: string[]): { dryRun: boolean; limit?: number } {
  const options: { dryRun: boolean; limit?: number } = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--limit" || argument.startsWith("--limit=")) {
      const inline = argument.startsWith("--limit=")
        ? argument.slice("--limit=".length)
        : argv[index + 1];
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
        "Usage: npx tsx scripts/dispatch-alerts.ts [--dry-run] [--limit N]\n" +
          "\n" +
          "  --dry-run   report what would be dispatched without sending or writing\n" +
          "  --limit N   consider at most N enabled alerts"
      );
      process.exit(0);
    }
    throw new Error(`unknown argument "${argument}"`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const firedAt = new Date();

  const loaded = await loadAlerts({ limit: options.limit });
  const dispatched = await loadDispatchedFingerprints();

  const deliveries: DeliveryEntry[] = [];
  let wouldDispatch = 0;
  let delivered = 0;
  let skipped = 0;
  let failed = 0;

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

  for (let index = 0; index < loaded.length; index += 1) {
    const entry = loaded[index];
    const evaluation = evaluations[index];
    if (!evaluation.fired) continue;

    const notification = buildNotification(entry, evaluation, firedAt);
    const channel = resolveChannel(entry.alert.channel);
    const base: DeliveryEntry = {
      alertId: evaluation.alertId,
      skuId: evaluation.skuId,
      skuCode: entry.sku?.skuCode ?? null,
      region: evaluation.region,
      rule: evaluation.rule,
      channel: channel.name,
      outcome: "skipped",
      subject: notification.subject,
      targetUrl: notification.targetUrl,
      fingerprint: evaluation.fingerprint,
      explanation: evaluation.explanation,
    };

    if (options.dryRun) {
      if (channel.isConfigured(notification)) {
        wouldDispatch += 1;
        deliveries.push({
          ...base,
          outcome: "would_deliver",
          detail: `the ${channel.name} channel is configured for this alert`,
        });
      } else {
        skipped += 1;
        deliveries.push({
          ...base,
          outcome: "would_skip",
          reason: channel.notConfiguredReason(notification),
        });
      }
      continue;
    }

    const result = await channel.send(notification);
    if (result.outcome === "delivered") {
      delivered += 1;
      deliveries.push({
        ...base,
        outcome: "delivered",
        detail: result.detail,
        reason: result.reason,
        error: result.error,
      });
      await recordReceipt(evaluation, notification, result);
      await prisma.alert.update({
        where: { id: evaluation.alertId },
        data: { lastTriggered: firedAt },
      });
      continue;
    }

    if (result.outcome === "failed") {
      failed += 1;
      deliveries.push({
        ...base,
        outcome: "failed",
        error: result.error ?? "the channel failed without giving a reason",
        detail: result.detail,
      });
      // The attempt is written down so the failure is not invisible, but it
      // is not a delivery and it does not stop the alert being tried again.
      await recordReceipt(evaluation, notification, result);
      continue;
    }

    skipped += 1;
    deliveries.push({
      ...base,
      outcome: "skipped",
      reason: result.reason ?? channel.notConfiguredReason(notification),
    });
  }

  const summary = summarize(evaluations);
  const report: DispatchReport = {
    dispatchedAt: firedAt.toISOString(),
    dryRun: options.dryRun,
    alertsEvaluated: summary.alertsEvaluated,
    fired: summary.fired,
    wouldDispatch,
    delivered,
    skipped,
    failed,
    alreadyDispatched: summary.skippedAlreadyDispatched,
    deliveries,
  };

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
        `dispatch-alerts failed: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
