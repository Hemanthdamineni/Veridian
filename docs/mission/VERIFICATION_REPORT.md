# Veridian Mission — Comprehensive Verification Report

**Date:** 2026-10-01
**Scope:** Real-data ingestion from a cleared source through the ADR-003
adapter contract, audited provenance write path, adversarial test suite, and
full build/test verification.

This report is the closing artifact of Phase 2. It reports **exact** counts and
**verified** outcomes only. Per mission rules 7 and 11, nothing here is
inferred or estimated; every number below was observed directly in this run.

---

## 1. Cleared source

`docs/DATA_SOURCES.md` now registers **US EPA ENERGY STAR Certified Computers
V9.0** (Socrata open-data API) as **CLEARED** (2026-09-30):

- Endpoint: `https://data.energystar.gov/resource/rxdj-2c88.json?type=Notebook`
- License: US Public Domain (data.gov Open Government Data Initiative)
- Provenance per record: source name, source URL, Energy Star model
  identifier, observed-at timestamp, certified date, market date.

---

## 2. What was verified

### 2.1 Adapter contract (ADR-003)

- `veridian-web/src/lib/energy-star/adapter.ts` — `fetch` (pinned HTTPS
  registry host, `assertSsrf` blocks loopback/private hosts), `extract`,
  `run`; SHA-256 hash of every raw payload.
- `veridian-web/src/lib/energy-star/validate.ts` — field-level deterministic
  validation (required identity, Notebook type, numeric ranges, Yes/No
  booleans, ISO dates, control-character rejection, OS length).
- `veridian-web/src/lib/energy-star/ingest.ts` — audited write path:
  `Manufacturer → Series → Model → Sku → CertifiedSkuSpec`, immutable
  `RawObservation` (raw payload + hash) linking each canonical entity to its
  verbatim source. Idempotent per source record id, including rejected rows.
- `veridian-web/scripts/ingest-energy-star.ts` — out-of-band CLI driver.

### 2.2 Schema (Prisma, SQLite)

- Added nullable measured/source fields on `Sku`, `catalogVisible` gating, and
  two new models: `CertifiedSkuSpec` (certified specs + provenance) and
  `RawObservation` (immutable raw payload, hash, status, errors).
- `prisma/schema.sqlite.prisma` kept in sync.

### 2.3 Real data volume (observed in `veridian-web/prisma/dev.db`)

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
| Total visible catalog SKUs (incl. pre-existing seed) | 2164 |

The rejected record (source `pd_id` 4639234) was written as a rejected
observation with the exact validation error:
`cpu_base_clock_speed_ghz '8.0' is outside [0.5, 6.5] or not finite` — a real
out-of-bounds spec that failed visibly instead of being inserted as a fact.

### 2.4 Test suites (exact results)

| Suite | Command | Result |
|---|---|---|
| Adversarial/integration (vitest) | `npx vitest run` in `veridian-web/` | **22 passed** (22/22) |
| Next.js lint | `npm run lint` in `veridian-web/` | **clean** (no reported issues) |
| Next.js build | `npm run build` in `veridian-web/` | **success** (12/12 static pages; type-check clean) |
| Python (existing) | `.venv/bin/python -m pytest -q` | **6 passed** (6/6; 4 pre-existing `utcnow()` deprecation warnings) |

The vitest suite (`veridian-web/tests/energy-star.test.ts`) covers:

- **Malformed payloads**: non-object/array payloads, missing identity, unknown
  type.
- **Out-of-bound / impossible specs**: zero/negative/fractional RAM, NaN,
  absurd clocks, impossible display diagonal, impossible battery, invalid
  Yes/No, invalid dates.
- **Injection / hostile characters**: control characters, overlong OS.
- **Variant collisions / extraction**: deterministic skuCode per source record
  id, deterministic distinct payload hashes.
- **SSRF / hostile network targets**: HTTPS enforcement, loopback/private-host
  blocking, core request pinned to the registered public host.
- **Audited write path (integration, temp SQLite DB)**: canonical entities +
  raw observations persisted; rejected records never become catalog facts;
  idempotent re-ingestion for accepted **and** rejected rows.

### 2.5 Data integrity invariants

- **Never fabricate data** — all 99 catalog records are verbatim rows from the
  official Socrata endpoint; no guesses, no synthesized variants.
- **Preserve raw + normalized** — every record stores its verbatim payload and
  SHA-256 hash in `RawObservation`, alongside clean `CertifiedSkuSpec`/
  `Sku` fields.
- **Fail visibly** — the 1 out-of-bounds record is a rejected observation with
  its exact error string, not a partial insert.
- **Idempotent writes** — re-running the CLI produced `created: 0`,
  `skipped: 99`, `rejectedStored: 0`; observation rows did not grow.

---

## 3. Files changed (Phase 2)

### New

- `veridian-web/src/lib/energy-star/{types,validate,adapter,ingest}.ts`
- `veridian-web/scripts/ingest-energy-star.ts`
- `veridian-web/tests/energy-star.test.ts`
- `veridian-web/vitest.config.ts`
- `docs/DATA_SOURCES.md` (source register)
- `docs/adr/ADR-003-ingestion-adapter-contract.md`
- `docs/adr/ADR-005-price-tracking-provenance.md`
- `docs/mission/TASK_GRAPH.md`, `docs/mission/task_graph.json`
- `docs/mission/VERIFICATION_REPORT.md` (this file)

### Modified (web catalog + nullable source fields + provenance UI)

- `veridian-web/prisma/schema.prisma`, `prisma/schema.sqlite.prisma`
- `veridian-web/src/lib/api.ts`, `src/lib/ai.ts`, `src/types/index.ts`
- `veridian-web/src/app/api/recommendations/route.ts`,
  `src/app/api/v1/compare/route.ts`, `src/app/api/skus/[id]/route.ts`,
  `src/app/api/skus/[id]/price-history/route.ts`,
  `src/app/api/admin/skus/route.ts`
- `veridian-web/src/app/skus/[id]/page.tsx`, `src/app/admin/page.tsx`,
  `src/app/page.tsx`, `src/app/layout.tsx`
- `veridian-web/src/components/SkuCard.tsx`,
  `src/components/admin/SkuList.tsx`, `src/components/LiveCatalogRefresh.tsx`
- `veridian-web/src/app/api/{alerts,contributions,refresh}/route.ts`,
  `src/middleware.ts` (security/provenance remediation)

---

## 4. Final audit

**Completed:**

- Source register gate opened with one cleared source.
- End-to-end real-data path from a public open-data API into the web catalog
  with first-class provenance.
- Adversarial + integration suite green.
- Next.js build, lint, and the existing Python suite green.

**Outstanding (mission remains OPEN, not falsely complete):**

- `prisma/schema.postgres.prisma` is not validated against a live Postgres
  instance (task C2).
- Python-domain normalization/entity resolution are prototypes not wired
  through a verified ingestion contract (D1/D2).
- Retail price sourcing still requires a source-specific legal/terms gate
  (register policy); `PriceObservation` rows remain synthetic seed only.

**Data integrity note:** the 2,164 visible SKUs include the pre-existing
43-row CSV seed expanded into synthetic variants. Only the 99 `ES-%` SKUs are
source-verified, and the app distinguishes them via `CertifiedSkuSpec`
provenance. The seed remains disclosed as unverified local data.
