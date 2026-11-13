import { describe, it, expect } from "vitest";
import { extractKeyword, parseNaturalLanguageQuery, describeFilters } from "@/lib/ai";
import { activeChips, filtersToQuery, DEFAULT_FILTERS } from "@/lib/catalog";
import { formatCpu, formatDate, formatStorage, formatWeight, formatPrice } from "@/lib/format";

describe("natural-language keyword extraction", () => {
  it("keeps the model keyword while dropping price phrases", () => {
    expect(extractKeyword("Zenbook under $1500")).toBe("Zenbook");
  });

  it("keeps model tokens that contain digits", () => {
    // "UX3407" must survive; only the filter phrases are stripped.
    expect(extractKeyword("UX3407 under 1.3kg")).toBe("UX3407");
  });

  it("returns an empty string when only filters and filler remain", () => {
    expect(extractKeyword("14 inch OLED laptop under $1500")).toBe("");
  });

  it("does not invent a keyword for a purely qualitative request", () => {
    const parsed = parseNaturalLanguageQuery("best battery life laptop");
    expect(parsed.q).toBeUndefined();
    expect(parsed.sort).toBe("battery_desc");
  });

  it("parses structured filters and keeps the residual keyword", () => {
    const parsed = parseNaturalLanguageQuery("Zenbook under $1500");
    expect(parsed.q).toBe("Zenbook");
    expect(parsed.priceMax).toBe("1500");
  });

  it("infers region from a rupee price", () => {
    const parsed = parseNaturalLanguageQuery("ultrabook under ₹90000");
    expect(parsed.region).toBe("IN");
    expect(parsed.priceMax).toBe("90000");
  });

  it("describes applied filters in plain language", () => {
    expect(describeFilters({ ramMin: "32", displayType: "OLED" })).toContain("OLED display");
    expect(describeFilters({})).toBe("Showing all laptops");
  });
});

describe("catalog URL state", () => {
  it("always includes the region so pricing is deterministic", () => {
    expect(filtersToQuery({ ...DEFAULT_FILTERS, region: "US" })).toContain("region=US");
  });

  it("omits empty filters from the query string", () => {
    expect(filtersToQuery(DEFAULT_FILTERS)).toBe("region=US");
  });

  it("round-trips multi-select and range filters", () => {
    const query = filtersToQuery({ ...DEFAULT_FILTERS, cpuBrand: ["Intel", "AMD"], ramMin: "32" });
    const params = new URLSearchParams(query);
    expect(params.get("cpu_brand")).toBe("Intel,AMD");
    expect(params.get("ram_min")).toBe("32");
  });

  it("produces dismissible chips only for active filters", () => {
    expect(activeChips(DEFAULT_FILTERS)).toHaveLength(0);
    const chips = activeChips({ ...DEFAULT_FILTERS, q: "Zenbook", ramMin: "16", region: "IN" });
    expect(chips.map((c) => c.key)).toEqual(["q", "ram", "region"]);
  });
});

describe("display formatting", () => {
  it("keeps UTC timestamps in their recorded month", () => {
    expect(formatDate("2026-01-01T00:00:00.000Z")).toBe("Jan 2026");
  });

  it("never repeats the CPU brand already present in the model string", () => {
    expect(formatCpu("Intel", "Intel N4500")).toBe("Intel N4500");
    expect(formatCpu("Intel", "Core Ultra 7 258V")).toBe("Intel Core Ultra 7 258V");
  });

  it("renders an em dash rather than a fabricated value when data is absent", () => {
    expect(formatCpu(null, null)).toBe("—");
    expect(formatStorage(null)).toBe("—");
    expect(formatWeight(null)).toBe("—");
    expect(formatPrice(null, "USD")).toBe("—");
  });

  it("scales storage units at the terabyte boundary", () => {
    expect(formatStorage(512)).toBe("512 GB");
    expect(formatStorage(1024)).toBe("1 TB");
    expect(formatStorage(2048)).toBe("2 TB");
  });
});
