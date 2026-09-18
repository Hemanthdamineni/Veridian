# Veridian Task Tracker

> Stories → Tasks → Subtasks. Update status as work progresses.
> Status: 🔴 Todo | 🟡 In Progress | 🟢 Done

---

## Epic 1: MVP Launch (P0) ✅ COMPLETED

### Story 1.1: Project Scaffolding ✅
- [x] **Task 1.1.1:** Initialize Next.js 14 project with App Router
- [x] **Task 1.1.2:** Project structure & conventions

### Story 1.2: Database Setup ✅
- [x] **Task 1.2.1:** Prisma schema definition (Manufacturer, Series, Model, Sku, SkuRegionalPricing, SkuPort)
- [x] **Task 1.2.2:** Database connection & migration setup

### Story 1.3: CSV Seed Script ✅
- [x] **Task 1.3.1:** Seed script implementation (`scripts/seed.ts`)
- [x] **Task 1.3.2:** Initial dataset (`data/laptops.csv` - 40 SKUs across ASUS, Lenovo, HP, Dell, Apple)

### Story 1.4: API Routes ✅
- [x] **Task 1.4.1:** List SKUs endpoint (`GET /api/skus`)
- [x] **Task 1.4.2:** SKU detail endpoint (`GET /api/skus/:id`)
- [x] **Task 1.4.3:** Manufacturers endpoint (`GET /api/manufacturers`)
- [x] **Task 1.4.4:** API utilities (filter builder, pagination, response formatting)

### Story 1.5: Frontend Filter UI ✅
- [x] **Task 1.5.1:** Filter components (FilterPanel with all filter types)
- [x] **Task 1.5.2:** Results display (SkuCard, Pagination, empty state)
- [x] **Task 1.5.3:** URL state management (filters synced to query params)

### Story 1.6: SKU Detail Page ✅
- [x] **Task 1.6.1:** Detail page layout (full specs, pricing, ports, breadcrumb)

### Story 1.7: Admin Route ✅
- [x] **Task 1.7.1:** Simple auth (Bearer token middleware)
- [x] **Task 1.7.2:** SKU management (SkuForm, SkuList components)

### Story 1.8: Deployment ✅
- [x] **Task 1.8.1:** Vercel configuration (next.config.mjs, env vars)
- [x] **Task 1.8.2:** Build verification (production build passes)

**Implementation:** `veridian-web/` directory with Next.js 14 + Prisma + Tailwind CSS v4

---

## Epic 2: Data Pipeline Hardening (P1)

### Story 2.1: Scraper Audit & Fix
- [ ] **Task 2.1.1:** Audit existing scrapers
  - [ ] Test ASUS scraper (should work)
  - [ ] Test Lenovo scraper
  - [ ] Test HP scraper
  - [ ] Test Dell scraper
  - [ ] Test Apple scraper
  - [ ] Document issues per scraper

- [ ] **Task 2.1.2:** Fix scraper implementations
  - [ ] Fix broken selectors
  - [ ] Handle pagination edge cases
  - [ ] Add proper error handling
  - [ ] Verify data extraction accuracy

### Story 2.2: Missing Configs
- [ ] **Task 2.2.1:** Create YAML configs for remaining manufacturers
  - [ ] Acer config
  - [ ] MSI config
  - [ ] Samsung config
  - [ ] Microsoft config
  - [ ] LG config
  - [ ] Razer config
  - [ ] Framework config
  - [ ] Gigabyte config

### Story 2.3: Incremental Scraping
- [ ] **Task 2.3.1:** Implement exclusion lists
  - [ ] Modify `run_scrapers.py` to accept exclusion list
  - [ ] Track last-scraped timestamps per manufacturer
  - [ ] Skip unchanged products

### Story 2.4: Data Quality
- [ ] **Task 2.4.1:** Validation layer
  - [ ] Reject impossible values (battery_wh > 200, weight_kg < 0.5, etc.)
  - [ ] Flag outliers for manual review
  - [ ] Add confidence scoring per field

---

## Epic 3: Price Intelligence (P2)

