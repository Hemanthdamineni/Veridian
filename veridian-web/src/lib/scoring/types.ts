/**
 * Shared types for the Veridian scoring engine.
 *
 * These types describe the pure inputs consumed by the scoring algorithms in
 * `src/lib/scoring/`. They are deliberately kept decoupled from the Prisma
 * persistence model so the scoring logic can be unit tested in isolation.
 */

/** A laptop that can be scored against a user's requirements. */
export interface LaptopForScoring {
  id: string;
  name: string;
  price: number;
  currency: string;
  ram_gb: number;
  display_size_in: number;
  display_type: string;
  weight_kg: number;
  battery_wh: number;
  cpu_brand: string;
  brand: string;
}

/** User requirements fed into the recommendation scorer. */
export interface RecommendationInput {
  budget?: number;
  currency?: string;
  min_ram?: number;
  preferred_size?: number;
  display_preference?: "IPS" | "OLED" | "Mini-LED";
  use_case?: "programming" | "gaming" | "business" | "creative" | "student" | "travel";
  brand_preference?: string[];
  require_touch?: boolean;
  max_weight?: number;
}

/** Result of scoring a laptop against requirements. */
export interface Recommendation {
  sku_id: string;
  name: string;
  price: number;
  currency: string;
  match_score: number;
  pros: string[];
  cons: string[];
  reason: string;
}

/** Display panel type used by display-scoring heuristics. */
export type DisplayType = "IPS" | "OLED" | "Mini-LED";

/**
 * A normalized laptop used by the side-by-side comparison engine.
 * Values are pulled from the Prisma SKU + relations but expressed here as
 * plain, well-typed primitives so the comparison algorithm is pure.
 */
export interface ComparableLaptop {
  id: string;
  name: string;
  displayType: string;
  displayRefreshHz: number;
  displayNits: number | null;
  ramGb: number;
  weightKg: number;
  batteryWh: number;
}

/** A single dimension-level verdict between one or more laptops. */
export interface ComparisonDimension {
  winner: string;
  explanation: string;
}

/** Full comparison analysis keyed by dimension name. */
export type ComparisonAnalysis = Record<string, ComparisonDimension>;

/** Direction of a pairwise comparison on a spec dimension. */
export type PairwiseOutcome = "better" | "worse" | "equivalent";