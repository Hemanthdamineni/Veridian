import { describe, it, expect } from "vitest";
import {
  canonicalBrand,
  canonicalSkuCode,
  chassisPrefix,
  configurationSignature,
  deriveSeriesName,
  isPlaceholderNote,
  looksLikePartNumber,
  parseAdditionalModelInfo,
  resolveModelName,
  stripEnumerationPrefix,
} from "@/lib/energy-star/canonical";

describe("canonicalBrand", () => {
  it("normalises the spellings manufacturers use inconsistently", () => {
    expect(canonicalBrand("DELL")).toBe("Dell");
    expect(canonicalBrand("dynabook")).toBe("Dynabook");
    expect(canonicalBrand("HP")).toBe("HP");
    expect(canonicalBrand("VAIO")).toBe("VAIO");
  });

  it("collapses case variants of the same brand", () => {
    expect(canonicalBrand("Jp. ik")).toBe(canonicalBrand("jp.ik"));
  });

  it("never returns an empty name", () => {
    expect(canonicalBrand("   ")).toBe("Unknown");
  });
});

describe("parseAdditionalModelInfo", () => {
  it("separates part numbers, marketing names and wildcard legends", () => {
    const info = parseAdditionalModelInfo(
      "N26ED2***,AL15-58P,* can be 0-9, a-z, A-Z, \"(\",\")\", \"-\", \"/\" or blank for the model"
    );
    expect(info.notes.length).toBeGreaterThan(0);
    expect(info.partNumbers).toContain("AL15-58P");
    // The legend must never be treated as an identifier.
    expect(info.marketingNames.join(" ")).not.toMatch(/can be/);
  });

  it("treats a source note as a note", () => {
    const info = parseAdditionalModelInfo(
      "NP960XRD,NP964XRD,Same as basic model except for model designation"
    );
    expect(info.notes).toHaveLength(1);
    expect(info.partNumbers).toEqual(["NP960XRD", "NP964XRD"]);
  });

  it("splits several groups separated by semicolons", () => {
    const info = parseAdditionalModelInfo("ThinkPad E14 Gen 8,21Y7; ThinkPad L14p Gen 7,21YA");
    expect(info.partNumbers).toEqual(["21Y7", "21YA"]);
  });

  it("handles an absent value", () => {
    expect(parseAdditionalModelInfo(null).parts).toEqual([]);
  });
});

describe("isPlaceholderNote", () => {
  it("recognises the legends the source appends", () => {
    expect(isPlaceholderNote("* can be 0-9, a-z, A-Z")).toBe(true);
    expect(isPlaceholderNote("Same as basic model except for model designation")).toBe(true);
    expect(isPlaceholderNote("The \"*\" in model may be numbers 0-9")).toBe(true);
  });

  it("does not mistake a real identifier for a legend", () => {
    expect(isPlaceholderNote("AL15-58P")).toBe(false);
    expect(isPlaceholderNote("21Y7")).toBe(false);
  });
});

describe("looksLikePartNumber", () => {
  it("accepts mixed alphanumeric codes and all-digit chassis codes", () => {
    expect(looksLikePartNumber("21Y7")).toBe(true);
    expect(looksLikePartNumber("2036")).toBe(true);
  });

  it("rejects marketing names", () => {
    expect(looksLikePartNumber("Dell Pro Essential 15 PV15260")).toBe(false);
  });
});

describe("stripEnumerationPrefix", () => {
  it("removes the source's enumeration marker", () => {
    expect(stripEnumerationPrefix("(1) ThinkBook 14x G2 IWC")).toBe("ThinkBook 14x G2 IWC");
    expect(stripEnumerationPrefix("ThinkPad L14")).toBe("ThinkPad L14");
  });
});

