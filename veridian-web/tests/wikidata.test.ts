import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildWikidataReport, ingestWikidataReport } from "@/lib/wikidata/ingest";
import {
  extractRows,
  sortRows,
  stripSparqlComments,
  WikidataClient,
  WikidataRateLimitError,
  WikidataRequestError,
} from "@/lib/wikidata/sparql";
import type { SparqlResults, WikidataRow } from "@/lib/wikidata/types";
import { cpuBrandFromLabel, validateWikidataRow } from "@/lib/wikidata/validate";

/** A well-formed Wikidata row, as the query returns it. */
function baseRow(overrides: Partial<WikidataRow> = {}): WikidataRow {
  return {
    itemId: "Q42530222",
    itemLabel: "Pixelbook",
    manufacturerId: "Q95",
    manufacturerLabel: "Google",
    releaseDate: "2017-10-04T00:00:00Z",
    cpuId: "Q1044821",
    cpuLabel: "Intel Core 7",
    displaySizeAmount: 12.3,
    displaySizeUnit: "Q218593", // inch
    massAmount: 1310,
    massUnit: "Q41803", // gram
    ramAmount: 8,
    ramUnit: "Q79738", // gigabyte
    ramTypeLabel: "DDR4",
    osId: "Q79531",
    osLabel: "ChromeOS",
    inventoryNumber: null,
    partNumber: null,
    predecessorId: null,
    predecessorLabel: null,
    successorId: null,
    successorLabel: null,
    ...overrides,
  };
}

describe("Wikidata row validation — a well-formed row", () => {
  it("becomes a canonical configuration with the expected code", () => {
    const { record, errors } = validateWikidataRow(baseRow());
    expect(errors).toEqual([]);
    expect(record).not.toBeNull();
    // The canonical code is the model token plus a hash of the configuration
    // signature, so it is stable, human-recognisable and unique.
    expect(record?.skuCode).toMatch(/^PIXELBOOK-[0-9a-f]{8}$/);
    expect(record?.brand).toBe("Google");
    expect(record?.modelName).toBe("Pixelbook");
    expect(record?.seriesName).toBe("Pixelbook");
    expect(record?.os).toBe("ChromeOS");
    expect(record?.launchDate).toBe("2017-10-04");
    expect(record?.observedSpecs.cpuBrand).toBe("Intel");
    expect(record?.observedSpecs.ramGb).toBe(8);
  });

  it("gives the same canonical code to the same configuration every time", () => {
    const a = validateWikidataRow(baseRow()).record;
    // A later observation of the same machine, with a different release date
    // and a different payload, is still the same configuration.
    const b = validateWikidataRow(
      baseRow({ releaseDate: "2018-01-01T00:00:00Z", itemLabel: "Pixelbook" })
    ).record;
    expect(a?.skuCode).toBe(b?.skuCode);
  });

  it("gives different configurations of one model different codes", () => {
    const a = validateWikidataRow(baseRow()).record;
    const b = validateWikidataRow(baseRow({ ramAmount: 16 })).record;
    expect(a?.skuCode).not.toBe(b?.skuCode);
  });
});

describe("Wikidata row validation — unit conversion", () => {
  it("converts mass from grams to kilograms", () => {
    const { record } = validateWikidataRow(baseRow({ massAmount: 1310, massUnit: "Q41803" }));
    expect(record?.observedSpecs.weightKg).toBeCloseTo(1.31, 6);
  });

  it("keeps a mass that is already in kilograms", () => {
    const { record } = validateWikidataRow(baseRow({ massAmount: 5.7, massUnit: "Q11570" }));
    expect(record?.observedSpecs.weightKg).toBeCloseTo(5.7, 6);
  });

  it("converts memory from bytes to GB", () => {
    const { record } = validateWikidataRow(
      baseRow({ ramAmount: 8589934592, ramUnit: "Q8799" })
    );
    expect(record?.observedSpecs.ramGb).toBe(8);
  });

  it("converts a screen size stated in inches", () => {
    const { record } = validateWikidataRow(
      baseRow({ displaySizeAmount: 12.3, displaySizeUnit: "Q218593" })
    );
    expect(record?.observedSpecs.displaySizeIn).toBeCloseTo(12.3, 6);
  });

  it("converts a screen size stated in centimetres", () => {
    const { record } = validateWikidataRow(
      baseRow({ displaySizeAmount: 31.24, displaySizeUnit: "Q174728" })
    );
    expect(record?.observedSpecs.displaySizeIn).toBeCloseTo(12.3, 1);
  });

  it("leaves an unstated value absent instead of guessing it", () => {
    const { record, errors } = validateWikidataRow(
      baseRow({ massAmount: null, massUnit: null, displaySizeAmount: null, displaySizeUnit: null })
    );
    expect(errors).toEqual([]);
    expect(record?.observedSpecs.weightKg).toBeNull();
    expect(record?.observedSpecs.displaySizeIn).toBeNull();
  });

  it("reads the CPU brand from the processor name", () => {
    expect(cpuBrandFromLabel("Intel Core 7")).toBe("Intel");
    expect(cpuBrandFromLabel("Celeron M")).toBe("Intel");
    expect(cpuBrandFromLabel("Apple A18 Pro")).toBe("Apple");
    expect(cpuBrandFromLabel("Ryzen 7")).toBe("AMD");
    expect(cpuBrandFromLabel("Something else")).toBe("Other");
  });
});

