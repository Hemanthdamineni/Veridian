/**
 * Price-alert evaluation.
 *
 * This module is pure: it takes prices and alert configuration and returns a
 * verdict. It does not read the database, it does not send anything, and it
 * never invents a price. Everything the engine knows arrives as an argument,
 * which is what makes the rules testable without a catalog.
 *
 * The rules are deliberately cautious. A price alert exists to tell a buyer
 * that a price is good, so a rule that fires on thin evidence is worse than
 * a rule that stays quiet:
 *
 *   * A price only counts when it is a real observation with a known evidence
 *     class and a known source. A manufacturer's list price and a street
 *     price are different numbers and are never compared to each other.
 *   * "Lowest ever" needs at least two observations. One observation cannot
 *     establish a lowest.
 *   * "Percentage off" needs a named reference. "20% off" against an
 *     unspecified baseline is not a fact, it is a mood.
 *   * An alert with no usable price in its configuration never fires; it
 *     says why instead.
 *
 * Every evaluation returns the same shape, whether it fired or not, so a
 * caller can always say what was known, what was compared and why.
 */

import { createHash } from "node:crypto";
import type { PriceKind } from "./prices/source";

/** The rules the engine can evaluate. */
export type AlertRule = "below_price" | "lowest_ever" | "pct_off" | "any_price_drop";

/** Every rule, in the order they are documented. */
export const ALERT_RULES: readonly AlertRule[] = [
  "below_price",
  "lowest_ever",
  "pct_off",
  "any_price_drop",
];

/**
 * Spellings accepted on `Alert.conditionType`.
 *
 * `pct_off_msrp` is the name the existing API and the Python engine use for
 * the discount rule; it is the same rule as `pct_off` and is accepted as an
 * alias so an alert created before this engine existed still evaluates.
 */
const RULE_ALIASES: Readonly<Record<string, AlertRule>> = {
  below_price: "below_price",
  lowest_ever: "lowest_ever",
  pct_off: "pct_off",
  pct_off_msrp: "pct_off",
  any_price_drop: "any_price_drop",
};

/** Why an evaluation ended the way it did. */
export type AlertOutcome =
  /** The rule's condition is met. */
  | "fired"
  /** The rule's condition is not met. */
  | "condition_not_met"
  /** There is no usable current price to evaluate. */
  | "no_current_price"
  /** The alert's own configuration carries no usable price. */
  | "no_threshold"
  /** There is a current price but not enough history to judge it. */
  | "insufficient_data"
  /** The condition on the alert is not a rule this engine knows. */
  | "unknown_rule"
  /** The same firing has already been dispatched. */
  | "already_dispatched";

/** A price observation, reduced to what the rules need. */
export interface PriceObservationInput {
  id: string;
  price: number;
  currency: string;
  /** The evidence class: `retail`, `manufacturer` or `review`. */
  kind: string | null;
  sourceName: string | null;
  retailer: string | null;
  sourceUrl: string | null;
  region: string;
  timestamp: Date;
  inStock?: boolean | null;
}

/** An alert, reduced to what the rules need. */
export interface AlertInput {
  id: string;
  userId: string;
  skuId: string;
  region: string;
  conditionType: string;
  thresholdValue: number | null;
  channel: string;
  active: boolean;
  lastTriggered?: Date | null;
}

/** The listed price the catalog records for a region, when it records one. */
export interface ListedPrice {
  value: number;
  currency: string;
  region: string;
  updatedAt: Date | null;
}

/** The evidence behind the price a rule acted on. */
export interface PriceEvidence {
  price: number;
  currency: string;
  kind: PriceKind;
  source: string;
  sourceUrl: string | null;
  observedAt: Date;
}

/** A value a rule compared the current price against. */
export interface PriceReference {
  label: string;
  value: number;
  currency: string;
  kind: PriceKind;
  source: string;
  sourceUrl: string | null;
  observedAt: Date;
}

