import { describe, expect, it } from "vitest";
import {
  clamp,
  displayNitsScore,
  displayRefreshScore,
  displayTypeScore,
  formatDisplaySize,
  formatWeight,
  normalizeDisplayType,
} from "./normalize";

describe("clamp", () => {
  it("clamps values below the minimum", () => {
    expect(clamp(-5, 0, 100)).toBe(0);
  });

  it("clamps values above the maximum", () => {
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it("leaves in-range values unchanged", () => {
    expect(clamp(42, 0, 100)).toBe(42);
  });
});

describe("displayTypeScore", () => {
  it("ranks OLED above Mini-LED above IPS above unknown", () => {
    expect(displayTypeScore("OLED")).toBe(3);
    expect(displayTypeScore("Mini-LED")).toBe(2);
    expect(displayTypeScore("IPS")).toBe(1);
    expect(displayTypeScore("TN")).toBe(0);
  });
});

describe("normalizeDisplayType", () => {
  it("returns known panel types", () => {
    expect(normalizeDisplayType("OLED")).toBe("OLED");
    expect(normalizeDisplayType("IPS")).toBe("IPS");
    expect(normalizeDisplayType("Mini-LED")).toBe("Mini-LED");
  });

  it("returns undefined for unknown values", () => {
    expect(normalizeDisplayType("TN")).toBeUndefined();
    expect(normalizeDisplayType(undefined)).toBeUndefined();
  });
});

describe("displayRefreshScore", () => {
  it("scales refresh rate relative to a 60Hz baseline", () => {
    expect(displayRefreshScore(60)).toBe(1);
    expect(displayRefreshScore(120)).toBe(2);
    expect(displayRefreshScore(90)).toBe(1.5);
  });
});

describe("displayNitsScore", () => {
  it("uses a 300-nit default when nits are unknown", () => {
    expect(displayNitsScore(null)).toBe(0.6);
    expect(displayNitsScore(undefined)).toBe(0.6);
  });

  it("scores known nits proportionally", () => {
    expect(displayNitsScore(500)).toBe(1);
    expect(displayNitsScore(0)).toBe(0.6);
  });
});

describe("formatting helpers", () => {
  it("formats display size and weight", () => {
    expect(formatDisplaySize(14)).toBe('14"');
    expect(formatWeight(1.35)).toBe("1.35kg");
  });
});