describe("Wikidata row validation — impossible values", () => {
  it("rejects an impossible mass with the reason", () => {
    const { record, errors } = validateWikidataRow(
      baseRow({ massAmount: 48000, massUnit: "Q11570" })
    );
    expect(record).toBeNull();
    expect(errors).toContain(
      "mass '48000 kilogram' (48000 kg) is outside [0.05, 50] kg"
    );
  });

  it("rejects an impossible screen size with the reason", () => {
    const { record, errors } = validateWikidataRow(
      baseRow({ displaySizeAmount: 48, displaySizeUnit: "Q218593" })
    );
    expect(record).toBeNull();
    expect(errors).toContain("display size '48 inch' (48 in) is outside [5, 32] in");
  });

  it("rejects a memory amount that is not a whole number of GB", () => {
    const { record, errors } = validateWikidataRow(
      baseRow({ ramAmount: 256, ramUnit: "Q79756" })
    );
    expect(record).toBeNull();
    expect(errors.some((error) => error.includes("must be a whole number of GB"))).toBe(true);
  });

  it("rejects a memory amount in a unit it does not know", () => {
    const { record, errors } = validateWikidataRow(baseRow({ ramUnit: "Q999999" }));
    expect(record).toBeNull();
    expect(errors.some((error) => error.includes("unknown unit 'Q999999'"))).toBe(true);
  });

  it("rejects a row without a manufacturer, a CPU, an OS or memory", () => {
    const { record, errors } = validateWikidataRow(
      baseRow({
        manufacturerLabel: null,
        cpuLabel: null,
        osLabel: null,
        ramAmount: null,
        ramUnit: null,
      })
    );
    expect(record).toBeNull();
    expect(errors).toContain("manufacturer is required");
    expect(errors).toContain("cpu is required");
    expect(errors).toContain("operating system is required");
    expect(errors).toContain("ram capacity is required");
  });

  it("rejects an invalid release date", () => {
    const { errors } = validateWikidataRow(baseRow({ releaseDate: "not-a-date" }));
    expect(errors).toContain("release date 'not-a-date' is not a valid date");
  });
});

describe("Wikidata row validation — placeholder labels", () => {
  it("rejects a label that is only a Wikidata item id", () => {
    const { record, errors } = validateWikidataRow(baseRow({ itemLabel: "Q60774298" }));
    expect(record).toBeNull();
    expect(errors).toContain(
      "item label 'Q60774298' is a Wikidata item id, not a product name"
    );
  });

  it("rejects a source placeholder as a product name", () => {
    const { record, errors } = validateWikidataRow(baseRow({ itemLabel: "n/a" }));
    expect(record).toBeNull();
    expect(errors).toContain("item label 'n/a' is a source placeholder, not a product name");
  });

  it("rejects a processor that has no label", () => {
    const { record, errors } = validateWikidataRow(baseRow({ cpuLabel: "Q98609806" }));
    expect(record).toBeNull();
    expect(errors).toContain("cpu 'Q98609806' is a Wikidata item id, not a processor name");
  });

  it("rejects an operating system that has no label", () => {
    const { record, errors } = validateWikidataRow(baseRow({ osLabel: "Q47604" }));
    expect(record).toBeNull();
    expect(errors).toContain(
      "operating system 'Q47604' is a Wikidata item id, not an operating system name"
    );
  });
});

