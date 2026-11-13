import { describe, expect, it } from "vitest";
import { generateReason, scoreLaptopForRecommendation } from "./recommendation";
import type { LaptopForScoring } from "./types";

const laptop: LaptopForScoring = {
  id: "sku-1",
  name: "ProBook 14",
  price: 1200,
  currency: "USD",
  ram_gb: 32,
  display_size_in: 14,
  display_type: "OLED",
  weight_kg: 1.2,
  battery_wh: 50,
  cpu_brand: "Intel",
  brand: "Acme",
};

describe("scoreLaptopForRecommendation", () => {
  it("starts from a base score of 50", () => {
    const result = scoreLaptopForRecommendation(laptop, {});
    expect(result.match_score).toBe(50);
  });

  it("awards the within-budget bonus and a pro", () => {
    const result = scoreLaptopForRecommendation(laptop, { budget: 1500 });
    expect(result.match_score).toBe(70);
    expect(result.pros.some((p) => p.includes("Within budget"))).toBe(true);
  });

  it("penalizes being over budget", () => {
    const result = scoreLaptopForRecommendation(laptop, { budget: 1000 });
    expect(result.match_score).toBe(20);
    expect(result.cons.some((c) => c.includes("Over budget"))).toBe(true);
  });

  it("rewards meeting the minimum RAM", () => {
    const result = scoreLaptopForRecommendation(laptop, { min_ram: 16 });
    expect(result.match_score).toBe(65);
    expect(result.pros.some((p) => p.includes("RAM meets"))).toBe(true);
  });

  it("penalizes insufficient RAM", () => {
    const result = scoreLaptopForRecommendation(laptop, { min_ram: 64 });
    expect(result.match_score).toBe(30);
    expect(result.cons.some((c) => c.includes("Only 32GB RAM"))).toBe(true);
  });

  it("rewards an exact display size match", () => {
    const result = scoreLaptopForRecommendation(laptop, { preferred_size: 14 });
    expect(result.match_score).toBe(60);
    expect(result.pros.some((p) => p.includes("display as preferred"))).toBe(
      true
    );
  });

  it("clamps the final score into the 0-100 range", () => {
    const maxed = scoreLaptopForRecommendation(laptop, {
      budget: 2000,
      min_ram: 32,
      preferred_size: 14,
      display_preference: "OLED",
      max_weight: 2,
    });
    expect(maxed.match_score).toBeGreaterThanOrEqual(0);
    expect(maxed.match_score).toBeLessThanOrEqual(100);
  });

  it("awards the programming use-case bonus", () => {
    const result = scoreLaptopForRecommendation(laptop, {
      use_case: "programming",
    });
    // base 50 + programming bonus 5
    expect(result.match_score).toBe(55);
    expect(result.pros.some((p) => p.includes("Good for programming"))).toBe(
      true
    );
  });

  it("awards the battery bonus for large batteries", () => {
    const bigBattery: LaptopForScoring = { ...laptop, battery_wh: 90 };
    const result = scoreLaptopForRecommendation(bigBattery, {});
    // base 50 + battery bonus 5
    expect(result.match_score).toBe(55);
    expect(result.pros.some((p) => p.includes("Excellent battery"))).toBe(true);
  });

  it("respects the pros/cons slice limits", () => {
    const result = scoreLaptopForRecommendation(laptop, {
      budget: 9999,
      min_ram: 16,
      preferred_size: 14,
      display_preference: "OLED",
      max_weight: 5,
      brand_preference: ["Acme"],
      use_case: "programming",
    });
    expect(result.pros.length).toBeLessThanOrEqual(4);
    expect(result.cons.length).toBeLessThanOrEqual(3);
  });
});

describe("generateReason", () => {
  it("produces an excellent match message for high scores", () => {
    expect(generateReason(laptop, {}, 90)).toContain("Excellent match");
  });

  it("produces a good match message for mid-high scores", () => {
    expect(generateReason(laptop, {}, 70)).toContain("Good match");
  });

  it("produces a decent option message for mid scores", () => {
    expect(generateReason(laptop, {}, 45)).toContain("Decent option");
  });

  it("flags poor fits", () => {
    expect(generateReason(laptop, {}, 20)).toContain("best fit");
  });
});