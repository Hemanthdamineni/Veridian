# Retailer Price Feed Registry

**Status:** Describes the price sources as they exist. Every retailer feed in
this registry is **gated** — none is enabled. The catalog shows manufacturer
list prices and reference MSRP only, and every price is labelled a reference
value, never a live quote (ADR-005).

**Policy:** No automated retailer scraping is enabled. Retailer prices require
a source-specific legal/terms gate and an official API/feed or documented
permission (DATA_SOURCES.md, Collection Rules). A feed in this registry is
either *cleared* (an official API/feed with permission), *needs credentials*
(an official API exists but the operator has not obtained access), or
*needs a TOS review* (no official API; scraping would require a terms gate).

The mapping from a product family (and its regional variants) to the page
that quotes its price lives in `veridian-web/data/family-price-sources.csv`
and `veridian-web/data/regional-price-sources.csv`. The refresh CLI
(`npm run db:prices` → `scripts/refresh-family-prices.ts`) reads those files
and reports a source that cannot be reached or carries no price; it never
guesses.

---

## Retailer feeds

| Feed | Kind | Status | Gate to unblock | Notes |
|---|---|---|---|---|
| Best Buy (bestbuy.com) | Retail | 🔴 **Needs credentials** | Best Buy Developer Program API key (free tier: price + availability endpoints) | Official API exists; no credentials in the repository or CI. Use the API in preference to scraping. |
| Amazon (amazon.com) | Retail | 🔴 **Needs credentials** | Amazon Product Advertising API (PA-API 5.0) — associate tag + access/secret keys | Official API exists; requires an Associates account. Prices via the API are delayed quotes. |
| eBay (ebay.com) | Retail | 🔴 **Needs credentials** | eBay Developer Program — OAuth app client ID/secret | Official API exists (Browse API: `itemSummary`, `item`); requires an app registration. |
| Newegg (newegg.com) | Retail | 🟡 **Needs TOS review** | No official price API; page markup only | Scraping would require a terms gate per DATA_SOURCES.md. Do not enable without written permission. |
| B&H Photo (bhphotovideo.com) | Retail | 🟡 **Needs TOS review** | No official price API; page markup only | Same gate as Newegg. |
| Walmart (walmart.com) | Retail | 🔴 **Needs credentials** | Walmart Affiliate API / Content API key | Official API exists for approved affiliates. |

**Cleared (no gate):**

| Feed | Kind | Status | How it is read |
|---|---|---|---|
| Manufacturer product pages | Manufacturer | ✅ **Cleared** | `scripts/refresh-family-prices.ts` reads the schema.org `Product` price from the manufacturer's own page (`data/family-price-sources.csv`); the figure is recorded on the product family, never on a configuration (ADR-007). |

---

## What "reference value" means

Every price the system shows is one of:

* a **manufacturer list price** read from the manufacturer's own page (cleared
  above), or
* a **reference MSRP** from the internal seed dataset (`data/laptops.csv`),
  which is not independently verified and is labelled as such.

Neither is a street price. A retailer feed from the table above is the
prerequisite for a live retail price, and none is enabled yet. The UI, the
API and the price filters all operate on reference values until one is.

## Operator checklist to enable a feed

1. Obtain the credential listed in the "Gate to unblock" column.
2. Add the credential as a secret (`*_API_KEY` etc.) — never to the
   repository.
3. Implement the `PriceSource` contract (`veridian-web/src/lib/prices/source.ts`)
   against the official API.
4. Register the feed in `data/family-price-sources.csv` (family) or
   `data/regional-price-sources.csv` (regional variant) and run
   `npm run db:prices`.
5. Update this registry: move the row from *needs credentials* to *cleared*,
   and record the observation in `docs/DATA_SOURCES.md` with a dated review.