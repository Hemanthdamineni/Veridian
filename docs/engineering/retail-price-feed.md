# Retail Price Feed — Feature Specification and Test Plan

> **Status:** Proposed (post-MVP). First feature to build after the 2026-11-12
> reconciliation of `TODO.md` and `ROADMAP.md`.
> **Scope:** Epic 3 (Price Intelligence), item 3.7. The build order in
> `ROADMAP.md` calls this the "Now" item: *a per-configuration retail price
> feed — the largest remaining gap between the product promise and the
> reality*.
> **Date:** 2026-11-12.
>
> This document is a specification and test plan. It does not change code.
> It is written against the working tree as measured by
> `bash scripts/verify-all.sh` (all checks passing) and `npm run db:audit`.

---

## 1. The gap

The methodology page and `docs/PRICE_FEEDS.md` are explicit: **no price in the
system is a street price.**

The schema and the pipeline that would carry a live retail price already
exist and are covered by tests:

- `Seller`, `RetailerListing` — the retailer and its listing for a product.
- `PriceObservation` — the append-only observation row (kind `retail`).
- `PriceHistory` — the per-listing history rollup.
- `PriceSource` contract + JSON-LD reader — `src/lib/prices/source.ts`
  (ADR-005). A retail reading needs a listing, a seller and a timestamp
  because that is what makes a retail price meaningful over time.
- `refresh-prices.ts` — the CLI that turns a configured source into stored
  observations (currently only **family-level manufacturer** and **regional**
  sources; it never writes a **per-configuration retail** observation).

What is missing is a connected **retail** source — a seller's API/feed — and
the per-configuration write path. `docs/PRICE_FEEDS.md` lists six retail
feeds, every one gated:

| Feed | Kind | Status |
|------|------|--------|
| Best Buy | Retail | 🔴 Needs credentials (official API exists) |
| Amazon | Retail | 🔴 Needs credentials (official API exists) |
| eBay | Retail | 🔴 Needs credentials (official API exists) |
| Newegg | Retail | 🟡 Needs TOS review |
| B&H Photo | Retail | 🟡 Needs TOS review |
| Walmart | Retail | 🔴 Needs credentials (official API exists) |

**Decision for the first retail feed:** **Best Buy**. It is the only retail
feed whose gate is a *credential* (Best Buy Developer Program API key), the
API is official (price + availability endpoints), and the credential can be
held as a secret without a terms review. Amazon/eBay/Walmart need an
Associates/affiliate account plus API keys; Newegg and B&H have no official
price API and require a TOS gate. Best Buy is therefore the smallest,
most auditable path to a first *real* retail observation.

**Design principle (carried from ADR-005/007):** a retail observation is
attached to a **configuration** (SKU) via its listing, and is labelled
`kind: "retail"`. It is never presented as a manufacturer list price or a
reference MSRPging, and it is never guessed: if the API returns no price, no
row is written.

---

## 2. Goals / non-goals

### Goals

1. Add a `PriceSource` implementation for the Best Buy Products API
   (`price` + `availability` endpoints), behind a credential that lives only
   as a secret (`BEST_BUY_API_KEY`), never in the repository.
2. Add the per-configuration retail write path: resolve a Best Buy SKU/UPC to
   a `Sku`, create/update the `RetailerListing`, and append a
   `kind: "retail"` `PriceObservation` (with `PriceHistory`).
3. Make the feature testable **without live credentials or network** so CI is
   green and deterministic.
4. Keep every existing "reference value" guarantee intact: a retail
   observation is disclosed as `retail` and can be distinguished from
   manufacturer/reference values in the UI and API.
5. Update `docs/PRICE_FEEDS.md` and `docs/DATA_SOURCES.md` when a feed
   actually becomes cleared.

### Non-goals

- Automatically scraping retailer pages (TOS-gated; see DATA_SOURCES.md
  Collection Rules).
