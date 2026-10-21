import type { PrismaClient } from "@prisma/client";
import type { PriceKind } from "@/lib/prices/source";

/**
 * Price history and price statistics.
 *
 * A price history is only useful if a reader can judge it. Every statistic
 * this module produces therefore carries three things the reader needs:
 *
 *   * the window it was computed over,
 *   * the number of observations that back it, and
 *   * the evidence class those observations carry.
 *
 * Three rules are absolute, and they are the point of this module:
 *
 *   1. A statistic computed from fewer than two observations is reported as
 *      insufficient, together with the count. A single observation is a data
 *      point, not an average, and presenting it as one would be a lie.
 *   2. A price is never carried forward, interpolated or invented. A gap in
 *      the observations is a gap, and it is reported as one.
 *   3. A manufacturer list price and a street price are different things.
 *      Every statistic says which kind of evidence it came from, so a
 *      published list price is never read as a price a buyer would pay.
 *
 * The module is deliberately free of a database dependency at import time:
 * the statistics are pure functions over observations, so they can be tested
 * without a database, and the loader accepts an injected client.
 */

/** The windows every price history is summarised over. */
export const PRICE_WINDOWS = ["7d", "30d", "90d", "all"] as const;

export type PriceWindowId = (typeof PRICE_WINDOWS)[number];

/** The length of each window in days. `all` has no length. */
export const WINDOW_DAYS: Record<PriceWindowId, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

/**
 * The fewest observations a statistic may be computed from.
 *
 * One observation is a reading, not a distribution. Reporting a minimum, a
 * maximum or a mean from a single point would dress a fact up as a
 * measurement, so a statistic that thin is refused.
 */
export const MIN_OBSERVATIONS_FOR_STATISTIC = 2;

/** A silence in the history longer than this is reported to the reader. */
export const GAP_THRESHOLD_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The evidence class of an observation.
 *
 * The three classes of ADR-005 are the contract. `unknown` exists for rows
 * whose stored class falls outside it: such a row is never relabelled as
 * something it might not be, because calling an unknown class `retail` would
 * present it as a street price.
 */
export type ObservationKind = PriceKind | "unknown";

const KIND_ORDER: ObservationKind[] = ["retail", "manufacturer", "review", "unknown"];

const KIND_LABELS: Record<ObservationKind, string> = {
  retail: "retail quotes",
  manufacturer: "manufacturer list prices",
  review: "review prices",
  unknown: "prices of an evidence class this API does not recognise",
};

/** The evidence class a statistic was computed from. */
export type EvidenceClass = ObservationKind | "mixed";

/** A price observation, normalised for the API. */
export interface PriceObservation {
  id: string;
  skuId: string;
  region: string;
  currency: string;
  price: number;
  kind: ObservationKind;
  sourceName: string | null;
  sourceUrl: string | null;
  retailer: string | null;
  inStock: boolean;
  confidence: number;
  timestamp: Date;
}

/** A price observation as it is written to the response. */
export interface PriceObservationPayload {
  id: string;
  timestamp: string;
  price: number;
  currency: string;
  kind: ObservationKind;
  sourceName: string | null;
  sourceUrl: string | null;
  retailer: string | null;
  inStock: boolean;
  confidence: number;
}

/** What a statistic is made of, stated plainly so a reader can judge it. */
export interface PriceEvidence {
  /** The evidence classes that contributed, in a stable order. */
  kinds: ObservationKind[];
  /** The single class, or `mixed` when more than one contributed. */
  evidenceClass: EvidenceClass;
  /** True only when every contributing observation is a retail quote. */
  isStreetPrice: boolean;
  /** The distinct sources the observations came from. */
  sourceNames: string[];
  /** The number of observations the evidence was drawn from. */
  observationCount: number;
  /** A plain-language statement of what the number is. */
  note: string;
}

/** The window a statistic was computed over. */
export interface PriceStatisticWindow {
  id: PriceWindowId;
  /** The length of the window in days, or null for the whole history. */
  days: number | null;
  /** The first moment of the window, ISO. */
  from: string | null;
  /** The last moment of the window, ISO. */
  to: string | null;
}

