# Veridian Roadmap

> **North Star:** A trusted decision platform for laptops — not just specs, but verified, connected, decision-ready data.

> **Last updated: 2026-11-12.** Statuses reflect verified code and measured data, not intent. Every number below comes from `npm run db:audit`. `main` is 68 commits ahead of `origin/main` (unpushed); the working tree adds the unconfirmable-provenance allowlist, provenance-by-configuration assertions and the deterministic primary-price selection described below.

---

## Where the project actually stands

The application is operational end to end. The catalog holds **1,168 laptop
configurations across 36 manufacturers**, and the majority of them trace to a
cited source.

**Three provenance tiers, disclosed everywhere:**

| Tier | Count | Source | Prices |
|------|------:|--------|--------|
| Certified | 1,125 | US EPA ENERGY STAR Certified Computers V9.0 — cited record, certification date, SHA-256 of the verbatim payload | None — the source publishes no price |
| Manufacturer | 2 | Checked against the manufacturer's own technical specification page, which is cited | Reference MSRP |
| Unverified | 41 | Our own reference dataset, not independently checked | Reference MSRP |

**Measured integrity (from `npm run db:audit`):** 1,181 raw source observations
stored (44 of them rejected, each with its verbatim reason) · 1,136
certification records · 477 shared components with 3,368 configuration links ·
0 duplicate part numbers · 0 impossible values · 0 configurations without a
provenance record. Provenance is counted per configuration, not per source row:
1,169 source rows describe 1,168 configurations, because one configuration
(Dell P148G) carries both its ENERGY STAR `certified` record and an applied
`community` correction. Of the 1,169 source rows, 36 carry no source URL; all
36 are allowlisted as `reference_dataset_unconfirmed` and reported by the audit
as expected (`coverage/source-url-allowlisted`), so `coverage/source-url`
reports only the *unexpected* gaps (0).

**Verified engineering baseline:** types clean · lint clean (no warnings) ·
530 web tests · 216 Python tests · 45 build routes · CI on every push and
pull request, with a job that ingests into a live PostgreSQL server, audits
the result and exercises the public API end to end. `bash scripts/verify-all.sh`
is the single gate: lint, typecheck, env templates, web + Python tests,
production build, Postgres schema drift, catalog audit, catalog assertions and
public API smoke.

**Since the 2026-10-21 reconciliation (68 unpushed commits + working tree):**
the compare page, regional prices, NL-search quality, price-history statistics
and its detail-page panel, an ingestion-validation hardening pass, Icecat and
Wikidata ingestion, the alerts engine, contributions, official feeds, the
HP/Apple/Samsung/LG scraper work, the reference-dataset QA pass, the energy-star
expansion, manufacturer verification, and docs/metrics hardening all landed on
`main` but are **not yet pushed**. The working tree on top adds the curation
described above: the machine-readable unconfirmable allowlist
(`veridian-web/src/lib/allowlist.ts`), provenance-by-configuration assertions in
`db:assert` (so an applied community correction such as Dell P148G is provenance,
not a violation), and a deterministic US-first primary-price selection shared by
the API route and the SKU detail page.

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
- 2.5 Scraper monitoring — per-manufacturer health report ✅; alerting ✅
  (`veridian_scraper/health_alerting.py` + `run_scrapers.py --alert`, wired into
  the scheduled CI job)
- 2.6 SQLite → Postgres parity ✅ — the two schemas had drifted apart; the
  PostgreSQL file is now generated from the SQLite one
- 2.7 robots.txt compliance ✅ — was never implemented, contrary to ADR-003
- 2.8 ASUS technical-specification extraction ✅ — the live page had moved on
  and the selectors matched nothing
- 2.9 Live re-verification of the remaining manufacturers 🟡 — Apple adapter
  added; confirms family-level fields and reports the SKU-specific fields as
  unconfirmable; Lenovo, Dell, HP and the rest still blocked from CI
- **Remaining:** durable per-manufacturer scrape checkpoints and live
  verification for the manufacturers that are blocked from CI (see the
  scraper status below).

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
  page. The per-configuration *retail* path is now built: a Best Buy Products
  API source (`src/lib/prices/sources/bestbuy.ts`), a dry-run-safe write path
  (`src/lib/prices/retail-refresh.ts`), the `db:retail-prices` CLI and their
  tests. The live feed is still gated on a `BEST_BUY_API_KEY` credential (see
  `docs/PRICE_FEEDS.md`), and the refresh defaults to a dry run until a key is
  configured. Every price shown is labelled a reference value.
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
  below ~5K configurations; the catalog is at 1,168
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
- 6.2 Component knowledge graph ✅ — 477 shared components, 3,368 links,
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
Now        Extend manufacturer verification beyond ASUS (Lenovo, Dell, HP),
           so the unverified tier shrinks toward zero — the retail feed path
           is built and only needs a Best Buy credential to go live
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
| Search engine | Postgres only vs Meilisearch | **Postgres first** — add Meilisearch when >5K configurations | Holding (1,168 configurations) |
| Region semantics | Region filters rows vs selects the price shown | **Region selects the price shown** — rows are never hidden for lacking a price | Adopted 2026-10-21 |
| Price data | Hide prices vs show with a caveat | **Show with a caveat** — every price is labelled a reference value, never a live quote | Adopted 2026-10-21 |
| Provenance disclosure | Implicit vs explicit tiers | **Explicit tier filter and badge on every listing** | Adopted 2026-10-21 |
| Source-less provenance records | Suppress silently vs allowlist with a reason | **Allowlist with a machine-readable reason** — `veridian-web/src/lib/allowlist.ts` maps each `skuCode` to a documented reason (`reference_dataset_unconfirmed`); the audit reports allowlisted records as expected and fails on any unallowlisted one | Adopted 2026-11-12 |
| Provenance counting | Source rows vs distinct configurations | **Distinct configurations** — `db:assert` requires every configuration to carry ≥1 provenance record, so an applied community correction (two rows on one SKU) is not a violation | Adopted 2026-11-12 |
| Primary price selection | First pricing row vs deterministic region order | **Deterministic** — US region when present, else the region that sorts first by name, else none; the API route and the SKU detail page share this rule | Adopted 2026-11-12 |
