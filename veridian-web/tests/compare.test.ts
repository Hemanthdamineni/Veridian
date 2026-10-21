import { describe, it, expect } from "vitest";
import {
  buildComparison,
  buildComparisonAnalysis,
  buildComparisonProvenance,
  buildComparisonSummary,
  buildCompareUrl,
  parseCompareIds,
  type CompareRow,
  type CompareValues,
} from "@/lib/compare";
import type { SkuProvenance } from "@/types";

// The rules this suite pins down are the ones a reader would notice if they
// broke: a winner is only ever declared on a metric every compared
// configuration reports, a missing value is never treated as a loss, and the
// summary never names a difference that is not there.

function fullValues(overrides: Partial<CompareValues> = {}): CompareValues {
  return {
    cpu: "Intel Core Ultra 7 258V",
    cpuCores: 16,
    gpu: "Arc 140V",
    ramGb: 16,
    ramType: "LPDDR5X",
    ramSoldered: true,
    storageGb: 512,
    storageType: "NVMe",
    storageSlots: 1,
    displaySizeIn: 14,
    displayResolution: "2880x1800",
    displayType: "OLED",
    displayRefreshHz: 120,
    displayNits: 600,
    displayTouch: true,
    weightKg: 1.2,
    batteryWh: 75,
    batteryLifeHours: 18,
    os: "Windows 11 Pro",
    ports: [{ type: "USB-C", count: 2 }],
    price: 1499,
    priceCurrency: "USD",
    priceUpdatedAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

/** A configuration that reports nothing except the given values. */
function onlyValues(overrides: Partial<CompareValues> = {}): CompareValues {
  return {
    cpu: null,
    cpuCores: null,
    gpu: null,
    ramGb: null,
    ramType: null,
    ramSoldered: null,
    storageGb: null,
    storageType: null,
    storageSlots: null,
    displaySizeIn: null,
    displayResolution: null,
    displayType: null,
    displayRefreshHz: null,
    displayNits: null,
    displayTouch: null,
    weightKg: null,
    batteryWh: null,
    batteryLifeHours: null,
    os: null,
    ports: [],
    price: null,
    priceCurrency: null,
    priceUpdatedAt: null,
    ...overrides,
  };
}

function makeRow(
  id: string,
  overrides: Partial<CompareValues> = {},
  provenance: SkuProvenance = "certified"
): CompareRow {
  return {
    id,
    skuCode: `SKU-${id}`,
    modelName: `Model ${id}`,
    brand: "ASUS",
    series: "Zenbook",
    provenance,
    values: fullValues(overrides),
  };
}

function metricOf(comparison: ReturnType<typeof buildComparison>, key: string) {
  const found = comparison.metrics.find((metric) => metric.metric.key === key);
  if (!found) throw new Error(`metric ${key} is not part of the comparison`);
  return found;
}

describe("winner rule — a winner needs every row to report the metric", () => {
  it("declares a winner when every compared row reports the metric", () => {
    const comparison = buildComparison([makeRow("a", { ramGb: 32 }), makeRow("b", { ramGb: 16 })]);
    const ram = metricOf(comparison, "ramGb");

    expect(ram.comparable).toBe(true);
    expect(ram.bestIndexes).toEqual([0]);
    expect(ram.cells[0].best).toBe(true);
    expect(ram.cells[1].best).toBe(false);
    expect(comparison.analysis?.memory).toEqual({
      winner: "a",
      explanation: "Model a has the most RAM at 32GB",
    });
  });

  it("declares no winner when one row does not report the metric, and says so", () => {
    const comparison = buildComparison([makeRow("a", { ramGb: 32 }), makeRow("b", { ramGb: null })]);
    const ram = metricOf(comparison, "ramGb");

    expect(ram.comparable).toBe(false);
    expect(ram.bestIndexes).toEqual([]);
    expect(ram.cells[0].best).toBe(false);
    expect(ram.cells[1].best).toBe(false);
    expect(ram.note).toMatch(/not reported by 1 configuration/i);
    expect(ram.note).toMatch(/no best value/i);
    expect(comparison.analysis?.memory).toBeUndefined();
  });

  it("does not declare a portability winner when a weight is missing", () => {
    const analysis = buildComparisonAnalysis([
      makeRow("a", { weightKg: 1.1 }),
      makeRow("b", { weightKg: null }),
    ]);
    expect(analysis?.portability).toBeUndefined();
  });

  it("does not declare a battery winner when a capacity is missing", () => {
    const analysis = buildComparisonAnalysis([
      makeRow("a", { batteryWh: 90 }),
      makeRow("b", { batteryWh: null }),
    ]);
    expect(analysis?.battery).toBeUndefined();
  });

  it("does not declare a display winner when a refresh rate is missing", () => {
    const analysis = buildComparisonAnalysis([
      makeRow("a", { displayRefreshHz: 120 }),
      makeRow("b", { displayRefreshHz: null }),
    ]);
    expect(analysis?.display).toBeUndefined();
  });

  it("declares no winner when the configurations tie", () => {
    const analysis = buildComparisonAnalysis([makeRow("a", { ramGb: 16 }), makeRow("b", { ramGb: 16 })]);
    expect(analysis?.memory).toBeUndefined();
  });

  it("marks both cells of a tie without naming a single winner", () => {
    const comparison = buildComparison([makeRow("a", { ramGb: 16 }), makeRow("b", { ramGb: 16 })]);
    const ram = metricOf(comparison, "ramGb");

    expect(ram.bestIndexes).toEqual([]);
    expect(ram.identical).toBe(true);
  });

  it("keeps the public API winner map shape and wording", () => {
    const analysis = buildComparisonAnalysis([
      makeRow("a", { ramGb: 32, weightKg: 1, batteryWh: 80, displayType: "OLED", displayRefreshHz: 120 }),
      makeRow("b", { ramGb: 16, weightKg: 1.5, batteryWh: 60, displayType: "IPS", displayRefreshHz: 60 }),
    ]);

    expect(Object.keys(analysis ?? {}).sort()).toEqual(["battery", "display", "memory", "portability"]);
    expect(analysis?.memory).toEqual({ winner: "a", explanation: "Model a has the most RAM at 32GB" });
    expect(analysis?.portability).toEqual({ winner: "a", explanation: "Model a is the lightest at 1kg" });
    expect(analysis?.battery).toEqual({ winner: "a", explanation: "Model a has the largest battery at 80Wh" });
    expect(analysis?.display).toEqual({
      winner: "a",
      explanation: "Model a has the best display (OLED, 120Hz)",
    });
  });

  it("returns no analysis at all for a single configuration", () => {
    expect(buildComparisonAnalysis([makeRow("a")])).toBeNull();
  });
});

describe("a missing metric is stated, never quietly ranked", () => {
  it("marks the cell as not reported and keeps the row out of the difference list", () => {
    const comparison = buildComparison([
      makeRow("a", { displayNits: 600 }),
      makeRow("b", { displayNits: null }),
    ]);
    const nits = metricOf(comparison, "displayNits");

    expect(nits.cells[1].reported).toBe(false);
    expect(nits.cells[1].text).toBe("");
    expect(nits.reportedCount).toBe(1);
    expect(nits.comparable).toBe(false);
    expect(nits.differs).toBe(false);
    expect(nits.identical).toBe(false);
    expect(comparison.summary.differing).not.toContain("displayNits");
    expect(comparison.summary.identical).not.toContain("displayNits");
    expect(comparison.summary.incomplete).toContain("displayNits");
    expect(comparison.summary.sentence).toMatch(/not reported by every configuration/i);
  });

  it("leaves a metric nobody reports out of the table entirely", () => {
    const comparison = buildComparison([
      makeRow("a", { displayNits: null }),
      makeRow("b", { displayNits: null }),
    ]);
    expect(comparison.metrics.find((metric) => metric.metric.key === "displayNits")).toBeUndefined();
    expect(comparison.summary.sentence).not.toMatch(/brightness/i);
  });

  it("reports a metric that only some rows report as incomplete, not as a difference", () => {
    const comparison = buildComparison([
      makeRow("a", { storageGb: 512 }),
      makeRow("b", { storageGb: null }),
    ]);
    expect(comparison.summary.differing).not.toContain("storageGb");
    expect(comparison.summary.incomplete).toContain("storageGb");
    expect(comparison.summary.sentence).toMatch(/storage/);
    expect(comparison.summary.sentence).toMatch(/not reported by every configuration/i);
  });

  it("says there is nothing to compare when no metric is shared at all", () => {
    const comparison = buildComparison([
      makeRow("a", onlyValues({ ramGb: 16 })),
      makeRow("b", onlyValues({ cpu: "AMD Ryzen 7 8845HS" })),
    ]);

    expect(comparison.summary.nothingToCompare).toBe(true);
    expect(comparison.summary.sentence).toMatch(/nothing to compare/i);
    expect(comparison.summary.differing).toEqual([]);
    expect(comparison.summary.identical).toEqual([]);
  });

  it("does not treat a missing port count as a zero", () => {
    const comparison = buildComparison([
      makeRow("a", { ports: [{ type: "USB-C", count: 2 }] }),
      makeRow("b", { ports: [] }),
    ]);
    const usbC = comparison.metrics.find((metric) => metric.metric.key === "port:USB-C");
    expect(usbC?.comparable).toBe(false);
    expect(usbC?.cells[1].reported).toBe(false);
  });

  it("treats an absent port type on a row that reports ports as zero", () => {
    const comparison = buildComparison([
      makeRow("a", { ports: [{ type: "USB-C", count: 2 }, { type: "HDMI", count: 1 }] }),
      makeRow("b", { ports: [{ type: "USB-C", count: 2 }] }),
    ]);
    const hdmi = comparison.metrics.find((metric) => metric.metric.key === "port:HDMI");
    expect(hdmi?.cells[1].reported).toBe(true);
    expect(hdmi?.cells[1].text).toBe("0×");
  });

  it("keeps the note on the row itself when a metric cannot be ranked", () => {
    const comparison = buildComparison([makeRow("a"), makeRow("b", { ramGb: null })]);
    expect(metricOf(comparison, "ramGb").note).toMatch(/no best value/i);
  });
});

describe("the differences summary names only real differences", () => {
  it("names the one metric that really differs", () => {
    const comparison = buildComparison([makeRow("a", { ramGb: 32 }), makeRow("b", { ramGb: 16 })]);
    expect(comparison.summary.differing).toEqual(["ramGb"]);
    expect(comparison.summary.sentence).toBe(
      "These two differ in memory; everything else is identical."
    );
  });

  it("names every metric that differs across three configurations", () => {
    const comparison = buildComparison([
      makeRow("a", { ramGb: 32, displaySizeIn: 14, price: 1499 }),
      makeRow("b", { ramGb: 16, displaySizeIn: 16, price: 1299 }),
      makeRow("c", { ramGb: 32, displaySizeIn: 14, price: 1799 }),
    ]);

    expect(comparison.summary.differing.sort()).toEqual(["displaySizeIn", "price", "ramGb"]);
    expect(comparison.summary.sentence).toMatch(/^These three differ in /);
    expect(comparison.summary.sentence).toMatch(/everything else is identical\.$/);
  });

  it("does not name a metric whose values are all equal", () => {
    const comparison = buildComparison([
      makeRow("a", { ramGb: 32, storageGb: 1024 }),
      makeRow("b", { ramGb: 32, storageGb: 1024 }),
    ]);
    expect(comparison.summary.differing).toEqual([]);
    expect(comparison.summary.identical).toContain("ramGb");
    expect(comparison.summary.identical).toContain("storageGb");
  });

  it("says two identical configurations are identical", () => {
    const comparison = buildComparison([makeRow("a"), makeRow("b")]);
    expect(comparison.summary.differing).toEqual([]);
    expect(comparison.summary.identical.length).toBeGreaterThan(0);
    expect(comparison.summary.incomplete).toEqual([]);
    expect(comparison.summary.sentence).toBe(
      "These two are identical across every metric they report."
    );
  });

  it("keeps a missing metric out of the identical claim", () => {
    const comparison = buildComparison([
      makeRow("a", { ramGb: 32 }),
      makeRow("b", { ramGb: 32, displayNits: null }),
    ]);
    expect(comparison.summary.sentence).not.toMatch(/everything else is identical/i);
    expect(comparison.summary.sentence).toMatch(/not reported by every configuration/i);
  });

  it("asks for a second configuration when only one is selected", () => {
    const comparison = buildComparison([makeRow("a")]);
    expect(comparison.summary.sentence).toMatch(/second configuration/i);
    expect(comparison.summary.differing).toEqual([]);
  });

  it("builds the summary from metrics directly", () => {
    const comparison = buildComparison([makeRow("a", { ramGb: 32 }), makeRow("b", { ramGb: 16 })]);
    const summary = buildComparisonSummary(comparison.metrics, comparison.rows.length);
    expect(summary.differing).toEqual(["ramGb"]);
  });
});

describe("provenance tiers are carried through", () => {
  it("keeps the tier of every compared configuration", () => {
    const comparison = buildComparison([
      makeRow("a", {}, "certified"),
      makeRow("b", {}, "manufacturer"),
      makeRow("c", {}, "unverified"),
    ]);

    expect(comparison.rows.map((row) => row.provenance)).toEqual([
      "certified",
      "manufacturer",
      "unverified",
    ]);
    expect(comparison.provenance.tiers).toEqual(["certified", "manufacturer", "unverified"]);
    expect(comparison.provenance.uniform).toBe(false);
    expect(comparison.provenance.counts).toEqual({
      certified: 1,
      manufacturer: 1,
      unverified: 1,
    });
  });

  it("says so when the compared configurations come from different sources", () => {
    const comparison = buildComparison([makeRow("a", {}, "certified"), makeRow("b", {}, "unverified")]);
    expect(comparison.provenance.sentence).toMatch(/different sources/i);
    expect(comparison.provenance.sentence).toMatch(/1 certified/);
    expect(comparison.provenance.sentence).toMatch(/1 unverified/);
  });

  it("says so when every configuration shares one tier", () => {
    const comparison = buildComparison([makeRow("a", {}, "certified"), makeRow("b", {}, "certified")]);
    expect(comparison.provenance.uniform).toBe(true);
    expect(comparison.provenance.sentence).toMatch(/certified/i);
    expect(comparison.provenance.sentence).not.toMatch(/different sources/i);
  });

  it("warns when every configuration is unverified", () => {
    const comparison = buildComparison([makeRow("a", {}, "unverified"), makeRow("b", {}, "unverified")]);
    expect(comparison.provenance.sentence).toMatch(/unverified/i);
    expect(comparison.provenance.sentence).toMatch(/no cited source/i);
  });

  it("describes an empty selection without inventing a tier", () => {
    const provenance = buildComparisonProvenance([]);
    expect(provenance.tiers).toEqual([]);
    expect(provenance.counts).toEqual({ certified: 0, manufacturer: 0, unverified: 0 });
    expect(provenance.sentence).toMatch(/no configurations/i);
  });

  it("describes a single configuration in the singular", () => {
    const provenance = buildComparisonProvenance([makeRow("a", {}, "unverified")]);
    expect(provenance.sentence).toMatch(/^This configuration is unverified/i);
    expect(provenance.sentence).not.toMatch(/All 1/);
  });
});

describe("the selection is read from the URL", () => {
  it("reads a comma separated list of ids", () => {
    expect(parseCompareIds("a,b,c").ids).toEqual(["a", "b", "c"]);
  });

  it("drops repeated ids", () => {
    const parsed = parseCompareIds("a,a,b");
    expect(parsed.ids).toEqual(["a", "b"]);
    expect(parsed.duplicates).toBe(1);
  });

  it("holds at most five configurations and says how many were left out", () => {
    const parsed = parseCompareIds("a,b,c,d,e,f,g");
    expect(parsed.ids).toEqual(["a", "b", "c", "d", "e"]);
    expect(parsed.overflow).toBe(2);
  });

  it("copes with an empty or missing parameter", () => {
    expect(parseCompareIds(undefined).ids).toEqual([]);
    expect(parseCompareIds("").ids).toEqual([]);
    expect(parseCompareIds(null).ids).toEqual([]);
  });

  it("builds a shareable link", () => {
    expect(buildCompareUrl(["a", "b"], "US")).toBe("/compare?ids=a,b&region=US");
    expect(buildCompareUrl([], "US")).toBe("/compare?region=US");
  });
});

describe("the price is a reference price, not a live price", () => {
  it("ranks the suggested price like any other comparable metric", () => {
    const comparison = buildComparison([
      makeRow("a", { price: 1499 }),
      makeRow("b", { price: 999 }),
    ]);
    const price = metricOf(comparison, "price");

    expect(price.metric.direction).toBe("lower");
    expect(price.bestIndexes).toEqual([1]);
    expect(price.cells[1].text).toBe("$999");
    expect(price.cells[0].text).toBe("$1,499");
  });

  it("declares no price winner when one configuration has no price for the region", () => {
    const comparison = buildComparison([
      makeRow("a", { price: 1499 }),
      makeRow("b", { price: null }),
    ]);
    const price = metricOf(comparison, "price");

    expect(price.comparable).toBe(false);
    expect(price.bestIndexes).toEqual([]);
    expect(comparison.summary.differing).not.toContain("price");
  });
});
