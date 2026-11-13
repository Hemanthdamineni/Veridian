import { describe, expect, it } from "vitest";
import {
  compareBattery,
  compareDisplay,
  compareRam,
  compareWeight,
  findStrictWinner,
  generateComparisonAnalysis,
  pairwiseComparators,
  scoreDisplay,
} from "./compare";
import type { ComparableLaptop } from "./types";

function laptop(overrides: Partial<ComparableLaptop>): ComparableLaptop {
  return {
    id: "sku-1",
    name: "Laptop A",
    displayType: "IPS",
    displayRefreshHz: 60,
    displayNits: 300,
    ramGb: 16,
    weightKg: 1.5,
    batteryWh: 50,
    ...overrides,
  };
}

const a = laptop({ id: "a", name: "A", ramGb: 16, weightKg: 1.5, batteryWh: 50 });
const b = laptop({
  id: "b",
  name: "B",
  ramGb: 32,
  weightKg: 1.2,
  batteryWh: 75,
  displayType: "OLED",
  displayRefreshHz: 120,
  displayNits: 500,
});

describe("pairwise comparators", () => {
  it("says more RAM is better", () => {
    expect(compareRam(b, a)).toBe("better");
    expect(compareRam(a, b)).toBe("worse");
    expect(compareRam(a, laptop({ id: "a1", ramGb: 16 }))).toBe("equivalent");
  });

  it("says lighter weight is better", () => {
    expect(compareWeight(b, a)).toBe("better");
    expect(compareWeight(a, b)).toBe("worse");
  });

  it("says larger battery is better", () => {
    expect(compareBattery(b, a)).toBe("better");
    expect(compareBattery(a, b)).toBe("worse");
  });

  it("says higher composite display score is better", () => {
    expect(compareDisplay(b, a)).toBe("better");
    expect(compareDisplay(a, b)).toBe("worse");
  });
});

describe("scoreDisplay", () => {
  it("combines panel type, refresh, and nits", () => {
    expect(scoreDisplay(b)).toBeGreaterThan(scoreDisplay(a));
  });
});

describe("memoized pairwise comparators", () => {
  it("returns a stable verdict for the same pair", () => {
    const first = pairwiseComparators.ram(b, a);
    const second = pairwiseComparators.ram(b, a);
    expect(first).toBe(second);
  });
});

describe("findStrictWinner", () => {
  it("returns null for fewer than two laptops", () => {
    expect(findStrictWinner([a], "ram")).toBeNull();
  });

  it("returns the laptop that beats all others on a rule", () => {
    expect(findStrictWinner([a, b], "ram")).toBe("b");
    expect(findStrictWinner([a, b], "weight")).toBe("b");
  });

  it("returns null when there is a tie", () => {
    const tie = laptop({ id: "c-tie", name: "C", ramGb: 16 });
    expect(findStrictWinner([a, tie], "ram")).toBeNull();
  });
});

describe("generateComparisonAnalysis", () => {
  it("returns an empty map for a single laptop", () => {
    expect(generateComparisonAnalysis([a])).toEqual({});
  });

  it("awards each dimension to the strongest laptop", () => {
    const analysis = generateComparisonAnalysis([a, b]);
    expect(analysis.memory.winner).toBe("b");
    expect(analysis.portability.winner).toBe("b");
    expect(analysis.battery.winner).toBe("b");
    expect(analysis.display.winner).toBe("b");
  });

  it("omits dimensions where no single laptop wins", () => {
    const tied = laptop({
      id: "d-tied",
      name: "D",
      ramGb: 16,
      weightKg: 1.5,
      batteryWh: 75,
      displayType: "IPS",
      displayRefreshHz: 60,
      displayNits: 300,
    });
    const analysis = generateComparisonAnalysis([a, tied]);
    expect(analysis.memory).toBeUndefined();
    expect(analysis.portability).toBeUndefined();
    expect(analysis.battery.winner).toBe("d-tied");
  });
});