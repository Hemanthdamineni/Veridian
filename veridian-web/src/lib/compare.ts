// Comparison logic.
//
// Every rule that decides what a reader is told lives here, so it can be
// tested without a database or a browser. The comparison page and the public
// `/api/v1/compare` endpoint both read from this module, which keeps the two
// answers identical.
//
// The rule the whole module is built around: a winner may only be declared on
// a metric that EVERY compared configuration reports. A missing value is not
// a loss, and it is never treated as one.

import type { SkuProvenance } from "@/types";
import { formatPrice, formatStorage, formatWeight } from "@/lib/format";

/** A comparison holds at most this many configurations. */
export const COMPARE_MAX_CONFIGS = 5;

/** Which way is "better" for a metric. `none` means the metric is descriptive. */
export type CompareDirection = "higher" | "lower" | "none";

/** A port reported for a configuration. */
export interface ComparePort {
  type: string;
  count: number;
}

/**
 * The values one configuration reports.
 *
 * Every field is nullable, and `null` means exactly one thing: this
 * configuration does not report the value. That distinction is what the
 * winner rule depends on, so it is never collapsed into `undefined` or `0`.
 */
export interface CompareValues {
  cpu: string | null;
  cpuCores: number | null;
  gpu: string | null;
  ramGb: number | null;
  ramType: string | null;
  ramSoldered: boolean | null;
  storageGb: number | null;
  storageType: string | null;
  storageSlots: number | null;
  displaySizeIn: number | null;
  displayResolution: string | null;
  displayType: string | null;
  displayRefreshHz: number | null;
  displayNits: number | null;
  displayTouch: boolean | null;
  weightKg: number | null;
  batteryWh: number | null;
  batteryLifeHours: number | null;
  os: string | null;
  ports: ComparePort[];
  /** Manufacturer suggested price for the region being compared. */
  price: number | null;
  priceCurrency: string | null;
  /** When that price was recorded. */
  priceUpdatedAt: string | null;
}

/** One configuration taking part in a comparison. */
export interface CompareRow {
  id: string;
  skuCode: string;
  modelName: string;
  brand: string;
  series: string;
  /** Provenance tier of the underlying catalog row. */
  provenance: SkuProvenance;
  values: CompareValues;
}

/** A metric that can be compared across configurations. */
export interface CompareMetric {
  key: string;
  /** The section of the table this metric belongs to. */
  group: string;
  /** The label shown in the table. */
  label: string;
  /** The wording used when this metric is named in a sentence. */
  sentenceLabel: string;
  direction: CompareDirection;
  /**
   * The wording used when this metric's best value is announced, e.g.
   * "Most RAM". `null` for descriptive metrics, which have no best value.
   */
  bestLabel: string | null;
  /** The raw value for a row, or `null` when the row does not report it. */
  get: (row: CompareRow) => string | number | boolean | null;
  /** The display text for a reported value. */
  format: (value: string | number | boolean, row: CompareRow) => string;
}

/** One cell of the comparison table. */
export interface CompareCell {
  rowIndex: number;
  /** `null` when the row does not report the metric. */
  value: string | number | boolean | null;
  /** The display text. Empty when the value is not reported. */
  text: string;
  reported: boolean;
  /** True when this cell holds the best reported value of the metric. */
  best: boolean;
}

/** The outcome of comparing one metric across every row. */
export interface CompareMetricResult {
  metric: CompareMetric;
  cells: CompareCell[];
  /** How many rows report the metric. */
  reportedCount: number;
  /** True when every row reports the metric. */
  comparable: boolean;
  /** True when every row reports it and all the values are equal. */
  identical: boolean;
  /** True when every row reports it and the values are not all equal. */
  differs: boolean;
  /** The rows holding the best value. Empty when there is no best value. */
  bestIndexes: number[];
  /** The rows that do not report the metric. */
  missingIndexes: number[];
  /** A plain statement of why no winner is declared, when that is the case. */
  note: string | null;
}

/** A table section: one metric group and the metrics inside it. */
export interface CompareGroup {
  name: string;
  metrics: CompareMetricResult[];
}

/** What the comparison actually found. */
export interface ComparisonSummary {
  /** The one-sentence answer to "what differs". */
  sentence: string;
  /** Metrics whose values differ across every row that reports them. */
  differing: string[];
  /** Metrics every row reports and every row agrees on. */
  identical: string[];
  /** Metrics at least one row does not report. */
  incomplete: string[];
  /** True when the configurations share no metric at all. */
  nothingToCompare: boolean;
}

