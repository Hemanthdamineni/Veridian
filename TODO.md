# Veridian Task Tracker

> Stories → Tasks → Subtasks. Update status as work progresses.
> Status: 🔴 Todo | 🟡 In Progress | 🟢 Done | ⛔ Deferred

Last reconciled: **2026-10-21**. This file was rewritten to match the code as it
actually stands, not against an original plan. Where a story is partially built,
the remaining work is listed explicitly rather than the story being marked done.

---

## Current state at a glance

| Metric | Value |
|---|---|
| Configurations in the catalog | 2,164 |
| Certified configurations (cited source) | 99 |
| Reference configurations (no cited source) | 2,065 |
| Manufacturers | 18 |
| Regions with recorded prices | 2 (US, IN) |
| Web test suites | 56 passing (Vitest) |
| Python test suite | 13 passing (pytest) |
| CI | `.github/workflows/ci.yml` (lint, types, tests, build) |

**Product rule:** the catalog mixes two tiers of record. Certified rows carry a
cited source record and are labelled `Certified`; the rest are reference
configurations labelled `Reference`. The UI, the API and the methodology page
all disclose which tier a row belongs to.

---

## Epic 1: MVP Launch (P0) ✅ COMPLETED

### Story 1.1: Project Scaffolding ✅
- [x] **Task 1.1.1:** Next.js 14 App Router + TypeScript + Tailwind v4
- [x] **Task 1.1.2:** Project structure & conventions (`veridian-web/`)

### Story 1.2: Database Setup ✅
- [x] **Task 1.2.1:** Prisma schema (Manufacturer, Series, Model, Sku, CertifiedSkuSpec, RawObservation, SkuRegionalPricing, SkuPort, PriceObservation, User, Session, Contribution, Alert)
- [x] **Task 1.2.2:** SQLite dev + PostgreSQL production schema, kept in parity by `tests/schema-parity.test.ts`
- [x] **Task 1.2.3:** Migrations / `db push` setup

### Story 1.3: Seed Script ✅
- [x] **Task 1.3.1:** `scripts/seed.ts` — loads `data/laptops.csv`
- [x] **Task 1.3.2:** 2,065 reference configurations across 17 manufacturers
- [x] **Task 1.3.3:** Seed rows are labelled `Reference` in the UI and disclosed on the methodology page

### Story 1.4: API Routes ✅
- [x] **Task 1.4.1:** `GET /api/skus` — list, filter, sort, paginate
- [x] **Task 1.4.2:** `GET /api/skus/:id` — detail
- [x] **Task 1.4.3:** `GET /api/manufacturers`, `GET /api/models`
- [x] **Task 1.4.4:** `GET /api/skus/:id/price-history`
- [x] **Task 1.4.5:** `GET /api/v1`, `GET /api/v1/compare`
- [x] **Task 1.4.6:** `GET /api/search` — natural-language → structured filters
- [x] **Task 1.4.7:** `GET /api/recommendations` — scored matching
- [x] **Task 1.4.8:** `POST /api/admin/skus`, `GET /api/admin/stats` (bearer/session auth)
- [x] **Task 1.4.9:** `POST /api/refresh`, `GET /api/alerts`, `GET /api/contributions` — deliberately **503-gated** until the pipeline/auth they depend on exists

### Story 1.5: Frontend Filter UI ✅
- [x] **Task 1.5.1:** Filter panel (processor, RAM, storage, display, refresh, weight, battery, touch, price range, source tier, price region)
- [x] **Task 1.5.2:** Results grid, pagination, empty / loading / error states
- [x] **Task 1.5.3:** URL state management — every filter is bookmarkable and shareable
- [x] **Task 1.5.4:** Active-filter chips with per-chip dismissal

### Story 1.6: SKU Detail Page ✅
- [x] **Task 1.6.1:** Full spec sheet, pricing, ports, breadcrumb
- [x] **Task 1.6.2:** Certified provenance panel with citation link, certification date, observation date
- [x] **Task 1.6.3:** Reference-provenance panel for rows with no cited source
- [x] **Task 1.6.4:** Price observation history with a synthetic-data warning