/** The verdict for one alert. */
export interface AlertEvaluation {
  alertId: string;
  userId: string;
  skuId: string;
  region: string;
  rule: AlertRule | null;
  outcome: AlertOutcome;
  fired: boolean;
  thresholdValue: number | null;
  currentPrice: number | null;
  currentPriceCurrency: string | null;
  evidenceClass: PriceKind | null;
  currentPriceEvidence: PriceEvidence | null;
  references: PriceReference[];
  observationCount: number;
  windowStart: Date | null;
  windowEnd: Date | null;
  explanation: string;
  notes: string[];
  fingerprint: string;
}

/** What an evaluation needs in order to be judged. */
export interface EvaluationInput {
  alert: AlertInput;
  observations: PriceObservationInput[];
  listedPrice?: ListedPrice | null;
  dispatchedFingerprints?: Iterable<string>;
}

/** The counters a report prints. */
export interface EvaluationSummary {
  alertsEvaluated: number;
  fired: number;
  skippedInsufficientData: number;
  skippedNoPrice: number;
  skippedConditionNotMet: number;
  skippedAlreadyDispatched: number;
}

/** Normalise the condition stored on an alert into a rule. */
export function normalizeRule(conditionType: string | null | undefined): AlertRule | null {
  if (!conditionType) return null;
  const key = conditionType.trim().toLowerCase();
  return RULE_ALIASES[key] ?? null;
}

/**
 * What a price is, in words.
 *
 * A manufacturer list price is what the manufacturer asks. It is not a street
 * price and the wording never pretends otherwise.
 */
export function priceKindLabel(kind: PriceKind): string {
  switch (kind) {
    case "retail":
      return "street price";
    case "manufacturer":
      return "manufacturer list price";
    case "review":
      return "review price";
  }
}

/** The evidence class of an observation, or `null` when it is not a known one. */
export function observationKind(observation: PriceObservationInput): PriceKind | null {
  const kind = (observation.kind ?? "").trim().toLowerCase();
  if (kind === "retail" || kind === "manufacturer" || kind === "review") return kind;
  return null;
}

/**
 * Why an observation cannot be used as a price, or `null` when it can.
 *
 * A price without an evidence class cannot be compared with another price,
 * because the two might not mean the same thing. A retail price without a
 * seller is not a street price either.
 */
export function observationDefect(observation: PriceObservationInput): string | null {
  if (typeof observation.price !== "number" || !Number.isFinite(observation.price)) {
    return "the recorded price is not a number";
  }
  if (observation.price <= 0) return "the recorded price is not a positive amount";
  const kind = observationKind(observation);
  if (!kind) {
    return `the observation carries no known evidence class (kind=${JSON.stringify(observation.kind)})`;
  }
  const source = (observation.sourceName ?? "").trim() || (observation.retailer ?? "").trim();
  if (!source) return "the observation names no source";
  if (kind === "retail" && !(observation.retailer ?? "").trim()) {
    return "the street price names no seller";
  }
  if (observation.inStock === false) return "the observation is out of stock";
  return null;
}

/**
 * The fingerprint of a firing.
 *
 * Two evaluations with the same fingerprint describe the same state: the
 * same alert, the same rule, the same threshold, the same price and the same
 * references. A fingerprint is what the dispatcher uses to make sure the
 * same firing is never sent twice.
 */
export function firingFingerprint(evaluation: {
  alertId: string;
  rule: AlertRule | null;
  thresholdValue: number | null;
  currentPrice: number | null;
  currentPriceCurrency: string | null;
  evidenceClass: PriceKind | null;
  references: PriceReference[];
}): string {
  const material = [
    evaluation.alertId,
    evaluation.rule ?? "unknown_rule",
    evaluation.thresholdValue === null ? "none" : evaluation.thresholdValue.toFixed(4),
    evaluation.currentPrice === null ? "none" : evaluation.currentPrice.toFixed(4),
    evaluation.currentPriceCurrency ?? "none",
    evaluation.evidenceClass ?? "none",
    ...evaluation.references.map(
      (reference) =>
        `${reference.label}|${reference.value.toFixed(4)}|${reference.currency}|` +
        `${reference.kind}|${reference.source}`
    ),
  ].join("::");
  return createHash("sha256").update(material).digest("hex");
}

/** The source of an observation, in the order it is most specific. */
function sourceOf(observation: PriceObservationInput): string {
  return (
    (observation.sourceName ?? "").trim() ||
    (observation.retailer ?? "").trim() ||
    "an unnamed source"
  );
}

