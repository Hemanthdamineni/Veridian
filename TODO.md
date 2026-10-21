# Veridian Task Tracker

> Stories → Tasks → Subtasks. Update status as work progresses.
> Status: 🔴 Todo | 🟡 In Progress | 🟢 Done | ⛔ Deferred

Last reconciled: **2026-10-21**. This file is written to match the code and
the measured data, not against an original plan. Where a story is partially
built, the remaining work is listed explicitly rather than the story being
marked done.

---

## Current state at a glance

| Metric | Value | Measured by |
|---|---:|---|
| Configurations in the catalog | 1,165 | `npm run db:audit` |
| Certified configurations (cited source) | 1,122 | `npm run db:audit` |
| Manufacturer-verified configurations (cited page) | 2 | `npm run db:audit` |
| Unverified configurations (no citation) | 41 | `npm run db:audit` |
| Manufacturers | 36 | `npm run db:audit` |
| Product families (series) | 577 | `npm run db:audit` |
| Models | 999 | `npm run db:audit` |
| Raw source observations stored | 1,177 | `npm run db:audit` |
| Source rows rejected, with reasons | 44 | `npm run db:audit` |
| Shared components | 477 | `npm run db:audit` |
| Configuration ↔ component links | 3,359 | `npm run db:audit` |
| Web test suites | 108 passing (Vitest) | `npm test` |
| Python test suite | 124 passing (pytest) | `pytest` |
| Build routes | 35 | `npm run build` |
| CI | `.github/workflows/ci.yml` (lint, types, tests, build, live PostgreSQL ingestion) | |

**Product rule:** the catalog mixes three tiers of record. `Certified` rows
carry a cited certification record, `Manufacturer` rows were checked against
the manufacturer's own specification page, and `Unverified` rows have no
citation at all. The UI, the API and the methodology page all disclose which
tier a row belongs to.

---

## Epic 1: MVP Launch (P0) ✅ COMPLETED

### Story 1.1: Project Scaffolding ✅
- [x] **Task 1.1.1:** Next.js 14 App Router + TypeScript + Tailwind v4
- [x] **Task 1.1.2:** Project structure & conventions (`veridian-web/`)

### Story 1.2: Database Setup ✅
- [x] **Task 1.2.1:** Prisma schema (Manufacturer, Series, Model, Sku, CertifiedSkuSpec, RawObservation, SkuSource, SkuRegionalPricing, SkuPort, PriceObservation, User, Session, Contribution, Vote, Alert, ApiKey, Category, Component, ComponentAlias, ComponentSpec, SkuComponent, Seller, RetailerListing, PriceHistory)
- [x] **Task 1.2.2:** SQLite dev + PostgreSQL production, one schema generated from the other
- [x] **Task 1.2.3:** Migrations / `db push` setup

### Story 1.3: Data Loading ✅
- [x] **Task 1.3.1:** `scripts/ingest-energy-star.ts` — the cited certification dataset
- [x] **Task 1.3.2:** `scripts/seed.ts` — the reference dataset, loaded as recorded
- [x] **Task 1.3.3:** `scripts/populate-components.ts` — the component knowledge graph
- [x] **Task 1.3.4:** Every row carries an explicit provenance tier

### Story 1.4: API Routes ✅
- [x] **Task 1.4.1:** `GET /api/skus` — list, filter, sort, paginate
- [x] **Task 1.4.2:** `GET /api/skus/:id` — detail
- [x] **Task 1.4.3:** `GET /api/manufacturers`, `GET /api/models`
- [x] **Task 1.4.4:** `GET /api/skus/:id/price-history`
- [x] **Task 1.4.5:** `GET /api/v1`, `GET /api/v1/compare`
- [x] **Task 1.4.6:** `GET /api/search` — natural language → structured filters
- [x] **Task 1.4.7:** `GET /api/recommendations` — scored matching
- [x] **Task 1.4.8:** `GET /api/components`, `GET /api/components/:slug` — the knowledge graph
- [x] **Task 1.4.9:** `POST /api/admin/skus`, `GET /api/admin/stats` (bearer/session auth)
- [x] **Task 1.4.10:** `POST /api/refresh` — the ingestion bridge, admin-authenticated, running the audited path
- [x] **Task 1.4.11:** `GET /api/alerts`, `GET /api/contributions` — deliberately **503-gated** until the auth they depend on exists

