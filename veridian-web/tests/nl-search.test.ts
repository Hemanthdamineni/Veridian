import { describe, it, expect } from "vitest";
import {
  interpretNaturalLanguageQuery,
  parseNaturalLanguageQuery,
  describeFilters,
  type NlInterpretation,
} from "@/lib/ai";

/** Read a sentence the way the endpoint does. */
function read(query: string): NlInterpretation {
  return interpretNaturalLanguageQuery(query);
}

/** The filters a sentence produced, in the shape the endpoint returns. */
function filters(query: string) {
  return parseNaturalLanguageQuery(query);
}

describe("processor families", () => {
  it("reads an Intel Core Ultra 7 as Intel plus that family", () => {
    const result = read("Intel Core Ultra 7");
    expect(result.filters.cpuBrand).toBe("Intel");
    expect(result.extra.cpuModelContains).toBe("Core Ultra 7");
    expect(result.ignoredTerms).toEqual([]);
  });

  it("reads a Ryzen 7 as AMD", () => {
    const result = read("Ryzen 7 laptop");
    expect(result.filters.cpuBrand).toBe("AMD");
    expect(result.extra.cpuModelContains).toBe("Ryzen 7");
  });

  it("reads Snapdragon X as Qualcomm", () => {
    const result = read("Snapdragon X Elite");
    expect(result.filters.cpuBrand).toBe("Qualcomm");
    expect(result.extra.cpuModelContains).toBe("Snapdragon X Elite");
  });

  it("reads Apple M4 as Apple", () => {
    const result = read("Apple M4");
    expect(result.filters.cpuBrand).toBe("Apple");
    expect(result.extra.cpuModelContains).toBe("M4");
  });

  it("reads a Core i7 as Intel", () => {
    const result = read("Core i7");
    expect(result.filters.cpuBrand).toBe("Intel");
    expect(result.extra.cpuModelContains).toBe("Core i7");
  });

  it("still reads a bare brand", () => {
    expect(filters("an Intel laptop").cpuBrand).toBe("Intel");
    expect(filters("an AMD laptop").cpuBrand).toBe("AMD");
  });
});

describe("graphics", () => {
  it("reads a dedicated GPU", () => {
    const result = read("laptop with a dedicated GPU");
    expect(result.extra.gpuModelAnyOf).toContain("RTX");
    expect(result.ignoredTerms).toEqual([]);
  });

  it("reads a named graphics family", () => {
    expect(read("RTX graphics").extra.gpuModelAnyOf).toEqual(["RTX"]);
    expect(read("Radeon laptop").extra.gpuModelAnyOf).toEqual(["Radeon"]);
    expect(read("Iris Xe").extra.gpuModelAnyOf).toEqual(["Iris"]);
  });

  it("reads integrated graphics", () => {
    const result = read("integrated graphics laptop");
    expect(result.extra.gpuModelAnyOf).toContain("Integrated");
    expect(result.extra.gpuModelAnyOf).toContain("Iris");
  });
});

describe("display, refresh rate and touch", () => {
  it("reads an explicit refresh rate", () => {
    expect(filters("120Hz display").refreshMin).toBe("120");
  });

  it("reads a high refresh request as 120 Hz and says so", () => {
    const result = read("high refresh laptop");
    expect(result.filters.refreshMin).toBe("120");
    expect(result.assumptions.join(" ")).toContain("high refresh");
  });

  it("reads a touchscreen and a 2-in-1 as touch", () => {
    expect(filters("touchscreen laptop").touch).toBe("true");
    expect(filters("2-in-1 laptop").touch).toBe("true");
  });

  it("reads a 2-in-1 as a whole phrase, not as a screen size", () => {
    const result = read("convertible 2 in 1 laptop");
    expect(result.filters.touch).toBe("true");
    expect(result.extra.displaySizeMin).toBeUndefined();
    expect(result.ignoredTerms).toEqual([]);
  });

  it("reads a storage size with its unit word", () => {
    const result = read("laptop with 2 tb ssd");
    expect(result.filters.storageMin).toBe("2048");
    expect(result.ignoredTerms).toEqual([]);
  });

  it("reads an explicit screen size as a window around it", () => {
    const result = read("14 inch OLED laptop");
    expect(result.extra.displaySizeMin).toBe("13.5");
    expect(result.extra.displaySizeMax).toBe("14.5");
  });
});

describe("operating system", () => {
  it("reads each operating system the catalog knows", () => {
    expect(read("Linux laptop").extra.osContains).toBe("Linux");
    expect(read("Windows laptop").extra.osContains).toBe("Windows");
    expect(read("macOS laptop").extra.osContains).toBe("macOS");
  });
});

