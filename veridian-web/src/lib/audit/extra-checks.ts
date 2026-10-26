/**
 * Extra data-quality checks for the Veridian catalog.
 *
 * The base audit (scripts/audit-data.ts) covers the defects that broke the
 * catalog once: missing provenance, impossible values, empty structural rows.
 * This module covers the defects that are still invisible — a product filed
 * twice, a weight that contradicts the screen it is sold with, a price in the
 * wrong currency for its region, a component nothing links to, a configuration
 * no page can reach.
 *
 * Rules of the house, kept identical to the base audit:
 *
 *   * ids are `area/thing`;
 *   * severities are `error`, `warning` or `info`;
 *   * a check reports a count and, at most, five samples that make the
 *     finding actionable;
 *   * every check is a Prisma query. Nothing here loads the catalog into
 *     memory: counts happen in the database and only the handful of rows that
 *     back a finding are read back.
 *
 * The module is read-only. It never writes, repairs or deletes a row, and it
 * never assumes the catalog is in any particular state: an empty database is a
 * catalog with nothing wrong with it, not a crash.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

export type Severity = "error" | "warning" | "info";

export interface Finding {
  check: string;
  severity: Severity;
  count: number;
  detail: string;
  samples: string[];
}

/** The base audit's `add(checkId, severity, count, message, samples?)`. */
export type AddFinding = (
  check: string,
  severity: Severity,
  count: number,
  detail: string,
  samples?: string[]
) => void;