describe("Wikidata SPARQL client", () => {
  function sparqlResponse(rows: unknown[]): Response {
    return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: rows } }), {
      status: 200,
      headers: { "content-type": "application/sparql-results+json" },
    });
  }

  it("sends the query in a query= parameter with a descriptive user agent", async () => {
    let requestedUrl = "";
    let headers: Record<string, string> = {};
    const client = new WikidataClient(async (input, init) => {
      requestedUrl = String(input);
      headers = (init?.headers ?? {}) as Record<string, string>;
      return sparqlResponse([]);
    });
    await client.runQuery("SELECT ?item WHERE { ?item wdt:P31 wd:Q3962 }");

    const requested = new URL(requestedUrl);
    expect(requested.origin).toBe("https://query.wikidata.org");
    expect(requested.searchParams.get("query")).toBe(
      "SELECT ?item WHERE { ?item wdt:P31 wd:Q3962 }"
    );
    expect(headers.Accept).toBe("application/sparql-results+json");
    // The endpoint answers 403 to a client that sends no user agent.
    expect(headers["User-Agent"]).toBeTruthy();
    expect(headers["User-Agent"]).toMatch(/Veridian/i);
    expect(headers["User-Agent"]).toMatch(/@/);
  });

  it("sends the query without its comments, so the request fits in a URL", () => {
    const documented = [
      "# the laptops of the world",
      "SELECT ?item WHERE {",
      '  ?item rdfs:label "C# notes" . # a hash inside a string stays',
      "}",
    ].join("\n");
    const stripped = stripSparqlComments(documented);
    expect(stripped).not.toContain("the laptops of the world");
    expect(stripped).toContain('"C# notes"');
    expect(stripped).toContain("SELECT ?item WHERE {");
  });

  it("waits at least a second between two requests", async () => {
    const waits: number[] = [];
    let clock = 10_000;
    const client = new WikidataClient(
      async () => sparqlResponse([]),
      async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      () => clock
    );
    await client.runQuery("SELECT 1 WHERE {}");
    await client.runQuery("SELECT 2 WHERE {}");
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThanOrEqual(1000);
  });

  it("stops on HTTP 429 instead of retrying", async () => {
    let calls = 0;
    const client = new WikidataClient(async () => {
      calls += 1;
      return new Response("rate limited", { status: 429 });
    });
    await expect(client.runQuery("SELECT 1 WHERE {}")).rejects.toBeInstanceOf(
      WikidataRateLimitError
    );
    expect(calls).toBe(1);
  });

  it("reports the exact status and body of a failed request", async () => {
    const client = new WikidataClient(
      async () => new Response("upstream request timeout", { status: 504 })
    );
    const error = await client.runQuery("SELECT 1 WHERE {}").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WikidataRequestError);
    expect((error as WikidataRequestError).status).toBe(504);
    expect((error as WikidataRequestError).body).toBe("upstream request timeout");
  });

  it("extracts observed values and leaves unstated ones absent", () => {    const results: SparqlResults = {
      head: { vars: ["item", "itemLabel"] },
      results: {
        bindings: [
          {
            item: { type: "uri", value: "http://www.wikidata.org/entity/Q42530222" },
            itemLabel: { type: "literal", value: "Pixelbook", "xml:lang": "en" },
            massAmount: { type: "literal", value: "1310", datatype: "http://www.w3.org/2001/XMLSchema#decimal" },
            massUnit: { type: "uri", value: "http://www.wikidata.org/entity/Q41803" },
          },
        ],
      },
    };
    const rows = extractRows(results);
    expect(rows).toHaveLength(1);
    expect(rows[0].itemId).toBe("Q42530222");
    expect(rows[0].itemLabel).toBe("Pixelbook");
    expect(rows[0].massAmount).toBe(1310);
    expect(rows[0].massUnit).toBe("Q41803");
    // The source did not publish these, so they stay absent.
    expect(rows[0].ramAmount).toBeNull();
    expect(rows[0].manufacturerLabel).toBeNull();
    expect(rows[0].osLabel).toBeNull();
  });

  it("orders the rows deterministically, most complete first", () => {
    const sparse: WikidataRow = baseRow({
      manufacturerLabel: null,
      cpuLabel: null,
      osLabel: null,
      ramAmount: null,
      ramUnit: null,
      massAmount: null,
      massUnit: null,
      itemLabel: "Aaa sparse",
      itemId: "Q1",
    });
    const complete: WikidataRow = baseRow({ itemLabel: "Zzz complete", itemId: "Q2" });
    const sorted = sortRows([sparse, complete]);
    expect(sorted[0].itemId).toBe("Q2");
    // The same rows in another order give the same result.
    expect(sortRows([complete, sparse]).map((row) => row.itemId)).toEqual(
      sorted.map((row) => row.itemId)
    );
  });
});

