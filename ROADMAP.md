# Veridian Roadmap

> **North Star:** A trusted decision platform for laptops — not just specs, but verified, connected, decision-ready data.

> **Last updated: 2026-10-21.** Statuses reflect verified code and measured data, not intent. Every number below comes from `npm run db:audit`.

---

## Where the project actually stands

The application is operational end to end. The catalog holds **1,165 laptop
configurations across 36 manufacturers**, and the majority of them trace to a
cited source.

**Three provenance tiers, disclosed everywhere:**

| Tier | Count | Source | Prices |
|------|------:|--------|--------|
| Certified | 1,122 | US EPA ENERGY STAR Certified Computers V9.0 — cited record, certification date, SHA-256 of the verbatim payload | None — the source publishes no price |
| Manufacturer | 2 | Checked against the manufacturer's own technical specification page, which is cited | Reference MSRP |
| Unverified | 41 | Our own reference dataset, not independently checked | Reference MSRP |

**Measured integrity (from `npm run db:audit`):** 1,177 raw source observations
stored (44 of them rejected, each with its verbatim reason) · 1,133
certification records · 477 shared components with 3,359 configuration links ·
0 duplicate part numbers · 0 impossible values · 0 rows without a provenance
record.

**Verified engineering baseline:** types clean · lint clean (no warnings) ·
108 web tests · 124 Python tests · 35 build routes · CI on every push and
pull request, with a job that ingests into a live PostgreSQL server, audits
the result and exercises the public API end to end.

---

## Epic Overview

| Epic | Goal | Priority | Status |
|------|------|----------|--------|
| 1. MVP Launch | Ship a working filterable laptop catalog | **P0** | ✅ Complete |
| 2. Data Pipeline | Production-ready scrapers for all manufacturers | **P1** | 🟡 Working for ASUS; others verified as blocked |
| 3. Price Intelligence | Price tracking, history, alerts | **P2** | 🟡 Domain engine and schema built; no live retailer feed |
| 4. AI & Search | NL filters, recommendations, smart search | **P3** | 🟡 Rule-based NL and recommendations, both now in the UI |
| 5. Community | User contributions, reputation, verification | **P4** | 🔴 Not started (models only) |
| 6. Platform Scale | Multi-category, public API, partnerships | **P5** | 🟡 Component graph, public API and schema abstraction landed |

---

## Epic 1: MVP Launch (P0) — ✅ Complete

- 1.1 Project scaffolding (Next.js 14 + TypeScript + Tailwind v4) ✅
- 1.2 Database setup (Prisma, SQLite + PostgreSQL in parity) ✅
- 1.3 Seed script & initial data load ✅
- 1.4 API routes (list, detail, manufacturers, price history, search, recommendations, compare) ✅
- 1.5 Frontend filter UI (incl. provenance tier and MSRP range filters) ✅
- 1.6 SKU detail page with a provenance section ✅
- 1.7 Admin/curation route with a data-quality stats panel ✅
- 1.8 Deployment configuration and build verification ✅

---

## Epic 2: Data Pipeline Hardening (P1) — 🟡

- 2.1 Scraper fleet — 13 manufacturer scrapers implemented ✅
- 2.2 YAML configs for all 13 supported manufacturers ✅ — the loader was
  broken and never read them; fixed and covered by a test
- 2.3 Incremental scraping (`--incremental`, `max_age_hours` cutoff) ✅
- 2.4 Data quality validation layer (spec, product, price-observation) ✅
- 2.5 Scraper monitoring — per-manufacturer health report ✅; alerting 🔴
- 2.6 SQLite → Postgres parity ✅ — the two schemas had drifted apart; the
  PostgreSQL file is now generated from the SQLite one
- 2.7 robots.txt compliance ✅ — was never implemented, contrary to ADR-003
- 2.8 ASUS technical-specification extraction ✅ — the live page had moved on
  and the selectors matched nothing
- 2.9 Live re-verification of the remaining manufacturers 🔴
- **Remaining:** durable per-manufacturer scrape checkpoints, failure
  alerting, and live verification for the twelve manufacturers that are
  blocked from CI (see the scraper status below).

### Scraper status

| Manufacturer | Status | Note |
|---|---|---|
| ASUS | ✅ Working | Technical-specification table extracted from the live page; verified against a saved fixture |
| Lenovo | 🟡 Partial | Product URLs are discovered, but the page renders its specifications client-side, so no specs are extracted yet |
| Framework | 🔴 Blocked | Cloudflare interstitial; the fleet refuses to attempt a bypass |
| Dell, HP, Acer, Apple, MSI, Samsung, Microsoft, LG, Razer, Gigabyte | 🟡 Unverified | Code paths exist and are covered by tests, but the live sites were not reachable from the verification environment |

---

## Epic 3: Price Intelligence (P2) — 🟡