### Story 3.1: Retailer Scrapers
- [ ] **Task 3.1.1:** Seller data model
  - [ ] Add `sellers` table to Prisma
  - [ ] Add `retailer_listings` table
  - [ ] Add `price_history` table

- [ ] **Task 3.1.2:** Scraper fleet
  - [ ] Amazon PA-API integration (preferred over scraping)
  - [ ] Best Buy API integration
  - [ ] Fallback scrapers for retailers without APIs

### Story 3.2: Identity Resolution
- [ ] **Task 3.2.1:** pg_trgm matching
  - [ ] Enable pg_trgm extension
  - [ ] Normalize retailer strings
  - [ ] Trigram similarity matching
  - [ ] Threshold-based auto-match (≥0.6)

### Story 3.3: Price Tracking
- [ ] **Task 3.3.1:** Price history
  - [ ] Append-only price writes
  - [ ] Nightly rollup job (lowest/highest/avg)
  - [ ] Price change detection

### Story 3.4: Alerts
- [ ] **Task 3.4.1:** Alert engine
  - [ ] Alert CRUD API
  - [ ] Condition checking (below_price, lowest_ever, pct_off)
  - [ ] Notification dispatch (email, telegram, discord)

---

## Epic 4: AI & Search (P3)

### Story 4.1: Search Engine
- [ ] **Task 4.1.1:** Meilisearch/Typesense setup
  - [ ] Deploy search instance
  - [ ] Sync from Postgres (CDC or dual-write)
  - [ ] Configure searchable attributes and facets

### Story 4.2: Natural Language Filters
- [ ] **Task 4.2.1:** NL-to-filter parsing
  - [ ] LLM system prompt for structured output
  - [ ] Parse user query → filter JSON
  - [ ] Show parsed filters to user for adjustment

### Story 4.3: Recommendations
- [ ] **Task 4.3.1:** AI recommendation engine
  - [ ] Hard-constraint pre-filtering
  - [ ] LLM ranking with pros/cons
  - [ ] Recommendation UI component

---

## Epic 5: Community (P4)

### Story 5.1: User Accounts
- [ ] **Task 5.1.1:** Auth.js setup
  - [ ] Configure providers (email, OAuth)
  - [ ] User profile pages
  - [ ] Role-based access (user, curator, admin)

### Story 5.2: Contributions
- [ ] **Task 5.2.1:** Contribution workflow
  - [ ] Correction submission form
  - [ ] Evidence upload (screenshots, links)
  - [ ] Voting system (confirmed/disputed)
  - [ ] Reputation tracking

---

## Epic 6: Platform Scale (P5)

### Story 6.1: Multi-Category
- [ ] **Task 6.1.1:** Category abstraction
  - [ ] Refactor schema for category-specific specs
  - [ ] Add category field to products
  - [ ] Test with second category (phones or monitors)

### Story 6.2: Public API
- [ ] **Task 6.2.1:** Developer API
  - [ ] API key management
  - [ ] Rate limiting
  - [ ] Documentation (OpenAPI/Swagger)

---

## Quick Reference: Story Points Estimate

| Story | Complexity | Est. Effort |
|-------|------------|-------------|
| 1.1 Scaffolding | Low | 1 day |
| 1.2 Database | Low | 1 day |
| 1.3 Seed Script | Medium | 2 days |
| 1.4 API Routes | Medium | 2 days |
| 1.5 Filter UI | High | 3-4 days |
| 1.6 Detail Page | Low | 1 day |
| 1.7 Admin | Low | 1 day |
| 1.8 Deploy | Low | 0.5 day |
| **Epic 1 Total** | | **~12 days** |
| 2.1 Scraper Audit | High | 3-5 days |
| 2.2 Configs | Medium | 2-3 days |
| 2.3 Incremental | Low | 1 day |
| **Epic 2 Total** | | **~7 days** |
| 3.1-3.4 Price | Very High | 10-14 days |
| 4.1-4.3 AI/Search | High | 7-10 days |
| 5.1-5.2 Community | High | 7-10 days |
| 6.1-6.2 Platform | Very High | 14+ days |