export interface ExtraCheck {
  /** The check id, `area/thing`, matching the base audit's convention. */
  id: string;
  /** What the check proves when it passes. */
  description: string;
  run(client: PrismaClient, add: AddFinding): Promise<void>;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

/**
 * The provenance tiers the catalog writes today (ADR-005): a certified
 * record, a manufacturer's own figure, or an unverified one.
 */
const KNOWN_TIERS = ["certified", "manufacturer", "unverified"];

/** Refresh rates real panels ship with, in hertz. */
const PLAUSIBLE_REFRESH_HZ: number[] = [24, 30, 40, 48, 50, 60, 75, 90, 100, 120, 144, 165, 180, 240, 360];

/** A laptop display is between these diagonals, in inches. */
const MIN_DISPLAY_IN = 8;
const MAX_DISPLAY_IN = 22;

/** A laptop battery is between these capacities, in watt hours. */
const MIN_BATTERY_WH = 10;
const MAX_BATTERY_WH = 200;

/** A laptop weighs between these, in kilograms, whatever its screen size. */
const MIN_WEIGHT_KG = 0.2;
const MAX_WEIGHT_KG = 5;

/** Memory capacities, in gigabytes, that are actually sold. */
const REAL_RAM_GB = [1, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192];
const MIN_RAM_GB = 1;
const MAX_RAM_GB = 256;

/**
 * Plausible weight bands by screen diagonal. A 10" netbook and a 17" workstation
 * cannot weigh the same, so the band narrows as the screen grows. The bands
 * are generous: they are meant to catch a number that cannot be right, not to
 * argue about whether a laptop is heavy for its size.
 */
const WEIGHT_BANDS: Array<{ minDisplayIn: number; maxDisplayIn: number; minKg: number; maxKg: number }> = [
  { minDisplayIn: 0, maxDisplayIn: 12, minKg: 0.3, maxKg: 2.2 },
  { minDisplayIn: 12, maxDisplayIn: 14, minKg: 0.4, maxKg: 2.6 },
  { minDisplayIn: 14, maxDisplayIn: 15, minKg: 0.5, maxKg: 3.0 },
  { minDisplayIn: 15, maxDisplayIn: 16, minKg: 0.6, maxKg: 3.6 },
  { minDisplayIn: 16, maxDisplayIn: Number.POSITIVE_INFINITY, minKg: 0.7, maxKg: 5.0 },
];

/**
 * The currency a region is priced in. A region that is not on this list is not
 * judged rather than judged against the wrong currency: an unmapped region is
 * reported as unchecked, never as a mismatch.
 */
const REGION_CURRENCY: Record<string, string> = {
  AE: "AED", AR: "ARS", AT: "EUR", AU: "AUD", BE: "EUR", BG: "BGN", BR: "BRL", CA: "CAD",
  CH: "CHF", CL: "CLP", CN: "CNY", CO: "COP", CZ: "CZK", DE: "EUR", DK: "DKK", EG: "EGP",
  ES: "EUR", EU: "EUR", FI: "EUR", FR: "EUR", GB: "GBP", GR: "EUR", HK: "HKD", HR: "EUR",
  HU: "HUF", ID: "IDR", IE: "EUR", IL: "ILS", IN: "INR", IT: "EUR", JP: "JPY", KE: "KES",
  KR: "KRW", MA: "MAD", MX: "MXN", MY: "MYR", NG: "NGN", NL: "EUR", NO: "NOK", NZ: "AUD",
  PH: "PHP", PK: "PKR", PL: "PLN", PT: "EUR", RO: "RON", SA: "SAR", SE: "SEK", SG: "SGD",
  TH: "THB", TR: "TRY", TW: "TWD", UA: "UAH", US: "USD", VN: "VND", ZA: "ZAR",
  // The same places, written out.
  "EUROPE": "EUR", "UNITED KINGDOM": "GBP", "UNITED STATES": "USD", INDIA: "INR", JAPAN: "JPY",
};

/** Collapse a name to the form two spellings of the same thing share. */
function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * A value no row can have as its id: the nil UUID.
 *
 * A required relation filters as an inner join, so a row whose parent is gone
 * does not match. To count the rows that *do* have a parent, the parent is
 * filtered on a column every row has. The id cannot be used for that directly:
 * the SQLite edition uses cuid strings and the PostgreSQL edition uses UUIDs,
 * so a comparison with an empty string is valid on one engine and rejected on
 * the other. The nil UUID is a valid id on both and matches no row on either.
 */
const NO_ROW_ID = "00000000-0000-0000-0000-000000000000";

/** The weight band that applies to a display size. */
function weightBand(displaySizeIn: number | null): { minKg: number; maxKg: number } {
  if (displaySizeIn === null) return { minKg: MIN_WEIGHT_KG, maxKg: MAX_WEIGHT_KG };
  const band = WEIGHT_BANDS.find((candidate) => displaySizeIn <= candidate.maxDisplayIn);
  return band ?? WEIGHT_BANDS[WEIGHT_BANDS.length - 1];
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

const duplicateModelName: ExtraCheck = {
  id: "identity/duplicate-model-name",
  description: "Two models in one series that share a name but not a slug: the same product filed twice",
  async run(client, add) {
    const groups = await client.model.groupBy({
      by: ["seriesId", "name"],
      _count: { _all: true },
      having: { name: { _count: { gt: 1 } } },
    });

    let affected = 0;
    const samples: string[] = [];
    for (const group of groups) {
      affected += group._count._all;
      if (samples.length >= 5) continue;
      const rows = await client.model.findMany({
        where: { seriesId: group.seriesId, name: group.name },
        select: {
          slug: true,
          series: { select: { name: true, manufacturer: { select: { name: true } } } },
        },
      });
      if (rows.length < 2) continue;
      const slugs = rows.map((row) => row.slug).join(", ");
      samples.push(
        `${rows[0].series.manufacturer.name} · ${rows[0].series.name} · ${group.name} — filed as ${slugs}`
      );
    }

    add(
      "identity/duplicate-model-name",
      "warning",
      affected,
      "Models that share a name with another model in the same series (the same product filed twice)",
      samples
    );
  },
};

const impossibleWeight: ExtraCheck = {
  id: "integrity/impossible-weight",
  description: "A weight no laptop can weigh, or one that contradicts the screen it is sold with",
  async run(client, add) {
    const where: Prisma.SkuWhereInput = {
      weightKg: { not: null },
      OR: [
        { weightKg: { lt: MIN_WEIGHT_KG } },
        { weightKg: { gt: MAX_WEIGHT_KG } },
        ...WEIGHT_BANDS.map((band) => ({
          AND: [
            { displaySizeIn: { gt: band.minDisplayIn } },
            // The open-ended band has no upper bound to compare against.
            ...(Number.isFinite(band.maxDisplayIn)
              ? [{ displaySizeIn: { lte: band.maxDisplayIn } }]
              : []),
            { OR: [{ weightKg: { lt: band.minKg } }, { weightKg: { gt: band.maxKg } }] },
          ],
        })),
      ],
    };

    const count = await client.sku.count({ where });
    const rows = await client.sku.findMany({
      where,
      take: 5,
      orderBy: { skuCode: "asc" },
      select: { skuCode: true, weightKg: true, displaySizeIn: true },
    });

    const samples = rows.map((row) => {
      const band = weightBand(row.displaySizeIn);
      const display =
        row.displaySizeIn === null ? "no display size reported" : `${row.displaySizeIn} in display`;
      return `${row.skuCode} — ${row.weightKg ?? "?"} kg with a ${display} (plausible ${band.minKg}-${band.maxKg} kg)`;
    });

    add(
      "integrity/impossible-weight",
      "error",
      count,
      `Weights outside ${MIN_WEIGHT_KG}-${MAX_WEIGHT_KG} kg, or outside the plausible band for the reported screen size`,
      samples
    );
  },
};

const impossibleDisplay: ExtraCheck = {
  id: "integrity/impossible-display",
  description: "A display diagonal, refresh rate or battery capacity no laptop has",
  async run(client, add) {
    const badDisplay: Prisma.SkuWhereInput = {
      OR: [{ displaySizeIn: { lt: MIN_DISPLAY_IN } }, { displaySizeIn: { gt: MAX_DISPLAY_IN } }],
    };
    const badRefresh: Prisma.SkuWhereInput = {
      displayRefreshHz: { not: null, notIn: PLAUSIBLE_REFRESH_HZ },
    };
    const badBattery: Prisma.SkuWhereInput = {
      OR: [{ batteryWh: { lt: MIN_BATTERY_WH } }, { batteryWh: { gt: MAX_BATTERY_WH } }],
    };

    const [displayCount, refreshCount, batteryCount, total] = await Promise.all([
      client.sku.count({ where: badDisplay }),
      client.sku.count({ where: badRefresh }),
      client.sku.count({ where: badBattery }),
      client.sku.count({ where: { OR: [badDisplay, badRefresh, badBattery] } }),
    ]);

    const rows = await client.sku.findMany({
      where: { OR: [badDisplay, badRefresh, badBattery] },
      take: 5,
      orderBy: { skuCode: "asc" },
      select: { skuCode: true, displaySizeIn: true, displayRefreshHz: true, batteryWh: true },
    });
    const samples = rows.map((row) => {
      const problems: string[] = [];
      if (
        row.displaySizeIn !== null &&
        (row.displaySizeIn < MIN_DISPLAY_IN || row.displaySizeIn > MAX_DISPLAY_IN)
      ) {
        problems.push(`${row.displaySizeIn} in display`);
      }
      if (row.displayRefreshHz !== null && !PLAUSIBLE_REFRESH_HZ.includes(row.displayRefreshHz)) {
        problems.push(`${row.displayRefreshHz} Hz refresh rate`);
      }
      if (row.batteryWh !== null && (row.batteryWh < MIN_BATTERY_WH || row.batteryWh > MAX_BATTERY_WH)) {
        problems.push(`${row.batteryWh} Wh battery`);
      }
      return `${row.skuCode} — ${problems.join(", ")}`;
    });

    add(
      "integrity/impossible-display",
      "error",
      total,
      `Displays outside ${MIN_DISPLAY_IN}-${MAX_DISPLAY_IN} in (${displayCount}), refresh rates that are not a real panel rate (${refreshCount}), batteries outside ${MIN_BATTERY_WH}-${MAX_BATTERY_WH} Wh (${batteryCount})`,
      samples
    );
  },
};

const ramTypeCapacity: ExtraCheck = {
  id: "consistency/ram-type-capacity",
  description: "A memory capacity no laptop ships, or a soldered flag that contradicts the memory",
  async run(client, add) {
    const badCapacity: Prisma.SkuWhereInput = {
      OR: [{ ramGb: { lt: MIN_RAM_GB } }, { ramGb: { gt: MAX_RAM_GB } }],
    };
    // LPDDR is soldered to the board, so it cannot live in a replaceable slot.
    const replaceableButLpddr: Prisma.SkuWhereInput = {
      ramSoldered: { equals: false },
      ramType: { contains: "LPDDR" },
    };
    // Plain DDR is a replaceable module, so it cannot be soldered down.
    const solderedButReplaceable: Prisma.SkuWhereInput = {
      ramSoldered: { equals: true },
      ramType: { contains: "DDR", not: { contains: "LPDDR" } },
    };
    // A replaceable module is sold in standard sizes only.
    const unsoldCapacity: Prisma.SkuWhereInput = {
      ramSoldered: { equals: false },
      ramGb: { notIn: REAL_RAM_GB },
    };

    const [capacityCount, lpddrCount, solderedCount, unsoldCount, total] = await Promise.all([
      client.sku.count({ where: badCapacity }),
      client.sku.count({ where: replaceableButLpddr }),
      client.sku.count({ where: solderedButReplaceable }),
      client.sku.count({ where: unsoldCapacity }),
      client.sku.count({
        where: { OR: [badCapacity, replaceableButLpddr, solderedButReplaceable, unsoldCapacity] },
      }),
    ]);

    const rows = await client.sku.findMany({
      where: { OR: [badCapacity, replaceableButLpddr, solderedButReplaceable, unsoldCapacity] },
      take: 5,
      orderBy: { skuCode: "asc" },
      select: { skuCode: true, ramGb: true, ramType: true, ramSoldered: true },
    });
    const samples = rows.map((row) => {
      const problems: string[] = [];
      if (row.ramGb < MIN_RAM_GB || row.ramGb > MAX_RAM_GB) {
        problems.push(`${row.ramGb} GB is outside ${MIN_RAM_GB}-${MAX_RAM_GB} GB`);
      }
      if (row.ramSoldered === false && row.ramType && /LPDDR/i.test(row.ramType)) {
        problems.push(`${row.ramType} is soldered memory but the row says it is replaceable`);
      }
      if (row.ramSoldered === true && row.ramType && /DDR/i.test(row.ramType) && !/LPDDR/i.test(row.ramType)) {
        problems.push(`${row.ramType} is a replaceable module but the row says it is soldered`);
      }
      if (row.ramSoldered === false && !REAL_RAM_GB.includes(row.ramGb)) {
        problems.push(`${row.ramGb} GB is not a capacity modules are sold in`);
      }
      return `${row.skuCode} — ${problems.join(", ")}`;
    });

    add(
      "consistency/ram-type-capacity",
      "error",
      total,
      `Memory outside ${MIN_RAM_GB}-${MAX_RAM_GB} GB (${capacityCount}), replaceable memory typed as soldered-only LPDDR (${lpddrCount}), soldered memory typed as replaceable DDR (${solderedCount}), capacities no module is sold in (${unsoldCount})`,
      samples
    );
  },
};

const missingLaunchDate: ExtraCheck = {
  id: "coverage/missing-launch-date",
  description: "A product the catalog cannot place in time",
  async run(client, add) {
    const where: Prisma.ModelWhereInput = {
      launchDate: null,
      skus: { every: { launchDate: null } },
    };

    const count = await client.model.count({ where });
    const rows = await client.model.findMany({
      where,
      take: 5,
      orderBy: { name: "asc" },
      select: {
        name: true,
        series: { select: { name: true, manufacturer: { select: { name: true } } } },
      },
    });
    const samples = rows.map(
      (row) => `${row.series.manufacturer.name} · ${row.series.name} · ${row.name}`
    );

    add(
      "coverage/missing-launch-date",
      "warning",
      count,
      "Products with no launch date on the model and none on any of their configurations",
      samples
    );
  },
};

const placeholderIdentity: ExtraCheck = {
  id: "coverage/placeholder-identity",
  description: "A series or model whose name carries no product identity at all",
  async run(client, add) {
    // A slug is derived from the name by keeping its letters and digits. An
    // empty slug therefore means the name was made of nothing but punctuation
    // and separators: the source reported a placeholder where a product name
    // was expected, and the row was filed under it.
    const [seriesCount, modelCount] = await Promise.all([
      client.series.count({ where: { slug: "" } }),
      client.model.count({ where: { slug: "" } }),
    ]);

    const samples: string[] = [];
    if (seriesCount > 0) {
      const rows = await client.series.findMany({
        where: { slug: "" },
        take: 5,
        select: { name: true, manufacturer: { select: { name: true } } },
      });
      for (const row of rows) {
        samples.push(`${row.manufacturer.name} · series "${row.name}" carries no product name`);
      }
    }
    if (modelCount > 0) {
      const rows = await client.model.findMany({
        where: { slug: "" },
        take: 5,
        select: { name: true, series: { select: { name: true } } },
      });
      for (const row of rows) {
        samples.push(`${row.series.name} · model "${row.name}" carries no product name`);
      }
    }

    add(
      "coverage/placeholder-identity",
      "warning",
      seriesCount + modelCount,
      `Series (${seriesCount}) and models (${modelCount}) whose name holds no letters or digits, so the source reported a placeholder rather than a product`,
      samples
    );
  },
};

const orphanComponent: ExtraCheck = {
  id: "coverage/orphan-component",
  description: "A component nothing links to, or an alias pointing at a component that is gone",
  async run(client, add) {
    const [unlinked, aliasTotal, aliasLinked, specTotal, specLinked] = await Promise.all([
      client.component.count({ where: { skus: { none: {} } } }),
      client.componentAlias.count(),
      // A required relation filters as an inner join, so a row whose parent is
      // gone does not match and the difference is the dangling count.
      client.componentAlias.count({ where: { component: { id: { not: NO_ROW_ID } } } }),
      client.componentSpec.count(),
      client.componentSpec.count({ where: { component: { id: { not: NO_ROW_ID } } } }),
    ]);

    const danglingAliases = aliasTotal - aliasLinked;
    const danglingSpecs = specTotal - specLinked;
    const count = unlinked + danglingAliases + danglingSpecs;

    const samples: string[] = [];
    if (unlinked > 0) {
      const orphans = await client.component.findMany({
        where: { skus: { none: {} } },
        take: 5,
        orderBy: { slug: "asc" },
        select: { kind: true, canonicalName: true, slug: true },
      });
      for (const orphan of orphans) {
        samples.push(`${orphan.kind} · ${orphan.canonicalName} (${orphan.slug}) is linked to no configuration`);
      }
    }

    add(
      "coverage/orphan-component",
      "warning",
      count,
      `Components no configuration links to (${unlinked}), aliases pointing at a component that does not exist (${danglingAliases}), specifications pointing at a component that does not exist (${danglingSpecs})`,
      samples
    );
  },
};

const duplicateComponent: ExtraCheck = {
  id: "graph/duplicate-component",
  description: "Two components of one kind whose canonical names differ only in case or whitespace",
  async run(client, add) {
    // Only the identity of a component is needed, not its specifications.
    // Case and whitespace are collapsed in the application because SQLite and
    // PostgreSQL disagree about what "equal" means for a string.
    const components = await client.component.findMany({
      select: { kind: true, canonicalName: true, slug: true },
    });

    const groups = new Map<string, typeof components>();
    for (const component of components) {
      const key = `${component.kind}::${normalizeName(component.canonicalName)}`;
      const group = groups.get(key);
      if (group) group.push(component);
      else groups.set(key, [component]);
    }
    const duplicates = [...groups.values()].filter((group) => group.length > 1);

    const samples = duplicates
      .slice(0, 5)
      .map((group) => `${group[0].kind} · ${group[0].canonicalName} — filed as ${group.map((c) => c.slug).join(", ")}`);

    add(
      "graph/duplicate-component",
      "error",
      duplicates.length,
      "Components whose canonical name differs from another component of the same kind only in case or whitespace (the same part filed twice)",
      samples
    );
  },
};

const currencyRegionMismatch: ExtraCheck = {
  id: "price/currency-region-mismatch",
  description: "A price whose currency contradicts the region it was recorded for",
  async run(client, add) {
    const observationGroups = await client.priceObservation.groupBy({
      by: ["region", "currency"],
      _count: { _all: true },
    });
    const pricingGroups = await client.skuRegionalPricing.groupBy({
      by: ["region", "currency"],
      _count: { _all: true },
    });

    let observations = 0;
    let pricingRows = 0;
    let uncheckedObservations = 0;
    let uncheckedPricingRows = 0;
    const mismatches: Array<{
      table: "observation" | "pricing";
      region: string;
      currency: string;
      expected: string;
      rows: number;
    }> = [];

    for (const group of observationGroups) {
      const expected = REGION_CURRENCY[group.region.trim().toUpperCase()];
      if (!expected) {
        uncheckedObservations += group._count._all;
        continue;
      }
      if (expected !== group.currency.trim().toUpperCase()) {
        observations += group._count._all;
        mismatches.push({
          table: "observation",
          region: group.region,
          currency: group.currency,
          expected,
          rows: group._count._all,
        });
      }
    }
    for (const group of pricingGroups) {
      const expected = REGION_CURRENCY[group.region.trim().toUpperCase()];
      if (!expected) {
        uncheckedPricingRows += group._count._all;
        continue;
      }
      if (expected !== group.currency.trim().toUpperCase()) {
        pricingRows += group._count._all;
        mismatches.push({
          table: "pricing",
          region: group.region,
          currency: group.currency,
          expected,
          rows: group._count._all,
        });
      }
    }

    const samples: string[] = [];
    for (const mismatch of mismatches.slice(0, 5)) {
      if (mismatch.table === "observation") {
        const row = await client.priceObservation.findFirst({
          where: { region: mismatch.region, currency: mismatch.currency },
          select: { sku: { select: { skuCode: true } }, price: true },
        });
        if (!row) continue;
        samples.push(
          `${row.sku.skuCode} — ${mismatch.currency} ${row.price} observed for region ${mismatch.region} (${mismatch.expected} expected)`
        );
      } else {
        const row = await client.skuRegionalPricing.findFirst({
          where: { region: mismatch.region, currency: mismatch.currency },
          select: { sku: { select: { skuCode: true } }, msrp: true },
        });
        if (!row) continue;
        samples.push(
          `${row.sku.skuCode} — ${mismatch.currency} ${row.msrp} listed for region ${mismatch.region} (${mismatch.expected} expected)`
        );
      }
    }

    add(
      "price/currency-region-mismatch",
      "error",
      observations + pricingRows,
      `Prices whose currency contradicts their region: ${observations} observation(s), ${pricingRows} regional pricing row(s); ${uncheckedObservations + uncheckedPricingRows} row(s) in regions with no known currency were left unchecked`,
      samples
    );
  },
};

const sourceWithoutKind: ExtraCheck = {
  id: "provenance/source-without-kind",
  description: "A source whose evidence class is not a tier, or a configuration whose tier contradicts its own sources",
  async run(client, add) {
    const unknownKind = await client.skuSource.count({
      where: { kind: { notIn: KNOWN_TIERS } },
    });

    // A configuration must declare the tier its strongest source supports, and
    // must not claim a tier no source backs. A configuration with no source at
    // all is the base audit's `provenance/missing`, not this one.
    const contradiction: Prisma.SkuWhereInput = {
      AND: [
        { sources: { some: {} } },
        {
          OR: [
            { provenance: "certified", sources: { none: { kind: "certified" } } },
            { provenance: "manufacturer", sources: { none: { kind: { in: ["certified", "manufacturer"] } } } },
            { provenance: "manufacturer", sources: { some: { kind: "certified" } } },
            {
              provenance: { in: ["retailer", "unverified"] },
              sources: { some: { kind: { in: ["certified", "manufacturer"] } } },
            },
          ],
        },
      ],
    };
    const contradicting = await client.sku.count({ where: contradiction });

    const rows = await client.sku.findMany({
      where: contradiction,
      take: 5,
      orderBy: { skuCode: "asc" },
      select: {
        skuCode: true,
        provenance: true,
        sources: { select: { kind: true } },
      },
    });
    const samples = rows.map(
      (row) =>
        `${row.skuCode} — declared ${row.provenance}, sources ${row.sources.map((s) => s.kind).join(", ") || "none"}`
    );

    if (unknownKind > 0) {
      const unknownRows = await client.skuSource.findMany({
        where: { kind: { notIn: KNOWN_TIERS } },
        take: 5,
        orderBy: { source: "asc" },
        select: { kind: true, source: true, sku: { select: { skuCode: true } } },
      });
      for (const row of unknownRows) {
        samples.push(`${row.sku.skuCode} — source "${row.source}" has the class "${row.kind}"`);
      }
    }

    add(
      "provenance/source-without-kind",
      "error",
      unknownKind + contradicting,
      `Source records whose evidence class is not one of ${KNOWN_TIERS.join(", ")} (${unknownKind}), configurations whose provenance contradicts the kinds of their own sources (${contradicting})`,
      samples
    );
  },
};

const unreachable: ExtraCheck = {
  id: "catalog/unreachable",
  description: "A visible configuration no page can reach",
  async run(client, add) {
    const [visible, withModel, withSeries, withManufacturer] = await Promise.all([
      client.sku.count({ where: { catalogVisible: true } }),
      client.sku.count({ where: { catalogVisible: true, model: { id: { not: NO_ROW_ID } } } }),
      client.sku.count({
        where: { catalogVisible: true, model: { series: { id: { not: NO_ROW_ID } } } },
      }),
      client.sku.count({
        where: {
          catalogVisible: true,
          model: { series: { manufacturer: { id: { not: NO_ROW_ID } } } },
        },
      }),
    ]);

    const count = visible - withManufacturer;
    const samples: string[] = [];
    if (count > 0) {
      const [reachable, visibleRows] = await Promise.all([
        client.sku.findMany({
          where: {
            catalogVisible: true,
            model: { series: { manufacturer: { id: { not: NO_ROW_ID } } } },
          },
          select: { skuCode: true },
        }),
        client.sku.findMany({
          where: { catalogVisible: true },
          select: { skuCode: true },
          orderBy: { skuCode: "asc" },
        }),
      ]);
      const reachableCodes = new Set(reachable.map((row) => row.skuCode));
      for (const row of visibleRows) {
        if (reachableCodes.has(row.skuCode)) continue;
        samples.push(`${row.skuCode} — no manufacturer to reach it through`);
        if (samples.length >= 5) break;
      }
    }

    add(
      "catalog/unreachable",
      "error",
      count,
      `Visible configurations with no model (${visible - withModel}), with no series (${withModel - withSeries}) or with no manufacturer (${withSeries - withManufacturer})`,
      samples
    );
  },
};

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

export const EXTRA_CHECKS: ExtraCheck[] = [
  duplicateModelName,
  impossibleWeight,
  impossibleDisplay,
  ramTypeCapacity,
  missingLaunchDate,
  placeholderIdentity,
  orphanComponent,
  duplicateComponent,
  currencyRegionMismatch,
  sourceWithoutKind,
  unreachable,
];

/**
 * Run every extra check against a database.
 *
 * A check that finds nothing still reports its zero, because "nothing found"
 * and "not looked at" are different answers. A check that cannot run reports
 * an error rather than being skipped: an invariant nobody could evaluate is
 * not an invariant that holds.
 */
export async function runExtraChecks(client: PrismaClient): Promise<Finding[]> {
  const findings: Finding[] = [];

  for (const check of EXTRA_CHECKS) {
    const collected: Finding[] = [];
    const add: AddFinding = (id, severity, count, detail, samples = []) => {
      collected.push({ check: id, severity, count, detail, samples: samples.slice(0, 5) });
    };

    try {
      await check.run(client, add);
    } catch (error) {
      collected.push({
        check: check.id,
        severity: "error",
        count: 1,
        detail: `The check could not be evaluated: ${(error as Error).message}`,
        samples: [],
      });
    }

    findings.push(...collected);
  }

  return findings;
}
