import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

interface CountArgs {
  where?: Record<string, unknown>;
}

interface FindArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown>[];
  skip?: number;
  take?: number;
}

/** The arguments the endpoint passed to Prisma, recorded for inspection. */
const countCalls: CountArgs[] = [];
const findCalls: FindArgs[] = [];

const count = vi.fn(async (args: CountArgs) => {
  countCalls.push(args);
  return 3;
});
const findMany = vi.fn(async (args: FindArgs) => {
  findCalls.push(args);
  return [] as unknown[];
});

vi.mock("@/lib/db", () => ({
  prisma: {
    sku: {
      count: (args: CountArgs) => count(args),
      findMany: (args: FindArgs) => findMany(args),
    },
  },
}));

import { GET } from "@/app/api/search/route";

/** Call the endpoint and return the parsed body. */
async function search(query: string, extra = ""): Promise<Record<string, unknown>> {
  const url = `http://localhost/api/search?q=${encodeURIComponent(query)}${extra}`;
  const response = await GET(new NextRequest(url));
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

interface ParsedFiltersBody {
  [key: string]: unknown;
}

async function parsedFilters(query: string, extra = ""): Promise<ParsedFiltersBody> {
  const body = await search(query, extra);
  return body.parsed_filters as ParsedFiltersBody;
}

beforeEach(() => {
  countCalls.length = 0;
  findCalls.length = 0;
});

describe("the plain-language search endpoint", () => {
  it("rejects a request without a query", async () => {
    const response = await GET(new NextRequest("http://localhost/api/search"));
    expect(response.status).toBe(400);
  });

  it("keeps the historical parsed_filters keys with the same meaning", async () => {
    const parsed = await parsedFilters("14 inch OLED laptop under $1500");
    expect(parsed.display_type).toBe("OLED");
    expect(parsed.price_max).toBe("1500");
    expect(parsed.ram_min).toBeUndefined();
    expect(parsed.cpu_brand).toBeUndefined();
    expect(parsed.storage_min).toBeUndefined();
    expect(parsed.weight_max).toBeUndefined();
    expect(parsed.touch).toBeUndefined();
    expect(parsed.region).toBe("US");
  });

  it("keeps producing the same keys for memory, storage and weight", async () => {
    const parsed = await parsedFilters("32 GB RAM with 1 TB of storage under 1.5kg");
    expect(parsed.ram_min).toBe("32");
    expect(parsed.storage_min).toBe("1024");
    expect(parsed.weight_max).toBe("1.5");
  });

  it("keeps the residual keyword in the parsed filters", async () => {
    const parsed = await parsedFilters("Zenbook under $1500");
    expect(parsed.q).toBe("Zenbook");
    expect(parsed.price_max).toBe("1500");
  });

  it("adds the new interpretation keys without removing the old ones", async () => {
    const parsed = await parsedFilters("a beautiful quiet laptop");
    expect(parsed).toHaveProperty("ignored_terms");
    expect(parsed).toHaveProperty("assumptions");
    expect(parsed).toHaveProperty("alternatives");
    expect(parsed).toHaveProperty("confidence");
    expect(parsed.ignored_terms).toEqual(["beautiful", "quiet"]);
    expect(typeof parsed.confidence).toBe("number");
  });

  it("reports the assumptions the parser made", async () => {
    const parsed = await parsedFilters("under 1500 dollars");
    expect((parsed.assumptions as string[]).join(" ")).toContain("US dollars");
  });

  it("returns the alternative readings of an ambiguous sentence", async () => {
    const parsed = await parsedFilters("512GB laptop");
    const alternatives = parsed.alternatives as Array<{ label: string; query: string }>;
    expect(alternatives).toHaveLength(1);
    expect(alternatives[0].label).toContain("memory");
    expect(alternatives[0].query).toContain("RAM");
  });

  it("turns the parsed filters into a database query", async () => {
    await search("16GB RAM OLED laptop under 1200 dollars");
    const where = countCalls[0].where as Record<string, unknown>;
    expect(where.ramGb).toEqual({ gte: 16 });
    expect(where.displayType).toEqual({ in: ["OLED"] });
    expect(where.pricing).toMatchObject({
      some: { region: "US", msrp: { lte: 1200 } },
    });
  });

  it("applies the constraints the shared query builder cannot express", async () => {
    await search("a laptop with a dedicated GPU running Linux");
    const where = countCalls[0].where as Record<string, unknown>;
    expect(where.os).toEqual({ contains: "Linux" });
    expect(where.AND).toBeDefined();
  });

  it("filters on the processor family that was named", async () => {
    await search("Intel Core Ultra 7");
    const where = countCalls[0].where as Record<string, unknown>;
    expect(where.cpuBrand).toEqual({ in: ["Intel"] });
    expect(where.cpuModel).toEqual({ contains: "Core Ultra 7" });
  });

  it("uses the region the sentence implied when the request did not name one", async () => {
    const parsed = await parsedFilters("laptop under ₹90000");
    expect(parsed.region).toBe("IN");
  });

  it("keeps a region the request named", async () => {
    const parsed = await parsedFilters("laptop under ₹90000", "&region=US");
    expect(parsed.region).toBe("US");
  });

  it("says so when the currency of the sentence does not match the region shown", async () => {
    const parsed = await parsedFilters("laptop under ₹90000", "&region=US");
    expect((parsed.assumptions as string[]).join(" ")).toContain("IN region");
  });

  it("maps a relative wish to an order, not to a filter", async () => {
    const parsed = await parsedFilters("cheapest laptop");
    expect(parsed.sort).toBe("price_asc");
    expect(parsed.price_max).toBeUndefined();
  });

  it("sorts by price in memory because price is a relation field", async () => {
    await search("cheapest laptop");
    const call = findCalls[0];
    expect(call.take).toBeUndefined();
    expect(call.skip).toBeUndefined();
  });

  it("orders by screen size when the reader asks for the biggest screen", async () => {
    await search("biggest screen");
    expect(findCalls[0].orderBy?.[0]).toEqual({ displaySizeIn: "desc" });
  });

  it("orders by memory when the reader asks for the most memory", async () => {
    await search("most memory");
    expect(findCalls[0].orderBy?.[0]).toEqual({ ramGb: "desc" });
  });

  it("does not apply gaming requirements to a negated gaming request", async () => {
    const parsed = await parsedFilters("not a gaming laptop");
    expect(parsed.display_type).toBeUndefined();
    expect(parsed.refresh_min).toBeUndefined();
  });

  it("reports the applied constraints the shared builder cannot express", async () => {
    const parsed = await parsedFilters("a laptop with a dedicated GPU running Linux");
    expect(parsed.gpu).toContain("RTX");
    expect(parsed.os).toBe("Linux");
  });
});
