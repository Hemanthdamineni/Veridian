# LaptopDB — Product & Technical Specification

**Document scope:** This spec has two parts. Part A defines the MVP/V1 — the minimum system that ships a real, usable filterable laptop catalog. Part B defines the final product vision — the complete system this grows into. Intermediate phases are intentionally omitted; Part B is the north star, not a v2/v3 breakdown.

---

# PART A — V1 / MVP SPECIFICATION

## A.1 Objective

Ship a filterable, structured database of current-generation ultrabook laptops, sourced from manufacturer specs, that lets a user find laptops matching hard spec constraints (RAM, CPU, display, weight, battery, price) faster and more precisely than searching manufacturer sites, Notebookcheck, and retailers separately.

No price tracking. No price history. No user accounts. No scraping infrastructure. Read-only public catalog with faceted filtering.

## A.2 In Scope

- Manufacturer → Series → Model → SKU catalog structure
- Full spec fields per SKU (CPU, RAM, storage, display, battery, weight, ports, build)
- Regional MSRP and availability (single price point per region, not history)
- Faceted filter UI: range filters, boolean filters, multi-select filters
- Text search by model name / SKU code
- SKU detail page
- Manual/curated data entry (no live scraping)

## A.3 Out of Scope (explicitly deferred to Part B)

- Price history / price tracking / alerts
- Live scraping of retailer sites
- Identity resolution across retailer listings
- AI-powered recommendations
- Successor/predecessor model linking
- User accounts, saved searches, reviews
- BIOS/driver archive, benchmark integration, used-market pricing
- Non-ultrabook categories (gaming, workstation, 2-in-1) — structure supports them later, data entry does not cover them in v1

## A.4 Data Model

**Hierarchy:** `Manufacturer → Series → Model → SKU`. There is no separate "Configuration" layer — each distinct spec combination (e.g. 16GB/512GB vs 32GB/1TB of the same model) is its own SKU row with its own `sku_code`, matching how manufacturers actually assign part numbers. This removes a layer of ambiguity present in earlier drafts of this idea.

### `manufacturers`

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| name | text, not null | e.g. "ASUS" |
| slug | text, unique, not null | e.g. "asus" |
| country | text | HQ country |
| website_url | text | |
| logo_url | text | nullable |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### `series`

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| manufacturer_id | uuid, FK → manufacturers.id, not null | |
| name | text, not null | e.g. "Zenbook" |
| slug | text, not null | unique per manufacturer |
| description | text | nullable |

### `models`

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| series_id | uuid, FK → series.id, not null | |
| name | text, not null | e.g. "Zenbook A14" |
| slug | text, not null | unique per series |
| launch_date | date | nullable |
| official_product_page_url | text | nullable |
| discontinued | boolean, default false | |

### `skus`

This is the primary filterable table. All queryable spec fields live here.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| model_id | uuid, FK → models.id, not null | |
| sku_code | text, unique, not null | manufacturer's official part number |
| cpu_brand | enum(Intel, AMD, Qualcomm, Apple), not null | |
| cpu_model | text, not null | e.g. "Snapdragon X Elite X1E-78" |
| cpu_cores | int | nullable |
| gpu_model | text | nullable (integrated or discrete name) |
| ram_gb | int, not null | |
| ram_type | enum(DDR5, LPDDR5, LPDDR5X), not null | |
| ram_soldered | boolean, not null | |
| storage_gb | int, not null | |
| storage_type | enum(NVMe SSD, SATA SSD, eMMC), not null | |
| storage_slots | int | number of physical drive slots |
| display_size_in | numeric(3,1), not null | e.g. 14.0 |
| display_resolution | text, not null | e.g. "2880x1800" |
| display_type | enum(IPS, OLED, Mini-LED), not null | |
| display_refresh_hz | int, not null | |
| display_touch | boolean, not null | |
| display_nits | int | nullable |
| weight_kg | numeric(4,2), not null | |
| battery_wh | numeric(5,1), not null | |
| battery_life_hours_claimed | numeric(4,1) | nullable, manufacturer-claimed |
| npu_tops | numeric(5,1) | nullable |
| os | text, not null | e.g. "Windows 11 Home" |
| build_material | enum(Aluminum, Magnesium, Plastic, Carbon Fiber), not null | |
| linux_compatibility_score | enum(Good, Partial, Poor, Untested) | nullable, curated manually |
| launch_date | date | nullable |
| discontinued | boolean, default false | |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

