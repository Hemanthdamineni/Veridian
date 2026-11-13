/**
 * Weighting schema for the Veridian recommendation scorer.
 *
 * Every numeric constant that contributes to a laptop's match score is defined
 * here in one place so the scoring weights are easy to tune and to test. Values
 * represent additive/subtractive point deltas applied to the base score.
 */

export const BASE_SCORE = 50;

/** Budget deltas — within budget is the best outcome. */
export const WEIGHTS = {
  budget: {
    within: 20,
    slightlyOver: 5,
    over: -30,
    /** Fraction of budget still considered "slightly over" (e.g. 1.1 = 10%). */
    slightTolerance: 1.1,
  },
  ram: {
    meets: 15,
    below: -20,
  },
  displaySize: {
    exact: 10,
    close: 5,
    /** Fractional size difference (inches) considered an "exact" match. */
    exactTolerance: 0.5,
    /** Fractional size difference (inches) considered a "close" match. */
    closeTolerance: 1,
  },
  displayType: {
    matches: 10,
  },
  weight: {
    meets: 10,
    exceeds: -15,
  },
  brandPreference: {
    matches: 5,
  },
  useCase: {
    programming: 5,
    gaming: 5,
    travel: 10,
  },
  battery: {
    /** Minimum battery (Wh) eligible for the battery bonus. */
    minWh: 70,
    bonus: 5,
  },
} as const;

export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/** How many pros/cons to surface on a recommendation. */
export const PROS_LIMIT = 4;
export const CONS_LIMIT = 3;