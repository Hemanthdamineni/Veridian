import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpecTable, parseColumnFields } from "@/lib/verify/parse";
import {
  createLenovoSource,
  LENOVO_SOURCE_NAME,
  type ManufacturerReading,
} from "@/lib/manufacturers/lenovo";

/**
 * The Lenovo specification adapter.
 *
 * These tests pin down what the adapter promises a reader: a Lenovo
 * specification page parses into one column per part number, a cell that
 * lists several values is ambiguous and never guessed at, and the source
 * never throws when the page is unreachable — it reports a reason.
 */

const FIXTURE = readFileSync(
  join(__dirname, "fixtures", "verify_lenovo_thinkpad_x1_carbon_gen12.html"),
  "utf8"
);

const SOURCE_URL =
  "https://psref.lenovo.com/syspool/Techspecs/PD000376_ThinkPad_X1_Carbon_Gen_12";

function textResponse(body: string, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body;
    },
    headers: new Headers({ "content-type": "text/html" }),
  } as unknown as Response;
}

describe("parseSpecTable with a Lenovo page", () => {
  it("parses one column per part number, with part-number headers", () => {
    const table = parseSpecTable(FIXTURE, SOURCE_URL, "Lenovo");
    expect(table).not.toBeNull();
    expect(table!.hasPartNumbers).toBe(true);
    expect(table!.columns.map((column) => column.name)).toEqual([
      "21KC000UUS",
      "21KC000VUS",
    ]);
  });

  it("extracts the unambiguous specification fields of a column", () => {
    const table = parseSpecTable(FIXTURE, SOURCE_URL, "Lenovo")!;
    const observed = parseColumnFields(table.columns[0]);
    expect(observed.cpu_model).toMatch(/Ultra 7 155H/);
    expect(observed.ram_gb).toBe("32");
    expect(observed.ram_type).toBe("LPDDR5X");
    expect(observed.storage_gb).toBe("512");
    expect(observed.display_size).toBeTruthy();
    expect(observed.display_resolution).toBeTruthy();
    expect(observed.weight_kg).toBe("1.09");
    expect(observed.battery_wh).toBe("57");
  });

  it("keeps the two configurations distinct", () => {
    const table = parseSpecTable(FIXTURE, SOURCE_URL, "Lenovo")!;
    const slim = parseColumnFields(table.columns[1]);
    expect(slim.ram_gb).toBe("16");
    expect(slim.storage_gb).toBe("256");
    expect(slim.display_resolution).toContain("1920x1200");
  });
});

describe("the Lenovo source", () => {
  it("returns a parsed table from a successful fetch", async () => {
    const fetchImpl = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => textResponse(FIXTURE, 200));
    const source = createLenovoSource({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(source.name).toBe(LENOVO_SOURCE_NAME);

    const reading = await source.read({ url: "syspool/PD000376" });

    expect(reading.table).not.toBeNull();
    expect(reading.table!.hasPartNumbers).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchImpl.mock.calls[0];
    expect(String(calledUrl)).toContain("psref.lenovo.com");
    expect(String(calledUrl)).toContain("syspool/PD000376");
  });

  it("returns a documented reason when the page cannot be reached", async () => {
    const fetchImpl = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => {
      throw new Error("network down");
    });
    const source = createLenovoSource({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const reading: ManufacturerReading = await source.read({ url: "syspool/x" });

    expect(reading.table).toBeNull();
    expect(reading.table === null && reading.reason).toBe("fetch-error");
  });

  it("returns a documented reason when the page has no spec table", async () => {
    const fetchImpl = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () =>
      textResponse("<html><body><p>no table</p></body></html>", 200)
    );
    const source = createLenovoSource({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const reading: ManufacturerReading = await source.read({
      url: "syspool/none",
    });

    expect(reading.table).toBeNull();
    expect(reading.table === null && reading.reason).toBe("no-spec-table");
  });
});