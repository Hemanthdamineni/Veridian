import { describe, it, expect } from "vitest";
import {
  extractJsonLdPrice,
  currencyMatchesRegion,
  parsePriceValue,
  regionForCurrency,
} from "@/lib/prices/source";

function page(body: string): string {
  return `<!doctype html><html><head><title>Example</title><script type="application/ld+json">${body}</script></head><body></body></html>`;
}

describe("extractJsonLdPrice", () => {
  it("reads a price from Product markup", () => {
    const html = page(
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Zenbook 14",
        offers: { "@type": "Offer", price: "1799.99", priceCurrency: "USD" },
      })
    );
    expect(extractJsonLdPrice(html)).toEqual({
      price: 1799.99,
      currency: "USD",
      inStock: true,
      basis: "list",
      shape: "offer",
      currencyStated: true,
      productName: "Zenbook 14",
      ambiguous: false,
    });
  });

  it("reads a price from an array of offers", () => {
    const html = page(
      JSON.stringify({
        "@type": "Product",
        offers: [
          { "@type": "Offer", price: "999.00", priceCurrency: "EUR" },
          { "@type": "Offer", price: "1200.00", priceCurrency: "EUR" },
        ],
      })
    );
    expect(extractJsonLdPrice(html)?.price).toBe(999);
    expect(extractJsonLdPrice(html)?.currency).toBe("EUR");
  });

  it("reads a price from a graph node", () => {
    const html = page(
      JSON.stringify({
        "@graph": [
          { "@type": "WebPage" },
          {
            "@type": "Product",
            offers: { price: 1234.5, priceCurrency: "GBP" },
          },
        ],
      })
    );
    expect(extractJsonLdPrice(html)).toEqual({
      price: 1234.5,
      currency: "GBP",
      inStock: true,
      basis: "list",
      shape: "offer",
      currencyStated: true,
      productName: null,
      ambiguous: false,
    });
  });

  it("reports an out-of-stock product", () => {
    const html = page(
      JSON.stringify({
        "@type": "Product",
        offers: {
          price: "10.00",
          priceCurrency: "USD",
          availability: "http://schema.org/OutOfStock",
        },
      })
    );
    expect(extractJsonLdPrice(html)?.inStock).toBe(false);
  });

  it("returns nothing when the page carries no structured price", () => {
    expect(extractJsonLdPrice("<html><body>Starting at $999</body></html>")).toBeNull();
    expect(extractJsonLdPrice(page(JSON.stringify({ "@type": "Product" })))).toBeNull();
  });

  it("returns nothing for a price that is not a usable number", () => {
    const html = page(
      JSON.stringify({ "@type": "Product", offers: { price: "0", priceCurrency: "USD" } })
    );
    expect(extractJsonLdPrice(html)).toBeNull();
  });

  it("ignores malformed JSON rather than failing", () => {
    const html = page("{ this is not json");
    expect(extractJsonLdPrice(html)).toBeNull();
  });

  it("returns nothing when the offer states no currency", () => {
    const html = page(
      JSON.stringify({ "@type": "Product", offers: { price: "1299.00" } })
    );
    expect(extractJsonLdPrice(html)).toBeNull();
  });

  it("takes the declared currency when the page states none, and says so", () => {
    const html = page(
      JSON.stringify({ "@type": "Product", offers: { price: "1299.00" } })
    );
    const reading = extractJsonLdPrice(html, { expectedCurrency: "GBP" });
    expect(reading?.currency).toBe("GBP");
    expect(reading?.currencyStated).toBe(false);
  });

  it("reads an aggregate offer as a starting price", () => {
    const html = page(
      JSON.stringify({
        "@type": "Product",
        name: "13-inch MacBook Air",
        offers: {
          "@type": "AggregateOffer",
          lowPrice: 1299,
          highPrice: 3519,
          priceCurrency: "USD",
        },
      })
    );
    const reading = extractJsonLdPrice(html);
    expect(reading?.price).toBe(1299);
    expect(reading?.basis).toBe("from");
    expect(reading?.shape).toBe("aggregate-offer");
  });

  it("reads a price out of a price specification", () => {
    const html = page(
      JSON.stringify({
        "@type": "Product",
        offers: {
          "@type": "Offer",
          priceSpecification: { price: "749.00", priceCurrency: "EUR" },
        },
      })
    );
    const reading = extractJsonLdPrice(html);
    expect(reading?.price).toBe(749);
    expect(reading?.currency).toBe("EUR");
    expect(reading?.shape).toBe("price-specification");
  });

  it("reads markup that is embedded in the page rather than in a script tag", () => {
    const payload = JSON.stringify({
      "@context": "http://schema.org/",
      "@type": "Product",
      name: "Workstation",
      offers: { "@type": "Offer", price: "155476.80", priceCurrency: "INR" },
    });
    const html = `<html><body><script>self.__next_f.push([1,"${payload.replace(/"/g, '\\"')}"])</script></body></html>`;
    const reading = extractJsonLdPrice(html);
    expect(reading?.price).toBe(155476.8);
    expect(reading?.currency).toBe("INR");
  });

  it("picks the product the page is about when it publishes several", () => {
    const html = `<html><head><title>ASUS Zenbook A14 (UX3407) | ASUS</title></head><body>
      <script type="application/ld+json">${JSON.stringify([
        { "@type": "Product", name: "ASUS Zenbook A16 (UX3607)", offers: { price: "1299.00", priceCurrency: "GBP" } },
        { "@type": "Product", name: "ASUS Zenbook A14 (UX3407)", offers: { price: "949.00", priceCurrency: "GBP" } },
      ])}</script></body></html>`;
    const reading = extractJsonLdPrice(html);
    expect(reading?.price).toBe(949);
    expect(reading?.productName).toBe("ASUS Zenbook A14 (UX3407)");
  });
});

