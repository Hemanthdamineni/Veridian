/**
 * Data quality audit for the Veridian catalog.
 *
 * Measures the things a buyer would be misled by, and prints them with the
 * evidence needed to act. Everything reported here is computed from the
 * database, never from a stored summary, so the report cannot drift from the
 * data it describes.
 *
 * Usage:
 *   npm run db:audit              # human-readable report
 *   npm run db:audit -- --json    # machine-readable report
 */

import { prisma } from "../src/lib/db";

interface Finding {
  check: string;
  severity: "error" | "warning" | "info";
  count: number;
  detail: string;
  samples: string[];
}

const findings: Finding[] = [];

function add(
  check: string,
  severity: Finding["severity"],
  count: number,
  detail: string,
  samples: string[] = []
) {
  if (count > 0) findings.push({ check, severity, count, detail, samples: samples.slice(0, 5) });
}

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
  const duplicateSkuCodes = await prisma.$queryRaw<
    Array<{ skuCode: string; n: number }>
  >`SELECT skuCode, COUNT(*) as n FROM Sku GROUP BY skuCode HAVING COUNT(*) > 1`;
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
  const alternatePartNumbers = await prisma.$queryRaw<
    Array<{ modelId: string; n: number }>
  >`
    SELECT modelId, COUNT(*) as n FROM (
      SELECT s.modelId,
             s.cpuBrand, s.cpuModel, s.cpuCores, s.ramGb, s.storageType,
             s.displaySizeIn, s.displayRefreshHz, s.batteryWh
      FROM Sku s
      GROUP BY s.modelId, s.cpuBrand, s.cpuModel, s.cpuCores, s.ramGb,
               s.storageType, s.displaySizeIn, s.displayRefreshHz, s.batteryWh
      HAVING COUNT(*) > 1
    ) GROUP BY modelId
  `;
  add(
    "identity/alternate-part-numbers",
    "info",
    alternatePartNumbers.length,
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

  // Price plausibility is checked per currency. A single global ceiling
  // would flag every rupee price as impossible, which is exactly the kind of
  // false alarm that trains people to ignore the report.
  const priceCeilings: Array<{ currency: string; ceiling: number }> = [
    { currency: "INR", ceiling: 500000 },
    { currency: "JPY", ceiling: 1000000 },
    { currency: "EUR", ceiling: 20000 },
    { currency: "GBP", ceiling: 20000 },
    { currency: "USD", ceiling: 100000 },
  ];
  const badPrices = await Promise.all(
    priceCeilings.map(async ({ currency, ceiling }) => ({
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
  const known = new Set(priceCeilings.map((entry) => entry.currency));
  for (const entry of uncheckedCurrencies) {
    if (known.has(entry.currency)) continue;
    add(
      `price/no-plausibility-range/${entry.currency}`,
      "info",
      entry._count._all,
      `Prices in ${entry.currency} are not checked against a plausibility range`
    );
  }

  const duplicateObservations = await prisma.$queryRaw<
    Array<{ skuId: string; region: string; n: number }>
  >`
    SELECT skuId, region, COUNT(*) as n FROM PriceObservation
    GROUP BY skuId, region, price, timestamp, sourceName
    HAVING COUNT(*) > 1
  `;
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
    for (const [key, value] of Object.entries(provenanceMap)) {
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