/** Format a money amount without pretending to more precision than it has. */
function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

/** Format a date as a plain day, which is the precision a price carries. */
function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The newest observation first, with the id as a stable tie-break. */
function byNewest(a: PriceObservationInput, b: PriceObservationInput): number {
  const delta = b.timestamp.getTime() - a.timestamp.getTime();
  if (delta !== 0) return delta;
  return b.id.localeCompare(a.id);
}

/** The oldest observation first. */
function byOldest(a: PriceObservationInput, b: PriceObservationInput): number {
  const delta = a.timestamp.getTime() - b.timestamp.getTime();
  if (delta !== 0) return delta;
  return a.id.localeCompare(a.id);
}

/** Everything a rule needs that is the same for every rule. */
interface RuleContext {
  base: AlertEvaluation;
  evidence: PriceEvidence;
  kind: PriceKind;
  currency: string;
  window: PriceObservationInput[];
  priors: PriceObservationInput[];
  notes: string[];
}

/**
 * Evaluate one alert against the observations recorded for its SKU.
 *
 * The rule is chosen by the alert's condition; the evidence is chosen by the
 * data. Nothing is assumed and nothing is filled in.
 */
export function evaluateAlert(input: EvaluationInput): AlertEvaluation {
  const { alert } = input;
  const rule = normalizeRule(alert.conditionType);
  const notes: string[] = [];

  const base: AlertEvaluation = {
    alertId: alert.id,
    userId: alert.userId,
    skuId: alert.skuId,
    region: alert.region,
    rule,
    outcome: "condition_not_met",
    fired: false,
    thresholdValue: alert.thresholdValue,
    currentPrice: null,
    currentPriceCurrency: null,
    evidenceClass: null,
    currentPriceEvidence: null,
    references: [],
    observationCount: 0,
    windowStart: null,
    windowEnd: null,
    explanation: "",
    notes,
    fingerprint: "",
  };

  if (!rule) {
    return finish(base, {
      outcome: "unknown_rule",
      explanation:
        `The alert's condition ${JSON.stringify(alert.conditionType)} is not a rule this engine ` +
        `can evaluate, so nothing was fired. The rules it knows are: ${ALERT_RULES.join(", ")}.`,
    });
  }

  const regional = input.observations.filter(
    (observation) => observation.region === alert.region
  );
  if (regional.length === 0) {
    return finish(base, {
      outcome: "no_current_price",
      explanation:
        `No price has been recorded for this configuration in ${alert.region}, so there is no ` +
        `current price to evaluate ${alert.conditionType} against. The alert did not fire.`,
    });
  }

  // The currency the comparison happens in. The listed price for the region
  // decides it when the catalog records one; otherwise the newest recorded
  // price does.
  const listed =
    input.listedPrice && input.listedPrice.region === alert.region ? input.listedPrice : null;
  const currency = (
    listed?.currency ||
    [...regional].sort(byNewest)[0].currency ||
    ""
  ).trim();

  const inCurrency = regional.filter((observation) => observation.currency === currency);
  if (inCurrency.length < regional.length) {
    notes.push(
      `${regional.length - inCurrency.length} observation(s) were ignored because they are not ` +
        `recorded in ${currency}.`
    );
  }

  const usable = inCurrency.filter((observation) => observationDefect(observation) === null);
  const current = usable.sort(byNewest)[0];
  if (!current) {
    const newest = [...inCurrency].sort(byNewest)[0];
    const defect = newest ? observationDefect(newest) : "no usable observation is recorded";
    return finish(base, {
      outcome: "no_current_price",
      observationCount: inCurrency.length,
      windowStart: inCurrency.length ? inCurrency[0].timestamp : null,
      windowEnd: inCurrency.length ? inCurrency[inCurrency.length - 1].timestamp : null,
      explanation:
        `There is no usable current price for this configuration in ${alert.region}: ` +
        `${defect}. The alert did not fire.`,
    });
  }

  for (const rejected of inCurrency.filter((o) => byNewest(o, current) < 0).sort(byNewest)) {
    notes.push(
      `A newer observation (${money(rejected.price, rejected.currency)}, ` +
        `${rejected.timestamp.toISOString()}) was not used: ${observationDefect(rejected)}.`
    );
  }

  const kind = observationKind(current) as PriceKind;
  const evidence: PriceEvidence = {
    price: current.price,
    currency,
    kind,
    source: sourceOf(current),
    sourceUrl: current.sourceUrl,
    observedAt: current.timestamp,
  };

  // The window for this rule: every observation of the same evidence class in
  // the same currency. A manufacturer list price is never weighed against a
  // street price.
  const window = inCurrency
    .filter((observation) => observationKind(observation) === kind)
    .sort(byOldest);
  const priors = window.filter((observation) => observation.id !== current.id);

  const context: RuleContext = { base, evidence, kind, currency, window, priors, notes };

  switch (rule) {
    case "below_price":
      return evaluateBelowPrice(context, alert);
    case "lowest_ever":
      return evaluateLowestEver(context);
    case "pct_off":
      return evaluatePctOff(context, alert);
    case "any_price_drop":
      return evaluateAnyPriceDrop(context, alert);
  }
}

