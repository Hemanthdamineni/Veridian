import { describe, it, expect } from "vitest";
import { extractJsonLdPrice } from "@/lib/prices/source";

function page(body: string): string {
  return `<!doctype html><html><head><script type="application/ld+json">${body}</script></head><body></body></html>`;
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
});
