/**
 * Side-by-side laptop comparison engine.
 *
 * Extracted from `src/app/api/v1/compare/route.ts`. Contains the pure scoring
 * algorithm that decides which laptop wins each spec dimension, plus a memoized
 * pairwise comparator that avoids recomputing the same laptop-pair verdict.
 */

import {
  displayNitsScore,
  displayRefreshScore,
  displayTypeScore,
} from "./normalize";
import type {
  ComparableLaptop,
  ComparisonAnalysis,
  ComparisonDimension,
  PairwiseOutcome,
} from "./types";

/** A comparison rule that produces a verdict between two laptops. */
export type ComparisonRule = "ram" | "weight" | "battery" | "display";

/** A comparator function: returns "better"/"worse"/"equivalent" for a, b. */
export type PairwiseComparator = (
  a: ComparableLaptop,
  b: ComparableLaptop
) => PairwiseOutcome;

/**
 * Memoize a pairwise comparator keyed by the two laptop ids.
 *
 * Because the comparator is pure, the same (idA, idB) pair always yields the
 * same verdict. Order matters (better/worse are asymmetric), so the memo key is
 * the ordered concatenation of both ids.
 */
function memoizePairwise(compare: PairwiseComparator): PairwiseComparator {
  const cache = new Map<string, PairwiseOutcome>();
  return (a: ComparableLaptop, b: ComparableLaptop) => {
    const key = `${a.id}::${b.id}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const outcome = compare(a, b);
    cache.set(key, outcome);
    return outcome;
  };
}

/** Compare two laptops on RAM (more is better). */
export function compareRam(
  a: ComparableLaptop,
  b: ComparableLaptop
): PairwiseOutcome {
  if (a.ramGb > b.ramGb) return "better";
  if (a.ramGb < b.ramGb) return "worse";
  return "equivalent";
}

/** Compare two laptops on weight (lighter is better). */
export function compareWeight(
  a: ComparableLaptop,
  b: ComparableLaptop
): PairwiseOutcome {
  if (a.weightKg < b.weightKg) return "better";
  if (a.weightKg > b.weightKg) return "worse";
  return "equivalent";
}

/** Compare two laptops on battery capacity (larger is better). */
export function compareBattery(
  a: ComparableLaptop,
  b: ComparableLaptop
): PairwiseOutcome {
  if (a.batteryWh > b.batteryWh) return "better";
  if (a.batteryWh < b.batteryWh) return "worse";
  return "equivalent";
}

/** Score a laptop's display on a composite panel quality scale. */
export function scoreDisplay(
  laptop: Pick<
    ComparableLaptop,
    "displayType" | "displayRefreshHz" | "displayNits"
  >
): number {
  return (
    displayTypeScore(laptop.displayType) +
    displayRefreshScore(laptop.displayRefreshHz) +
    displayNitsScore(laptop.displayNits)
  );
}

/** Compare two laptops on display quality (higher composite score is better). */
export function compareDisplay(
  a: ComparableLaptop,
  b: ComparableLaptop
): PairwiseOutcome {
  const scoreA = scoreDisplay(a);
  const scoreB = scoreDisplay(b);
  if (scoreA > scoreB) return "better";
  if (scoreA < scoreB) return "worse";
  return "equivalent";
}

/** Registry of memoized pairwise comparators, one per comparison rule. */
export const pairwiseComparators: Record<ComparisonRule, PairwiseComparator> = {
  ram: memoizePairwise(compareRam),
  weight: memoizePairwise(compareWeight),
  battery: memoizePairwise(compareBattery),
  display: memoizePairwise(compareDisplay),
};

/**
 * Find the id of the laptop that strictly beats all others on a rule.
 *
 * Returns `null` when there is no single clear winner (a tie, or fewer than two
 * laptops to compare).
 */
export function findStrictWinner(
  laptops: readonly ComparableLaptop[],
  rule: ComparisonRule
): string | null {
  if (laptops.length < 2) return null;

  const compare = pairwiseComparators[rule];

  for (const laptop of laptops) {
    let beatsAll = true;
    for (const other of laptops) {
      if (other.id === laptop.id) continue;
      if (compare(laptop, other) !== "better") {
        beatsAll = false;
        break;
      }
    }
    if (beatsAll) {
      return laptop.id;
    }
  }

  return null;
}

/** Build a ComparisonDimension entry from a winning laptop. */
function dimension(
  winner: ComparableLaptop,
  explanation: string
): ComparisonDimension {
  return { winner: winner.id, explanation };
}

/**
 * Generate a full comparison analysis across the standard spec dimensions.
 *
 * The returned map contains a winner + explanation per dimension, omitting
 * dimensions where no single laptop wins outright.
 */
export function generateComparisonAnalysis(
  laptops: readonly ComparableLaptop[]
): ComparisonAnalysis {
  if (laptops.length < 2) return {};

  const analysis: ComparisonAnalysis = {};

  // RAM - most is best.
  const ramWinner = findStrictWinner(laptops, "ram");
  if (ramWinner) {
    const winner = laptops.find((l) => l.id === ramWinner)!;
    analysis.memory = dimension(
      winner,
      `${winner.name} has the most RAM at ${winner.ramGb}GB`
    );
  }

  // Weight - lightest is best.
  const weightWinner = findStrictWinner(laptops, "weight");
  if (weightWinner) {
    const winner = laptops.find((l) => l.id === weightWinner)!;
    analysis.portability = dimension(
      winner,
      `${winner.name} is the lightest at ${winner.weightKg}kg`
    );
  }

  // Battery - largest is best.
  const batteryWinner = findStrictWinner(laptops, "battery");
  if (batteryWinner) {
    const winner = laptops.find((l) => l.id === batteryWinner)!;
    analysis.battery = dimension(
      winner,
      `${winner.name} has the largest battery at ${winner.batteryWh}Wh`
    );
  }

  // Display - composite quality score is best.
  const displayWinner = findStrictWinner(laptops, "display");
  if (displayWinner) {
    const winner = laptops.find((l) => l.id === displayWinner)!;
    analysis.display = dimension(
      winner,
      `${winner.name} has the best display (${winner.displayType}, ${winner.displayRefreshHz}Hz)`
    );
  }

  return analysis;
}

/** Convenience re-export of the pairwise outcome type for consumers. */
export type { PairwiseOutcome } from "./types";