Indexes: btree on `ram_gb`, `storage_gb`, `weight_kg`, `battery_wh`, `display_refresh_hz`; standard btree on `model_id`; unique on `sku_code`.

### `sku_regional_pricing`

One row per (SKU, region) — current price only, no history in v1.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| sku_id | uuid, FK → skus.id, not null | |
| region | enum(US, IN, UK, EU, CA), not null | |
| currency | text, not null | ISO 4217 code |
| msrp | numeric(10,2), not null | |
| available | boolean, default true | |
| official_store_url | text | nullable |
| updated_at | timestamptz | default now() |

Unique constraint on (`sku_id`, `region`).

### `sku_ports`

Normalized rather than JSON so port type/count is filterable.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| sku_id | uuid, FK → skus.id, not null | |
| port_type | enum(USB-C/USB4, Thunderbolt4, USB-A, HDMI, SD Card, Headphone) | |
| count | int, not null | |

## A.5 Functional Requirements

| ID | Requirement |
|---|---|
| FR-1 | User can browse the full catalog paginated, 24 SKUs per page default |
| FR-2 | User can filter by: RAM (min/max), storage (min/max), CPU brand (multi-select), display type (multi-select), display refresh rate (min), weight (max), battery capacity (min), price (min/max per selected region), touch (yes/no/any), region availability |
| FR-3 | User can sort results by: price (asc/desc), weight (asc), battery capacity (desc), launch date (newest first) |
| FR-4 | User can text-search by model name or SKU code, case-insensitive, partial match |
| FR-5 | User can view a full SKU detail page showing every spec field and regional pricing |
| FR-6 | Filters combine with AND logic across categories, OR logic within a multi-select category (e.g. CPU brand = Intel OR AMD, AND RAM >= 32) |
| FR-7 | Filter state is reflected in the URL query string so results are shareable/bookmarkable |
| FR-8 | Empty filter results show a clear "no matches" state, not a blank page |

## A.6 Non-Functional Requirements

- Filtered query response time: under 300ms server-side at up to 5,000 SKU rows (comfortably achievable with proper indexing at MVP scale; no dedicated search engine needed yet)
- Fully responsive: usable on mobile viewport (~375px) and desktop
- No authentication required for browsing (public read-only)
- Data updated manually on a weekly cadence; no real-time freshness requirement
- No SLA/uptime commitment required for MVP (single-region deployment acceptable)

## A.7 Tech Stack (decisive — no alternatives listed to avoid ambiguity)

| Layer | Choice |
|---|---|
| Frontend + API | Next.js 14+ (App Router), single deployable app — API routes serve the frontend, no separate backend service |
| Language | TypeScript throughout |
| Database | PostgreSQL 16 |
| DB hosting | Neon (serverless Postgres, pairs natively with Vercel deploys) |
| ORM | Prisma |
| Styling | Tailwind CSS |
| Hosting | Vercel |
| Data entry | Internal-only admin route (`/admin`, protected by a single shared bearer token in an env var — not full auth, out of scope for MVP) with a form to create/edit SKUs, plus a CSV import script (`scripts/seed.ts`) for bulk loading curated spec data |

No search-engine service (Meilisearch/Typesense) in v1 — Postgres with proper indexes handles filtering at this scale. Introduce a dedicated search engine only if row count or query latency crosses the thresholds in A.6.

## A.8 System Architecture (MVP)

```
┌─────────────────────┐
│   Browser (React)    │
│  Filter UI, results  │
│  grid, SKU detail     │
└──────────┬───────────┘
           │ HTTPS
┌──────────▼───────────┐
│   Next.js App         │
│  (Vercel)              │
│  - App Router pages    │
│  - /api/skus route     │
│  - /api/skus/[id]      │
│  - /api/manufacturers  │
│  - /admin (curation)   │
└──────────┬───────────┘
           │ Prisma Client (SQL over TLS)
┌──────────▼───────────┐
│   Postgres (Neon)      │
│  manufacturers          │
│  series                 │
│  models                 │
│  skus                   │
│  sku_regional_pricing   │
│  sku_ports              │
└───────────────────────┘
```

No queues, no background workers, no external APIs in the MVP request path.

## A.9 API Specification

### `GET /api/skus`

Query parameters (all optional, combine with AND):