/** How the compared rows were sourced. */
export interface ComparisonProvenance {
  /** The distinct tiers present, strongest first. */
  tiers: SkuProvenance[];
  /** True when every row shares one tier. */
  uniform: boolean;
  /** How many rows sit in each tier. */
  counts: Record<SkuProvenance, number>;
  /** A plain statement of what the tiers mean for this comparison. */
  sentence: string;
}

/** One configuration and the metrics where it holds the best value. */
export interface ComparisonLead {
  rowIndex: number;
  items: Array<{ metric: CompareMetric; text: string }>;
}

/** The winner map the public API returns. Its shape is part of that contract. */
export interface ComparisonAnalysisEntry {
  winner: string;
  explanation: string;
}

export type ComparisonAnalysis = Record<string, ComparisonAnalysisEntry>;

/** The complete comparison, ready to render. */
export interface Comparison {
  rows: CompareRow[];
  metrics: CompareMetricResult[];
  groups: CompareGroup[];
  summary: ComparisonSummary;
  provenance: ComparisonProvenance;
  leads: ComparisonLead[];
  /** The same winner map the public API returns. */
  analysis: ComparisonAnalysis | null;
}

const PROVENANCE_ORDER: SkuProvenance[] = ["certified", "manufacturer", "unverified"];

/* -------------------------------------------------------------------------- */
/* Metrics                                                                    */
/* -------------------------------------------------------------------------- */

const PRICE_METRIC: CompareMetric = {
  key: "price",
  group: "Price",
  label: "Suggested price",
  sentenceLabel: "price",
  direction: "lower",
  bestLabel: "Lowest price",
  get: (row) => row.values.price,
  format: (value, row) =>
    formatPrice(typeof value === "number" ? value : null, row.values.priceCurrency ?? undefined),
};

const RAM_METRIC: CompareMetric = {
  key: "ramGb",
  group: "Memory & storage",
  label: "RAM",
  sentenceLabel: "memory",
  direction: "higher",
  bestLabel: "Most RAM",
  get: (row) => row.values.ramGb,
  format: (value) => `${value} GB`,
};

const WEIGHT_METRIC: CompareMetric = {
  key: "weightKg",
  group: "Portability",
  label: "Weight",
  sentenceLabel: "weight",
  direction: "lower",
  bestLabel: "Lightest",
  get: (row) => row.values.weightKg,
  format: (value) => formatWeight(typeof value === "number" ? value : null),
};

const BATTERY_METRIC: CompareMetric = {
  key: "batteryWh",
  group: "Battery",
  label: "Battery capacity",
  sentenceLabel: "battery",
  direction: "higher",
  bestLabel: "Largest battery",
  get: (row) => row.values.batteryWh,
  format: (value) => `${value} Wh`,
};

