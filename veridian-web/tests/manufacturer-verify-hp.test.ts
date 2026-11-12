import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseColumnFields, parseSpecTable } from "@/lib/verify/parse";
import {
  createHpSource,
  HP_SOURCE_NAME,
  type ManufacturerReading,
} from "@/lib/manufacturers/hp";

/**
 * The HP verification adapter.
 *
 * These tests pin down the promise a reader of the reference dataset relies
 * on: an HP 'Specifications' page yields one column per published part
 * number, and a specification field is read only when the manufacturer
 * states a single unambiguous value. Nothing here touches the network.
 */

const FIXTURE = readFileSync(
  join(__dirname, "fixtures", "verify_hp_elitebook_640_g11.html"),
  "utf8"
);
const SOURCE_URL = "https://www.hp.com/us-en/shop/pdp/elitebook-640-g11";

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body;
    },
    headers: new Headers({ "content-type": "text/html" }),
  } as unknown as Response;
}

describe("parseSpecTable with an HP page", () => {
  it("reads each part-number configuration as its own column", () => {
    const table = parseSpecTable(FIXTURE, SOURCE_URL, "HP");
    expect(table).not.toBeNull();
    expect(table!.columns.map((c) => c.name)).toEqual([
      "9G0Y0UA#ABA",
      "9G0Y1UA#ABA",
    ]);
    expect(table!.hasPartNumbers).toBe(true);
  });

  it("extracts the unambiguous specification fields of the first configuration", () => {
    const table = parseSpecTable(FIXTURE, SOURCE_URL, "HP")!;
    const fields = parseColumnFields(table.columns[0]);
    expect(fields.cpu_model).toMatch(/Ultra 7 258V/);
    expect(fields.ram_gb).toBe("16");
    expect(fields.ram_type).toBe("LPDDR5X");
    expect(fields.storage_gb).toBe("512");
    expect(fields.display_size).toBeTruthy();
    expect(fields.display_resolution).toBeTruthy();
    expect(fields.weight_kg).toBe("1.39");
    expect(fields.battery_wh).toBe("56");
  });

  it("keeps the two configurations distinct", () => {
    const table = parseSpecTable(FIXTURE, SOURCE_URL, "HP")!;
    const fields = parseColumnFields(table.columns[1]);
    expect(fields.ram_gb).toBe("32");
    expect(fields.storage_gb).toBe("1024");
    expect(fields.display_resolution).toContain("1920x1200");
  });
});

describe("the HP source", () => {
  it("fetches a page and returns its specification table", async () => {
    const fetchImpl = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => textResponse(FIXTURE));
    const source = createHpSource({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const reading = await source.read({ url: "/elitebook-640-g11" });
    expect(source.name).toBe(HP_SOURCE_NAME);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("hp.com");
    expect(reading.table).not.toBeNull();
    expect(reading.table!.hasPartNumbers).toBe(true);
  });

  it("returns a fetch-error reading when the network throws", async () => {
    const fetchImpl = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => {
      throw new Error("network down");
    });
    const source = createHpSource({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const reading: ManufacturerReading = await source.read({
      url: "/elitebook-640-g11",
    });
    expect(reading.table === null && reading.reason).toBe("fetch-error");
  });

  it("returns no-spec-table when the page has no specification table", async () => {
    const fetchImpl = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () =>
      textResponse("<html><body><p>no table</p></body></html>")
    );
    const source = createHpSource({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const reading: ManufacturerReading = await source.read({
      url: "/elitebook-640-g11",
    });
    expect(reading.table === null && reading.reason).toBe("no-spec-table");
  });
});