### Story 1.7: Admin Route ✅
- [x] **Task 1.7.1:** Auth (constant-time token comparison, bearer + session cookie)
- [x] **Task 1.7.2:** SKU management (SkuForm, SkuList)
- [x] **Task 1.7.3:** Data quality stats panel
- [x] **Task 1.7.4:** Login page reports clearly when `ADMIN_TOKEN` is not configured

### Story 1.8: Deployment ✅
- [x] **Task 1.8.1:** Vercel configuration (`next.config.mjs`, env vars)
- [x] **Task 1.8.2:** Production build passes (16/16 routes)

---

## Epic 2: Data Pipeline Hardening (P1) 🟡 MOSTLY DONE

### Story 2.1: Scraper Fleet ✅
- [x] **Task 2.1.1:** 13 manufacturer scrapers (ASUS, Lenovo, HP, Dell, Acer, MSI, Apple, Samsung, Microsoft, LG, Razer, Framework, Gigabyte)
- [x] **Task 2.1.2:** YAML config for every one of the 13
- [x] **Task 2.1.3:** Shared `HTTPClient`, retry, progress reporting, `GenericScraper` base

### Story 2.2: Incremental Scraping ✅
- [x] **Task 2.2.1:** `run_scrapers.py --incremental`
- [x] **Task 2.2.2:** Recently-scraped URL exclusion via a `max_age_hours` cutoff
- [x] **Task 2.2.3:** Per-manufacturer and per-region selection

### Story 2.3: Data Quality Validation ✅
- [x] **Task 2.3.1:** Python validation layer (`validators/validator.py`) — range checks, severity grading, field-level confidence
- [x] **Task 2.3.2:** TypeScript validation layer (`lib/energy-star/validate.ts`) — deterministic field validation with exact error messages
- [x] **Task 2.3.3:** Rejected records persisted with their verbatim error, never silently dropped

### Story 2.4: Normalization Engine ✅
- [x] **Task 2.4.1:** `veridian_db/normalizer.py` — unit conversion (mm/in, px, GB/TB, Wh, kg/lb, GHz/MHz)
- [x] **Task 2.4.2:** SQLAlchemy knowledge-graph schema (`veridian_db/models.py`, 30+ models)

### Story 2.5: Schema Parity ✅
- [x] **Task 2.5.1:** `prisma/schema.postgres.prisma` kept in full parity with `prisma/schema.prisma`
- [x] **Task 2.5.2:** Parity enforced by an automated AST test suite

### Story 2.6: Real-Data Ingestion ✅
- [x] **Task 2.6.1:** `EnergyStarAdapter` (ADR-003) — pinned HTTPS host, SSRF guard, SHA-256 payload hashing
- [x] **Task 2.6.2:** Audited write path — `Manufacturer → Series → Model → Sku → CertifiedSkuSpec` + immutable `RawObservation`
- [x] **Task 2.6.3:** CLI driver `scripts/ingest-energy-star.ts`
- [x] **Task 2.6.4:** 99 certified notebooks ingested, 1 rejected with a verbatim reason

### Story 2.7: Scraper Monitoring 🟡 PARTIAL
- [x] **Task 2.7.1:** Admin stats API (observation counts, stale observations, observations without a source, quality score)
- [ ] **Task 2.7.2:** Per-scraper health alerting (not started)
- [ ] **Task 2.7.3:** Scheduled run orchestration in CI (not started)

---

## Epic 3: Price Intelligence (P2) 🟡 PARTIAL

### Story 3.1: Seller Data Model 🟡
- [x] **Task 3.1.1:** Python `Seller`, `PriceListing`, `PriceHistory` models
- [x] **Task 3.1.2:** Prisma `PriceObservation` + `SkuRegionalPricing` with append-only semantics
- [ ] **Task 3.1.3:** Mirror `Seller` / `PriceListing` into the Prisma schema (not started)

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
- [ ] **Task 3.4.4:** Dispatch scheduler (not started)

### Story 3.5: Live Retailer Prices 🔴 NOT STARTED
- [ ] **Task 3.5.1:** Amazon PA-API integration
- [ ] **Task 3.5.2:** Best Buy API integration
- [ ] **Task 3.5.3:** Fallback scrapers for retailers without APIs
- **Note:** until one of these ships, all displayed prices are reference MSRP and are labelled as such.