### Story 1.5: Frontend Filter UI ✅
- [x] **Task 1.5.1:** Filter panel (processor, RAM, storage, display, refresh, weight, battery, touch, price range, source tier, price region)
- [x] **Task 1.5.2:** Results grid, pagination, empty / loading / error states
- [x] **Task 1.5.3:** URL state management — every filter is bookmarkable and shareable
- [x] **Task 1.5.4:** Active-filter chips with per-chip dismissal

### Story 1.6: SKU Detail Page ✅
- [x] **Task 1.6.1:** Full spec sheet, pricing, ports, breadcrumb
- [x] **Task 1.6.2:** Certified provenance panel with citation link, certification date, observation date
- [x] **Task 1.6.3:** Reference-provenance panel that says plainly when a row is unverified
- [x] **Task 1.6.4:** Price observation history with a source warning
- [x] **Task 1.6.5:** Shared-components panel linking into the knowledge graph

### Story 1.7: Admin Route ✅
- [x] **Task 1.7.1:** Auth (constant-time token comparison, bearer + session cookie)
- [x] **Task 1.7.2:** SKU management (SkuForm, SkuList)
- [x] **Task 1.7.3:** Data quality stats panel
- [x] **Task 1.7.4:** Login page reports clearly when `ADMIN_TOKEN` is not configured

### Story 1.8: Deployment ✅
- [x] **Task 1.8.1:** Vercel configuration (`next.config.mjs`, env vars)
- [x] **Task 1.8.2:** Production build passes (28 routes)

---

## Epic 2: Data Pipeline Hardening (P1) 🟡

### Story 2.1: Scraper Fleet ✅
- [x] **Task 2.1.1:** 13 manufacturer scrapers (ASUS, Lenovo, HP, Dell, Acer, MSI, Apple, Samsung, Microsoft, LG, Razer, Framework, Gigabyte)
- [x] **Task 2.1.2:** YAML config for every one of the 13, loaded by a loader that actually works
- [x] **Task 2.1.3:** Shared `HTTPClient`, retry, progress reporting

### Story 2.2: Incremental Scraping ✅
- [x] **Task 2.2.1:** `run_scrapers.py --incremental`
- [x] **Task 2.2.2:** Recently-scraped URL exclusion via a `max_age_hours` cutoff
- [x] **Task 2.2.3:** Per-manufacturer and per-region selection

### Story 2.3: Data Quality Validation ✅
- [x] **Task 2.3.1:** Python validation layer (`validators/validator.py`) — range checks, severity grading, field-level confidence
- [x] **Task 2.3.2:** TypeScript validation layer (`lib/energy-star/validate.ts`) — deterministic field validation with exact error messages
- [x] **Task 2.3.3:** Rejected records persisted with their verbatim error, never silently dropped
- [x] **Task 2.3.4:** `scripts/audit-data.ts` — a whole-catalog audit that measures rather than asserts

### Story 2.4: Normalization & Identity ✅
- [x] **Task 2.4.1:** `veridian_db/normalizer.py` — unit conversion (mm/in, px, GB/TB, Wh, kg/lb, GHz/MHz)
- [x] **Task 2.4.2:** SQLAlchemy knowledge-graph schema (`veridian_db/models.py`)
- [x] **Task 2.4.3:** Canonical identity — SKU codes derived from the part number plus a configuration signature
- [x] **Task 2.4.4:** Series derivation from the reported model name, with source wildcard legends excluded
- [x] **Task 2.4.5:** Marketing names resolved from the source record, internal chassis codes preserved as part numbers

### Story 2.5: Schema Parity ✅
- [x] **Task 2.5.1:** `prisma/schema.postgres.prisma` generated from `prisma/schema.prisma`
- [x] **Task 2.5.2:** `npm run db:schema:pg-check` fails CI when the generated file is stale

### Story 2.6: Real-Data Ingestion ✅
- [x] **Task 2.6.1:** `EnergyStarAdapter` (ADR-003) — pinned HTTPS host, SSRF guard, SHA-256 payload hashing
- [x] **Task 2.6.2:** Audited write path — `Manufacturer → Series → Model → Sku → CertifiedSkuSpec` + immutable `RawObservation`
- [x] **Task 2.6.3:** Full-dataset ingestion with pagination across every laptop product type
- [x] **Task 2.6.4:** 1,133 accepted, 44 rejected with verbatim reasons

