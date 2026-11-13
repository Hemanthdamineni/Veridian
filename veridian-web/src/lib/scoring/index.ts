/**
 * Veridian scoring engine — public API.
 *
 * Re-exports the pure scoring algorithms, weighting schemas, and normalization
 * helpers used by the AI recommendation engine and the side-by-side comparison
 * API.
 */

export * from "./types";
export * from "./normalize";
export * from "./weights";
export * from "./recommendation";
export * from "./compare";