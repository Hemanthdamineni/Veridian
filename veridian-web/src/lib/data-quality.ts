import { prisma } from "@/lib/db";

/**
 * The data-quality checks for the Veridian catalog.
 *
 * These checks are the single implementation of "is this catalog honest?".
 * The CLI report (`scripts/audit-data.ts`) and the admin dashboard API
 * (`/api/admin/quality`) both read them from here, so a number can never be
 * correct in one place and stale in the other.
 *
 * Every measure is computed from the database, never from a stored summary,
 * so the report cannot drift from the data it describes.
 *
 * A check is a *measure*, not a verdict: `count` is the number of rows that
 * violate the invariant. A non-zero count is a measurable gap in the
 * catalog and must be reported as such — it is not a pass.
 */

export type QualitySeverity = "error" | "warning" | "info";

export interface QualityCheck {
  /** Stable identifier of the invariant, e.g. `coverage/source-url`. */
  id: string;
  /** How serious a violation of this invariant is. */
  severity: QualitySeverity;
  /** How many rows currently violate the invariant. */
  count: number;
  /** What the check measures, in one sentence. */
  message: string;
  /** A short list of the affected values, so the finding is actionable. */
  samples: string[];
}

export interface QualityTotals {
  skus: number;
  visibleSkus: number;
  manufacturers: number;
  series: number;
  models: number;
  certifiedSpecs: number;
  rawObservations: number;
  rejectedObservations: number;
  skuSourceRecords: number;
  priceObservations: number;
  regionalPricing: number;
  components: number;
  skuComponentLinks: number;
  sellers: number;
  retailerListings: number;
}

export interface DataQualityReport {
  /** ISO timestamp of the moment the checks were run. */
  generatedAt: string;
  /** Size of the catalog in every dimension the checks care about. */
  totals: QualityTotals;
  /** How many configurations claim each provenance tier. */
  provenance: Record<string, number>;
  /** Every check, including the ones that currently hold. */
  checks: QualityCheck[];
}

/** How many affected values are kept per check. */
const MAX_SAMPLES = 5;

/**
 * Price plausibility ceilings, per currency.
 *
 * A single global ceiling would flag every rupee price as impossible, which
 * is exactly the kind of false alarm that trains people to ignore the
 * report.
 */
const PRICE_CEILINGS: ReadonlyArray<{ currency: string; ceiling: number }> = [
  { currency: "INR", ceiling: 500000 },
  { currency: "JPY", ceiling: 1000000 },
  { currency: "EUR", ceiling: 20000 },
  { currency: "GBP", ceiling: 20000 },
  { currency: "USD", ceiling: 100000 },
];

/**
 * Run every data-quality check against the live catalog.
 *
 * The returned `checks` array contains every check, in a stable order, with
 * its current count. Checks that currently hold are reported with a count of
 * zero so a reader can tell "measured and clean" from "not measured".
 */