### Story 2.7: Scraper Monitoring 🟡
- [x] **Task 2.7.1:** Per-manufacturer health report (`veridian_scraper/health.py`, `run_scrapers.py --report`)
- [x] **Task 2.7.2:** robots.txt compliance in the HTTP client, with an honest user agent
- [ ] **Task 2.7.3:** Failure alerting to a real channel
- [ ] **Task 2.7.4:** Scheduled run orchestration in CI

### Story 2.8: Manufacturer Verification 🟡
- [x] **Task 2.8.1:** `scripts/verify-reference-specs.py` — checks the reference dataset against manufacturer specification pages and reports every contradiction with a citation
- [x] **Task 2.8.2:** ASUS technical-specification extraction working against the live page
- [ ] **Task 2.8.3:** Extend to Lenovo, Dell, HP, Acer, Apple and the rest

---

## Epic 3: Price Intelligence (P2) 🟡

### Story 3.1: Seller Data Model ✅
- [x] **Task 3.1.1:** `Seller`, `RetailerListing`, `PriceHistory` in the Prisma schema on both engines
- [x] **Task 3.1.2:** `PriceObservation` + `SkuRegionalPricing` with append-only semantics
- [x] **Task 3.1.3:** `SkuSource` records the provenance of every price observation

### Story 3.2: Identity Resolution ✅
- [x] **Task 3.2.1:** `price_tracker/identity_resolver.py` — normalized-string + similarity matching
- [x] **Task 3.2.2:** Threshold-based match results

### Story 3.3: Price Tracking ✅
- [x] **Task 3.3.1:** Append-only price writes
- [x] **Task 3.3.2:** Rollups (lowest / highest / average over 7 / 30 / 90 day windows)
- [x] **Task 3.3.3:** Price change detection
- [x] **Task 3.3.4:** Price history panel on the SKU detail page

### Story 3.4: Alert Engine 🟡
- [x] **Task 3.4.1:** `price_tracker/alert_engine.py` — `below_price`, `lowest_ever`, `pct_off`
- [x] **Task 3.4.2:** `notifications/notifier.py` — email, Telegram, Discord, Web Push channels
- [ ] **Task 3.4.3:** User-facing alert CRUD (blocked on Epic 5 auth — endpoint returns 503)
- [ ] **Task 3.4.4:** Dispatch scheduler

### Story 3.5: Live Prices 🟡 INFRASTRUCTURE READY
- [x] **Task 3.5.1:** A price source contract (`PriceSource`) with the evidence
  class carried on every observation
- [x] **Task 3.5.2:** A reader that takes a price only from schema.org `Product`
  markup, never from a price string in a rendered page
- [x] **Task 3.5.3:** A refresh CLI over a configurable source list
  (`data/family-price-sources.csv`)
- [x] **Task 3.5.4:** Manufacturer list prices read from ASUS product pages and
  recorded against the product *family* with the page they came from
- [ ] **Task 3.5.5:** A retailer API integration (Best Buy, Amazon, eBay) —
  these need credentials
- [ ] **Task 3.5.6:** Per-configuration retail prices, with the listing, the
  seller and the timestamp that make a retail price meaningful
- **Note:** a "starting at" price is never attached to a single configuration,
  because it is not that configuration's price. Every price the system shows
  is labelled a reference value.

---

## Epic 4: AI & Search (P3) 🟡

### Story 4.1: Natural Language Filters ✅
- [x] **Task 4.1.1:** Rule-based NL → filter parsing (`lib/ai.ts`)
- [x] **Task 4.1.2:** Residual-keyword extraction so `"Zenbook under $1500"` still matches models
- [x] **Task 4.1.3:** `GET /api/search` returns parsed filters alongside results
- [x] **Task 4.1.4:** Plain-language search in the catalog UI, showing the parsed reading back
- [ ] **Task 4.1.5:** LLM-backed parsing for query shapes the rules do not cover

### Story 4.2: Recommendations ✅
- [x] **Task 4.2.1:** Hard-constraint pre-filtering + weighted scoring with pros/cons
- [x] **Task 4.2.2:** `GET /api/recommendations`
- [x] **Task 4.2.3:** Use-case panel in the UI with the reasoning shown
- [ ] **Task 4.2.4:** LLM-ranked explanations

### Story 4.3: Comparison ✅
- [x] **Task 4.3.1:** Side-by-side comparison, up to 5 SKUs
- [x] **Task 4.3.2:** Category winners, declared only when every compared row reports the metric
- [ ] **Task 4.3.3:** Use-case-based difference explanation