describe("Wikidata ingestion — audited write path", () => {
  async function withTempDb(fn: (prisma: PrismaClient) => Promise<void>) {
    const dir = mkdtempSync(path.join(tmpdir(), "veridian-wikidata-test-"));
    const dbPath = path.join(dir, "test.db");
    process.env.DATABASE_URL = `file:${dbPath}`;
    const prisma = new PrismaClient();
    try {
      execSync("npx prisma db push --skip-generate --accept-data-loss --force-reset", {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env },
        stdio: "ignore",
      });
      await fn(prisma);
    } finally {
      await prisma.$disconnect();
      delete process.env.DATABASE_URL;
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("writes the canonical entities, the observation and the provenance row", async () => {
    const report = buildWikidataReport([baseRow()]);
    expect(report.accepted).toBe(1);
    expect(report.rejected).toBe(0);

    await withTempDb(async (prisma) => {
      const result = await ingestWikidataReport(prisma, report);
      expect(result.created).toBe(1);

      const sku = await prisma.sku.findUnique({
        where: { skuCode: report.records[0].skuCode },
        include: { certifiedSpecs: true, observations: true, sources: true, model: true },
      });
      expect(sku).not.toBeNull();
      expect(sku?.ramGb).toBe(8);
      expect(sku?.weightKg).toBeCloseTo(1.31, 6);
      expect(sku?.displaySizeIn).toBeCloseTo(12.3, 6);
      expect(sku?.os).toBe("ChromeOS");
      expect(sku?.cpuBrand).toBe("Intel");
      // Provenance is written by the ingestion path, never inferred downstream.
      expect(sku?.provenance).toBe("manufacturer");
      expect(sku?.model.name).toBe("Pixelbook");

      // One immutable observation with the payload hash of the source row.
      expect(sku?.observations).toHaveLength(1);
      expect(sku?.observations[0].status).toBe("accepted");
      expect(sku?.observations[0].payloadHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.parse(sku?.observations[0].payload ?? "{}").itemId).toBe("Q42530222");

      // The observed specification and the source row.
      expect(sku?.certifiedSpecs).toHaveLength(1);
      expect(sku?.certifiedSpecs[0].energyStarId).toBe("Q42530222");
      expect(sku?.certifiedSpecs[0].ramGb).toBe(8);

      // Every configuration carries an explicit provenance row.
      expect(sku?.sources).toHaveLength(1);
      expect(sku?.sources[0].source).toBe("Wikidata");
      expect(sku?.sources[0].kind).toBe("manufacturer");
      expect(sku?.sources[0].sourceUrl).toContain("wikidata.org/wiki/Q42530222");
    });
  });

  it("merges two rows for one configuration into one canonical entry", async () => {
    // The same configuration observed twice: a second observation of the same
    // machine on another date.
    const report = buildWikidataReport([
      baseRow(),
      baseRow({ releaseDate: "2018-02-02T00:00:00Z" }),
    ]);
    expect(report.accepted).toBe(2);

    await withTempDb(async (prisma) => {
      const result = await ingestWikidataReport(prisma, report);
      expect(result.created).toBe(1);
      expect(result.merged).toBe(1);
      expect(await prisma.sku.count()).toBe(1);
      // Both observations are kept, so nothing is lost when records merge.
      expect(await prisma.rawObservation.count({ where: { status: "accepted" } })).toBe(2);
      expect(await prisma.certifiedSkuSpec.count()).toBe(1);
      expect(await prisma.skuSource.count()).toBe(1);
    });
  });

  it("is idempotent: running it twice creates no duplicates", async () => {
    const report = buildWikidataReport([baseRow()]);

    await withTempDb(async (prisma) => {
      await ingestWikidataReport(prisma, report);
      const again = await ingestWikidataReport(prisma, report);
      expect(again.created).toBe(0);
      expect(again.unchanged).toBe(1);
      expect(await prisma.sku.count()).toBe(1);
      expect(await prisma.rawObservation.count()).toBe(1);
      expect(await prisma.certifiedSkuSpec.count()).toBe(1);
      expect(await prisma.skuSource.count()).toBe(1);
      expect(await prisma.manufacturer.count()).toBe(1);
      expect(await prisma.series.count()).toBe(1);
      expect(await prisma.model.count()).toBe(1);
    });
  });

  it("never stores a rejected row as a catalog fact", async () => {
    const report = buildWikidataReport([
      baseRow({ massAmount: 48000, massUnit: "Q11570" }),
    ]);
    expect(report.accepted).toBe(0);
    expect(report.rejected).toBe(1);

    await withTempDb(async (prisma) => {
      const result = await ingestWikidataReport(prisma, report);
      expect(result.accepted).toBe(0);
      expect(result.rejectedStored).toBe(1);
      expect(await prisma.sku.count()).toBe(0);

      const raw = await prisma.rawObservation.findFirst({ where: { status: "rejected" } });
      expect(raw).not.toBeNull();
      expect(raw?.errors).toContain("mass");
      expect(raw?.payloadHash).toMatch(/^[a-f0-9]{64}$/);

      // The rejected row is stored once, not once per run.
      const again = await ingestWikidataReport(prisma, report);
      expect(again.rejectedStored).toBe(0);
      expect(await prisma.rawObservation.count({ where: { status: "rejected" } })).toBe(1);
    });
  });
});
