import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseColumnFields,
  parseSpecTable,
} from "@/lib/verify/parse";
import {
  createDellSource,
  DELL_SOURCE_NAME,
  type ManufacturerReading,
} from "@/lib/manufacturers/dell";

/**
 * The Dell Tech Specs adapter.
 *
 * The Dell pages publish a per-configuration spec table, so a confirmed row
 * depends on the part-number columns being read apart. These tests pin down
 * the parsing of a saved Dell page with no live network: the two XPS 13
 * configurations must stay distinct, and each specification field is only
 * read when the manufacturer states a single unambiguous value.
 */

const FIXTURE = readFileSync(
  join(__dirname, "fixtures", "verify_dell_xps13_9340.html"),
  "utf8"
);

const SOURCE_URL =
  "https://www.dell.com/en-us/shop/dell-laptops/xps-13/spd/xps-13-9340-laptop";

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body;
    },
    headers: new Headers({ "content-type": "text/html" }),
  } as Response;
}

describe("parseSpecTable with a Dell page", () => {
  it("reads each part-number configuration as its own column", () => {
    const table = parseSpecTable(FIXTURE, SOURCE_URL, "Dell");
    expect(table).not.toBeNull();
    expect(table!.columns.map((c) => c.name)).toEqual([
      "9440-1428SIL",
      "9440-1628BLU",
    ]);
    expect(table!.hasPartNumbers).toBe(true);
  });

  it("extracts unambiguous specification fields from the first configuration", () => {
    const table = parseSpecTable(FIXTURE, SOURCE_URL, "Dell")!;
    const fields = parseColumnFields(table.columns[0]);
    expect(fields.cpu_model).toMatch(/Ultra 7 155H/);
    expect(fields.ram_gb).toBe("32");
    expect(fields.ram_type).toBe("LPDDR5X");
    expect(fields.storage_gb).toBe("512");
    expect(fields.display_size).toBeTruthy();
    expect(fields.display_resolution).toBeTruthy();
    expect(fields.weight_kg).toBe("1.09");
    expect(fields.battery_wh).toBe("57");
  });

  it("keeps the two configurations distinct", () => {
    const table = parseSpecTable(FIXTURE, SOURCE_URL, "Dell")!;
    const fields = parseColumnFields(table.columns[1]);
    expect(fields.ram_gb).toBe("16");
    expect(fields.storage_gb).toBe("1024");
    expect(fields.display_resolution).toContain("1920x1200");
  });
});

describe("the Dell source", () => {
  it("returns the parsed table on a successful fetch", async () => {
    const fetchImpl = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => textResponse(FIXTURE));
    const source = createDellSource({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const reading = await source.read({ url: "/en-us/shop/dell-laptops/xps-13/spd/xps-13-9340-laptop" });

    expect(source.name).toBe(DELL_SOURCE_NAME);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchImpl.mock.calls[0][0]);
    expect(calledUrl).toContain("dell.com");
    expect(reading.table).not.toBeNull();
    expect(reading.table!.hasPartNumbers).toBe(true);
  });

  it("reports a fetch error without throwing", async () => {
    const fetchImpl = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => {
      throw new Error("network down");
    });
    const source = createDellSource({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const reading: ManufacturerReading = await source.read({ url: "/xps-13" });

    expect(reading.table === null && reading.reason).toBe("fetch-error");
  });

  it("reports no-spec-table when the page has no table", async () => {
    const fetchImpl = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => textResponse("<html><body><p>no table</p></body></html>"));
    const source = createDellSource({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const reading: ManufacturerReading = await source.read({ url: "/xps-13" });

    expect(reading.table === null && reading.reason).toBe("no-spec-table");
  });
});