const BASE_METRICS: CompareMetric[] = [
  PRICE_METRIC,
  {
    key: "processor",
    group: "Performance",
    label: "Processor",
    sentenceLabel: "processor",
    direction: "none",
    bestLabel: null,
    get: (row) => row.values.cpu,
    format: (value) => String(value),
  },
  {
    key: "cores",
    group: "Performance",
    label: "Cores",
    sentenceLabel: "core count",
    direction: "higher",
    bestLabel: "Most cores",
    get: (row) => row.values.cpuCores,
    format: (value) => `${value}`,
  },
  {
    key: "graphics",
    group: "Performance",
    label: "Graphics",
    sentenceLabel: "graphics",
    direction: "none",
    bestLabel: null,
    get: (row) => row.values.gpu,
    format: (value) => String(value),
  },
  RAM_METRIC,
  {
    key: "ramType",
    group: "Memory & storage",
    label: "RAM type",
    sentenceLabel: "memory type",
    direction: "none",
    bestLabel: null,
    get: (row) => row.values.ramType,
    format: (value) => String(value),
  },
  {
    key: "ramSoldered",
    group: "Memory & storage",
    label: "RAM upgradeability",
    sentenceLabel: "memory upgradeability",
    direction: "none",
    bestLabel: null,
    get: (row) => row.values.ramSoldered,
    format: (value) => (value ? "Soldered" : "Upgradeable"),
  },
  {
    key: "storageGb",
    group: "Memory & storage",
    label: "Storage",
    sentenceLabel: "storage",
    direction: "higher",
    bestLabel: "Most storage",
    get: (row) => row.values.storageGb,
    format: (value) => formatStorage(typeof value === "number" ? value : null),
  },
  {
    key: "storageType",
    group: "Memory & storage",
    label: "Storage type",
    sentenceLabel: "storage type",
    direction: "none",
    bestLabel: null,
    get: (row) => row.values.storageType,
    format: (value) => String(value),
  },
  {
    key: "storageSlots",
    group: "Memory & storage",
    label: "Storage slots",
    sentenceLabel: "storage slots",
    direction: "higher",
    bestLabel: "Most storage slots",
    get: (row) => row.values.storageSlots,
    format: (value) => `${value}`,
  },
  {
    key: "displaySizeIn",
    group: "Display",
    label: "Screen size",
    sentenceLabel: "display size",
    direction: "none",
    bestLabel: null,
    get: (row) => row.values.displaySizeIn,
    format: (value) => `${value}"`,
  },
  {
    key: "displayResolution",
    group: "Display",
    label: "Resolution",
    sentenceLabel: "resolution",
    direction: "none",
    bestLabel: null,
    get: (row) => row.values.displayResolution,
    format: (value) => String(value),
  },
  {
    key: "displayType",
    group: "Display",
    label: "Panel",
    sentenceLabel: "display type",
    direction: "none",
    bestLabel: null,
    get: (row) => row.values.displayType,
    format: (value) => String(value),
  },
  {
    key: "displayRefreshHz",
    group: "Display",
    label: "Refresh rate",
    sentenceLabel: "refresh rate",
    direction: "higher",
    bestLabel: "Highest refresh rate",
    get: (row) => row.values.displayRefreshHz,
    format: (value) => `${value} Hz`,
  },
  {
    key: "displayNits",
    group: "Display",
    label: "Peak brightness",
    sentenceLabel: "brightness",
    direction: "higher",
    bestLabel: "Brightest",
    get: (row) => row.values.displayNits,
    format: (value) => `${value} nits`,
  },
  {
    key: "displayTouch",
    group: "Display",
    label: "Touch",
    sentenceLabel: "touch",
    direction: "none",
    bestLabel: null,
    get: (row) => row.values.displayTouch,
    format: (value) => (value ? "Yes" : "No"),
  },
  WEIGHT_METRIC,
  BATTERY_METRIC,
  {
    key: "batteryLifeHours",
    group: "Battery",
    label: "Claimed battery life",
    sentenceLabel: "battery life",
    direction: "higher",
    bestLabel: "Longest claimed battery life",
    get: (row) => row.values.batteryLifeHours,
    format: (value) => `${value} h`,
  },
  {
    key: "os",
    group: "Software",
    label: "Operating system",
    sentenceLabel: "operating system",
    direction: "none",
    bestLabel: null,
    get: (row) => row.values.os,
    format: (value) => String(value),
  },
];

/**
 * Port metrics, one per port type that any compared row reports.
 *
 * A row that reports ports at all but not this type is reporting zero of
 * them; a row that reports no ports at all is reporting nothing.
 */
function buildPortMetrics(rows: CompareRow[]): CompareMetric[] {
  const types = new Set<string>();
  for (const row of rows) {
    for (const port of row.values.ports) types.add(port.type);
  }
  return Array.from(types)
    .sort((a, b) => a.localeCompare(b))
    .map((type) => ({
      key: `port:${type}`,
      group: "Connectivity",
      label: type,
      sentenceLabel: `${type.toLowerCase()} ports`,
      direction: "higher" as const,
      bestLabel: `Most ${type}`,
      get: (row: CompareRow) => {
        if (row.values.ports.length === 0) return null;
        const found = row.values.ports.find((port) => port.type === type);
        return found ? found.count : 0;
      },
      format: (value: string | number | boolean) => `${value}×`,
    }));
}

/**
 * Every metric that could be compared for these rows.
 *
 * `region` only labels the price metric; it never changes which price is
 * shown, which is decided by the caller when the rows are built.
 */
export function buildCompareMetrics(rows: CompareRow[], region?: string): CompareMetric[] {
  const price: CompareMetric = region
    ? { ...PRICE_METRIC, label: `Suggested price (${region})` }
    : PRICE_METRIC;
  const base = BASE_METRICS.map((metric) => (metric.key === "price" ? price : metric));
  return [...base, ...buildPortMetrics(rows)];
}

