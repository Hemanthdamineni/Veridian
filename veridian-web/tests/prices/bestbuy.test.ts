import { describe, it, expect } from "vitest";
import {
  createBestBuySource,
  BEST_BUY_RETAILER,
  BEST_BUY_SOURCE_NAME,
} from "@/lib/prices/sources/bestbuy";

/**
 * The Best Buy Products API source, tested against realistic API responses
 * through an injected HTTP client. No live credential and no network are
 * used: `fetchImpl` is a fake that returns the fixtures below.
 */

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload,
  } as unknown as Response;
}

function fetchReturning(fixtures: Array<{ url: string; ok?: boolean; payload?: unknown }>) {
  const calls: string[] = [];
  const impl = async (input: unknown): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    calls.push(url);
    const fixture = fixtures.find((f) => url.includes(f.url));
    if (!fixture) return jsonResponse(undefined, false);
    return jsonResponse(fixture.payload, fixture.ok ?? true);
  };
  return { impl, calls };
}

const TARGET = {
  skuId: "sku-1",
  region: "US",
  url: "https://api.bestbuy.com/v1/products/6495820.json",
  sellerName: "Best Buy",
  retailerSku: "6495820",
};

/** A realistic Best Buy Products API response for a laptop. */
const inStockProduct = {
  sku: "6495820",
  name: "Dell Inspiron 15 (2026)",
  salePrice: 899.99,
  regularPrice: 1099.99,
  onlineAvailability: true,
  inStoreAvailability: true,
  url: "https://www.bestbuy.com/site/dell-inspiron-15/6495820.p",
};

describe("bestBuySource", () => {
  it("reads the SKU code, price and availability from a realistic fixture", async () => {
    const { impl, calls } = fetchReturning([
      { url: "6495820", payload: inStockProduct },
    ]);
    const source = createBestBuySource({ apiKey: "test-key", fetchImpl: impl });

    const reading = await source.read(TARGET);

    expect(reading).not.toBeNull();
    expect(reading).toMatchObject({
      price: 899.99,
      currency: "USD",
      retailer: BEST_BUY_RETAILER,
      sourceName: BEST_BUY_SOURCE_NAME,
      kind: "retail",
      inStock: true,
      retailerSku: "6495820",
      confidence: 0.95,
    });
    // The URL the price was read from is recorded on the observation, and it
    // carries the retailer SKU and the credential.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/6495820.json?");
    expect(calls[0]).toContain("apiKey=test-key");
    expect(reading?.sourceUrl).toBe(calls[0]);
  });

  it("reads a string salePrice into a number", async () => {
    const { impl } = fetchReturning([
      {
        url: "A1234",
        payload: { ...inStockProduct, sku: "A1234", salePrice: "649.50", onlineAvailability: true },
      },
    ]);
    const source = createBestBuySource({ apiKey: "k", fetchImpl: impl });
    const reading = await source.read({ ...TARGET, retailerSku: "A1234" });
    expect(reading?.price).toBe(649.5);
  });

  it("reports in stock when either availability channel is open", async () => {
    const { impl } = fetchReturning([
      {
        url: "B1",
        payload: { ...inStockProduct, onlineAvailability: false, inStoreAvailability: true },
      },
    ]);
    const source = createBestBuySource({ apiKey: "k", fetchImpl: impl });
    const reading = await source.read({ ...TARGET, retailerSku: "B1" });
    expect(reading?.inStock).toBe(true);
    expect(reading?.price).toBe(899.99);
  });

  it("returns null when the product is unavailable on every channel", async () => {
    const { impl } = fetchReturning([
      {
        url: "C1",
        payload: { ...inStockProduct, onlineAvailability: false, inStoreAvailability: false },
      },
    ]);
    const source = createBestBuySource({ apiKey: "k", fetchImpl: impl });
    const reading = await source.read({ ...TARGET, retailerSku: "C1" });
    expect(reading).toBeNull();
  });

  it("returns null when the API reports no price", async () => {
    const { impl } = fetchReturning([
      { url: "D1", payload: { ...inStockProduct, sku: "D1", salePrice: null } },
    ]);
    const source = createBestBuySource({ apiKey: "k", fetchImpl: impl });
    const reading = await source.read({ ...TARGET, retailerSku: "D1" });
    expect(reading).toBeNull();
  });

  it("returns null on a non-200 response instead of throwing", async () => {
    const { impl } = fetchReturning([
      { url: "E1", payload: undefined, ok: false },
    ]);
    const source = createBestBuySource({ apiKey: "k", fetchImpl: impl });
    const reading = await source.read({ ...TARGET, retailerSku: "E1" });
    expect(reading).toBeNull();
  });

  it("returns null when the HTTP client rejects instead of throwing", async () => {
    const source = createBestBuySource({
      apiKey: "k",
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    const reading = await source.read(TARGET);
    expect(reading).toBeNull();
  });

  it("reports nothing when no API key is configured, without calling the network", async () => {
    let called = false;
    const source = createBestBuySource({
      apiKey: "",
      fetchImpl: async () => {
        called = true;
        return jsonResponse(inStockProduct);
      },
    });
    const reading = await source.read(TARGET);
    expect(reading).toBeNull();
    expect(called).toBe(false);
  });

  it("records the source URL on every observation", async () => {
    const { impl, calls } = fetchReturning([
      { url: "F1", payload: { ...inStockProduct, sku: "F1" } },
    ]);
    const source = createBestBuySource({ apiKey: "k", fetchImpl: impl });
    const reading = await source.read({ ...TARGET, retailerSku: "F1" });
    expect(reading?.sourceUrl).toBe(calls[0]);
  });

  it("honours a custom currency rather than assuming it", async () => {
    const { impl } = fetchReturning([
      { url: "G1", payload: { ...inStockProduct, sku: "G1" } },
    ]);
    const source = createBestBuySource({ apiKey: "k", fetchImpl: impl, currency: "CAD" });
    const reading = await source.read({ ...TARGET, retailerSku: "G1" });
    expect(reading?.currency).toBe("CAD");
  });

  it("reports nothing for a target without a retailer SKU", async () => {
    let called = false;
    const source = createBestBuySource({
      apiKey: "k",
      fetchImpl: async () => {
        called = true;
        return jsonResponse(inStockProduct);
      },
    });
    const reading = await source.read({ ...TARGET, retailerSku: null });
    expect(reading).toBeNull();
    expect(called).toBe(false);
  });
});