export type PriceStatisticStatus = "ok" | "insufficient_data";

/**
 * One statistic.
 *
 * `value` is present in both states so the shape never shifts; it is null
 * exactly when the evidence was too thin to compute one, and `status` and
 * `reason` say why.
 */
export interface PriceStatistic {
  status: PriceStatisticStatus;
  value: number | null;
  window: PriceStatisticWindow;
  /** The number of observations behind the statistic. */
  observationCount: number;
  currency: string | null;
  evidence: PriceEvidence;
  /** Why the statistic is not a number. Null when it is one. */
  reason: string | null;
}

/** The statistics for one currency, when a window holds more than one. */
export interface CurrencyStatistics {
  currency: string;
  observationCount: number;
  evidence: PriceEvidence;
  min: PriceStatistic;
  max: PriceStatistic;
  mean: PriceStatistic;
}

/** Everything known about one window. */
export interface WindowStatistics {
  window: PriceStatisticWindow;
  /** Observations in the window, across every currency it holds. */
  observationCount: number;
  /** Observations in the currency the statistics are computed in. */
  countedObservationCount: number;
  /** The currency the statistics are computed in. */
  currency: string | null;
  /** Every currency in the window and how many observations it holds. */
  currencies: { currency: string; observationCount: number }[];
  /** The evidence the statistics were computed from. */
  evidence: PriceEvidence;
  min: PriceStatistic;
  max: PriceStatistic;
  mean: PriceStatistic;
  /** The same statistics for every currency in the window. */
  byCurrency: CurrencyStatistics[];
  /** Observations left out of the statistics, and why. */
  excluded: { currency: string; observationCount: number; reason: string }[];
}

/** A silence in the history. */
export interface PriceGap {
  from: string;
  to: string;
  days: number;
}

/** How much history exists, and where it is missing. */
export interface PriceCoverage {
  /** The scope the coverage describes. */
  scope: string;
  /** Observations in scope, across the whole history. */
  totalObservationCount: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  daysSinceLastObservation: number | null;
  /** Silences longer than the gap threshold, oldest first. */
  gaps: PriceGap[];
}

/** The manufacturer's suggested price as last recorded. */
export interface CurrentPricing {
  msrp: number;
  currency: string;
  available: boolean;
  storeUrl: string | null;
  updatedAt: string;
  note: string;
}

/** The parameters of a price history request. */
export interface PriceHistoryQuery {
  skuId: string;
  region: string;
  window: PriceWindowId;
  currency: string | null;
}

/** The result of reading a request's query string. */
export type ParsedPriceHistoryQuery =
  | { ok: true; query: PriceHistoryQuery }
  | { ok: false; error: string };

