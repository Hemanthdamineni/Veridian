# Veridian Roadmap

> **North Star:** A trusted decision platform for laptops — not just specs, but verified, connected, decision-ready data.

---

## Epic Overview

| Epic | Goal | Priority | Status |
|------|------|----------|--------|
| 1. MVP Launch | Ship a working filterable laptop catalog | **P0** | Not started |
| 2. Data Pipeline | Production-ready scrapers for all manufacturers | **P1** | In progress |
| 3. Price Intelligence | Price tracking, history, alerts | **P2** | Not started |
| 4. AI & Search | NL filters, recommendations, smart search | **P3** | Not started |
| 5. Community | User contributions, reputation, verification | **P4** | Not started |
| 6. Platform Scale | Multi-category, public API, partnerships | **P5** | Not started |

---

## Epic 1: MVP Launch (P0)

**Goal:** 50+ SKUs across 5 manufacturers with working filters, <300ms queries, deployed to Vercel.

**Stories:**
- 1.1 Project scaffolding (Next.js + TypeScript + Tailwind)
- 1.2 Database setup (Postgres on Neon + Prisma schema)
- 1.3 CSV seed script & initial data load
- 1.4 API routes (list, detail, manufacturers)
- 1.5 Frontend filter UI
- 1.6 SKU detail page
- 1.7 Admin/curation route
- 1.8 Deployment to Vercel

---

## Epic 2: Data Pipeline Hardening (P1)

**Goal:** All 14 manufacturer scrapers reliably producing clean normalized data.

**Stories:**
- 2.1 Audit & fix existing scraper implementations
- 2.2 Build missing YAML configs for 12 manufacturers
- 2.3 Implement incremental scraping (exclusion lists)
- 2.4 Data quality validation layer
- 2.5 Scraper monitoring & alerting
- 2.6 Migrate SQLite → Postgres for scraper output

---

## Epic 3: Price Intelligence (P2)

**Goal:** Price history tracking with alerts via email/telegram/discord.

**Stories:**
- 3.1 Retailer/seller data model & scraper fleet
- 3.2 Identity resolution pipeline (pg_trgm matching)
- 3.3 Price history append-only table & nightly rollups
- 3.4 Alert engine (below_price, lowest_ever, pct_off_msrp)
- 3.5 Notification service (email, telegram, discord)
- 3.6 Price history UI on SKU detail page

---

## Epic 4: AI & Search (P3)

**Goal:** Natural language filters, recommendations, and dedicated search engine.

**Stories:**
- 4.1 Meilisearch/Typesense integration with CDC sync
- 4.2 NL-to-filter parsing (structured LLM output)
- 4.3 AI recommendation engine (filtered candidates → ranked)
- 4.4 "Find similar laptops" (pgvector semantic similarity)
- 4.5 Smart comparison (explained differences, use-case based)

---

## Epic 5: Community (P4)

**Goal:** Community-driven data quality with trust/reputation system.

**Stories:**
- 5.1 User accounts & auth (Auth.js)
- 5.2 Contribution workflow (corrections, evidence, voting)
- 5.3 Reputation & trust system
- 5.4 Admin curation UI for pending edits
- 5.5 Community Q&A on product pages

---

## Epic 6: Platform Scale (P5)

**Goal:** Multi-category support, public API, affiliate partnerships.

**Stories:**
- 6.1 Category schema abstraction (laptops → phones, monitors, etc.)
- 6.2 Public developer API (search, compare, recommend)
- 6.3 Affiliate integration layer
- 6.4 Data quality dashboard (internal)
- 6.5 Lifecycle tracking (successors, discontinuations, firmware)

---

## Recommended Build Order

```
Week 1-2:  Epic 1 (MVP) — Get something live
Week 3-4:  Epic 2.1-2.3 — Harden ASUS/Lenovo/HP/Dell/Apple scrapers
Week 5-6:  Epic 1 polish + real data from scrapers
Week 7-8:  Epic 3 (Price tracking) — biggest differentiator
Week 9-10: Epic 4.1-4.2 (Search + NL filters)
Week 11+:  Epic 4.3-4.5, Epic 5, Epic 6 as needed
```

---

## Key Decisions Needed

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Database for MVP | Postgres (spec) vs SQLite (current) | **Postgres on Neon** — matches spec, zero migration later |
| Data source for MVP | Manual CSV vs scraper output | **Hybrid** — CSV for launch, scrapers feed updates |
| Search engine | Postgres only vs Meilisearch | **Postgres first** — add Meilisearch when >5K SKUs |
| Scraper priority | All 14 vs top 5 | **Top 5 first** (ASUS, Lenovo, HP, Dell, Apple) |