| Param | Type | Example |
|---|---|---|
| cpu_brand | comma-separated enum | `cpu_brand=Intel,AMD` |
| ram_min | int | `ram_min=32` |
| storage_min | int | `storage_min=1000` |
| display_type | comma-separated enum | `display_type=OLED` |
| refresh_min | int | `refresh_min=120` |
| weight_max | numeric | `weight_max=1.4` |
| battery_min | numeric | `battery_min=70` |
| touch | boolean | `touch=false` |
| region | enum | `region=IN` |
| price_min | numeric | requires `region` |
| price_max | numeric | requires `region` |
| q | text | free-text model/SKU search |
| sort | enum | `price_asc, price_desc, weight_asc, battery_desc, newest` |
| page | int, default 1 | |
| limit | int, default 24, max 100 | |

Response:

```json
{
  "results": [
    {
      "id": "uuid",
      "sku_code": "UX3407QA-QD123WS",
      "model_name": "Zenbook A14",
      "series_name": "Zenbook",
      "manufacturer_name": "ASUS",
      "cpu_model": "Snapdragon X Elite X1E-78",
      "ram_gb": 32,
      "storage_gb": 1024,
      "display": { "size_in": 14.0, "resolution": "2880x1800", "type": "OLED", "refresh_hz": 120 },
      "weight_kg": 1.2,
      "battery_wh": 75,
      "price": { "region": "IN", "currency": "INR", "msrp": 89990 }
    }
  ],
  "pagination": { "page": 1, "limit": 24, "total_results": 63, "total_pages": 3 }
}
```

### `GET /api/skus/:id`

Returns full SKU object: every field in the `skus` table, all `sku_regional_pricing` rows, all `sku_ports` rows, and parent model/series/manufacturer names.

### `GET /api/manufacturers`

Returns all manufacturers, for populating filter dropdowns.

### `GET /api/models?series_id=`

Returns models under a series, for admin/curation use.

## A.10 Data Sourcing Plan for MVP

- **Category:** 14"-class ultrabooks only
- **Manufacturers:** ASUS, Lenovo, HP, Dell, Apple (5 brands)
- **Recency:** current-generation models only (launched within the last 12 months)
- **Target volume:** 50–80 SKUs
- **Source of truth:** each manufacturer's own product/spec page
- **QA step:** cross-check specs against Notebookcheck's listing for the same model for accuracy (reference only — do not scrape or bulk-copy Notebookcheck's database; that is their business and doing so risks a legal request to stop)
- **Entry method:** hand-curated into a CSV matching the `skus` table schema, loaded via `scripts/seed.ts`

## A.11 Success Criteria for MVP

- 50+ SKUs live across 5 manufacturers
- All filters in FR-2 functional and return correct results, verified against manually checked expected results for at least 10 test queries
- Filtered query response under 300ms measured server-side
- A user can answer a real question ("14 inch, OLED, 32GB RAM, under 1.3kg, under ₹1,00,000") in a single filter pass with zero manual cross-referencing

---

# PART B — FINAL PRODUCT SPECIFICATION

This section describes the complete system, independent of build order. It extends every table and component from Part A.

## B.1 Full Data Model Extensions

### `models` — add

| Column | Type | Notes |
|---|---|---|
| successor_model_id | uuid, FK → models.id, nullable, self-referencing | |
| predecessor_model_id | uuid, FK → models.id, nullable, self-referencing | |

### `sellers`

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| name | text, not null | e.g. "Best Buy", "Amazon India" |
| region | enum(US, IN, UK, EU, CA), not null | |
| base_url | text | |
| scrape_method | enum(official_api, scraper), not null | prefer official_api wherever one exists |
| affiliate_program_url | text | nullable |

### `retailer_listings`

The raw, unresolved rows a scraper produces before identity resolution runs.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| seller_id | uuid, FK → sellers.id, not null | |
| retailer_sku_string | text, not null | the seller's own product name/code, as scraped |
| resolved_sku_id | uuid, FK → skus.id, nullable | null until matched |
| match_confidence | numeric(3,2) | 0.00–1.00, from resolution pipeline |
| verified_by_human | boolean, default false | |
| last_scraped_at | timestamptz | |

### `price_history`

Append-only. Never updated, only inserted.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| retailer_listing_id | uuid, FK → retailer_listings.id, not null | |
| price | numeric(10,2), not null | |
| currency | text, not null | |
| scraped_at | timestamptz, not null | |