/** The price history of one configuration, as it is written to the response. */
export interface PriceHistoryResponse {
  skuId: string;
  region: string;
  /** The currency filter that was applied, or null when none was. */
  currency: string | null;
  /** The window the observations below were taken from. */
  window: PriceWindowId;
  generatedAt: string;
  /** Observations in the requested window. */
  observationCount: number;
  observations: PriceObservationPayload[];
  /** The statistics for every window, not only the requested one. */
  statistics: Record<PriceWindowId, WindowStatistics>;
  coverage: PriceCoverage;
  currentPricing: CurrentPricing | null;
  /** Observations that were not counted, and why. */
  excluded: { otherCurrency: number; unusablePrice: number };
  /** Plain-language statements a reader needs in order to judge the above. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Reading the request
// ---------------------------------------------------------------------------

const REGION_PATTERN = /^[A-Za-z0-9_-]{1,16}$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

/**
 * Read the query string of a price history request.
 *
 * The window may be written `7`, `30`, `90` or `all`; the `d` forms are
 * accepted as well so `7d` and `7` mean the same thing. A malformed value
 * is refused rather than quietly replaced, because a reader who asked for
 * the wrong window must not be given the right one without being told.
 */
export function parsePriceHistoryQuery(
  searchParams: URLSearchParams,
  skuId: string
): ParsedPriceHistoryQuery {
  const rawRegion = searchParams.get("region");
  const region = (rawRegion === null || rawRegion.trim() === "" ? "US" : rawRegion).trim();
  if (!REGION_PATTERN.test(region)) {
    return { ok: false, error: "The region must be a short code such as US or IN." };
  }

  const rawWindow = (searchParams.get("window") ?? "all").trim().toLowerCase();
  const window = normalizeWindow(rawWindow);
  if (!window) {
    return { ok: false, error: "The window must be one of 7, 30, 90 or all." };
  }

  const rawCurrency = searchParams.get("currency");
  const currency =
    rawCurrency === null || rawCurrency.trim() === "" ? null : rawCurrency.trim().toUpperCase();
  if (currency !== null && !CURRENCY_PATTERN.test(currency)) {
    return { ok: false, error: "The currency must be a three-letter code such as USD." };
  }

  return {
    ok: true,
    query: {
      skuId,
      region: region.toUpperCase(),
      window,
      currency,
    },
  };
}

/**
 * Read a window name.
 *
 * `7`, `7d`, `30`, `30d`, `90`, `90d` and `all` are all accepted, so that
 * `?window=30` and `?window=30d` mean the same thing. Anything else is
 * refused rather than quietly replaced.
 */
export function normalizeWindow(raw: string): PriceWindowId | null {
  const value = raw.trim().toLowerCase();
  if (value === "all") return "all";
  if (value === "7" || value === "7d") return "7d";
  if (value === "30" || value === "30d") return "30d";
  if (value === "90" || value === "90d") return "90d";
  return null;
}

// ---------------------------------------------------------------------------
// Normalising observations
// ---------------------------------------------------------------------------

/** Map a stored evidence class onto the contract, without relabelling it. */
export function normalizeKind(raw: string | null | undefined): ObservationKind {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "retail" || value === "manufacturer" || value === "review") return value;
  return "unknown";
}

interface RawObservation {
  id: string;
  skuId: string;
  region: string;
  currency: string;
  price: number;
  kind: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  retailer: string | null;
  inStock: boolean;
  confidence: number;
  timestamp: Date;
}

/** Turn a stored row into an observation the statistics can be computed over. */
export function normalizeObservation(row: RawObservation): PriceObservation {
  return {
    id: row.id,
    skuId: row.skuId,
    region: row.region,
    currency: (row.currency ?? "").trim().toUpperCase(),
    price: row.price,
    kind: normalizeKind(row.kind),
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    retailer: row.retailer,
    inStock: row.inStock,
    confidence: row.confidence,
    timestamp: row.timestamp,
  };
}

/** The observations that belong in a response, and what was left out. */
export interface ObservationSelection {
  observations: PriceObservation[];
  excluded: {
    otherSku: number;
    otherRegion: number;
    otherCurrency: number;
    unusablePrice: number;
  };
}

/**
 * Keep only the observations that belong to one configuration in one region,
 * and — when the caller asked for one — in one currency.
 *
 * The configuration check is not a formality: it is the guarantee that one
 * configuration's history can never carry another's prices.
 */
export function filterObservations(
  observations: PriceObservation[],
  scope: { skuId: string; region: string; currency: string | null }
): ObservationSelection {
  const region = scope.region.trim().toUpperCase();
  const currency = scope.currency ? scope.currency.trim().toUpperCase() : null;

  const kept: PriceObservation[] = [];
  const excluded = { otherSku: 0, otherRegion: 0, otherCurrency: 0, unusablePrice: 0 };

  for (const observation of observations) {
    if (observation.skuId !== scope.skuId) {
      excluded.otherSku += 1;
      continue;
    }
    if (observation.region.trim().toUpperCase() !== region) {
      excluded.otherRegion += 1;
      continue;
    }
    if (currency !== null && observation.currency.trim().toUpperCase() !== currency) {
      excluded.otherCurrency += 1;
      continue;
    }
    if (!Number.isFinite(observation.price)) {
      excluded.unusablePrice += 1;
      continue;
    }
    kept.push(observation);
  }

  return { observations: kept, excluded };
}