- 3.1 Seller / price-listing data model ✅ — now in the Prisma schema on both
  engines, not only in the Python knowledge graph
- 3.2 Identity resolution pipeline (normalised + similarity matching) ✅
- 3.3 Price history append-only table and rollups ✅
- 3.4 Alert engine (below_price, lowest_ever, pct_off) ✅
- 3.5 Notification service (email, telegram, discord, web push) ✅
- 3.6 Price history UI on the SKU detail page ✅
- 3.7 Price sources 🟡 — the source contract, the structured-data reader,
  the refresh CLI and the append-only history are in place, and four product
  families carry a manufacturer list price read from the manufacturer's own
  page. A per-configuration *retail* price still needs a retailer feed, which
  needs credentials. Every price shown is labelled a reference value.
- 3.8 `POST /api/refresh` ✅ — the ingestion bridge, admin-authenticated

---

## Epic 4: AI & Search (P3) — 🟡

- 4.1 Natural language → filter parsing ✅ — deterministic rule-based parser
- 4.2 Residual-keyword extraction ✅
- 4.3 `GET /api/search` returns parsed filters alongside results ✅
- 4.4 Plain-language search in the catalog UI ✅ — the sentence is sent to
  the parser and the filters it produced are shown back, so the reading can
  be checked before it is trusted
- 4.5 Recommendation engine with pros/cons ✅
- 4.6 Recommendation UI ✅ — a use-case panel that shows the reasons behind
  every pick, including the constraints it could not check
- 4.7 LLM-backed parsing and ranking 🔴
- 4.8 Dedicated search engine ⛔ Deferred — Postgres filtering is sufficient
  below ~5K configurations; the catalog is at 1,165
- 4.9 Semantic similarity (pgvector) 🔴

---

## Epic 5: Community (P4) — 🔴

- 5.1 User accounts 🔴
- 5.2 Contribution workflow 🔴 — models exist, endpoints return 503
- 5.3 Reputation & trust system 🔴
- 5.4 Admin curation UI for pending edits 🔴
- 5.5 Community Q&A on product pages 🔴

---

## Epic 6: Platform Scale (P5) — 🟡

- 6.1 Category abstraction in the schema ✅ — `Category` and `Series.categoryId`
  exist, so adding a product class does not require rewriting the platform
- 6.2 Component knowledge graph ✅ — 477 shared components, 3,359 links,
  browsable at `/components` and served by `/api/components`
- 6.3 Public developer API ✅ — API keys issued through a CLI and stored only
  as a hash, an hourly budget per key counted in the database, real
  endpoints, and an OpenAPI 3.1 description of the contract
- 6.4 Data quality dashboard ✅ — `npm run db:audit` measures the catalog and
  fails on an error-severity finding
- 6.5 Lifecycle tracking (successors, discontinuations) 🔴
- 6.6 Second product category 🔴

---

## Recommended Build Order

```
Now        A per-configuration retail price feed — the largest remaining
           gap between the product promise and the reality
Then       Extend manufacturer verification beyond ASUS, so the unverified
           tier shrinks toward zero
Then       Accounts (Auth.js) → unlocks alerts and contributions
Then       LLM-backed natural-language parsing and recommendation ranking
Then       Public developer API with rate limiting and an OpenAPI document
Then       Meilisearch, once the catalog passes ~5K configurations
Then       Multi-category rollout and the second product class
```

---

## Key Decisions

| Decision | Options | Recommendation | Status |
|----------|---------|----------------|--------|
| Database for MVP | Postgres vs SQLite | **Both** — SQLite for local work, PostgreSQL for production, one schema generated from the other | Adopted 2026-10-21 |
| Catalog size vs truth | Synthesise configurations vs cite sources | **Cite sources** — 1,122 cited configurations beat 2,164 of which 2,022 were generated | Adopted 2026-10-21 |
| Provenance representation | Infer from another record vs store it | **Store it** — `Sku.provenance` plus a row per source | Adopted 2026-10-21 |
| Duplicate handling | Merge on part number vs part number + signature | **Part number + signature** — one product line can be certified in several configurations | Adopted 2026-10-21 |
| Data source for MVP | Manual CSV vs scraper output | **Both** — the certification dataset for cited rows, the scraper fleet for manufacturer pages | In effect |
| Search engine | Postgres only vs Meilisearch | **Postgres first** — add Meilisearch when >5K configurations | Holding (1,165 configurations) |
| Region semantics | Region filters rows vs selects the price shown | **Region selects the price shown** — rows are never hidden for lacking a price | Adopted 2026-10-21 |
| Price data | Hide prices vs show with a caveat | **Show with a caveat** — every price is labelled a reference value, never a live quote | Adopted 2026-10-21 |
| Provenance disclosure | Implicit vs explicit tiers | **Explicit tier filter and badge on every listing** | Adopted 2026-10-21 |
