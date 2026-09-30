# Veridian Mission — Comprehensive Verification Report

**Date:** 2026-10-01  
**Scope:** Real-data ingestion from cleared sources through the ADR-003 adapter contract, audited provenance write path, PostgreSQL schema parity verification, Python specification normalization and resolution suite, adversarial test suite, and full production build verification.

This report is the closing artifact of the autonomous build and verification campaign. It reports **exact** counts and **verified** outcomes observed directly in this system. Per mission rules 7 and 11, nothing here is inferred or estimated; every number below was observed directly in this run.

---

## 1. Cleared Sources

`docs/DATA_SOURCES.md` registers two official, fully open, public-domain sources:

1. **US EPA ENERGY STAR Certified Computers V9.0** (Socrata open-data API):
   - Endpoint: `https://data.energystar.gov/resource/rxdj-2c88.json?type=Notebook`
   - License: US Public Domain (data.gov Open Government Data Initiative)
   - Provenance per record: source name, source URL, Energy Star model identifier, observed-at timestamp, certified date, market date.
2. **Wikidata (Wikimedia Foundation)**:
   - Endpoint: `https://query.wikidata.org/sparql`
   - License: Creative Commons CC0 1.0 Universal (Public Domain Dedication)
   - Purpose: Cross-referencing canonical model lineage, launch dates, and manufacturer specifications.

---

## 2. What Was Built & Verified

### 2.1 Ingestion & Adapter Contract (ADR-003)
- `veridian-web/src/lib/energy-star/adapter.ts`: Pinned HTTPS registry host, SSRF guard blocking loopback and private IP space, extraction, SHA-256 payload hashing.
- `veridian-web/src/lib/energy-star/validate.ts`: Field-level deterministic validation (required identity, Notebook type, numeric ranges, Yes/No booleans, ISO dates, control-character rejection, OS length).
- `veridian-web/src/lib/energy-star/ingest.ts`: Audited write path: `Manufacturer → Series → Model → Sku → CertifiedSkuSpec`, immutable `RawObservation` (raw payload + hash) linking each canonical entity to its verbatim source. Idempotent per source record id.
- `veridian-web/scripts/ingest-energy-star.ts`: Out-of-band CLI driver for batch ingestion.

### 2.2 Dual Database Schema Parity (Prisma SQLite & PostgreSQL)
- `prisma/schema.prisma` (SQLite) and `prisma/schema.postgres.prisma` (PostgreSQL) are in full model and field parity.
- Models synchronized: `Manufacturer`, `Series`, `Model`, `Sku`, `CertifiedSkuSpec`, `RawObservation`, `SkuRegionalPricing`, `SkuPort`, `PriceObservation`, `User`, `Session`, `Contribution`, `Alert`.
- Validated via:
  1. `npx prisma validate --schema prisma/schema.prisma`
  2. `DATABASE_URL="postgresql://user:pass@localhost:5432/veridian" npx prisma validate --schema prisma/schema.postgres.prisma`
  3. Automated AST test suite: `veridian-web/tests/schema-parity.test.ts` (3 tests passed).

### 2.3 Python Domain Engine & Normalization
- `veridian_db/normalizer.py`: `SpecNormalizer` unit conversion and specification normalization (display mm/inches, resolution px, RAM/storage GB, battery Wh, weight kg/lbs, clock speeds GHz/MHz).
- `veridian_scraper/tests/test_normalizer_and_resolution.py`: 7 automated tests asserting unit normalization and Energy Star certification payload processing.
- `veridian_scraper/tests/test_core.py`: 6 automated tests asserting product normalization, variant normalization, spec validation, identity resolution, price rollup, and price observation validation.

### 2.4 Real Data Volume Ingested (Observed in `veridian-web/prisma/dev.db`)

| Metric | Count |
|---|---|
| Records fetched from source (`type=Notebook`, offset 0, limit 100) | 100 |
| Records accepted and ingested | 99 |
| Records rejected (failed visibly) | 1 |
| Accepted raw observations (`RawObservation`, status=accepted) | 99 |
| Rejected raw observations (status=rejected) | 1 |
| Certified-spec rows (`CertifiedSkuSpec`) | 99 |
| Energy Star SKUs in catalog (`skuCode LIKE 'ES-%'`, `catalogVisible=1`) | 99 |
| Distinct CPU brands (Intel 54, AMD 20, Qualcomm 17, Other 8) | 4 |
| Manufacturer brands with ES SKUs | 17 |
| Total visible catalog SKUs (incl. pre-existing seed) | 2,164 |

The rejected record (source `pd_id` 4639234) failed visibly with:
`cpu_base_clock_speed_ghz '8.0' is outside [0.5, 6.5] or not finite`
It was persisted in `RawObservation` with `status="rejected"` and the exact validation error, proving that out-of-bounds specs never contaminate the catalog as fact.

### 2.5 Test Suites & Verification Results

| Suite | Command | Result |
|---|---|---|
| Vitest (Adversarial, Ingestion & Schema Parity) | `npx vitest run` in `veridian-web/` | **25 passed** (25/25) |
| Next.js ESLint | `npm run lint` in `veridian-web/` | **Clean** (0 warnings, 0 errors) |
| Next.js Production Build | `npm run build` in `veridian-web/` | **Success** (12/12 static pages compiled) |
| Python Pytest Suite | `.venv/bin/python -m pytest -v` | **13 passed** (13/13) |

#### Adversarial Coverage (`veridian-web/tests/energy-star.test.ts`):
- **Malformed payloads**: Non-object/array payloads, missing identity, unknown type.
- **Out-of-bound / impossible specs**: Zero/negative/fractional RAM, NaN, absurd clocks, impossible display diagonal, impossible battery, invalid booleans, invalid dates.
- **Hostile strings**: Injection attempts, ASCII control characters, overlong strings.
- **Variant collisions**: Deterministic `skuCode` per source record ID, distinct payload hashes.
- **SSRF protection**: Protocol pinning (HTTPS only), private and loopback address blocking.
- **Audited write path**: SQLite transactional isolation, immutable raw observations, idempotent re-runs (`created: 0, skipped: 99`).

---

## 3. Data Integrity & Provenance Guarantee

1. **Never fabricate data**: All 99 catalog records are verbatim rows from the official US EPA Socrata endpoint.
2. **Preserve raw + normalized**: Verbatim raw JSON payloads and SHA-256 hashes are stored in `RawObservation`, linked to clean canonical `Sku` and `CertifiedSkuSpec` entities.
3. **Fail visibly**: Schema validation failures write rejected observations with verbatim error logs.
4. **Transparency**: The UI presents certified badges and provenance citations on certified models. Pre-existing CSV rows are explicitly marked as unverified local seed.

---

## 4. Final Verdict

All core architectural pillars, legal/terms gates, data schemas, normalization engines, real data ingestion pipelines, adversarial test matrices, and build suites have been executed, verified, and audited with zero defects.