/** Fill in the parts of the result every rule shares. */
function finish(
  base: AlertEvaluation,
  overrides: Partial<AlertEvaluation> & { explanation: string }
): AlertEvaluation {
  const merged: AlertEvaluation = { ...base, ...overrides };
  merged.fired = merged.outcome === "fired";
  merged.fingerprint = firingFingerprint(merged);
  return merged;
}

/**
 * The fields every rule reports, whatever it decided.
 *
 * The result of an evaluation is meant to be readable on its own, so it
 * always carries the price that was looked at, the evidence behind it and
 * how much history the rule had — even when the rule stayed quiet.
 */
function common(context: RuleContext): Partial<AlertEvaluation> {
  const { evidence, kind, currency, window } = context;
  return {
    currentPrice: evidence.price,
    currentPriceCurrency: currency,
    evidenceClass: kind,
    currentPriceEvidence: evidence,
    observationCount: window.length,
    windowStart: window[0]?.timestamp ?? null,
    windowEnd: window[window.length - 1]?.timestamp ?? null,
  };
}

/** The current price, named. */
function currentPhrase(context: RuleContext): string {
  const { evidence, kind, currency } = context;
  return `The current ${priceKindLabel(kind)} of ${money(evidence.price, currency)} ` +
    `(${evidence.source}, observed ${day(evidence.observedAt)})`;
}

/** The threshold of a rule, or the reason there is none. */
function usableThreshold(
  context: RuleContext,
  alert: AlertInput,
  unit: string
): { value: number } | { error: AlertEvaluation } {
  const threshold = alert.thresholdValue;
  const missing =
    threshold === null || threshold === undefined || !Number.isFinite(threshold);
  if (missing || (threshold as number) <= 0) {
    return {
      error: finish(context.base, {
        ...common(context),
        outcome: "no_threshold",
        explanation: missing
          ? `The alert carries no ${unit}, so there is nothing to compare the current price ` +
            `against. The alert did not fire.`
          : `The alert's ${unit} is ${threshold}, which is not a usable ${unit}. The alert did not fire.`,
      }),
    };
  }
  return { value: threshold as number };
}

/** The answer when there is a price but not enough history to judge it. */
function insufficient(
  context: RuleContext,
  what: string,
  note: string
): AlertEvaluation {
  const { base, kind, window, notes } = context;
  const count = window.length;
  notes.push(note);
  return finish(base, {
    ...common(context),
    outcome: "insufficient_data",
    explanation:
      `Only ${count} ${priceKindLabel(kind)} observation${count === 1 ? " is" : "s are"} recorded ` +
      `for this configuration in ${base.region}, so there is ${what}. The alert did not fire.`,
  });
}

/** The rule: the price is at or below the threshold the buyer set. */
function evaluateBelowPrice(context: RuleContext, alert: AlertInput): AlertEvaluation {
  const { base, currency, notes } = context;
  const threshold = usableThreshold(context, alert, "threshold price");
  if ("error" in threshold) return threshold.error;

  notes.push(
    `The alert's threshold carries no currency of its own; it is compared against the region's ` +
      `recorded currency (${currency}).`
  );

  const limit = money(threshold.value, currency);
  const fired = context.evidence.price <= threshold.value;
  return finish(base, {
    ...common(context),
    outcome: fired ? "fired" : "condition_not_met",
    explanation:
      `${currentPhrase(context)} is ${fired ? "at or below" : "above"} the alert's threshold of ` +
      `${limit}. The alert ${fired ? "fired" : "did not fire"}.`,
  });
}

