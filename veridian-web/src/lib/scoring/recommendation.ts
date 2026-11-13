/**
 * Recommendation scoring engine.
 *
 * Scores a laptop against a user's requirements and produces a human-readable
 * recommendation (match score, pros, cons, and a reason string). This is the
 * pure algorithm extracted from `src/lib/ai.ts`.
 */

import { clamp } from "./normalize";
import {
  BASE_SCORE,
  CONS_LIMIT,
  PROS_LIMIT,
  SCORE_MAX,
  SCORE_MIN,
  WEIGHTS,
} from "./weights";
import type { LaptopForScoring, Recommendation, RecommendationInput } from "./types";

/**
 * Score a laptop against user requirements.
 * Returns a score from 0-100 and lists of pros/cons.
 */
export function scoreLaptopForRecommendation(
  laptop: LaptopForScoring,
  requirements: RecommendationInput
): Recommendation {
  let score = BASE_SCORE;
  const pros: string[] = [];
  const cons: string[] = [];

  const currency = requirements.currency || laptop.currency;

  // Budget scoring
  if (requirements.budget) {
    if (laptop.price <= requirements.budget) {
      score += WEIGHTS.budget.within;
      pros.push(`Within budget (${currency}${laptop.price})`);
    } else if (laptop.price <= requirements.budget * WEIGHTS.budget.slightTolerance) {
      score += WEIGHTS.budget.slightlyOver;
      cons.push(`Slightly over budget (${currency}${laptop.price})`);
    } else {
      score += WEIGHTS.budget.over;
      cons.push(
        `Over budget (${currency}${laptop.price} vs ${requirements.budget})`
      );
    }
  }

  // RAM scoring
  if (requirements.min_ram) {
    if (laptop.ram_gb >= requirements.min_ram) {
      score += WEIGHTS.ram.meets;
      pros.push(`${laptop.ram_gb}GB RAM meets requirement`);
    } else {
      score += WEIGHTS.ram.below;
      cons.push(`Only ${laptop.ram_gb}GB RAM (need ${requirements.min_ram}GB)`);
    }
  }

  // Display size scoring
  if (requirements.preferred_size) {
    const sizeDiff = Math.abs(
      laptop.display_size_in - requirements.preferred_size
    );
    if (sizeDiff < WEIGHTS.displaySize.exactTolerance) {
      score += WEIGHTS.displaySize.exact;
      pros.push(`${laptop.display_size_in}" display as preferred`);
    } else if (sizeDiff < WEIGHTS.displaySize.closeTolerance) {
      score += WEIGHTS.displaySize.close;
    } else {
      cons.push(
        `${laptop.display_size_in}" display (preferred ${requirements.preferred_size}")`
      );
    }
  }

  // Display type scoring
  if (requirements.display_preference) {
    if (laptop.display_type === requirements.display_preference) {
      score += WEIGHTS.displayType.matches;
      pros.push(`${laptop.display_type} display as preferred`);
    } else {
      cons.push(
        `${laptop.display_type} display (preferred ${requirements.display_preference})`
      );
    }
  }

  // Weight scoring
  if (requirements.max_weight) {
    if (laptop.weight_kg <= requirements.max_weight) {
      score += WEIGHTS.weight.meets;
      pros.push(`Lightweight at ${laptop.weight_kg}kg`);
    } else {
      score += WEIGHTS.weight.exceeds;
      cons.push(
        `Heavy at ${laptop.weight_kg}kg (max ${requirements.max_weight}kg)`
      );
    }
  }

  // Brand preference
  if (requirements.brand_preference && requirements.brand_preference.length > 0) {
    if (
      requirements.brand_preference.some((brand) =>
        laptop.brand.toLowerCase().includes(brand.toLowerCase())
      )
    ) {
      score += WEIGHTS.brandPreference.matches;
      pros.push(`Preferred brand: ${laptop.brand}`);
    }
  }

  // Use case bonuses
  if (requirements.use_case === "programming" && laptop.ram_gb >= 16) {
    score += WEIGHTS.useCase.programming;
    pros.push("Good for programming");
  } else if (requirements.use_case === "gaming" && laptop.display_type === "IPS") {
    score += WEIGHTS.useCase.gaming;
    pros.push("Good display for gaming");
  } else if (requirements.use_case === "travel" && laptop.weight_kg < 1.3) {
    score += WEIGHTS.useCase.travel;
    pros.push("Great for travel");
  }

  // Battery bonus
  if (laptop.battery_wh >= WEIGHTS.battery.minWh) {
    score += WEIGHTS.battery.bonus;
    pros.push("Excellent battery life");
  }

  // Clamp score
  const matchScore = clamp(score, SCORE_MIN, SCORE_MAX);

  return {
    sku_id: laptop.id,
    name: laptop.name,
    price: laptop.price,
    currency: laptop.currency || "USD",
    match_score: matchScore,
    pros: pros.slice(0, PROS_LIMIT),
    cons: cons.slice(0, CONS_LIMIT),
    reason: generateReason(laptop, requirements, matchScore),
  };
}

/**
 * Generate a human-readable reason string based on the final match score.
 */
export function generateReason(
  laptop: Pick<LaptopForScoring, "name" | "brand">,
  _requirements: RecommendationInput,
  score: number
): string {
  if (score >= 80) {
    return `Excellent match - ${laptop.brand} ${laptop.name} meets your key requirements`;
  } else if (score >= 60) {
    return `Good match - ${laptop.brand} ${laptop.name} fits most of your needs`;
  } else if (score >= 40) {
    return `Decent option - ${laptop.brand} ${laptop.name} with some trade-offs`;
  } else {
    return `May not be the best fit - consider other options`;
  }
}