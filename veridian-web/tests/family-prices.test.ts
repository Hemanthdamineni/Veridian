import { describe, it, expect } from "vitest";
import { extractJsonLdPrice, resolveRegion } from "@/lib/prices/source";

/**
 * The family list price is the price the manufacturer publishes for a whole
 * product family. These are the page shapes the collector has to understand
 * to read one honestly, and the rules it has to hold to:
 *
 *   * a plain offer is the family's list price;
 *   * an array of offers makes the cheapest published offer the family's
 *     starting price;
 *   * an aggregate offer's low price is a starting price, and its high price
 *     is never the price of the family;
 *   * a page that publishes no structured price yields nothing at all;
 *   * a region and a currency that disagree are corrected, never filed as
 *     they are.
 */

function page(body: string, title = "Example"): string {
  return `<!doctype html><html><head><title>${title}</title><script type="application/ld+json">${body}</script></head><body></body></html>`;
}

describe("the family list price", () => {
  it("is the price of a plain offer", () => {
    const html = page(
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "ASUS Zenbook A14 (UX3407)",
        offers: { "@type": "Offer", price: "1599.99", priceCurrency: "USD" },
      })
    );
    const reading = extractJsonLdPrice(html);
    expect(reading?.price).toBe(1599.99);
    expect(reading?.currency).toBe("USD");
    expect(reading?.basis).toBe("list");
  });

  it("is the cheapest of an array of published offers, and is a starting price", () => {
    const html = page(
      JSON.stringify({
        "@type": "Product",
        name: "Zenbook",
        offers: [
          { "@type": "Offer", price: "2299.00", priceCurrency: "EUR" },
          { "@type": "Offer", price: "1299.00", priceCurrency: "EUR" },
          { "@type": "Offer", price: "1699.00", priceCurrency: "EUR" },
        ],
      })
    );
    const reading = extractJsonLdPrice(html);
    expect(reading?.price).toBe(1299);
    expect(reading?.basis).toBe("from");
    expect(reading?.shape).toBe("offer-array");
  });

  it("is the low price of an aggregate offer, and never its high price", () => {
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
    expect(reading?.price).not.toBe(3519);
    expect(reading?.basis).toBe("from");
    expect(reading?.shape).toBe("aggregate-offer");
  });

  it("is nothing at all when the page publishes no structured price", () => {
    expect(extractJsonLdPrice("<html><body>From $999</body></html>")).toBeNull();
    expect(extractJsonLdPrice(page(JSON.stringify({ "@type": "WebPage" })))).toBeNull();
    expect(
      extractJsonLdPrice(
        page(JSON.stringify({ "@type": "Product", name: "No price here" }))
      )
    ).toBeNull();
  });

  it("is the page's own product when the page publishes several", () => {
    const html = `<html><head><title>ASUS Zenbook A14 (UX3407) | ASUS UK</title></head><body>
      <script type="application/ld+json">${JSON.stringify([
        { "@type": "Product", name: "ASUS Zenbook A16 (UX3607)", offers: { price: "1299.00", priceCurrency: "GBP" } },
        { "@type": "Product", name: "ASUS Zenbook A14 (UX3407)", offers: { price: "949.00", priceCurrency: "GBP" } },
      ])}</script></body></html>`;
    const reading = extractJsonLdPrice(html);
    expect(reading?.price).toBe(949);
    expect(reading?.productName).toBe("ASUS Zenbook A14 (UX3407)");
  });
});

describe("the region of a family price", () => {
  const reading = (price: number, currency: string, stated = true) => ({
    price,
    currency,
    inStock: true,
    basis: "list" as const,
    shape: "offer" as const,
    currencyStated: stated,
    productName: "A laptop",
    ambiguous: false,
  });

  it("keeps a region that matches the currency", () => {
    const decision = resolveRegion({
      declaredCurrency: "GBP",
      declaredRegion: "UK",
      extracted: reading(949, "GBP"),
    });
    expect(decision.region).toBe("UK");
    expect(decision.currency).toBe("GBP");
    expect(decision.regionCorrected).toBe(false);
    expect(decision.notes).toHaveLength(0);
  });

  it("corrects a region that does not match the currency", () => {
    const decision = resolveRegion({
      declaredCurrency: "EUR",
      declaredRegion: "EU",
      extracted: reading(949, "EUR"),
    });
    expect(decision.region).toBe("EU");
    expect(decision.currency).toBe("EUR");
    expect(decision.regionCorrected).toBe(false);
  });

  it("believes the page when it publishes a currency the list did not declare", () => {
    const decision = resolveRegion({
      declaredCurrency: "USD",
      declaredRegion: "US",
      extracted: reading(86990, "INR"),
    });
    expect(decision.currency).toBe("INR");
    expect(decision.region).toBe("IN");
    expect(decision.currencyCorrected).toBe(true);
    expect(decision.regionCorrected).toBe(true);
    expect(decision.notes.join(" ")).toContain("INR");
  });

  it("reports a currency it cannot place in a region rather than filing it wrongly", () => {
    const decision = resolveRegion({
      declaredCurrency: "XYZ",
      declaredRegion: "US",
      extracted: reading(100, "XYZ"),
    });
    expect(decision.currency).toBe("XYZ");
    expect(decision.region).toBe("US");
    expect(decision.regionUnconfirmed).toBe(true);
    expect(decision.notes.join(" ")).toContain("no region is known");
  });

  it("says so when the page states no currency and the list's currency is used", () => {
    const decision = resolveRegion({
      declaredCurrency: "EUR",
      declaredRegion: "DE",
      extracted: reading(949, "EUR", false),
    });
    expect(decision.currency).toBe("EUR");
    expect(decision.currencyFromSourceList).toBe(true);
    expect(decision.notes.join(" ")).toContain("did not state a currency");
  });
});