describe("deriveSeriesName", () => {
  it("uses the per-brand family table", () => {
    expect(deriveSeriesName("Lenovo", "ThinkPad E14 Gen 8")).toBe("ThinkPad E14");
    expect(deriveSeriesName("Lenovo", "IdeaPad Slim 5 13IWC11")).toBe("IdeaPad Slim 5");
    expect(deriveSeriesName("HP", "HP EliteBook 640 G11")).toBe("HP EliteBook 640");
    expect(deriveSeriesName("Apple", "MacBook Air 13-inch (M4)")).toBe("MacBook Air");
    expect(deriveSeriesName("Microsoft", "Surface Laptop 13\" 2nd Edition")).toBe("Surface Laptop");
    expect(deriveSeriesName("Dell", "Latitude 5450")).toBe("Latitude");
  });

  it("falls back to a chassis family for a bare part number", () => {
    expect(deriveSeriesName("ASUS", "B1503CVA")).toBe("B1503");
    expect(deriveSeriesName("Samsung", "NP760XJG")).toBe("NP760");
  });

  it("never leaks a wildcard legend into a family name", () => {
    const additional = parseAdditionalModelInfo(
      "N26ED2***,AL15-58P,* can be 0-9, a-z, A-Z or blank"
    );
    const series = deriveSeriesName("Acer", "N26ED2***", additional);
    expect(series).not.toMatch(/can be/);
    expect(series).toBe("AL15");
  });

  it("keeps a published marketing family name intact", () => {
    // The manufacturer is carried separately, so a family name that repeats
    // the brand is kept as the manufacturer published it.
    expect(deriveSeriesName("Lenovo", "Lenovo Chrome 500e")).toBe("Lenovo Chrome 500e");
  });
});

describe("chassisPrefix", () => {
  it("strips the variant suffix", () => {
    expect(chassisPrefix("B1503CVA")).toBe("B1503");
    expect(chassisPrefix("NP760XJG")).toBe("NP760");
    expect(chassisPrefix("P112F")).toBe("P112");
  });

  it("uses the first segment of a hyphenated part number", () => {
    expect(chassisPrefix("AL15-310P")).toBe("AL15");
  });

  it("returns nothing for a value that carries no family", () => {
    expect(chassisPrefix("P")).toBeNull();
  });
});

describe("resolveModelName", () => {
  it("keeps a name that already reads like a product name", () => {
    expect(resolveModelName("ThinkPad E14 Gen 8")).toBe("ThinkPad E14 Gen 8");
  });

  it("prefers the marketing name when the source reports an internal code", () => {
    const additional = parseAdditionalModelInfo("P185G,Dell Pro Essential 14 PV14260");
    expect(resolveModelName("P185G", additional)).toBe("Dell Pro Essential 14 PV14260");
  });
});

describe("configurationSignature", () => {
  const base = {
    cpuModel: "Ryzen AI 7 350",
    cpuCores: 8,
    cpuPackages: 1,
    ramGb: 32,
    storageType: "SSD",
    storageDrives: 1,
    displaySizeIn: 15.3,
    displayResolutionMp: 2.92,
    touchScreen: false,
    batteryWh: 65,
    os: "Windows 11",
  };

  it("is stable for the same configuration", () => {
    expect(configurationSignature(base)).toBe(configurationSignature({ ...base }));
  });

  it("changes when a meaningful field changes", () => {
    expect(configurationSignature(base)).not.toBe(
      configurationSignature({ ...base, ramGb: 64 })
    );
  });

  it("treats a missing field and an empty field as the same", () => {
    const withNull = configurationSignature({ ...base, storageType: null });
    const withEmpty = configurationSignature({ ...base, storageType: "" });
    expect(withNull).toBe(withEmpty);
  });
});

describe("canonicalSkuCode", () => {
  it("is deterministic and unique per configuration", () => {
    const a = canonicalSkuCode("21Y7", "ThinkPad E14 Gen 8", "sig-one");
    const b = canonicalSkuCode("21Y7", "ThinkPad E14 Gen 8", "sig-one");
    const c = canonicalSkuCode("21Y7", "ThinkPad E14 Gen 8", "sig-two");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^21Y7-[0-9a-f]{8}$/);
  });

  it("falls back to the model name when there is no part number", () => {
    const code = canonicalSkuCode(null, "Surface Laptop 13\"", "sig");
    expect(code.startsWith("SURFACE-LAPTOP-13-")).toBe(true);
  });
});