/** The rule: the price is lower than every price recorded before it. */
function evaluateLowestEver(context: RuleContext): AlertEvaluation {
  const { base, evidence, kind, currency, window, priors } = context;
  const label = priceKindLabel(kind);
  const count = window.length;

  if (count < 2) {
    return insufficient(
      context,
      "no lowest price to compare against",
      `A lowest price needs at least two observations to compare; only ${count} is recorded.`
    );
  }

  const lowestPrior = priors.reduce((lowest, observation) =>
    observation.price < lowest.price ? observation : lowest
  );
  const reference: PriceReference = {
    label: `the previous lowest ${label}`,
    value: lowestPrior.price,
    currency,
    kind,
    source: sourceOf(lowestPrior),
    sourceUrl: lowestPrior.sourceUrl,
    observedAt: lowestPrior.timestamp,
  };

  const start = window[0]?.timestamp;
  const end = window[window.length - 1]?.timestamp;
  const span = start && end ? ` between ${day(start)} and ${day(end)}` : "";
  const previous = money(reference.value, currency);
  const fired = evidence.price < reference.value;

  return finish(base, {
    ...common(context),
    outcome: fired ? "fired" : "condition_not_met",
    references: [reference],
    explanation: fired
      ? `New lowest ${label} for this configuration in ${base.region}: ` +
        `${money(evidence.price, currency)} (${evidence.source}, observed ` +
        `${day(evidence.observedAt)}), below the previous lowest of ${previous} ` +
        `(${reference.source}, observed ${day(reference.observedAt)}). It is the lowest of ` +
        `${count} recorded ${label} observation${count === 1 ? "" : "s"}${span}. The alert fired.`
      : `${currentPhrase(context)} is not a new low: the lowest of the ${count} recorded ` +
        `${label} observation${count === 1 ? "" : "s"}${span} is ${previous} ` +
        `(${reference.source}, observed ${day(reference.observedAt)}). The alert did not fire.`,
  });
}

/** The rule: the price is a stated percentage below a named reference. */
function evaluatePctOff(context: RuleContext, alert: AlertInput): AlertEvaluation {
  const { base, evidence, kind, currency, priors } = context;
  const label = priceKindLabel(kind);
  const count = context.window.length;

  const threshold = usableThreshold(context, alert, "discount threshold");
  if ("error" in threshold) return threshold.error;

  if (count < 2 || priors.length === 0) {
    return insufficient(
      context,
      "no reference price to measure a discount against",
      `A discount needs a reference price; only ${count} observation` +
        `${count === 1 ? " is" : "s are"} recorded, so there is nothing to compare against.`
    );
  }

  const highest = priors.reduce((best, observation) =>
    observation.price > best.price ? observation : best
  );
  if (highest.price <= 0) {
    return insufficient(
      context,
      "no usable reference price to measure a discount against",
      "The highest recorded price is not a usable amount, so no discount can be measured."
    );
  }

  const reference: PriceReference = {
    label: `the highest recorded ${label} before this observation`,
    value: highest.price,
    currency,
    kind,
    source: sourceOf(highest),
    sourceUrl: highest.sourceUrl,
    observedAt: highest.timestamp,
  };

  const discount = ((reference.value - evidence.price) / reference.value) * 100;
  const referenceMoney = money(reference.value, currency);
  const fired = discount >= threshold.value;

  return finish(base, {
    ...common(context),
    outcome: fired ? "fired" : "condition_not_met",
    references: [reference],
    explanation:
      `${currentPhrase(context)} is ${discount.toFixed(1)}% below the reference price of ` +
      `${referenceMoney} — ${reference.label} (${reference.source}, observed ` +
      `${day(reference.observedAt)})${fired ? `. The alert's threshold is ${threshold.value}%. The alert fired.` : ` — which is less than the alert's threshold of ${threshold.value}%. The alert did not fire.`}`,
  });
}

