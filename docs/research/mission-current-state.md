# Veridian Mission Research and Current-State Audit

**Date:** 2026-09-30  
**Scope:** Repository inspection and safe local verification only. No product-page crawling or source data ingestion was performed.

## Existing System

- Public application: `veridian-web/`, Next.js App Router with TypeScript, Prisma, local SQLite in `.env`, and PostgreSQL schema variants.
- Python domain: `veridian_db/` SQLAlchemy knowledge graph; it is separate from the web app's Prisma database.
- Python collection prototypes: `veridian_scraper/` has manufacturer scraper classes/configs and validation/price tracking logic. `asus_scraper/` is a separate older implementation. Neither is wired into the public web database through a verified ingestion contract.
- Web features present: catalog filters/search/pagination, SKU detail with price history data, comparison workspace/API, rule-based recommendations and parsing, admin pages/stats, contributions and alerts APIs.
- Some features are incomplete or unsafe: public APIs accept unauthenticated writes/updates for contributions/alerts; admin auth uses a JavaScript-set credential cookie; scraper refresh is launched from the browser but writes to a different data store and is unsuitable for serverless deployment; price sorting loads all matching rows into memory; no test suite covers the Next routes or UI.

## Data Integrity Findings

- `veridian-web/data/laptops.csv` is tracked and contains 43 rows across ASUS, Apple, Dell, HP, and Lenovo. The repository provides no row-level source URLs, source capture timestamps, applicable license/terms, or curation log that permits independent validation. Treat every row as **unverified local seed**, not proven real-world data.
- `veridian-web/scripts/seed.ts` expands each CSV row into 47 or 48 synthetic configurations by changing RAM, storage, generated SKU suffixes, and prices. This is fabricated catalog data and must not be presented as observed or verified products/prices.
- That script also writes synthetic `PriceObservation` rows timestamped 2023-01-01 with `sourceName="csv seed"` and no source URL. A history view that does not clearly identify this as synthetic can mislead users.
- No real-data ingestion was attempted. Data volume of legitimate, source-validated records ingested during this mission: **0**.

## Legal and Data Source Gate

A direct policy-document check was made on 2026-09-30 only; this did not authorize product collection. ASUS India `/robots.txt` returned 404, while the root ASUS robots file returned 200; Lenovo root robots returned 403; Apple, Dell, and HP root robots endpoints returned 200. Exact path rules and terms were not fully reviewed, so all sources remain blocked pending the source register gate in `docs/DATA_SOURCES.md`.

## Commands and Verification

- `.venv/bin/python -m pytest -q`: **6 passed**, 4 `datetime.utcnow()` deprecation warnings.
- `npm run lint` under `veridian-web`: completed with no reported issues.
- An exploratory `npx tsc --noEmit` / `npm run build` was not run in this audit step; verify after resolving Prisma client/schema and environment consistency.
- No source product pages were fetched. No source-derived volume is claimed.

## Mission Limitations

The requested full end-to-end mission cannot honestly be marked complete from this repository state: there are zero independently verified real records ingested in this run, source terms are not cleared, and frontend/API security and schema inconsistencies need remediation. The task graph tracks the required remaining work. Documentation status does not substitute for implementation, tests, real-data validation, or independent code review.