- Enabling Amazon/eBay/Walmart/Newegg/B&H feeds (each has its own credential
  or TOS gate).
- Changing how *existing* manufacturer/reference prices are shown.
- Building the alerts dispatch on top of retail prices in this increment.

---

## 3. Data model impact

All models already exist; **no schema migration is required**. This feature
uses them:

```
Seller            — Best Buy (name, slug, region "US", baseUrl, scrapeMethod "api")
RetailerListing   — one row per (sellerId, retailerSkuString), the match to a Sku
PriceObservation  — kind "retail", listingId set, sourceUrl = the API item page,
                    inStock/confidence from the API response
PriceHistory      — per (listingId, skuId) scrapedAt snapshot
```

New `Seller` seed:

| field | value |
|-------|-------|
| name | Best Buy |
| slug | best-buy |
| region | US |
| baseUrl | https://www.bestbuy.com |
| scrapeMethod | `api` |
| affiliateUrl | null |

---

## 4. Source contract

Implement `PriceSource` in `veridian-web/src/lib/prices/source.ts` or a new
`src/lib/prices/bestbuy.ts`:

```ts
export interface BestBuyPriceTarget extends PriceTarget {
  /** The retailer's SKU / modelId (Best Buy `skuId` or UPC). */
  retailerSku: string;
  sellerName: string; // "Best Buy"
}

export const bestBuySource: PriceSource = {
  name: "Best Buy Products API",
  kind: "retail",
  read(target) {
    // GET https://api.bestbuy.com/v1/products/{retailerSku}.json
    //   ?apiKey={BEST_BUY_API_KEY}
    // Returns the current salePrice + availability.
    // Returns null when the API returns no price or the SKU is unavailable.
  },
};
```

The `read` returns a `PriceReading` whose `kind` is `retail`, `retailer` is
`"Best Buy"`, `sourceUrl` is the product URL on bestbuy.com, and `inStock`
comes from the availability endpoint.

**Contract rules (mirror `source.ts` header):**

- A missing price is never guessed — return `null`.
- The currency is taken from the page/API, never assumed.
- `robots.txt`/terms: the official API is used in preference to scraping, so
  no bypass is attempted.
- Every observation records the URL it came from and the moment it was read.

---

## 5. Write path (`refresh-prices.ts` or a new `scripts/refresh-retail-prices.ts`)

Add a per-configuration retail refresh that:

1. Reads the mapping `data/retail-price-sources.csv`:
   `sku_code,seller,retailer_sku,region` (only rows whose seller is enabled).
2. For each row: resolve `sku_code` → `Sku`; look up or create the
   `Seller`; upsert the `RetailerListing` on `(sellerId, retailerSkuString)`;
   call `bestBuySource.read(target)`; on a non-null reading, append a
   `PriceObservation` (`kind: "retail"`) and a `PriceHistory` row; on `null`
   or error, report and skip.
3. Never overwrite history — observations are append-only.
4. `--limit N` for development, mirroring `refresh-prices.ts`.
5. A source that cannot be reached, or that has no `BEST_BUY_API_KEY`
   configured, is reported and skipped — a missing credential is a skip,
   not a failure.

CLI: `npm run db:retail-prices`.

---

## 6. Test plan

All tests run **without network or credentials**. The Best Buy API is faked
with a fixture server / mocked `fetch`, and the credential is injected as an
env var in the test.

### 6.1 Unit tests — `src/lib/prices` (new `bestbuy.test.ts`)