export async function runDataQualityAudit(): Promise<DataQualityReport> {
  const checks: QualityCheck[] = [];

  const add = (
    id: string,
    severity: QualitySeverity,
    count: number,
    message: string,
    samples: string[] = []
  ) => {
    checks.push({ id, severity, count, message, samples: samples.slice(0, MAX_SAMPLES) });
  };

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
    prisma.seller.count(),
    prisma.retailerListing.count(),
  ]);

  // --- Provenance -----------------------------------------------------------
  const byProvenance = await prisma.sku.groupBy({ by: ["provenance"], _count: { _all: true } });
  const provenanceMap = Object.fromEntries(
    byProvenance.map((row) => [row.provenance, row._count._all])
  ) as Record<string, number>;

  // A configuration that claims certification but has no certified spec row
  // is claiming a provenance it cannot back up.
  const uncertifiedButClaimed = await prisma.sku.count({
    where: { provenance: "certified", certifiedSpecs: { none: {} } },
  });
  add(
    "provenance/unsupported-claim",
    "error",
    uncertifiedButClaimed,
    "Rows declare provenance 'certified' but carry no certified specification record"
  );

  // A configuration with a certified spec row must declare the certified tier.
  const certifiedButUndeclared = await prisma.sku.count({
    where: { provenance: { not: "certified" }, certifiedSpecs: { some: {} } },
  });
  add(
    "provenance/undeclared",
    "error",
    certifiedButUndeclared,
    "Rows carry a certified specification record but do not declare the 'certified' provenance"
  );

  // Every row must have at least one explicit provenance record.
  const withoutSource = await prisma.sku.count({ where: { sources: { none: {} } } });
  add(
    "provenance/missing",
    "error",
    withoutSource,
    "Rows carry no explicit provenance record"
  );

  // --- Duplicates -----------------------------------------------------------
  // Grouping is done through Prisma rather than raw SQL so the audit runs
  // unchanged on SQLite and PostgreSQL, whose table names differ.
  const duplicateSkuCodes = await prisma.sku.groupBy({
    by: ["skuCode"],
    _count: { _all: true },
    having: { skuCode: { _count: { gt: 1 } } },
  });
  add(
    "duplicates/sku-code",
    "error",
    duplicateSkuCodes.length,
    "Part numbers used by more than one canonical configuration"
  );

  // Two configurations of the same model that share a specification
  // signature but carry different part numbers. These are usually regional or
  // alternate part numbers for the same machine, and sometimes genuinely
  // different machines the source describes with the same coarse fields.
  // The part number is the stronger discriminator, so they are reported for
  // review rather than merged automatically.
  const alternatePartNumbers = await prisma.sku.groupBy({
    by: [
      "modelId",
      "cpuBrand",
      "cpuModel",
      "cpuCores",
      "ramGb",
      "storageType",
      "displaySizeIn",
      "displayRefreshHz",
      "batteryWh",
    ],
    _count: { _all: true },
    having: { modelId: { _count: { gt: 1 } } },
  });
  const affectedModels = new Set(alternatePartNumbers.map((row) => row.modelId));
  add(
    "identity/alternate-part-numbers",
    "info",
    affectedModels.size,
    "Models holding several part numbers with the same specification signature (kept separate on purpose)"
  );

  // --- Orphans --------------------------------------------------------------
  const orphanSeries = await prisma.series.count({ where: { models: { none: {} } } });
  add("integrity/empty-series", "warning", orphanSeries, "Series rows with no models");

  const orphanModels = await prisma.model.count({ where: { skus: { none: {} } } });
  add("integrity/empty-model", "warning", orphanModels, "Model rows with no configurations");

  const orphanManufacturers = await prisma.manufacturer.count({
    where: { series: { none: {} } },
  });
  add(
    "integrity/empty-manufacturer",
    "warning",
    orphanManufacturers,
    "Manufacturer rows with no series"
  );

  // --- Impossible or suspicious values --------------------------------------
  const badRam = await prisma.sku.count({ where: { OR: [{ ramGb: { lt: 1 } }, { ramGb: { gt: 512 } }] } });
  add("values/ram", "error", badRam, "Configurations with an impossible RAM capacity");

  const badWeight = await prisma.sku.count({
    where: { OR: [{ weightKg: { lt: 0.3 } }, { weightKg: { gt: 5 } }] },
  });
  add("values/weight", "error", badWeight, "Configurations with an impossible weight");

  const badBattery = await prisma.sku.count({
    where: { OR: [{ batteryWh: { lt: 5 } }, { batteryWh: { gt: 300 } }] },
  });
  add("values/battery", "error", badBattery, "Configurations with an impossible battery capacity");

  const badDisplay = await prisma.sku.count({
    where: { OR: [{ displaySizeIn: { lt: 8 } }, { displaySizeIn: { gt: 24 } }] },
  });
  add("values/display-size", "error", badDisplay, "Configurations with an impossible display size");

  const badRefresh = await prisma.sku.count({
    where: { OR: [{ displayRefreshHz: { lt: 24 } }, { displayRefreshHz: { gt: 500 } }] },
  });
  add("values/refresh-rate", "error", badRefresh, "Configurations with an impossible refresh rate");

  const badCores = await prisma.sku.count({
    where: { OR: [{ cpuCores: { lt: 1 } }, { cpuCores: { gt: 128 } }] },
  });
  add("values/cpu-cores", "error", badCores, "Configurations with an impossible CPU core count");

  // --- Coverage -------------------------------------------------------------
  // A source occasionally records a placeholder instead of a product ("UPLOAD
  // TO EPA", "Same as basic model"). Such a row describes no product and must
  // not sit in the catalog as if it did.
  const placeholderModels = await prisma.model.findMany({
    where: {
      OR: [
        { name: { equals: "UPLOAD TO EPA" } },
        { name: { contains: "Same as basic model" } },
        { name: { contains: "can be 0-9" } },
        { name: { contains: "or blank" } },
        { name: { equals: "Unknown" } },
      ],
    },
    select: { name: true, series: { select: { manufacturer: { select: { name: true } } } } },
  });
  add(
    "coverage/placeholder-model",
    "warning",
    placeholderModels.length,
    "Models whose recorded name is a source placeholder rather than a product",
    placeholderModels.map((m) => `${m.series.manufacturer.name} · ${m.name}`)
  );

  const missingCpu = await prisma.sku.count({ where: { cpuModel: "" } });
  add("coverage/cpu-model", "error", missingCpu, "Configurations with no CPU model");

  const missingOs = await prisma.sku.count({ where: { os: "" } });
  add("coverage/os", "error", missingOs, "Configurations with no operating system");

  const missingSeries = await prisma.sku.count({
    where: { model: { series: { name: "" } } },
  });
  add("coverage/series", "error", missingSeries, "Configurations with no series name");

  const missingProvenanceUrl = await prisma.skuSource.count({ where: { sourceUrl: null } });
  add(
    "coverage/source-url",
    "warning",
    missingProvenanceUrl,
    "Provenance records with no source URL to check the value against"
  );

  // --- Prices ---------------------------------------------------------------
  const priceWithoutSource = await prisma.priceObservation.count({
    where: { sourceUrl: null },
  });
  add(
    "price/no-source-url",
    "warning",
    priceWithoutSource,
    "Price observations with no source URL (reference values, not live retailer prices)"
  );

  const priceWithoutListing = await prisma.priceObservation.count({
    where: { listingId: null, kind: "retail" },
  });
  add(
    "price/no-listing",
    "warning",
    priceWithoutListing,
    "Retail-kind price observations not attached to a retailer listing"
  );

  const badPrices = await Promise.all(
    PRICE_CEILINGS.map(async ({ currency, ceiling }) => ({
      currency,
      count: await prisma.priceObservation.count({
        where: { currency, OR: [{ price: { lt: 1 } }, { price: { gt: ceiling } }] },
      }),
    }))
  );
  for (const entry of badPrices) {
    add(
      `price/out-of-range/${entry.currency}`,
      "error",
      entry.count,
      `Price observations outside a plausible range for ${entry.currency}`
    );
  }
  // A price in a currency we have no ceiling for is not checked rather than
  // checked against the wrong one.
  const uncheckedCurrencies = await prisma.priceObservation.groupBy({
    by: ["currency"],
    _count: { _all: true },
  });
  const known = new Set(PRICE_CEILINGS.map((entry) => entry.currency));
  for (const entry of uncheckedCurrencies) {
    if (known.has(entry.currency)) continue;
    add(
      `price/no-plausibility-range/${entry.currency}`,
      "info",
      entry._count._all,
      `Prices in ${entry.currency} are not checked against a plausibility range`
    );
  }

  const duplicateObservations = await prisma.priceObservation.groupBy({
    by: ["skuId", "region", "price", "timestamp", "sourceName"],
    _count: { _all: true },
    having: { skuId: { _count: { gt: 1 } } },
  });
  add(
    "price/duplicate-observation",
    "warning",
    duplicateObservations.length,
    "Identical price observations recorded more than once (breaks append-only semantics)"
  );

  // --- Raw observations -----------------------------------------------------
  const rejectedWithoutReason = await prisma.rawObservation.count({
    where: { status: "rejected", errors: null },
  });
  add(
    "ingestion/rejected-without-reason",
    "error",
    rejectedWithoutReason,
    "Rejected source records stored without a reason"
  );

  const acceptedWithoutSku = await prisma.rawObservation.count({
    where: { status: "accepted", skuId: null },
  });
  add(
    "ingestion/accepted-without-sku",
    "error",
    acceptedWithoutSku,
    "Accepted source records not linked to a canonical configuration"
  );

  // --- Components -----------------------------------------------------------
  const componentsWithoutAlias = await prisma.component.count({
    where: { aliases: { none: {} } },
  });
  add(
    "components/no-alias",
    "info",
    componentsWithoutAlias,
    "Components with no observed alias recorded"
  );

  return {
    generatedAt: new Date().toISOString(),
    totals: {
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
      sellers,
      retailerListings: listings,
    },
    provenance: provenanceMap,
    checks,
  };
}

/**
 * Summarise a report for a dashboard: how many checks exist, how many found
 * a gap, and how many rows are affected at each severity.
 *
 * A check with a non-zero count is a gap. It is never counted as a pass.
 */
export function summariseQuality(report: DataQualityReport) {
  const bySeverity: Record<QualitySeverity, { checks: number; affected: number }> = {
    error: { checks: 0, affected: 0 },
    warning: { checks: 0, affected: 0 },
    info: { checks: 0, affected: 0 },
  };

  let failingChecks = 0;
  for (const check of report.checks) {
    if (check.count === 0) continue;
    failingChecks += 1;
    bySeverity[check.severity].checks += 1;
    bySeverity[check.severity].affected += check.count;
  }

  return {
    totalChecks: report.checks.length,
    failingChecks,
    holdingChecks: report.checks.length - failingChecks,
    bySeverity,
  };
}