---

## Epic 4: AI & Search (P3) 🟡 PARTIAL

### Story 4.1: Natural Language Filters 🟡
- [x] **Task 4.1.1:** Rule-based NL → filter parsing (`lib/ai.ts`)
- [x] **Task 4.1.2:** Residual-keyword extraction so `"Zenbook under $1500"` still matches models
- [x] **Task 4.1.3:** `GET /api/search` returns parsed filters alongside results
- [ ] **Task 4.1.4:** LLM-backed parsing for query shapes the rules do not cover (not started)
- [ ] **Task 4.1.5:** Surface natural-language search in the catalog UI (not started)

### Story 4.2: Recommendations 🟡
- [x] **Task 4.2.1:** Hard-constraint pre-filtering + weighted scoring with pros/cons
- [x] **Task 4.2.2:** `GET /api/recommendations`
- [ ] **Task 4.2.3:** LLM-ranked explanations (not started)
- [ ] **Task 4.2.4:** Recommendation UI component (not started)

### Story 4.3: Comparison ✅
- [x] **Task 4.3.1:** Side-by-side comparison, up to 5 SKUs
- [x] **Task 4.3.2:** Category winners, declared only when every compared row reports the metric
- [ ] **Task 4.3.3:** Use-case-based difference explanation (not started)

### Story 4.4: Dedicated Search Engine ⛔ DEFERRED
- [ ] **Task 4.4.1:** Meilisearch / Typesense
- [ ] **Task 4.4.2:** CDC or dual-write sync
- [ ] **Task 4.4.3:** Faceted configuration
- **Decision:** deferred. Postgres filtering is sufficient below ~5K SKUs; the catalog is at 2,164.

### Story 4.5: Semantic Similarity 🔴 NOT STARTED
- [ ] **Task 4.5.1:** pgvector embeddings for "find similar laptops"

---

## Epic 5: Community (P4) 🔴 NOT STARTED

### Story 5.1: User Accounts 🔴
- [ ] **Task 5.1.1:** Auth.js setup, providers, sessions
- [ ] **Task 5.1.2:** Profile pages
- [ ] **Task 5.1.3:** Role-based access (user, curator, admin)

### Story 5.2: Contributions 🔴
- [x] **Task 5.2.1:** Prisma `Contribution` model (schema only)
- [x] **Task 5.2.2:** `GET/POST /api/contributions` endpoints — 503-gated until ownership checks exist
- [ ] **Task 5.2.3:** Correction submission form with evidence upload
- [ ] **Task 5.2.4:** Voting system
- [ ] **Task 5.2.5:** Reputation tracking

---

## Epic 6: Platform Scale (P5) 🔴 NOT STARTED

### Story 6.1: Multi-Category 🔴
- [ ] **Task 6.1.1:** Category abstraction in the Prisma schema
- [ ] **Task 6.1.2:** Second category (phones or monitors)

### Story 6.2: Public Developer API 🔴
- [ ] **Task 6.2.1:** API key management
- [ ] **Task 6.2.2:** Rate limiting
- [ ] **Task 6.2.3:** OpenAPI documentation

### Story 6.3: Affiliate Integration 🔴
- [ ] **Task 6.3.1:** Affiliate link layer

---

## Known Gaps

| # | Gap | Impact |
|---|---|---|
| 1 | No live retailer price source — every price shown is reference MSRP | Price filters and price sorting operate on seed data, labelled "MSRP reference" |
| 2 | Natural-language search and recommendations exist as APIs but are not surfaced in the UI | Two working features are invisible to users |
| 3 | `POST /api/refresh` returns 503 | There is no scheduled ingestion path from the scrapers into the web database |
| 4 | Python `Seller` / `PriceListing` models are not mirrored in Prisma | The SQLAlchemy knowledge graph and the Prisma catalog are separate stores |
| 5 | PostgreSQL schema is validated but never exercised against a live database | Parity is proven structurally, not operationally |
| 6 | `AdminStatsPanel` counts `PriceObservation` rows, which are seed-derived | The quality score reflects seed completeness, not live-source completeness |