| # | Test | Assertion |
|---|------|-----------|
| U1 | Reads a sale price from a Best Buy API response | `read` returns a `PriceReading` with the parsed `price`, `currency` "USD", `kind` "retail", `retailer` "Best Buy" |
| U2 | Reads availability / in-stock | `inStock` reflects the API `availability` field |
| U3 | No price → `null` | An API response with no sale price returns `null`; no observation is produced |
| U4 | Unavailable product → `null` | A sold-out / discontinued SKU returns `null` |
| U5 | Non-200 / error → `null` | A 4xx/5xx or network error returns `null` (never throws out of `read`) |
| U6 | Missing API key is a skip | With no `BEST_BUY_API_KEY`, the source reports "not configured" rather than attempting a request |
| U7 | Currency from the API, never assumed | A response publishing a currency other than USD records that currency |
| U8 | `sourceUrl` is set | The reading carries the Best Buy product URL for the SKU |

### 6.2 Write-path tests — `tests/retail-prices.test.ts` (vi.hoisted prisma double, following `tests/admin-quality.test.ts`)

| # | Test | Assertion |
|---|------|-----------|
| W1 | Resolves `sku_code` → `Sku` and creates the listing | A row produces one `RetailerListing` keyed on `(sellerId, retailerSkuString)` |
| W2 | Appends a retail observation + history | One `PriceObservation` (`kind` "retail", `listingId` set) and one `PriceHistory` row per reading |
| W3 | Is append-only | A second refresh with the same price creates a second observation, never overwrites the first |
| W4 | Skips unknown `sku_code` | A `sku_code` that matches no `Sku` is reported and skipped |
| W5 | Skips a null reading | A `read` returning `null` writes no observation and no history |
| W6 | Missing credential skips the seller's rows | With no `BEST_BUY_API_KEY`, every Best Buy row is reported as skipped |
| W7 | Does not touch manufacturer/reference prices | Existing family/regional observations are unchanged by a retail refresh |
| W8 | `--limit N` caps the run | Only the first N rows are processed |

### 6.3 Integration guard — `bash scripts/verify-all.sh`

The retail feed is **not** part of the default gate until a credential is
configured (it would fail CI otherwise). Add a **check-only** step
(`db:retail-prices:check`) that asserts:

- No retail `PriceObservation` exists without a `listingId`.
- Every `PriceObservation` of `kind: "retail"` has a `sourceUrl` and a
  non-null `retailer`.
- The `coverage`/`price` audit invariants still hold (run `npm run db:audit`).

These assertions keep a retail observation from silently weakening the
"reference value" guarantees. This step is added to `verify-all.sh` in the
increment that implements the feature, and it must pass with **zero** retail
observations in the default DB.

### 6.4 Documentation updates

- `docs/PRICE_FEEDS.md`: move Best Buy from *needs credentials* to
  *cleared* **only** when a credential is actually configured; otherwise keep
  it gated and note the implementation is ready behind the gate.
- `docs/DATA_SOURCES.md`: add the dated review for the Best Buy API.
- `ROADMAP.md` / `TODO.md`: flip Epic 3.7 to ✅ only when a live retail
  observation has been written and verified.

---

## 7. Definition of done

- `bash scripts/verify-all.sh` passes (11 steps, including the new
  retail check-only step; web tests +5 new retail tests).
- `npm run db:audit` still passes with no error-severity finding; retail
  observations, when present, are disclosed as `kind: "retail"` and carry a
  `sourceUrl`, `listingId` and `retailer`.
- Unit + write-path tests run without network or credentials (deterministic
  CI).
- No schema migration.
- No price is ever shown as a live quote unless it came from an enabled
  retail feed, and the UI/API label it `retail`.

---

## 8. Out of scope / follow-ups

- Enabling the other five retail feeds (each needs its own credential/TOS
  gate).
- Retail-price-driven alert dispatch.
- Matching a Best Buy listing to a `Sku` by name+spec (the `matchMethod`
  column already exists; this increment keys on the retailer's own SKU/UPC
  provided in `retail-price-sources.csv`).

---

*Measured from the working tree on 2026-11-12: 1,168 configurations, 1,125
certified, 36 allowlisted unconfirmable provenance records, 45 build routes,
530 web tests, 216 Python tests. `bash scripts/verify-all.sh`: every check
passed.*