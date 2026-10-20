# Veridian Roadmap

> **North Star:** A trusted decision platform for laptops — not just specs, but verified, connected, decision-ready data.

> **Last updated: 2026-10-21.** Statuses reflect verified code, not intent.

---

## Epic Overview

| Epic | Goal | Priority | Status |
|------|------|----------|--------|
| 1. MVP Launch | Ship a working filterable laptop catalog | **P0** | ✅ Complete |
| 2. Data Pipeline | Production-ready scrapers for all manufacturers | **P1** | 🟡 Code complete, live re-verification pending |
| 3. Price Intelligence | Price tracking, history, alerts | **P2** | 🟡 Domain engine built, wiring pending |
| 4. AI & Search | NL filters, recommendations, smart search | **P3** | 🟡 Rule-based NL + recommendations; dedicated search deferred |
| 5. Community | User contributions, reputation, verification | **P4** | 🔴 Not started (models only) |
| 6. Platform Scale | Multi-category, public API, partnerships | **P5** | 🔴 Not started |

---

## Where the project actually stands

The application is operational end to end: a filterable catalog of **2,164
laptop configurations** across **18 manufacturers**, with **99 configurations
carrying a cited certification record** and full provenance.

**Two data tiers, disclosed everywhere:**

| Tier | Count | Provenance | Prices |
|------|------:|------------|--------|
| Certified | 99 | US EPA ENERGY STAR V9.0 — cited URL, certification date, SHA-256 of the verbatim payload | None — the source publishes no price |
| Reference | 2,065 | Local seed dataset, no cited source | MSRP per region |

The catalog never conflates the two: every card, detail page, comparison, and
methodology section labels which tier it is showing.

**Verified engineering baseline:** types clean · lint clean · 56 web tests ·
13 Python tests · 16/16 build routes · CI on every push and pull request.

---

## Epic 1: MVP Launch (P0) — ✅ Complete

**Goal met:** 50+ SKUs across 5 manufacturers with working filters, <300ms
queries, production build passing.

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

**Goal:** All manufacturer scrapers reliably producing clean normalized data.

- 2.1 Scraper fleet — 13 manufacturers implemented ✅
- 2.2 YAML configs for all 13 supported manufacturers ✅
- 2.3 Incremental scraping (`--incremental`, `max_age_hours` cutoff) ✅
- 2.4 Data quality validation layer (spec, product, price-observation) ✅
- 2.5 Scraper monitoring — stats endpoint done; failure alerting 🟡
- 2.6 SQLite → Postgres parity ✅
- **Remaining:** live re-verification against manufacturer sites (terms of
  service dependent), durable per-manufacturer scrape checkpoints.

---

## Epic 3: Price Intelligence (P2) — 🟡

**Goal:** Price history tracking with alerts via email/telegram/discord.

- 3.1 Seller/price-listing data model — Python knowledge graph ✅, Prisma `Seller`/`RetailerListing` 🔴
- 3.2 Identity resolution pipeline (trigram matching) ✅
- 3.3 Price history append-only table and rollups — domain engine ✅, scheduler 🔴
- 3.4 Alert engine (below_price, lowest_ever, pct_off) ✅, CRUD API 🔴
- 3.5 Notification service (email, telegram, discord, web push) ✅
- 3.6 Price history UI on the SKU detail page ✅
- **Remaining:** no live retailer price source exists. Every price in the
  system is a manufacturer suggested price from the seed dataset. Closing
  this gap is the single highest-value remaining work.

---

## Epic 4: AI & Search (P3) — 🟡

**Goal:** Natural language filters, recommendations, and dedicated search.

- 4.1 Meilisearch/Typesense integration 🔴 — deferred by standing decision
- 4.2 NL-to-filter parsing — deterministic rule-based parser ✅, LLM layer 🟡
- 4.3 AI recommendation engine — constraint scorer with pros/cons ✅, LLM ranking 🔴
- 4.4 "Find similar laptops" (pgvector) 🔴
- 4.5 Smart comparison — difference highlighting and winner analysis ✅, use-case explanations 🔴

---

## Epic 5: Community (P4) — 🔴

**Goal:** Community-driven data quality with trust/reputation system.

- 5.1 User accounts & auth (Auth.js) 🔴
- 5.2 Contribution workflow (corrections, evidence, voting) 🔴 — models exist, endpoints return 503
- 5.3 Reputation & trust system 🔴
- 5.4 Admin curation UI for pending edits 🔴
- 5.5 Community Q&A on product pages 🔴

---

## Epic 6: Platform Scale (P5) — 🔴

**Goal:** Multi-category support, public API, affiliate partnerships.

- 6.1 Category schema abstraction (laptops → phones, monitors, etc.) 🔴
- 6.2 Public developer API (search, compare, recommend) 🔴
- 6.3 Affiliate integration layer 🔴
- 6.4 Data quality dashboard — internal stats panel done ✅, fuller dashboard 🔴
- 6.5 Lifecycle tracking (successors, discontinuations, firmware) 🔴

---

## Recommended Build Order

```
Now        Ship what is built — fix trust and usability defects
Next       Live price source (retailer API or compliant scraper) — the
           largest remaining gap between the product promise and reality
Then       Seller/listing schema + price history wiring in Postgres
Then       Accounts (Auth.js) → unlocks alerts and contributions
Then       LLM-backed NL parsing and recommendation ranking
Then       Meilisearch (once the catalog passes ~5K configurations)
Then       Multi-category abstraction and the public API
```

---

## Key Decisions

| Decision | Options | Recommendation | Status |
|----------|---------|----------------|--------|
| Database for MVP | Postgres vs SQLite | **Postgres on Neon** — matches spec, zero migration later | Schema parity done; deployment pending |
| Data source for MVP | Manual CSV vs scraper output | **Hybrid** — CSV for launch, scrapers feed updates | In effect |
| Search engine | Postgres only vs Meilisearch | **Postgres first** — add Meilisearch when >5K SKUs | Holding (2,164 SKUs) |
| Scraper priority | All 14 vs top 5 | **Top 5 first** | Extended to 13 |
| Region semantics | Region filters rows vs selects the price shown | **Region selects the price shown** — rows are never hidden for lacking a price | Adopted 2026-10-21 |
| Price data | Hide prices vs show with a caveat | **Show MSRP labelled as a seed-sourced reference value** | Adopted 2026-10-21 |
| Provenance disclosure | Implicit vs explicit tiers | **Explicit tier filter and badge on every listing** | Adopted 2026-10-21 |
