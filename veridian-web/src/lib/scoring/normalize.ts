/**
 * Normalization helpers for the Veridian scoring engine.
 *
 * These pure functions convert raw spec values into bounded, comparable
 * quantities. Keeping them here means the same normalization rules are reused
 * by the recommendation scorer, the comparison engine, and unit tests.
 */

import type { DisplayType } from "./types";

/** Clamp a value into the inclusive [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Score a display panel type on a 0-3 scale where better panels rank higher.
 *
 * - OLED => 3
 * - Mini-LED => 2
 * - IPS => 1
 * - anything else => 0
 */
export function displayTypeScore(type: string): number {
  switch (type) {
    case "OLED":
      return 3;
    case "Mini-LED":
      return 2;
    case "IPS":
      return 1;
    default:
      return 0;
  }
}

/** Validate and coerce a display type preference to a known panel type. */
export function normalizeDisplayType(value: string | undefined): DisplayType | undefined {
  if (value === "IPS" || value === "OLED" || value === "Mini-LED") {
    return value;
  }
  return undefined;
}

/**
 * Score a display's refresh rate as a fraction of a 60Hz baseline.
 * A 120Hz panel scores 2.0, a 90Hz panel 1.5, etc.
 */
export function displayRefreshScore(refreshHz: number): number {
  return refreshHz / 60;
}

/**
 * Score display brightness (nits), defaulting to a 300-nit baseline when the
 * value is unknown. Brighter panels score higher.
 */
export function displayNitsScore(nits: number | null | undefined): number {
  return (nits || 300) / 500;
}

/** Format a display size with a double-prime symbol, e.g. `14"`. */
export function formatDisplaySize(sizeIn: number): string {
  return `${sizeIn}"`;
}

/** Format a weight with its unit, e.g. `1.35kg`. */
export function formatWeight(weightKg: number): string {
  return `${weightKg}kg`;
}