### `price_rollups`

Materialized nightly from `price_history`, one row per resolved SKU per seller, for fast reads.

| Column | Type | Notes |
|---|---|---|
| sku_id | uuid, FK → skus.id | |
| seller_id | uuid, FK → sellers.id | |
| lowest_ever | numeric(10,2) | |
| highest_ever | numeric(10,2) | |
| avg_30d | numeric(10,2) | |
| avg_90d | numeric(10,2) | |
| current_price | numeric(10,2) | |
| current_discount_pct | numeric(5,2) | vs. launch MSRP |

### `users` / `alerts`

| Table | Key columns |
|---|---|
| users | id, email, created_at |
| alerts | id, user_id (FK), sku_id (FK), region, condition_type (enum: below_price, lowest_ever, pct_off_msrp), threshold_value, channel (enum: email, telegram, discord, push), active (bool) |

## B.2 Full System Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                         Scraper Fleet                            │
│  Playwright-based workers, containerized (Docker)                │
│  One worker config per seller; scheduled via queue                │
│  Prefers official retailer APIs (Amazon PA-API, Best Buy API)     │
│  over scraping wherever one exists — see B.8 legal notes          │
└───────────────────────┬────────────────────────────────────────┘
                         │ writes raw rows
┌────────────────────────▼───────────────────────────────────────┐
│                    retailer_listings (Postgres)                  │
└───────────────────────┬────────────────────────────────────────┘
                         │ triggers
┌────────────────────────▼───────────────────────────────────────┐
│               Identity Resolution Service                        │
│  pg_trgm similarity match against skus.sku_code / models.name    │
│  Auto-match ≥0.6 confidence · flag 0.3–0.6 for manual review     │
│  · reject <0.3 as unmatched/new                                   │
│  Writes resolved_sku_id + match_confidence back onto the listing  │
└───────────────────────┬────────────────────────────────────────┘
                         │
        ┌────────────────┼─────────────────────┐
        │                │                       │
┌───────▼──────┐  ┌──────▼────────┐   ┌─────────▼─────────┐
│ price_history │  │ price_rollups │   │ Admin Curation UI  │
│ (append-only) │  │ (nightly job) │   │ reviews 0.3–0.6     │
└───────┬───────┘  └──────┬────────┘   │ confidence matches  │
        │                  │            └────────────────────┘
        │           ┌──────▼────────┐
        │           │  Alert Engine  │
        │           │  checks active │
        │           │  alerts after  │
        │           │  each scrape   │
        │           └──────┬────────┘
        │                  │
        │           ┌──────▼──────────────┐
        │           │ Notification Service │
        │           │ Email / Telegram /    │
        │           │ Discord / Web Push    │
        │           └──────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────┐
│                      Canonical Postgres DB                      │
│         (source of truth: manufacturers → skus, as in A.4)      │
└───────┬───────────────────────────────────────────────────────┘
        │
┌───────▼──────────────┐        ┌──────────────────────────────┐
│  Search/Filter Layer   │        │   AI Recommendation Service   │
│  Meilisearch/Typesense │        │  Structured filter query built │
│  synced from Postgres  │◄───────┤  from user's natural-language │
│  for instant facets     │        │  request via LLM API           │
└───────┬────────────────┘        │  → ranked results with          │
        │                          │  pros/cons via a second LLM call│
