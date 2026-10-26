/**
 * Manufacturer-specification verification.
 *
 * The tests use HTML saved from the live manufacturer pages
 * (`tests/fixtures/verify_*.html`) so that the parsing rules are exercised
 * against the markup the manufacturer actually serves, and they cover the rule
 * the whole tool exists for:
 *
 *   * a single unambiguous value that disagrees with the reference row is a
 *     contradiction,
 *   * a cell that lists several options is ambiguous, and an ambiguous cell
 *     produces no contradiction at all,
 *   * a part number published in several columns cannot be resolved by a
 *     processor that identifies none of them, so the row is unconfirmed,
 *   * a processor the reference row claims that the page publishes under a
 *     different part number is reported.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { verifyRowAgainstTable } from "@/lib/verify/compare";
import { parseSpecTable } from "@/lib/verify/parse";
import {
  applyCorrections,
  parseRobots,
  readCsvRecords,
  robotsAllows,
  runVerification,
} from "@/lib/verify/runner";
import type { ReferenceRow, RowResult, VerifyReport } from "@/lib/verify/types";

const FIXTURES = path.join(__dirname, "fixtures");

function fixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), "utf-8");
}

function table(name: string, manufacturer = "ASUS") {
  const html = fixture(name);
  const parsed = parseSpecTable(html, `https://example.test/${name}`, manufacturer);
  if (!parsed) throw new Error(`no specification table found in ${name}`);
  return parsed;
}

function row(overrides: Partial<ReferenceRow> = {}): ReferenceRow {
  const base: Record<string, string> = {
    sku_code: "UX3405CA-UQ123WS",
    manufacturer: "ASUS",
    series: "Zenbook",
    model: "Zenbook 14 (UX3405)",
    cpu_model: "Core Ultra 7 258V",
    ram_gb: "32",
    ram_type: "LPDDR5X",
    storage_gb: "1024",
    display_size: "14.0",
    display_resolution: "2880x1800",
    display_type: "OLED",
    display_refresh: "120",
    display_nits: "500",
    weight_kg: "1.28",
    battery_wh: "75",
    source_url: "",
    verified: "false",
  };
  return { ...base, ...overrides } as ReferenceRow;
}

describe("a single unambiguous value that disagrees", () => {
  it("is a contradiction", () => {
    const spec = table("verify_asus_single_value.html");
    const outcome = verifyRowAgainstTable(row({ ram_gb: "32", storage_gb: "512" }), spec);

    expect(outcome.status).toBe("contradicted");
    expect(outcome.partNumber).toBe("UX3405CA");
    expect(outcome.observed.ram_gb).toBe("16");
    expect(outcome.contradictions).toHaveLength(1);
    expect(outcome.contradictions[0]).toMatchObject({
      field: "ram_gb",
      reference: "32",
      manufacturerValue: "16",
      correction: "16",
      partNumber: "UX3405CA",
    });
  });

  it("is not a contradiction when the manufacturer agrees", () => {
    const spec = table("verify_asus_single_value.html");
    const outcome = verifyRowAgainstTable(row({ ram_gb: "16", storage_gb: "512" }), spec);

    expect(outcome.status).toBe("confirmed");
    expect(outcome.contradictions).toHaveLength(0);
  });
});

describe("a cell that lists several options", () => {
  it("is ambiguous and produces no contradiction", () => {
    const spec = table("verify_asus_ambiguous_cell.html");
    // The reference claims a third memory size that the page does not list.
    const outcome = verifyRowAgainstTable(row({ ram_gb: "64", storage_gb: "512" }), spec);

    expect(outcome.status).toBe("confirmed");
    expect(outcome.observed.ram_gb).toBeUndefined();
    expect(outcome.contradictions).toHaveLength(0);
  });

  it("leaves a field the manufacturer does not state alone", () => {
    const spec = table("verify_asus_ambiguous_cell.html");
    // The page states no display size, so the reference value for it is not
    // contradicted.
    const outcome = verifyRowAgainstTable(
      row({ display_size: "99", storage_gb: "512" }),
      spec
    );

    expect(outcome.observed.display_size).toBeUndefined();
    expect(outcome.contradictions).toHaveLength(0);
  });
});

describe("a part number published in several columns", () => {
  it("is unconfirmed when the processor identifies none of them", () => {
    const spec = table("verify_asus_duplicated_part_number.html");
    const outcome = verifyRowAgainstTable(
      row({
        sku_code: "UX3407QA-QD123WS",
        cpu_model: "Core Ultra 7 258V",
        storage_gb: "512",
        display_resolution: "1920x1200",
        display_refresh: "60",
        display_nits: "",
        weight_kg: "1.09",
        battery_wh: "70",
      }),
      spec
    );

    expect(outcome.status).toBe("unconfirmed");
    expect(outcome.reason).toBe("ambiguous-configuration");
    expect(outcome.contradictions).toHaveLength(0);
    expect(outcome.detail).toContain("does not identify exactly one column");
  });

  it("is resolved by the processor when it identifies exactly one column", () => {
    const spec = table("verify_asus_duplicated_part_number.html");
    const outcome = verifyRowAgainstTable(
      row({
        sku_code: "UX3407QA-QD123WS",
        cpu_model: "Snapdragon X Plus X1P 42 100",
        ram_gb: "16",
        storage_gb: "512",
        display_resolution: "1920x1200",
        display_refresh: "60",
        display_nits: "",
        weight_kg: "1.09",
        battery_wh: "70",
      }),
      spec
    );

    expect(outcome.status).toBe("confirmed");
    expect(outcome.observed.cpu_model).toBe("Snapdragon X Plus X1P 42 100");
  });
});

describe("a processor published under a different part number", () => {
  it("is reported as a contradiction", () => {
    const spec = table("verify_asus_duplicated_part_number.html");
    // The page publishes this processor under UX3407RA, not under UX3407QA.
    const withOtherColumn = {
      ...spec,
      columns: [
        ...spec.columns,
        {
          name: "UX3407RA",
          values: { Processor: "Snapdragon® X Elite X1E 78 100 Processor (42MB Cache, up to 3.4GHz)" },
        },
      ],
    };

    const outcome = verifyRowAgainstTable(
      row({ sku_code: "UX3407QA-QD123WS", cpu_model: "Snapdragon X Elite X1E-78-100" }),
      withOtherColumn
    );

    expect(outcome.status).toBe("contradicted");
    expect(outcome.contradictions).toHaveLength(1);
    expect(outcome.contradictions[0].field).toBe("cpu_model");
    expect(outcome.contradictions[0].manufacturerValue).toContain("UX3407RA lists this processor");
    // The manufacturer states no value for this field, so nothing may be
    // written back.
    expect(outcome.contradictions[0].correction).toBeUndefined();
  });
});

describe("the saved ASUS pages", () => {
  it("confirms the Zenbook 14 and contradicts nothing", () => {
    const spec = table("verify_asus_zenbook_14.html");
    const outcome = verifyRowAgainstTable(row({ storage_gb: "1024" }), spec);

    expect(outcome.status).toBe("confirmed");
    expect(outcome.partNumber).toBe("UX3405CA");
    // The cell lists two displays, two memory sizes, two storage sizes and
    // two weights, so only the battery and the panel type are unambiguous.
    expect(outcome.observed).toEqual({ battery_wh: "75", display_type: "OLED" });
    expect(outcome.contradictions).toHaveLength(0);
  });

  it("reports the Zenbook A14 processor as belonging to another part number", () => {
    const spec = table("verify_asus_zenbook_a14.html");
    const outcome = verifyRowAgainstTable(
      row({
        sku_code: "UX3407QA-QD123WS",
        model: "Zenbook A14 (UX3407)",
        cpu_model: "Snapdragon X Elite X1E-78-100",
        ram_gb: "32",
        storage_gb: "1024",
      }),
      spec
    );

    expect(outcome.status).toBe("contradicted");
    expect(outcome.contradictions).toHaveLength(1);
    expect(outcome.contradictions[0].field).toBe("cpu_model");
    expect(outcome.contradictions[0].manufacturerValue).toContain("UX3407RA");
  });

  it("finds no part number for the Zenbook S 16 row on its page", () => {
    const spec = table("verify_asus_zenbook_s16.html");
    const outcome = verifyRowAgainstTable(
      row({ sku_code: "UM5606QA-MY123WS", model: "Zenbook S 16 (UM5606)" }),
      spec
    );

    expect(outcome.status).toBe("unconfirmed");
    expect(outcome.reason).toBe("part-number-absent");
    expect(outcome.detail).toContain("UM5606QA");
  });

  it("finds the ProArt P16 battery and contradicts the refresh rate and the processor", () => {
    const spec = table("verify_asus_proart_p16.html");
    const outcome = verifyRowAgainstTable(
      row({
        sku_code: "H7606WI-MY123WS",
        model: "ProArt P16 (H7606)",
        cpu_model: "Core Ultra 9 285H",
        ram_gb: "64",
        storage_gb: "2048",
        display_size: "16.0",
        display_resolution: "3840x2400",
        display_type: "OLED",
        display_refresh: "120",
        display_nits: "550",
        weight_kg: "1.85",
        battery_wh: "90",
      }),
      spec
    );

    expect(outcome.status).toBe("contradicted");
    expect(outcome.observed.battery_wh).toBe("90");
    expect(outcome.observed.weight_kg).toBe("1.85");
    const fields = outcome.contradictions.map((entry) => entry.field).sort();
    expect(fields).toEqual(["cpu_model", "display_refresh"]);
    const refresh = outcome.contradictions.find((entry) => entry.field === "display_refresh");
    expect(refresh?.reference).toBe("120");
    expect(refresh?.manufacturerValue).toBe("60");
  });

  it("reads the Zenbook Duo battery and storage", () => {
    const spec = table("verify_asus_zenbook_duo.html");
    const outcome = verifyRowAgainstTable(
      row({
        sku_code: "UX8406CA-MY123WS",
        model: "Zenbook Duo (UX8406)",
        cpu_model: "Core Ultra 9 285H",
        storage_gb: "1024",
        weight_kg: "1.65",
        battery_wh: "75",
      }),
      spec
    );

    expect(outcome.status).toBe("confirmed");
    expect(outcome.observed.battery_wh).toBe("75");
    expect(outcome.observed.storage_gb).toBe("1024");
  });

  it("reads the Vivobook S 14 display and battery", () => {
    const spec = table("verify_asus_vivobook_s14.html");
    const outcome = verifyRowAgainstTable(
      row({
        sku_code: "S3407AA-MY123WS",
        model: "Vivobook S 14 (S3407)",
        cpu_model: "Core Ultra 7 355",
        ram_gb: "16",
        ram_type: "DDR5",
        storage_gb: "512",
        display_size: "",
        display_resolution: "1920x1200",
        display_type: "OLED",
        display_refresh: "60",
        display_nits: "",
        weight_kg: "1.40",
        battery_wh: "70",
      }),
      spec
    );

    expect(outcome.status).toBe("confirmed");
    expect(outcome.observed.display_resolution).toBe("1920x1200");
    expect(outcome.observed.battery_wh).toBe("70");
    // The page states no display size and no brightness for this column.
    expect(outcome.observed.display_size).toBeUndefined();
    expect(outcome.observed.display_nits).toBeUndefined();
  });
});

describe("the saved Apple page", () => {
  it("cannot be used, because it does not label its columns with part numbers", () => {
    const spec = table("verify_apple_macbook_air.html", "Apple");
    expect(spec.hasPartNumbers).toBe(false);

    const outcome = verifyRowAgainstTable(
      row({
        sku_code: "MRXN3LL/A",
        manufacturer: "Apple",
        model: "MacBook Air 13 (M4)",
        cpu_model: "M4",
      }),
      spec
    );

    expect(outcome.status).toBe("unconfirmed");
    expect(outcome.reason).toBe("no-part-number-column");
    expect(outcome.contradictions).toHaveLength(0);
  });
});

describe("robots.txt", () => {
  it("refuses a path the policy disallows", () => {
    const groups = parseRobots("User-agent: *\nDisallow: /private/\n");
    expect(robotsAllows(groups, "https://example.test/public/page", "VeridianBot/1.0")).toBe(true);
    expect(robotsAllows(groups, "https://example.test/private/page", "VeridianBot/1.0")).toBe(false);
  });

  it("prefers the most specific agent group", () => {
    const groups = parseRobots(
      "User-agent: *\nDisallow: /\n\nUser-agent: VeridianBot\nDisallow: /private/\n"
    );
    expect(robotsAllows(groups, "https://example.test/public", "VeridianBot/1.0")).toBe(true);
    expect(robotsAllows(groups, "https://example.test/private/x", "VeridianBot/1.0")).toBe(false);
  });

  it("treats an empty disallow as no restriction", () => {
    const groups = parseRobots("User-agent: *\nDisallow:\n");
    expect(robotsAllows(groups, "https://example.test/anything", "VeridianBot/1.0")).toBe(true);
  });
});

describe("the runner", () => {
  it("reports a page it cannot reach as unconfirmed, never as a pass", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "verify-"));
    const reference = path.join(directory, "laptops.csv");
    const sources = path.join(directory, "verify-sources.csv");
    fs.writeFileSync(
      reference,
      "sku_code,manufacturer,model,cpu_model,ram_gb,verified\n" +
        "UX3405CA-UQ123WS,ASUS,Zenbook 14 (UX3405),Core Ultra 7 258V,32,false\n"
    );
    fs.writeFileSync(
      sources,
      "sku_code,manufacturer,region,spec_url,part_number\n" +
        "UX3405CA-UQ123WS,ASUS,US,https://www.asus.com/us/laptops/for-home/zenbook/asus-zenbook-14-ux3405/techspec/,UX3405CA\n"
    );

    const fetchImpl = (async () => {
      throw new Error("the network is unreachable");
    }) as unknown as typeof fetch;

    const report = await runVerification({
      referencePath: reference,
      sourcesPath: sources,
      fetchImpl,
      minIntervalMs: 0,
    });

    expect(report.rowsChecked).toBe(1);
    expect(report.confirmed).toBe(0);
    expect(report.contradicted).toBe(0);
    expect(report.unconfirmed).toBe(1);
    expect(report.results[0].status).toBe("unconfirmed");
  });

  it("never fetches a page the policy disallows", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "verify-"));
    const reference = path.join(directory, "laptops.csv");
    const sources = path.join(directory, "verify-sources.csv");
    fs.writeFileSync(
      reference,
      "sku_code,manufacturer,model,cpu_model,ram_gb,verified\n" +
        "UX3405CA-UQ123WS,ASUS,Zenbook 14 (UX3405),Core Ultra 7 258V,32,false\n"
    );
    fs.writeFileSync(
      sources,
      "sku_code,manufacturer,region,spec_url,part_number\n" +
        "UX3405CA-UQ123WS,ASUS,US,https://www.asus.com/us/laptops/for-home/zenbook/asus-zenbook-14-ux3405/techspec/,UX3405CA\n"
    );

    const requested: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      requested.push(String(input));
      if (String(input).endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow: /us/\n", { status: 200 });
      }
      return new Response("<html></html>", { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runVerification({
      referencePath: reference,
      sourcesPath: sources,
      fetchImpl,
      minIntervalMs: 0,
    });

    expect(requested).toEqual(["https://www.asus.com/robots.txt"]);
    expect(report.unconfirmed).toBe(1);
    expect(report.results[0].reason).toBe("robots-disallowed");
  });
});

describe("writing the result back", () => {
  it("corrects only a value the manufacturer states and marks confirmed rows", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "verify-"));
    const reference = path.join(directory, "laptops.csv");
    const original =
      "sku_code,manufacturer,model,cpu_model,ram_gb,display_refresh,verified,source_url\n" +
      "UX3405CA-UQ123WS,ASUS,Zenbook 14 (UX3405),Core Ultra 7 258V,32,120,false,\n";
    fs.writeFileSync(reference, original);

    const report: VerifyReport = {
      rowsChecked: 1,
      confirmed: 0,
      contradicted: 1,
      unconfirmed: 0,
      notAttempted: 0,
      errors: 0,
      contradictions: [],
      pages: [],
      results: [
        {
          sku_code: "UX3405CA-UQ123WS",
          manufacturer: "ASUS",
          model: "Zenbook 14 (UX3405)",
          status: "contradicted",
          sourceUrl: "https://www.asus.com/us/techspec/",
          partNumber: "UX3405CA",
          observed: { display_refresh: "60" },
          contradictions: [
            {
              sku_code: "UX3405CA-UQ123WS",
              manufacturer: "ASUS",
              field: "display_refresh",
              reference: "120",
              manufacturerValue: "60",
              correction: "60",
              sourceUrl: "https://www.asus.com/us/techspec/",
              partNumber: "UX3405CA",
            },
          ],
        } as RowResult,
      ],
    };

    const applied = applyCorrections(reference, report);
    expect(applied.corrected).toEqual([
      { sku_code: "UX3405CA-UQ123WS", field: "display_refresh", from: "120", to: "60" },
    ]);
    // A row that a page contradicts is not marked as verified.
    expect(applied.verified).toEqual([]);

    const records = readCsvRecords(reference);
    expect(records[0].display_refresh).toBe("60");
    expect(records[0].verified).toBe("false");
    expect(records[0].cpu_model).toBe("Core Ultra 7 258V");
  });

  it("marks a confirmed row as verified and gives it its citation", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "verify-"));
    const reference = path.join(directory, "laptops.csv");
    fs.writeFileSync(
      reference,
      "sku_code,manufacturer,model,cpu_model,ram_gb,verified,source_url\n" +
        "UX3405CA-UQ123WS,ASUS,Zenbook 14 (UX3405),Core Ultra 7 258V,32,false,\n"
    );

    const report: VerifyReport = {
      rowsChecked: 1,
      confirmed: 1,
      contradicted: 0,
      unconfirmed: 0,
      notAttempted: 0,
      errors: 0,
      contradictions: [],
      pages: [],
      results: [
        {
          sku_code: "UX3405CA-UQ123WS",
          manufacturer: "ASUS",
          model: "Zenbook 14 (UX3405)",
          status: "confirmed",
          sourceUrl: "https://www.asus.com/us/techspec/",
          partNumber: "UX3405CA",
          observed: { battery_wh: "75" },
          contradictions: [],
        } as RowResult,
      ],
    };

    const applied = applyCorrections(reference, report);
    expect(applied.verified).toEqual(["UX3405CA-UQ123WS"]);
    expect(applied.cited).toEqual(["UX3405CA-UQ123WS"]);

    const records = readCsvRecords(reference);
    expect(records[0].verified).toBe("true");
    expect(records[0].source_url).toBe("https://www.asus.com/us/techspec/");
  });
});