/* -------------------------------------------------------------------------- */
/* Metric evaluation                                                          */
/* -------------------------------------------------------------------------- */

function isMissing(value: unknown): boolean {
  return value === null || value === undefined;
}

/**
 * The rows holding the best value of a metric.
 *
 * Returns `null` when the metric cannot be ranked: when a row does not
 * report it, when the metric has no direction, or when every row reports the
 * same value and there is therefore nothing to win.
 */
export function pickBest(
  rows: CompareRow[],
  metric: CompareMetric
): { value: string | number | boolean; indexes: number[] } | null {
  if (metric.direction === "none") return null;
  if (rows.length === 0) return null;

  const values = rows.map((row) => metric.get(row));
  if (values.some(isMissing)) return null;

  const target =
    metric.direction === "higher"
      ? Math.max(...(values as number[]))
      : Math.min(...(values as number[]));

  const indexes = values
    .map((value, index) => (value === target ? index : -1))
    .filter((index) => index >= 0);

  // Every row reports the same value: there is no best value, only a shared one.
  if (indexes.length === values.length) return null;

  return { value: target, indexes };
}

/** Compare one metric across every row. */
export function compareMetric(metric: CompareMetric, rows: CompareRow[]): CompareMetricResult {
  const raw = rows.map((row) => metric.get(row));
  const reported = raw.map((value) => !isMissing(value));
  const reportedCount = reported.filter(Boolean).length;
  const missingIndexes = reported
    .map((isReported, index) => (isReported ? -1 : index))
    .filter((index) => index >= 0);
  const comparable = rows.length > 0 && reportedCount === rows.length;

  const reportedValues = raw.filter((value) => !isMissing(value));
  const allEqual =
    reportedValues.length > 0 && reportedValues.every((value) => value === reportedValues[0]);

  const best = comparable ? pickBest(rows, metric) : null;
  const bestIndexes = best ? best.indexes : [];

  const cells: CompareCell[] = rows.map((row, index) => {
    const value = raw[index];
    const isReported = reported[index];
    return {
      rowIndex: index,
      value: isReported ? (value as string | number | boolean) : null,
      text: isReported ? metric.format(value as string | number | boolean, row) : "",
      reported: isReported,
      best: bestIndexes.includes(index),
    };
  });

  let note: string | null = null;
  if (!comparable) {
    note =
      missingIndexes.length === 1
        ? "Not reported by 1 configuration, so no best value is declared."
        : `Not reported by ${missingIndexes.length} configurations, so no best value is declared.`;
  } else if (bestIndexes.length > 1) {
    note = `${bestIndexes.length} configurations tie on the best value.`;
  }

  return {
    metric,
    cells,
    reportedCount,
    comparable,
    identical: comparable && allEqual,
    differs: comparable && !allEqual,
    bestIndexes,
    missingIndexes,
    note,
  };
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

const SUBJECTS: Record<number, string> = {
  2: "These two",
  3: "These three",
  4: "These four",
  5: "These five",
};

function subjectFor(count: number): string {
  return SUBJECTS[count] ?? `These ${count} configurations`;
}

/** "RAM, storage and price". */
export function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Summarise what actually differs.
 *
 * The summary only names a metric when every compared configuration reports
 * it. A metric that is missing on one side is reported as missing, never as
 * a difference and never as a similarity.
 */
export function buildComparisonSummary(
  metrics: CompareMetricResult[],
  rowCount: number
): ComparisonSummary {
  const differing = metrics.filter((metric) => metric.differs);
  const identical = metrics.filter((metric) => metric.identical);
  const incomplete = metrics.filter((metric) => !metric.comparable);
  const comparable = metrics.filter((metric) => metric.comparable);
  const maxReported = metrics.reduce(
    (max, metric) => Math.max(max, metric.reportedCount),
    0
  );
  const nothingToCompare = rowCount >= 2 && comparable.length === 0 && maxReported <= 1;

  const differingLabels = differing.map((metric) => metric.metric.sentenceLabel);
  const incompleteLabels = incomplete.map((metric) => metric.metric.sentenceLabel);
  const subject = subjectFor(rowCount);

  let sentence: string;
  if (rowCount < 2) {
    sentence = "Add a second configuration to see what differs.";
  } else if (nothingToCompare) {
    sentence =
      "There is nothing to compare: these configurations report no metric in common.";
  } else if (comparable.length === 0) {
    sentence = `${subject} share no metric that every configuration reports. ${
      incompleteLabels.length === 1
        ? `${incompleteLabels[0]} is reported by only some of them.`
        : `${joinList(incompleteLabels)} are reported by only some of them.`
    }`;
  } else if (differing.length > 0 && incomplete.length === 0) {
    sentence = `${subject} differ in ${joinList(differingLabels)}; everything else is identical.`;
  } else if (differing.length > 0) {
    sentence = `${subject} differ in ${joinList(differingLabels)}. ${
      incompleteLabels.length === 1
        ? `${incompleteLabels[0]} is not reported by every configuration, so nothing is concluded from it.`
        : `${joinList(incompleteLabels)} are not reported by every configuration, so nothing is concluded from them.`
    }`;
  } else if (incomplete.length === 0) {
    sentence = `${subject} are identical across every metric they report.`;
  } else {
    sentence = `${subject} match on every metric they both report. ${
      incompleteLabels.length === 1
        ? `${incompleteLabels[0]} is not reported by every configuration.`
        : `${joinList(incompleteLabels)} are not reported by every configuration.`
    }`;
  }

  return {
    sentence,
    differing: differing.map((metric) => metric.metric.key),
    identical: identical.map((metric) => metric.metric.key),
    incomplete: incomplete.map((metric) => metric.metric.key),
    nothingToCompare,
  };
}

/* -------------------------------------------------------------------------- */
/* Provenance                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Describe how the compared rows were sourced.
 *
 * A comparison that mixes tiers says so: a difference between a cited row and
 * an unverified one may be a difference in how the two were recorded rather
 * than a difference between the products.
 */
export function buildComparisonProvenance(rows: CompareRow[]): ComparisonProvenance {
  const counts: Record<SkuProvenance, number> = {
    certified: 0,
    manufacturer: 0,
    unverified: 0,
  };
  for (const row of rows) counts[row.provenance] += 1;

  const tiers = PROVENANCE_ORDER.filter((tier) => counts[tier] > 0);
  const uniform = tiers.length === 1;
  const count = rows.length;
  const subject = count === 2 ? "Both configurations" : `All ${count} configurations`;

  let sentence: string;
  if (count === 0) {
    sentence = "No configurations are selected.";
  } else if (count === 1) {
    const tier = tiers[0];
    sentence =
      tier === "certified"
        ? "This configuration is certified against a cited certification record."
        : tier === "manufacturer"
          ? "This configuration was checked against the manufacturer's own specification page."
          : "This configuration is unverified — no cited source backs its figures.";
  } else if (uniform && tiers[0] === "certified") {
    sentence = `${subject} are certified against a cited certification record.`;
  } else if (uniform && tiers[0] === "manufacturer") {
    sentence = `${subject} were checked against the manufacturer's own specification page.`;
  } else if (uniform) {
    sentence = `${subject} are unverified — no cited source backs these figures.`;
  } else {
    const breakdown = tiers
      .map((tier) => `${counts[tier]} ${tier === "manufacturer" ? "manufacturer-checked" : tier}`)
      .join(", ");
    sentence = `These configurations come from different sources: ${breakdown}. A difference between them may reflect how each was recorded, not a difference between the products.`;
  }

  return { tiers, uniform, counts, sentence };
}

/* -------------------------------------------------------------------------- */
/* Winner map (the public API contract)                                       */
/* -------------------------------------------------------------------------- */

/**
 * The display score the API has always used to rank displays.
 *
 * Panel type carries the most weight, then refresh rate, then brightness.
 */
export function displayScore(row: CompareRow): number {
  let score = 0;
  if (row.values.displayType === "OLED") score += 3;
  else if (row.values.displayType === "Mini-LED") score += 2;
  else if (row.values.displayType === "IPS") score += 1;
  score += (row.values.displayRefreshHz ?? 0) / 60;
  score += (row.values.displayNits || 300) / 500;
  return score;
}

/**
 * The winner map returned by `/api/v1/compare`.
 *
 * The shape of this map is part of the public API contract, so the keys and
 * the explanation wording are preserved exactly. The winner rule is the same
 * one the table uses: a winner is only declared when every compared row
 * reports the metric.
 */
export function buildComparisonAnalysis(rows: CompareRow[]): ComparisonAnalysis | null {
  if (rows.length < 2) return null;

  const analysis: ComparisonAnalysis = {};

  const memory = pickBest(rows, RAM_METRIC);
  if (memory && memory.indexes.length === 1) {
    const winner = rows[memory.indexes[0]];
    analysis.memory = {
      winner: winner.id,
      explanation: `${winner.modelName} has the most RAM at ${memory.value}GB`,
    };
  }

  const weight = pickBest(rows, WEIGHT_METRIC);
  if (weight && weight.indexes.length === 1) {
    const winner = rows[weight.indexes[0]];
    analysis.portability = {
      winner: winner.id,
      explanation: `${winner.modelName} is the lightest at ${weight.value}kg`,
    };
  }

  const battery = pickBest(rows, BATTERY_METRIC);
  if (battery && battery.indexes.length === 1) {
    const winner = rows[battery.indexes[0]];
    analysis.battery = {
      winner: winner.id,
      explanation: `${winner.modelName} has the largest battery at ${battery.value}Wh`,
    };
  }

  // The display is ranked on a combined score, so it needs both the panel type
  // and the refresh rate from every row before anything can be said.
  const displayReady = rows.every(
    (row) => row.values.displayRefreshHz !== null && row.values.displayType !== null
  );
  if (displayReady) {
    const scored = rows
      .map((row) => ({ row, score: displayScore(row) }))
      .sort((a, b) => b.score - a.score);
    if (scored.length > 1 && scored[0].score > scored[1].score) {
      const winner = scored[0].row;
      analysis.display = {
        winner: winner.id,
        explanation: `${winner.modelName} has the best display (${winner.values.displayType}, ${winner.values.displayRefreshHz}Hz)`,
      };
    }
  }

  return analysis;
}

/* -------------------------------------------------------------------------- */
/* The comparison itself                                                      */
/* -------------------------------------------------------------------------- */

/** Build the full comparison for a set of rows. */
export function buildComparison(rows: CompareRow[]): Comparison {
  const metrics = buildCompareMetrics(rows)
    .map((metric) => compareMetric(metric, rows))
    // A metric nobody reports is not a row in the table.
    .filter((metric) => metric.reportedCount > 0);

  const groups: CompareGroup[] = [];
  for (const metric of metrics) {
    const last = groups[groups.length - 1];
    if (last && last.name === metric.metric.group) {
      last.metrics.push(metric);
    } else {
      groups.push({ name: metric.metric.group, metrics: [metric] });
    }
  }

  const leads: ComparisonLead[] = rows.map((_, index) => ({ rowIndex: index, items: [] }));
  for (const metric of metrics) {
    for (const index of metric.bestIndexes) {
      leads[index].items.push({ metric: metric.metric, text: metric.cells[index].text });
    }
  }

  return {
    rows,
    metrics,
    groups,
    summary: buildComparisonSummary(metrics, rows.length),
    provenance: buildComparisonProvenance(rows),
    leads: leads.filter((lead) => lead.items.length > 0),
    analysis: buildComparisonAnalysis(rows),
  };
}

/* -------------------------------------------------------------------------- */
/* URL state                                                                  */
/* -------------------------------------------------------------------------- */

export interface ParsedCompareIds {
  /** The requested ids, de-duplicated and capped at the maximum. */
  ids: string[];
  /** How many repeated ids were dropped. */
  duplicates: number;
  /** How many ids were dropped because the comparison holds at most five. */
  overflow: number;
}

/** Read the `ids` query parameter into a clean list of ids. */
export function parseCompareIds(raw: string | string[] | null | undefined): ParsedCompareIds {
  const source = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  const parts = source
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const unique: string[] = [];
  let duplicates = 0;
  for (const part of parts) {
    if (unique.includes(part)) {
      duplicates += 1;
      continue;
    }
    unique.push(part);
  }

  const overflow = Math.max(0, unique.length - COMPARE_MAX_CONFIGS);
  return { ids: unique.slice(0, COMPARE_MAX_CONFIGS), duplicates, overflow };
}

/** Build the shareable URL for a selection. */
export function buildCompareUrl(ids: string[], region: string, base = "/compare"): string {
  const parts: string[] = [];
  if (ids.length > 0) {
    parts.push(`ids=${ids.map((id) => encodeURIComponent(id)).join(",")}`);
  }
  if (region) parts.push(`region=${encodeURIComponent(region)}`);
  return parts.length > 0 ? `${base}?${parts.join("&")}` : base;
}
