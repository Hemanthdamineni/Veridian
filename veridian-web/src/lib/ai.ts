/**
 * AI & Natural Language Features for Veridian
 *
 * - Natural Language to Filter parsing
 * - AI Recommendation Engine
 *
 * Based on Veridian-spec.md B.5 and B.6
 */

import type { SkusQueryParams } from "@/types";

/**
 * Parse natural language query into structured filter parameters.
 *
 * This is a rule-based implementation that extracts common laptop search patterns.
 * In production, this would use an LLM API for more sophisticated parsing.
 *
 * Examples:
 * - "14 inch OLED laptop under $1500" -> { displayType: "OLED", priceMax: "1500" }
 * - "lightweight laptop for programming under 1.5kg" -> { weightMax: "1.5", ramMin: "16" }
 * - "best battery life laptop" -> { sort: "battery_desc" }
 */
export function parseNaturalLanguageQuery(query: string): Partial<SkusQueryParams> {
  const params: Partial<SkusQueryParams> = {};
  const lowerQuery = query.toLowerCase();

  // Display size patterns
  const sizePatterns = [
    /(\d+\.?\d*)\s*[""]?\s*(?:screen|display|inch)/i,
    /(\d+\.?\d*)\s*inch(?:es)?/i,
    /(\d+)\s*(?:in|")/i,
  ];
  for (const pattern of sizePatterns) {
    const match = lowerQuery.match(pattern);
    if (match) {
      const size = parseFloat(match[1]);
      if (size >= 10 && size <= 20) {
        // Use as filter - exact size matching would need a range
        break;
      }
    }
  }

  // Display type
  if (lowerQuery.includes("oled")) {
    params.displayType = "OLED";
  } else if (lowerQuery.includes("ips")) {
    params.displayType = "IPS";
  } else if (lowerQuery.includes("mini-led") || lowerQuery.includes("mini led")) {
    params.displayType = "Mini-LED";
  }

  // CPU brand
  if (lowerQuery.includes("intel")) {
    params.cpuBrand = "Intel";
  } else if (lowerQuery.includes("amd") || lowerQuery.includes("ryzen")) {
    params.cpuBrand = "AMD";
  } else if (lowerQuery.includes("apple") || lowerQuery.includes("m1") || lowerQuery.includes("m2") || lowerQuery.includes("m3") || lowerQuery.includes("m4")) {
    params.cpuBrand = "Apple";
  } else if (lowerQuery.includes("qualcomm") || lowerQuery.includes("snapdragon")) {
    params.cpuBrand = "Qualcomm";
  }

  // RAM patterns
  const ramPatterns = [
    /(\d+)\s*gb\s*(?:of\s*)?ram/i,
    /(\d+)\s*gb\s*memory/i,
    /(\d+)\s*gb/i,
  ];
  for (const pattern of ramPatterns) {
    const match = lowerQuery.match(pattern);
    if (match) {
      const ram = parseInt(match[1], 10);
      if ([8, 16, 32, 64, 128].includes(ram)) {
        params.ramMin = ram.toString();
        break;
      }
    }
  }

  // Storage patterns
  const storagePatterns = [
    /(\d+)\s*tb/i,
    /(\d+)\s*gb\s*(?:ssd|storage)/i,
  ];
  for (const pattern of storagePatterns) {
    const match = lowerQuery.match(pattern);
    if (match) {
      const storage = parseInt(match[1], 10);
      if (lowerQuery.includes("tb")) {
        params.storageMin = (storage * 1024).toString();
      } else if (storage >= 128) {
        params.storageMin = storage.toString();
      }
      break;
    }
  }

  // Weight patterns
  const weightPatterns = [
    /under\s*(\d+\.?\d*)\s*kg/i,
    /less\s*than\s*(\d+\.?\d*)\s*kg/i,
    /(\d+\.?\d*)\s*kg\s*(?:or\s*)?(?:less|under|lighter)/i,
    /lightweight/i,
    /light/i,
  ];
  for (const pattern of weightPatterns) {
    const match = lowerQuery.match(pattern);
    if (match) {
      if (match[1]) {
        params.weightMax = match[1];
      } else if (pattern.source.includes("light")) {
        params.weightMax = "1.5";
      }
      break;
    }
  }

  // Price patterns
  const pricePatterns = [
    /under\s*[\$₹]?\s*(\d[\d,]*)/i,
    /less\s*than\s*[\$₹]?\s*(\d[\d,]*)/i,
    /below\s*[\$₹]?\s*(\d[\d,]*)/i,
    /[\$₹]\s*(\d[\d,]*)\s*(?:or\s*)?(?:less|under)/i,
    /max(?:imum)?\s*[\$₹]?\s*(\d[\d,]*)/i,
    /budget\s*(?:of\s*)?[\$₹]?\s*(\d[\d,]*)/i,
  ];
  for (const pattern of pricePatterns) {
    const match = lowerQuery.match(pattern);
    if (match) {
      const price = parseInt(match[1].replace(/,/g, ""), 10);
      if (price > 100 && price < 100000) {
        params.priceMax = price.toString();
        // Detect currency
        if (match[0].includes("₹")) {
          params.region = "IN";
        }
      }
      break;
    }
  }

  // Touch screen
  if (lowerQuery.includes("touch") || lowerQuery.includes("touchscreen") || lowerQuery.includes("2-in-1") || lowerQuery.includes("convertible")) {
    params.touch = "true";
  }

  // Use case based recommendations
  if (lowerQuery.includes("programming") || lowerQuery.includes("coding") || lowerQuery.includes("development") || lowerQuery.includes("developer")) {
    if (!params.ramMin) params.ramMin = "16";
    if (!params.weightMax) params.weightMax = "1.8";
  } else if (lowerQuery.includes("gaming")) {
    if (!params.displayType) params.displayType = "IPS";
    if (!params.refreshMin) params.refreshMin = "120";
  } else if (lowerQuery.includes("business") || lowerQuery.includes("work")) {
    if (!params.ramMin) params.ramMin = "16";
    if (!params.weightMax) params.weightMax = "1.5";
  } else if (lowerQuery.includes("student")) {
    if (!params.priceMax) params.priceMax = "1000";
    if (!params.weightMax) params.weightMax = "1.5";
  } else if (lowerQuery.includes("travel") || lowerQuery.includes("portable")) {
    if (!params.weightMax) params.weightMax = "1.3";
  } else if (lowerQuery.includes("creative") || lowerQuery.includes("video editing") || lowerQuery.includes("design")) {
    if (!params.ramMin) params.ramMin = "32";
    if (!params.displayType) params.displayType = "OLED";
  }

  // Battery priority
  if (lowerQuery.includes("battery") && (lowerQuery.includes("best") || lowerQuery.includes("good") || lowerQuery.includes("long"))) {
    params.sort = "battery_desc";
  }

  // Newest first
  if (lowerQuery.includes("newest") || lowerQuery.includes("latest") || lowerQuery.includes("new")) {
    params.sort = "newest";
  }

  // Price sorting
  if (lowerQuery.includes("cheapest") || lowerQuery.includes("affordable") || lowerQuery.includes("budget")) {
    params.sort = "price_asc";
  }

  return params;
}

/**
 * Generate a human-readable description of applied filters.
 */
export function describeFilters(params: Partial<SkusQueryParams>): string {
  const parts: string[] = [];

  if (params.displayType) parts.push(`${params.displayType} display`);
  if (params.cpuBrand) parts.push(`${params.cpuBrand} processor`);
  if (params.ramMin) parts.push(`at least ${params.ramMin}GB RAM`);
  if (params.storageMin) {
    const storage = parseInt(params.storageMin, 10);
    parts.push(`at least ${storage >= 1024 ? `${storage / 1024}TB` : `${storage}GB`} storage`);
  }
  if (params.weightMax) parts.push(`under ${params.weightMax}kg`);
  if (params.batteryMin) parts.push(`at least ${params.batteryMin}Wh battery`);
  if (params.touch === "true") parts.push("touchscreen");
  if (params.priceMax) {
    const currency = params.region === "IN" ? "₹" : "$";
    parts.push(`under ${currency}${parseInt(params.priceMax, 10).toLocaleString()}`);
  }

  if (parts.length === 0) return "Showing all laptops";
  return "Filtering by: " + parts.join(", ");
}

/**
 * Recommendation Engine
 *
 * Generates laptop recommendations based on user requirements.
 * In production, this would use an LLM API for ranking and pros/cons.
 */

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

/**
 * Score a laptop against user requirements.
 * Returns a score from 0-100 and lists of pros/cons.
 */
export function scoreLaptopForRecommendation(
  laptop: {
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
  },
  requirements: RecommendationInput
): Recommendation {
  let score = 50; // Base score
  const pros: string[] = [];
  const cons: string[] = [];

  // Budget scoring
  if (requirements.budget) {
    if (laptop.price <= requirements.budget) {
      score += 20;
      pros.push(`Within budget (${requirements.currency || "$"}${laptop.price})`);
    } else if (laptop.price <= requirements.budget * 1.1) {
      score += 5;
      cons.push(`Slightly over budget (${requirements.currency || "$"}${laptop.price})`);
    } else {
      score -= 30;
      cons.push(`Over budget (${requirements.currency || "$"}${laptop.price} vs ${requirements.budget})`);
    }
  }

  // RAM scoring
  if (requirements.min_ram) {
    if (laptop.ram_gb >= requirements.min_ram) {
      score += 15;
      pros.push(`${laptop.ram_gb}GB RAM meets requirement`);
    } else {
      score -= 20;
      cons.push(`Only ${laptop.ram_gb}GB RAM (need ${requirements.min_ram}GB)`);
    }
  }

  // Display size scoring
  if (requirements.preferred_size) {
    const sizeDiff = Math.abs(laptop.display_size_in - requirements.preferred_size);
    if (sizeDiff < 0.5) {
      score += 10;
      pros.push(`${laptop.display_size_in}" display as preferred`);
    } else if (sizeDiff < 1) {
      score += 5;
    } else {
      cons.push(`${laptop.display_size_in}" display (preferred ${requirements.preferred_size}")`);
    }
  }

  // Display type scoring
  if (requirements.display_preference) {
    if (laptop.display_type === requirements.display_preference) {
      score += 10;
      pros.push(`${laptop.display_type} display as preferred`);
    } else {
      cons.push(`${laptop.display_type} display (preferred ${requirements.display_preference})`);
    }
  }

  // Weight scoring
  if (requirements.max_weight) {
    if (laptop.weight_kg <= requirements.max_weight) {
      score += 10;
      pros.push(`Lightweight at ${laptop.weight_kg}kg`);
    } else {
      score -= 15;
      cons.push(`Heavy at ${laptop.weight_kg}kg (max ${requirements.max_weight}kg)`);
    }
  }

  // Touch requirement
  if (requirements.require_touch) {
    // Would need touch field in laptop data
  }

  // Brand preference
  if (requirements.brand_preference && requirements.brand_preference.length > 0) {
    if (requirements.brand_preference.some(b => laptop.brand.toLowerCase().includes(b.toLowerCase()))) {
      score += 5;
      pros.push(`Preferred brand: ${laptop.brand}`);
    }
  }

  // Use case bonuses
  if (requirements.use_case === "programming" && laptop.ram_gb >= 16) {
    score += 5;
    pros.push("Good for programming");
  } else if (requirements.use_case === "gaming" && laptop.display_type === "IPS") {
    score += 5;
    pros.push("Good display for gaming");
  } else if (requirements.use_case === "travel" && laptop.weight_kg < 1.3) {
    score += 10;
    pros.push("Great for travel");
  }

  // Battery bonus
  if (laptop.battery_wh >= 70) {
    score += 5;
    pros.push("Excellent battery life");
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  return {
    sku_id: laptop.id,
    name: laptop.name,
    price: laptop.price,
    currency: laptop.currency || "USD",
    match_score: score,
    pros: pros.slice(0, 4),
    cons: cons.slice(0, 3),
    reason: generateReason(laptop, requirements, score),
  };
}

function generateReason(
  laptop: { name: string; brand: string; ram_gb: number; display_type: string; weight_kg: number },
  requirements: RecommendationInput,
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