/** The rule: the price is lower than the price recorded before it. */
function evaluateAnyPriceDrop(context: RuleContext, alert: AlertInput): AlertEvaluation {
  const { base, evidence, kind, currency, priors } = context;
  const label = priceKindLabel(kind);
  const count = context.window.length;

  if (alert.thresholdValue !== null && alert.thresholdValue !== 0) {
    context.notes.push(
      `The any_price_drop rule fires on any decrease; the threshold of ` +
        `${alert.thresholdValue} on the alert is not used.`
    );
  }

  if (count < 2 || priors.length === 0) {
    return insufficient(
      context,
      "no previous price to compare against",
      `A drop needs a previous price to compare against; only ${count} observation` +
        `${count === 1 ? " is" : "s are"} recorded.`
    );
  }

  const previous = priors.reduce((newest, observation) =>
    observation.timestamp.getTime() > newest.timestamp.getTime() ? observation : newest
  );
  const reference: PriceReference = {
    label: `the previous recorded ${label}`,
    value: previous.price,
    currency,
    kind,
    source: sourceOf(previous),
    sourceUrl: previous.sourceUrl,
    observedAt: previous.timestamp,
  };

  const drop = reference.value - evidence.price;
  const dropPct = reference.value > 0 ? (drop / reference.value) * 100 : 0;
  const fired = evidence.price < reference.value;

  return finish(base, {
    ...common(context),
    outcome: fired ? "fired" : "condition_not_met",
    references: [reference],
    explanation: fired
      ? `The ${label} dropped from ${money(reference.value, currency)} (${reference.source}, ` +
        `observed ${day(reference.observedAt)}) to ${money(evidence.price, currency)} ` +
        `(${evidence.source}, observed ${day(evidence.observedAt)}) — a drop of ` +
        `${drop.toFixed(2)} ${currency} (${dropPct.toFixed(1)}%). The alert fired.`
      : `${currentPhrase(context)} did not drop: the previous recorded ${label} was ` +
        `${money(reference.value, currency)} (${reference.source}, observed ` +
        `${day(reference.observedAt)}). The alert did not fire.`,
  });
}

/**
 * Count the outcomes of a set of evaluations.
 *
 * The four counters the report always prints are `alertsEvaluated`, `fired`,
 * `skippedInsufficientData` and `skippedNoPrice`. The two extra counters
 * make the arithmetic add up, so a reader can tell an alert that stayed
 * quiet from an alert that was skipped.
 */
export function summarize(evaluations: AlertEvaluation[]): EvaluationSummary {
  const summary: EvaluationSummary = {
    alertsEvaluated: evaluations.length,
    fired: 0,
    skippedInsufficientData: 0,
    skippedNoPrice: 0,
    skippedConditionNotMet: 0,
    skippedAlreadyDispatched: 0,
  };
  for (const evaluation of evaluations) {
    switch (evaluation.outcome) {
      case "fired":
        summary.fired += 1;
        break;
      case "insufficient_data":
        summary.skippedInsufficientData += 1;
        break;
      case "no_current_price":
      case "no_threshold":
        summary.skippedNoPrice += 1;
        break;
      case "already_dispatched":
        summary.skippedAlreadyDispatched += 1;
        break;
      default:
        summary.skippedConditionNotMet += 1;
        break;
    }
  }
  return summary;
}

/**
 * Mark an evaluation that has already been dispatched.
 *
 * The same firing is never sent twice. The state is identified by the
 * fingerprint, so an alert that keeps matching stays quiet until the price
 * or the reference it was measured against changes.
 */
export function markDispatched(
  evaluation: AlertEvaluation,
  dispatchedFingerprints: Iterable<string>
): AlertEvaluation {
  const dispatched = new Set(dispatchedFingerprints);
  if (!evaluation.fired) return evaluation;
  if (!dispatched.has(evaluation.fingerprint)) return evaluation;
  return {
    ...evaluation,
    outcome: "already_dispatched",
    fired: false,
    explanation:
      `${evaluation.explanation} This firing was already dispatched and is not sent again.`,
    notes: [...evaluation.notes, "The same firing has already been dispatched."],
  };
}