describe("use cases", () => {
  it("reads a programming request", () => {
    const result = read("laptop for programming");
    expect(result.filters.ramMin).toBe("16");
    expect(result.assumptions.join(" ")).toContain("programming");
  });

  it("reads a video editing request", () => {
    const result = read("laptop for video editing");
    expect(result.filters.ramMin).toBe("32");
    expect(result.filters.displayType).toBe("OLED");
  });

  it("reads a gaming request", () => {
    const result = read("gaming laptop");
    expect(result.filters.displayType).toBe("IPS");
    expect(result.filters.refreshMin).toBe("120");
  });

  it("reads a travel request", () => {
    expect(filters("laptop for travel").weightMax).toBe("1.3");
  });

  it("reads a university request", () => {
    const result = read("laptop for university");
    expect(result.filters.priceMax).toBe("1000");
  });
});

describe("budget phrases", () => {
  it("reads an amount with a currency word", () => {
    const result = read("under 1500 dollars");
    expect(result.filters.priceMax).toBe("1500");
    expect(result.filters.region).toBe("US");
  });

  it("reads an approximate amount as a ceiling and says so", () => {
    const result = read("around 1000");
    expect(result.filters.priceMax).toBe("1000");
    expect(result.assumptions.join(" ")).toContain("around 1000");
  });

  it("reads a range as both ends", () => {
    const result = read("between 800 and 1200");
    expect(result.filters.priceMin).toBe("800");
    expect(result.filters.priceMax).toBe("1200");
  });

  it("reads a currency symbol and infers the region", () => {
    const pounds = read("£1000 laptop");
    expect(pounds.filters.priceMax).toBe("1000");
    expect(pounds.filters.region).toBe("UK");

    const rupees = read("₹80,000 laptop");
    expect(rupees.filters.priceMax).toBe("80000");
    expect(rupees.filters.region).toBe("IN");
  });

  it("records the currency it inferred as an assumption", () => {
    const result = read("₹80,000 laptop");
    expect(result.assumptions.join(" ")).toContain("rupees");
  });
});

describe("relative wishes", () => {
  it("maps lightest to a sort, not a filter", () => {
    const result = read("lightest laptop");
    expect(result.filters.sort).toBe("weight_asc");
    expect(result.filters.weightMax).toBeUndefined();
  });

  it("maps the longest battery to a sort, not a filter", () => {
    const result = read("longest battery life");
    expect(result.filters.sort).toBe("battery_desc");
    expect(result.filters.batteryMin).toBeUndefined();
  });

  it("maps cheapest to a sort, not a filter", () => {
    const result = read("cheapest laptop");
    expect(result.filters.sort).toBe("price_asc");
    expect(result.filters.priceMax).toBeUndefined();
  });

  it("maps the biggest screen to a sort, not a filter", () => {
    const result = read("biggest screen");
    expect(result.filters.sort).toBe("display_size_desc");
    expect(result.filters.displayType).toBeUndefined();
  });

  it("maps most memory to a sort, not a filter", () => {
    const result = read("most memory");
    expect(result.filters.sort).toBe("ram_desc");
    expect(result.filters.ramMin).toBeUndefined();
  });
});

describe("negations", () => {
  it("does not apply gaming requirements to a negated gaming request", () => {
    const result = read("not a gaming laptop");
    expect(result.filters.displayType).toBeUndefined();
    expect(result.filters.refreshMin).toBeUndefined();
    expect(result.assumptions.join(" ")).toContain("not gaming");
  });

  it("reads no touch as a request for a non-touch screen", () => {
    const result = read("no touch laptop");
    expect(result.filters.touch).toBe("false");
    expect(result.ignoredTerms).toEqual([]);
  });
});

describe("multi-constraint sentences", () => {
  it("combines two constraints instead of letting the second win", () => {
    const result = read("16GB RAM OLED laptop under 1200 dollars");
    expect(result.filters.ramMin).toBe("16");
    expect(result.filters.displayType).toBe("OLED");
    expect(result.filters.priceMax).toBe("1200");
  });

  it("combines a size, a display type, memory and a price", () => {
    const result = read("a 14 inch OLED laptop with 32 GB of RAM under 1500 dollars");
    expect(result.extra.displaySizeMin).toBe("13.5");
    expect(result.filters.displayType).toBe("OLED");
    expect(result.filters.ramMin).toBe("32");
    expect(result.filters.priceMax).toBe("1500");
  });

  it("keeps the model name alongside the structured filters", () => {
    const result = read("Zenbook under 1500 dollars");
    expect(result.filters.q).toBe("Zenbook");
    expect(result.filters.priceMax).toBe("1500");
  });
});