┌───────▼────────────────┐        └──────────────────────────────┘
│   Next.js Frontend       │
│   (same app as Part A,   │
│   extended with price     │
│   history charts, alerts, │
│   recommendation UI)       │
└──────────────────────────┘
```

## B.3 Identity Resolution Pipeline — Detail

1. **Normalize** the incoming `retailer_sku_string`: lowercase, strip whitespace/punctuation variance, strip common retailer boilerplate ("Laptop", "Notebook", brand name repetition).
2. **Extract SKU-like tokens** via regex for alphanumeric patterns matching known manufacturer part-number formats (e.g. `[A-Z]{2}\d{4}[A-Z]{2}`).
3. **Trigram similarity** (`pg_trgm`, `similarity()` function) against both `skus.sku_code` and `models.name` fields.
4. **Thresholds:**
   - similarity ≥ 0.6 → auto-match, `verified_by_human = false`
   - 0.3 ≤ similarity < 0.6 → written to `retailer_listings` with `resolved_sku_id` set to best guess but flagged in the Admin Curation UI for human confirmation
   - similarity < 0.3 → left unresolved, surfaced in Admin UI as a possible new/unmapped SKU
5. Once a human confirms a match in the Admin UI, `verified_by_human = true` and that (retailer_sku_string → sku_id) pair is cached so future identical strings from that seller auto-match at confidence 1.0 without re-running similarity search.

## B.4 Price Tracking — Detail

- Each seller's scraper runs on an independent schedule (default: daily; higher-traffic sellers e.g. Amazon can run more frequently).
- Every scrape appends one immutable row to `price_history` — never overwrites.
- A nightly job recomputes `price_rollups` (lowest/highest ever, 30/90-day averages, current discount vs. launch MSRP) per (SKU, seller) pair.
- The Alert Engine runs after each scrape batch completes, checking all `active` alerts whose `sku_id` had a new price row written, and firing notifications for any that now satisfy their `condition_type`/`threshold_value`.

## B.5 Smart Filters — Final Version

All MVP filters (A.5, FR-2) remain. Added:

- **Saved filter presets** per user account.
- **Natural-language-to-filter parsing:** user input ("quiet laptop good for programming under ₹90,000") is sent to an LLM with a system prompt instructing it to output a structured JSON object matching the `/api/skus` query-parameter schema in A.9. That JSON is then executed as a normal filtered database query — this is a structured-output LLM call, not an embedding similarity search, so results remain exact and debuggable.

## B.6 AI Recommendation Engine

1. User submits structured requirements (budget, RAM, size, display, use case).
2. Backend queries the database for candidate SKUs matching all hard constraints (price range, RAM minimum, etc.) — this narrows to, say, the top 20 candidates.
3. Those 20 candidates' full spec data, plus the user's stated needs, are passed to an LLM API in a single call, with a system prompt instructing it to return a ranked JSON list of the top 4 with a `pros` array and `cons` array per entry.
4. Frontend renders the ranked JSON as recommendation cards.
5. The LLM never sees or reasons about the full catalog — only the pre-filtered candidate set — so recommendation quality depends on the hard-constraint filtering being correct, not on the model's own knowledge of laptop specs.

## B.7 Full Tech Stack Additions (beyond Part A)

| Component | Choice |
|---|---|
| Fuzzy string matching | `pg_trgm` Postgres extension |
| Semantic similarity (future: "find similar laptops") | `pgvector` Postgres extension |
| Job queue | Redis + BullMQ |
| Scraper runtime | Playwright, containerized via Docker, one image per seller config |
| Proxy layer | Residential proxy provider for scrapers targeting sites with bot detection (adds cost and legal exposure — see B.8) |
| Search/filter engine | Meilisearch or Typesense, kept in sync with Postgres via a change-data-capture job or on-write dual-write |
| Email notifications | Resend |
| Telegram notifications | Telegram Bot API |
| Discord notifications | Discord incoming webhooks |
| Push notifications | Web Push API |
| Admin/curator auth | Auth.js (formerly NextAuth) with role-based access |
| LLM API (recommendations, NL filter parsing) | Any provider's structured-output-capable chat completions API |

## B.8 Legal and Risk Notes

- Scraping retailer sites generally violates their Terms of Service. Wherever an official API exists (Amazon Product Advertising API, Best Buy Developer API, etc.), it should be used in preference to scraping — this is both lower legal risk and more reliable than scraping.
- For sellers with no official API, scraping carries real risk: rate-limiting, IP bans, and potential legal action (cease-and-desist) from the retailer. This should get a legal review before any scraper targeting a given seller goes into production, not treated as a pure engineering decision.
- Notebookcheck's spec database is proprietary; use it for manual QA/reference only, never as a bulk data source.
- Affiliate program terms (commission structure, cookie windows, payout thresholds) differ per retailer per region and must be negotiated/reviewed independently — this is a business-development task, not something automated by the scraper.

## B.9 Non-Functional Requirements (Final Product)

- Data freshness SLA: prices refreshed within 24 hours of a retailer's own price change, for actively-tracked SKUs
- Scale target: 10,000+ SKUs, 50+ sellers across 5+ regions
- Search/filter response time: under 150ms at full scale (via dedicated search engine, not raw Postgres)
- Alert delivery latency: under 15 minutes from price change to notification sent
- Admin Curation UI uptime: best-effort, internal tool, no external SLA required
