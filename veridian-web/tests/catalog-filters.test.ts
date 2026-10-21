import { describe, it, expect } from "vitest";
import { buildSkusQuery, sortSkusByPrice } from "@/lib/api";
import { activeChips, filtersToQuery, queryToFilters, DEFAULT_FILTERS } from "@/lib/catalog";

// The catalog deliberately mixes two tiers of record. These tests pin the
// rules that keep the split honest: a region chooses which price to *show*,
// it must never decide which configurations *exist*.

describe("region semantics — region selects the price, not the row", () => {
  it("does not exclude configurations that have no price for the region", () => {
    const where = buildSkusQuery({ region: "US" });
    expect(where.pricing).toBeUndefined();
  });

  it("does not filter at all when no region is given", () => {
    const where = buildSkusQuery({});
    expect(where.pricing).toBeUndefined();
  });

  it("requires a recorded price when a price bound is given", () => {
    const where = buildSkusQuery({ region: "US", priceMin: "1000" });
    expect(where.pricing).toEqual({
      some: { region: "US", available: true, msrp: { gte: 1000 } },
    });
  });

  it("supports an upper price bound", () => {
    const where = buildSkusQuery({ region: "IN", priceMax: "90000" });
    expect(where.pricing).toEqual({
      some: { region: "IN", available: true, msrp: { lte: 90000 } },
    });
  });

  it("ignores a price bound that is not a number rather than matching nothing", () => {
    const where = buildSkusQuery({ region: "US", priceMin: "abc" });
    expect(where.pricing).toBeUndefined();
  });
});

describe("provenance tier filter", () => {
  it("selects only certified configurations", () => {
    const where = buildSkusQuery({ provenance: "certified" });
    expect(where.provenance).toBe("certified");
  });

  it("selects only manufacturer-verified configurations", () => {
    const where = buildSkusQuery({ provenance: "manufacturer" });
    expect(where.provenance).toBe("manufacturer");
  });

  it("selects only unverified configurations", () => {
    const where = buildSkusQuery({ provenance: "unverified" });
    expect(where.provenance).toBe("unverified");
  });

  it("matches any of the requested tiers", () => {
    const where = buildSkusQuery({ provenance: "certified,manufacturer" });
    expect(where.provenance).toEqual({ in: ["certified", "manufacturer"] });
  });

  it("applies no tier constraint when every tier is requested", () => {
    const where = buildSkusQuery({ provenance: "certified,manufacturer,unverified" });
    expect(where.provenance).toEqual({
      in: ["certified", "manufacturer", "unverified"],
    });
  });

  it("applies no tier constraint for an unknown tier", () => {
    const where = buildSkusQuery({ provenance: "invented" });
    expect(where.provenance).toBeUndefined();
  });
});

describe("price sorting", () => {
  const priced = (region: string, msrp: number) => ({ pricing: [{ region, msrp }] });
  const unpriced = { pricing: [] };

  it("sorts ascending by the price for the selected region", () => {
    const sorted = sortSkusByPrice(
      [priced("US", 900), priced("US", 100), priced("US", 500)],
      "US",
      "asc"
    );
    expect(sorted.map((s) => s.pricing[0].msrp)).toEqual([100, 500, 900]);
  });

  it("sorts descending by the price for the selected region", () => {
    const sorted = sortSkusByPrice(
      [priced("US", 900), priced("US", 100), priced("US", 500)],
      "US",
      "desc"
    );
    expect(sorted.map((s) => s.pricing[0].msrp)).toEqual([900, 500, 100]);
  });

  it("keeps configurations without a price last in both directions", () => {
    const asc = sortSkusByPrice([unpriced, priced("US", 100)], "US", "asc");
    const desc = sortSkusByPrice([unpriced, priced("US", 100)], "US", "desc");
    expect(asc[0].pricing[0]?.msrp).toBe(100);
    expect(desc[0].pricing[0]?.msrp).toBe(100);
    expect(asc[1].pricing).toHaveLength(0);
    expect(desc[1].pricing).toHaveLength(0);
  });

  it("ignores prices recorded for a different region", () => {
    const sorted = sortSkusByPrice([priced("IN", 50), priced("US", 900)], "US", "asc");
    // The IN row has no US price, so it sorts last rather than at 50.
    expect(sorted[0].pricing[0]).toEqual({ region: "US", msrp: 900 });
  });

  it("does not mutate the input array", () => {
    const input = [priced("US", 900), priced("US", 100)];
    sortSkusByPrice(input, "US", "asc");
    expect(input[0].pricing[0].msrp).toBe(900);
  });
});

describe("catalog URL state — provenance filter", () => {
  it("round-trips the provenance tier through the query string", () => {
    const query = filtersToQuery({ ...DEFAULT_FILTERS, provenance: ["certified"] });
    expect(new URLSearchParams(query).get("provenance")).toBe("certified");
  });

  it("parses a provenance tier back into filter state", () => {
    const state = queryToFilters(new URLSearchParams("provenance=reference"));
    expect(state.provenance).toEqual(["reference"]);
  });

  it("produces a dismissible chip for an active provenance tier", () => {
    const chips = activeChips({ ...DEFAULT_FILTERS, provenance: ["certified"] });
    expect(chips.map((c) => c.key)).toEqual(["provenance"]);
    expect(chips[0].label).toContain("Certified");
  });
});