describe("honest reporting", () => {
  it("reports a word it cannot act on instead of dropping it", () => {
    const result = read("a beautiful quiet laptop");
    expect(result.ignoredTerms).toEqual(["beautiful", "quiet"]);
    expect(result.filters.q).toBeUndefined();
  });

  it("does not turn an unreadable sentence into a confident empty filter set", () => {
    const result = read("a beautiful quiet laptop");
    expect(result.confidence).toBeLessThan(0.3);
    expect(result.applied).toHaveLength(0);
  });

  it("offers the other reading when a capacity is ambiguous", () => {
    const result = read("512GB laptop");
    expect(result.filters.storageMin).toBe("512");
    expect(result.alternatives).toHaveLength(1);
    expect(result.alternatives[0].label).toContain("memory");
    expect(result.alternatives[0].filters.ramMin).toBe("512");
  });

  it("offers the other reading when light could mean bright", () => {
    const result = read("light 14 inch OLED laptop");
    expect(result.filters.weightMax).toBe("1.5");
    expect(result.alternatives.length).toBeGreaterThan(0);
    expect(result.alternatives[0].extra.nitsMin).toBe("400");
  });

  it("offers alternatives that can be chosen again and produce that reading", () => {
    const sentences = ["512GB laptop", "light 14 inch OLED laptop", "big battery laptop"];
    for (const sentence of sentences) {
      const result = read(sentence);
      expect(result.alternatives.length).toBeGreaterThan(0);
      for (const alternative of result.alternatives) {
        const replay = read(alternative.query);
        // The chosen sentence is read cleanly: no ignored words, and it
        // produces the reading it promised.
        expect(replay.ignoredTerms).toEqual([]);
        expect(replay.applied.length).toBeGreaterThan(0);
        for (const [key, value] of Object.entries(alternative.filters)) {
          expect((replay.filters as Record<string, unknown>)[key]).toBe(value);
        }
        for (const [key, value] of Object.entries(alternative.extra)) {
          expect((replay.extra as Record<string, unknown>)[key]).toEqual(value);
        }
      }
    }
  });

  it("lowers the confidence when the sentence is ambiguous", () => {
    const certain = read("16GB RAM OLED laptop under 1200 dollars");
    const ambiguous = read("512GB laptop");
    expect(ambiguous.confidence).toBeLessThan(certain.confidence);
  });

  it("reports the assumptions it made", () => {
    const result = read("lightweight laptop for programming");
    expect(result.assumptions.join(" ")).toContain("lightweight");
    expect(result.assumptions.join(" ")).toContain("programming");
  });

  it("accounts for every word: applied, understood or reported", () => {
    const result = read("a light 14 inch OLED laptop with 32 GB of RAM for programming");
    expect(result.ignoredTerms).toEqual([]);
    expect(result.applied.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const query = "a light 14 inch OLED laptop with 32 GB of RAM for programming";
    expect(interpretNaturalLanguageQuery(query)).toEqual(interpretNaturalLanguageQuery(query));
  });
});

describe("the historical filter keys", () => {
  it("keeps producing the same keys with the same meaning", () => {
    const parsed = filters("14 inch OLED laptop under $1500");
    expect(parsed.displayType).toBe("OLED");
    expect(parsed.priceMax).toBe("1500");
    expect(parsed.cpuBrand).toBeUndefined();
    expect(parsed.ramMin).toBeUndefined();
  });

  it("keeps reading memory, storage and weight", () => {
    const parsed = filters("32 GB RAM with 1 TB of storage under 1.5kg");
    expect(parsed.ramMin).toBe("32");
    expect(parsed.storageMin).toBe("1024");
    expect(parsed.weightMax).toBe("1.5");
  });

  it("keeps reading the residual model keyword", () => {
    expect(filters("Zenbook under $1500").q).toBe("Zenbook");
    expect(filters("UX3407 under 1.3kg").q).toBe("UX3407");
  });

  it("keeps the whole model name, not only its first word", () => {
    expect(filters("macbook air for travel").q).toBe("macbook air");
  });

  it("keeps the human-readable description", () => {
    expect(describeFilters({ ramMin: "32", displayType: "OLED" })).toContain("OLED display");
    expect(describeFilters({})).toBe("Showing all laptops");
  });
});