### Story 4.4: Dedicated Search Engine ⛔ DEFERRED
- [ ] **Task 4.4.1:** Meilisearch / Typesense
- [ ] **Task 4.4.2:** CDC or dual-write sync
- [ ] **Task 4.4.3:** Faceted configuration
- **Decision:** deferred. Postgres filtering is sufficient below ~5K configurations; the catalog is at 1,165.

### Story 4.5: Semantic Similarity 🔴 NOT STARTED
- [ ] **Task 4.5.1:** pgvector embeddings for "find similar laptops"

---

## Epic 5: Community (P4) 🔴 NOT STARTED

### Story 5.1: User Accounts 🔴
- [ ] **Task 5.1.1:** Auth.js setup, providers, sessions
- [ ] **Task 5.1.2:** Profile pages
- [ ] **Task 5.1.3:** Role-based access (user, curator, admin)

### Story 5.2: Contributions 🔴
- [x] **Task 5.2.1:** Prisma `Contribution` and `Vote` models
- [x] **Task 5.2.2:** `GET/POST /api/contributions` endpoints — 503-gated until ownership checks exist
- [ ] **Task 5.2.3:** Correction submission form with evidence upload
- [ ] **Task 5.2.4:** Voting system UI
- [ ] **Task 5.2.5:** Reputation tracking

---

## Epic 6: Platform Scale (P5) 🟡

### Story 6.1: Multi-Category 🟡
- [x] **Task 6.1.1:** `Category` model and `Series.categoryId` in the Prisma schema
- [ ] **Task 6.1.2:** Second category (phones or monitors)

### Story 6.2: Component Knowledge Graph ✅
- [x] **Task 6.2.1:** `Component`, `ComponentAlias`, `ComponentSpec`, `SkuComponent` models
- [x] **Task 6.2.2:** Population from the cited certification data
- [x] **Task 6.2.3:** `/components` index and `/components/[slug]` detail pages
- [x] **Task 6.2.4:** `GET /api/components` and `GET /api/components/:slug`
- [x] **Task 6.2.5:** Cross-links from every product page into the graph

### Story 6.3: Public Developer API ✅
- [x] **Task 6.3.1:** `ApiKey` model — only the hash is stored
- [x] **Task 6.3.2:** Key issuance CLI (`npm run db:apikey`); the key is shown once
- [x] **Task 6.3.3:** Rate limiting — an hourly budget per key, counted in the
  database so instances share it and a restart does not reset it
- [x] **Task 6.3.4:** Real endpoints for configurations, manufacturers, the
  component graph, comparison and recommendations
- [x] **Task 6.3.5:** An OpenAPI 3.1 description of the contract
- [x] **Task 6.3.6:** A smoke test that exercises every endpoint, run in CI
- [ ] **Task 6.3.7:** A key management UI for operators

### Story 6.4: Data Quality Dashboard ✅
- [x] **Task 6.4.1:** `npm run db:audit` — measures the catalog and fails on an error-severity finding
- [x] **Task 6.4.2:** `npm run db:audit:repair` — removes empty structural rows
- [ ] **Task 6.4.3:** A browser dashboard over the same measures

---

## Known Gaps

| # | Gap | Impact | Where it is tracked |
|---|---|---|---|
| 1 | No live retailer price source — every price shown is reference MSRP | Price filters and price sorting operate on reference values | Epic 3, Story 3.5 |
| 2 | 41 reference configurations are not independently verified | Their figures may contradict the manufacturer | Epic 2, Story 2.8.3; reported by `npm run db:audit` |
| 3 | 38 provenance records carry no source URL | The reader cannot check those values against a page | `npm run db:audit`, `coverage/source-url` |
| 4 | The scraper fleet has no scheduled run in CI | Manufacturer data has to be refreshed by hand | Epic 2, Story 2.7.4 |
| 5 | Twelve of thirteen manufacturers are unverified against their live sites | Their scrapers may extract nothing, as ASUS's did | Epic 2, Story 2.8.3 |
| 6 | The Python `Seller` / `PriceListing` models still duplicate the Prisma ones | Two stores describe the same thing; the boundary is documented but not yet collapsed | Epic 3, Story 3.1 |
| 7 | No component-to-component or issue-level relationships | "Which laptops are affected by this component issue" is not answerable | Epic 6 |