/** Sort observations oldest first. The identifier breaks ties reproducibly. */
export function sortChronologically(observations: PriceObservation[]): PriceObservation[] {
  return [...observations].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id.localeCompare(b.id)
  );
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Describe what a set of observations is made of. */
export function describeEvidence(observations: PriceObservation[]): PriceEvidence {
  const kinds = KIND_ORDER.filter((kind) => observations.some((o) => o.kind === kind));
  const sourceNames: string[] = [];
  for (const observation of observations) {
    const name = observation.sourceName?.trim();
    if (name && !sourceNames.includes(name)) sourceNames.push(name);
  }
  sourceNames.sort((a, b) => a.localeCompare(b));

  const evidenceClass: EvidenceClass =
    kinds.length === 0 ? "unknown" : kinds.length === 1 ? kinds[0] : "mixed";
  const isStreetPrice = kinds.length === 1 && kinds[0] === "retail";

  return {
    kinds,
    evidenceClass,
    isStreetPrice,
    sourceNames,
    observationCount: observations.length,
    note: evidenceNote(kinds, evidenceClass),
  };
}

function evidenceNote(kinds: ObservationKind[], evidenceClass: EvidenceClass): string {
  if (kinds.length === 0) {
    return "There are no observations, so there is no evidence class to report.";
  }
  if (evidenceClass === "retail") {
    return "Every observation is a retail quote, so this is a street price.";
  }
  if (evidenceClass === "manufacturer") {
    return "Every observation is a manufacturer list price. This is a published list price, not a street price.";
  }
  if (evidenceClass === "review") {
    return "Every observation is a reported price from a review. It is not a quote from a seller.";
  }
  if (evidenceClass === "unknown") {
    return "The observations carry an evidence class this API does not recognise, so they are not presented as street prices.";
  }
  return `The observations mix ${kinds.map((kind) => KIND_LABELS[kind]).join(", ")}, so the result is not a street price.`;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function windowLabel(window: PriceStatisticWindow): string {
  if (window.id === "all") return "the whole history";
  return `the last ${window.days} days`;
}

function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Compute the minimum, maximum and mean of a set of prices.
 *
 * Fewer than two observations is not a distribution, so the statistic is
 * refused: the caller receives the count and a reason, never a number that
 * would read as a measurement.
 */
function computeStatistics(
  values: number[],
  window: PriceStatisticWindow,
  currency: string | null,
  evidence: PriceEvidence
): { min: PriceStatistic; max: PriceStatistic; mean: PriceStatistic } {
  const observationCount = values.length;

  if (observationCount < MIN_OBSERVATIONS_FOR_STATISTIC) {
    const insufficient: PriceStatistic = {
      status: "insufficient_data",
      value: null,
      window,
      observationCount,
      currency,
      evidence,
      reason:
        observationCount === 0
          ? `There are no observations in ${windowLabel(window)}.`
          : `There is only ${observationCount} observation in ${windowLabel(window)}. A statistic needs at least ${MIN_OBSERVATIONS_FOR_STATISTIC}.`,
    };
    return { min: insufficient, max: insufficient, mean: insufficient };
  }

  let min = values[0];
  let max = values[0];
  let sum = 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  const mean = roundToCents(sum / observationCount);

  const ok = (value: number): PriceStatistic => ({
    status: "ok",
    value,
    window,
    observationCount,
    currency,
    evidence,
    reason: null,
  });

  return { min: ok(min), max: ok(max), mean: ok(mean) };
}

/**
 * The currency a window's statistics are computed in.
 *
 * Prices in different currencies are not comparable, so they are never
 * averaged together. The most recent observation decides the currency,
 * because it is the one that reflects the market as it stands; the others
 * are reported separately under `byCurrency`.
 */
function primaryCurrency(observations: PriceObservation[]): string | null {
  if (observations.length === 0) return null;
  let latest = observations[0];
  for (const observation of observations) {
    if (observation.timestamp.getTime() >= latest.timestamp.getTime()) latest = observation;
  }
  return latest.currency;
}

function currencyCounts(observations: PriceObservation[]): { currency: string; observationCount: number }[] {
  const counts = new Map<string, number>();
  for (const observation of observations) {
    counts.set(observation.currency, (counts.get(observation.currency) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([currency, observationCount]) => ({ currency, observationCount }))
    .sort((a, b) => b.observationCount - a.observationCount || a.currency.localeCompare(b.currency));
}

/** Compute the statistics of one window. */
export function computeWindowStatistics(
  id: PriceWindowId,
  observations: PriceObservation[],
  asOf: Date
): WindowStatistics {
  const days = WINDOW_DAYS[id];
  const cutoff = days === null ? null : new Date(asOf.getTime() - days * MS_PER_DAY);
  const inWindow = observations.filter(
    (observation) => cutoff === null || observation.timestamp.getTime() >= cutoff.getTime()
  );

  const window: PriceStatisticWindow = {
    id,
    days,
    from:
      cutoff !== null
        ? cutoff.toISOString()
        : inWindow.length > 0
          ? inWindow[0].timestamp.toISOString()
          : null,
    to:
      cutoff !== null
        ? asOf.toISOString()
        : inWindow.length > 0
          ? inWindow[inWindow.length - 1].timestamp.toISOString()
          : null,
  };

  const currencies = currencyCounts(inWindow);
  const currency = primaryCurrency(inWindow);
  const counted = currency === null ? [] : inWindow.filter((o) => o.currency === currency);

  const evidence = describeEvidence(counted);
  const { min, max, mean } = computeStatistics(
    counted.map((o) => o.price),
    window,
    currency,
    evidence
  );

  const byCurrency: CurrencyStatistics[] = currencies.map((entry) => {
    const inCurrency = inWindow.filter((o) => o.currency === entry.currency);
    const currencyEvidence = describeEvidence(inCurrency);
    const stats = computeStatistics(
      inCurrency.map((o) => o.price),
      window,
      entry.currency,
      currencyEvidence
    );
    return {
      currency: entry.currency,
      observationCount: inCurrency.length,
      evidence: currencyEvidence,
      ...stats,
    };
  });

  // One entry per currency that was left out, not one per observation.
  const excluded = currencies
    .filter((entry) => entry.currency !== currency)
    .map((entry) => ({
      currency: entry.currency,
      observationCount: entry.observationCount,
      reason:
        `Statistics are computed in ${currency}, the currency of the most recent observation. ` +
        `Prices in ${entry.currency} are not comparable with it and are reported under byCurrency.`,
    }));

  return {
    window,
    observationCount: inWindow.length,
    countedObservationCount: counted.length,
    currency,
    currencies,
    evidence,
    min,
    max,
    mean,
    byCurrency,
    excluded,
  };
}

/** Compute the statistics of every window. */
export function computeAllWindowStatistics(
  observations: PriceObservation[],
  asOf: Date
): Record<PriceWindowId, WindowStatistics> {
  const sorted = sortChronologically(observations);
  const statistics = {} as Record<PriceWindowId, WindowStatistics>;
  for (const id of PRICE_WINDOWS) {
    statistics[id] = computeWindowStatistics(id, sorted, asOf);
  }
  return statistics;
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/** Describe the history that exists, and where it is missing. */
export function describeCoverage(
  observations: PriceObservation[],
  scope: { region: string; currency: string | null },
  asOf: Date
): PriceCoverage {
  const sorted = sortChronologically(observations);
  const gaps: PriceGap[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const days = (current.timestamp.getTime() - previous.timestamp.getTime()) / MS_PER_DAY;
    if (days > GAP_THRESHOLD_DAYS) {
      gaps.push({
        from: previous.timestamp.toISOString(),
        to: current.timestamp.toISOString(),
        days: Math.floor(days),
      });
    }
  }

  const last = sorted.length > 0 ? sorted[sorted.length - 1] : null;

  return {
    scope: `region ${scope.region}${scope.currency ? `, currency ${scope.currency}` : ""}, across the whole history`,
    totalObservationCount: sorted.length,
    firstObservedAt: sorted.length > 0 ? sorted[0].timestamp.toISOString() : null,
    lastObservedAt: last ? last.timestamp.toISOString() : null,
    daysSinceLastObservation: last
      ? Math.max(0, Math.floor((asOf.getTime() - last.timestamp.getTime()) / MS_PER_DAY))
      : null,
    gaps,
  };
}

// ---------------------------------------------------------------------------
// The response
// ---------------------------------------------------------------------------

/** Everything needed to assemble a price history, before any database call. */
export interface PriceHistoryInput {
  skuId: string;
  region: string;
  currency: string | null;
  window: PriceWindowId;
  /** The observations of this configuration in this region, already filtered. */
  observations: PriceObservation[];
  currentPricing: CurrentPricing | null;
  /** The moment the history is read at. */
  asOf: Date;
  /** Counts of what was left out of the observations above. */
  excluded?: { otherCurrency: number; unusablePrice: number };
}

/**
 * Assemble the price history of one configuration.
 *
 * The function is pure: it takes the observations that belong to the
 * configuration and returns what a reader is entitled to see. A
 * configuration with no observations produces the same shape as one with
 * many, with empty collections and explicit counts rather than nulls.
 */
export function buildPriceHistory(input: PriceHistoryInput): PriceHistoryResponse {
  const window = normalizeWindow(input.window) ?? "all";
  const sorted = sortChronologically(input.observations);
  const statistics = computeAllWindowStatistics(sorted, input.asOf);
  const coverage = describeCoverage(sorted, { region: input.region, currency: input.currency }, input.asOf);

  const days = WINDOW_DAYS[window];
  const cutoff = days === null ? null : new Date(input.asOf.getTime() - days * MS_PER_DAY);
  const inWindow = sorted.filter(
    (observation) => cutoff === null || observation.timestamp.getTime() >= cutoff.getTime()
  );

  const observations: PriceObservationPayload[] = inWindow.map((observation) => ({
    id: observation.id,
    timestamp: observation.timestamp.toISOString(),
    price: observation.price,
    currency: observation.currency,
    kind: observation.kind,
    sourceName: observation.sourceName,
    sourceUrl: observation.sourceUrl,
    retailer: observation.retailer,
    inStock: observation.inStock,
    confidence: observation.confidence,
  }));

  const excluded = {
    otherCurrency: input.excluded?.otherCurrency ?? 0,
    unusablePrice: input.excluded?.unusablePrice ?? 0,
  };

  const notes = buildNotes({
    input,
    window,
    statistics,
    coverage,
    observationCount: inWindow.length,
  });

  return {
    skuId: input.skuId,
    region: input.region,
    currency: input.currency,
    window,
    generatedAt: input.asOf.toISOString(),
    observationCount: observations.length,
    observations,
    statistics,
    coverage,
    currentPricing: input.currentPricing,
    excluded,
    notes,
  };
}

function buildNotes(context: {
  input: PriceHistoryInput;
  window: PriceWindowId;
  statistics: Record<PriceWindowId, WindowStatistics>;
  coverage: PriceCoverage;
  observationCount: number;
}): string[] {
  const { input, window, statistics, coverage, observationCount } = context;
  const notes: string[] = [];
  const requested = statistics[window];

  if (coverage.totalObservationCount === 0) {
    notes.push(
      `No price observations have been recorded for this configuration in region ${input.region}` +
        `${input.currency ? ` and currency ${input.currency}` : ""}. ` +
        "There is no history to summarise, and no price is inferred from its absence."
    );
  } else if (observationCount === 0) {
    notes.push(
      `There are no observations in ${windowLabel(requested.window)}. ` +
        `The history holds ${coverage.totalObservationCount} observation(s) in total, which the all-time statistics cover.`
    );
  }

  if (requested.observationCount > 0 && requested.observationCount < MIN_OBSERVATIONS_FOR_STATISTIC) {
    notes.push(
      `Only ${requested.observationCount} observation in ${windowLabel(requested.window)}. ` +
        "A minimum, a maximum and a mean need at least two observations, so they are reported as insufficient."
    );
  }

  if (requested.countedObservationCount > 0 && requested.evidence.kinds.length === 1) {
    if (requested.evidence.evidenceClass === "manufacturer") {
      notes.push(
        "Every observation in this window is a manufacturer list price. These are published list prices, not street prices."
      );
    } else if (requested.evidence.evidenceClass === "review") {
      notes.push(
        "Every observation in this window is a reported price from a review, not a quote from a seller."
      );
    } else if (requested.evidence.evidenceClass === "retail") {
      notes.push("Every observation in this window is a retail quote, so the statistics are street prices.");
    }
  }

  if (requested.excluded.length > 0) {
    for (const entry of requested.excluded) {
      notes.push(
        `${entry.observationCount} observation(s) in ${entry.currency} are excluded from the statistics above. ${entry.reason}`
      );
    }
  }

  if (coverage.gaps.length > 0) {
    notes.push(
      `The history holds ${coverage.gaps.length} gap(s) longer than ${GAP_THRESHOLD_DAYS} days. ` +
        "A gap is a gap: no price is carried across it."
    );
  }

  if (coverage.daysSinceLastObservation !== null && coverage.daysSinceLastObservation > 30) {
    notes.push(
      `The most recent observation is ${coverage.daysSinceLastObservation} days old. The history may be stale.`
    );
  }

  if (input.currentPricing) {
    notes.push(
      "The manufacturer's suggested price below is a reference figure recorded at the last update. It is not a street price and it is not one of the observations above."
    );
  }

  return notes;
}

// ---------------------------------------------------------------------------
// The loader
// ---------------------------------------------------------------------------

type PriceObservationDelegate = Pick<PrismaClient["priceObservation"], "findMany">;
type SkuRegionalPricingDelegate = Pick<PrismaClient["skuRegionalPricing"], "findUnique">;

/** The slice of the database the loader needs. */
export interface PriceHistoryClient {
  priceObservation: PriceObservationDelegate;
  skuRegionalPricing: SkuRegionalPricingDelegate;
}

/**
 * Read the price history of one configuration.
 *
 * The configuration is the only thing that is ever asked for: the query is
 * bound to it, and the observations are filtered again afterwards, so one
 * configuration's history can never carry another's prices.
 */
export async function loadPriceHistory(
  query: PriceHistoryQuery,
  client?: PriceHistoryClient
): Promise<PriceHistoryResponse> {
  const db = client ?? (await import("@/lib/db")).prisma;

  const rows = await db.priceObservation.findMany({
    where: { skuId: query.skuId, region: query.region },
    orderBy: [{ timestamp: "asc" }, { id: "asc" }],
    select: {
      id: true,
      skuId: true,
      region: true,
      currency: true,
      price: true,
      kind: true,
      sourceName: true,
      sourceUrl: true,
      retailer: true,
      inStock: true,
      confidence: true,
      timestamp: true,
    },
  });

  const selection = filterObservations(
    rows.map((row) => normalizeObservation(row)),
    query
  );

  const pricing = await db.skuRegionalPricing.findUnique({
    where: { skuId_region: { skuId: query.skuId, region: query.region } },
    select: {
      msrp: true,
      currency: true,
      available: true,
      storeUrl: true,
      updatedAt: true,
    },
  });

  return buildPriceHistory({
    skuId: query.skuId,
    region: query.region,
    currency: query.currency,
    window: normalizeWindow(query.window) ?? "all",
    observations: selection.observations,
    currentPricing: pricing
      ? {
          msrp: pricing.msrp,
          currency: pricing.currency,
          available: pricing.available,
          storeUrl: pricing.storeUrl,
          updatedAt: pricing.updatedAt.toISOString(),
          note:
            "The manufacturer's suggested price as last recorded. It is a reference figure, not a street price, and it is not an observation.",
        }
      : null,
    asOf: new Date(),
    excluded: {
      otherCurrency: selection.excluded.otherCurrency,
      unusablePrice: selection.excluded.unusablePrice,
    },
  });
}