describe("parsePriceValue", () => {
  it("reads a plain number", () => {
    expect(parsePriceValue("1299")).toBe(1299);
    expect(parsePriceValue(1299)).toBe(1299);
  });

  it("reads a grouped number", () => {
    expect(parsePriceValue("1,599.99")).toBe(1599.99);
    expect(parsePriceValue("1.599,99")).toBe(1599.99);
  });

  it("reads a number written with a decimal comma", () => {
    expect(parsePriceValue("1599,99")).toBe(1599.99);
  });

  it("drops a currency symbol or code written into the number", () => {
    expect(parsePriceValue("$1,299.00")).toBe(1299);
    expect(parsePriceValue("1299.00 USD")).toBe(1299);
  });

  it("refuses a number it cannot read", () => {
    expect(parsePriceValue("")).toBeNull();
    expect(parsePriceValue("free")).toBeNull();
    expect(parsePriceValue(0)).toBeNull();
  });
});

describe("regions and currencies", () => {
  it("knows the region a currency belongs to", () => {
    expect(regionForCurrency("USD")).toBe("US");
    expect(regionForCurrency("GBP")).toBe("UK");
    expect(regionForCurrency("EUR")).toBe("EU");
    expect(regionForCurrency("INR")).toBe("IN");
    expect(regionForCurrency("CAD")).toBe("CA");
    expect(regionForCurrency("AUD")).toBe("AU");
    expect(regionForCurrency("XYZ")).toBeNull();
  });

  it("confirms a currency against a region", () => {
    expect(currencyMatchesRegion("GBP", "UK")).toBe(true);
    expect(currencyMatchesRegion("EUR", "EU")).toBe(true);
    expect(currencyMatchesRegion("EUR", "DE")).toBe(true);
    expect(currencyMatchesRegion("GBP", "EU")).toBe(false);
    expect(currencyMatchesRegion("USD", "UK")).toBe(false);
    expect(currencyMatchesRegion("XYZ", "US")).toBe(false);
  });
});
