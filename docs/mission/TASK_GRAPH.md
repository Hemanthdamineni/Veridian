# Veridian Mission Task Graph

**Status:** 2026-10-01 — Live state of the mission's phases and tasks. This graph is
the authoritative record of what is done, what is verified, and what is planned. It is
maintained alongside `docs/research/mission-current-state.md` and `docs/mission/VERIFICATION_REPORT.md`.

Machine-readable copy: `docs/mission/task_graph.json`

---

## Phase A — Repository exploration & research consolidation

| Task | State | Notes |
|------|-------|-------|
| A1 Explore repository layout | DONE | See `docs/repo-analysis.md` |
| A2 Consolidate research under `docs/research/` | DONE | `docs/research/mission-current-state.md` |
| A3 Record engineering analysis | DONE | `docs/engineering/schema.md`, `docs/engineering/architecture.md` |

## Phase B — Architecture decisions, source register & task graph

| Task | State | Notes |
|------|-------|-------|
| B1 ADR-001 system architecture / tech stack | DONE | `docs/adr/ADR-001-system-architecture.md` |
| B2 ADR-002 domain model / entity resolution | DONE | `docs/adr/ADR-002-domain-model-entity-resolution.md` |
| B3 ADR-003 ingestion / adapter contract | DONE | `docs/adr/ADR-003-ingestion-adapter-contract.md` |
| B4 ADR-004 normalization spec hierarchy | DONE | `docs/adr/ADR-004-normalization-specification-hierarchy.md` |
| B5 ADR-005 price tracking / provenance | DONE | `docs/adr/ADR-005-price-tracking-provenance.md` |
| B6 Source register gate | DONE | `docs/DATA_SOURCES.md` — US EPA ENERGY STAR V9.0 & Wikidata cleared |
| B7 Task graph | DONE | This file + `task_graph.json` |

## Phase C — Domain model & schema

| Task | State | Notes |
|------|-------|-------|
| C1 Prisma domain model | DONE | `veridian-web/prisma/schema.prisma` |
| C2 PostgreSQL schema parity | DONE | `prisma/schema.postgres.prisma` synchronized with `schema.prisma` (CertifiedSkuSpec, RawObservation, provenance); validated via `prisma validate` and automated Vitest parity suite (`tests/schema-parity.test.ts`) |
| C3 SQLAlchemy knowledge graph | EXISTING | `veridian_db/` (separate knowledge graph and normalizer engine) |

## Phase D — Core engine, backend, frontend, real-data ingestion

| Task | State | Notes |
|------|-------|-------|
| D1 Normalization engine | DONE | `veridian_db/normalizer.py` + `SpecNormalizer`; unit conversion and spec normalization verified by 13 pytest tests |
| D2 Entity resolution | DONE | SKU resolution + duplicate detection tested in `test_core.py` and `test_normalizer_and_resolution.py` |
| D3 Price tracking & provenance | DONE | `PriceObservation` + `RawObservation` with SHA-256 hashes and timestamped observations |
| D4 Search / filter / comparison backend | DONE | `src/lib/api.ts`, `/api/skus`, comparison APIs |
| D5 Frontend catalog + SKU detail | DONE | Pages render; verified real Energy Star SKUs prominently displayed with citation badges |
| D6 Real-data ingestion + validation | DONE | `EnergyStarAdapter` (ADR-003) + audited write path; 100 notebook records fetched, 99 accepted, 1 visibly rejected, 99 certified-spec rows, 99 visible ES SKUs |

## Phase E — Rigorous testing

| Task | State | Notes |
|------|-------|-------|
| E1 Python test suite | DONE | `.venv/bin/python -m pytest -v` → 13 passed (100%) |
| E2 Next.js build/lint | DONE | `npm run lint` clean; `npm run build` succeeds (12/12 static pages) |
| E3 Adversarial/negative & parity tests | DONE | `veridian-web/tests/energy-star.test.ts` + `tests/schema-parity.test.ts` — 25 vitest tests pass |

## Phase F — Final audit, docs, verification report

| Task | State | Notes |
|------|-------|-------|
| F1 Security/provenance remediation | DONE | Constant-time admin auth; unauthenticated write endpoints 503-gated; synthetic seed disclosed; SSRF protection |
| F2 Final audit | DONE | See `mission-current-state.md` + `VERIFICATION_REPORT.md` |
| F3 Comprehensive verification report | DONE | `docs/mission/VERIFICATION_REPORT.md` |

---

## Verification Summary

1. **Dual Cleared Sources**: US EPA ENERGY STAR Certified Computers V9.0 (Socrata REST API, US Public Domain) and Wikidata (CC0 1.0 Universal).
2. **Real Data Ingested**: 99 authentic certified notebook configurations with verbatim SHA-256 raw observations, citations, certified dates, and market availability.
3. **Database Parity**: Full parity between SQLite (`schema.prisma`) and PostgreSQL (`schema.postgres.prisma`), validated via automated AST tests.
4. **Test Matrix**:
   - Vitest: 25/25 passed (adversarial, negative payloads, SSRF prevention, schema parity)
   - Pytest: 13/13 passed (specification normalization, unit conversion, price rollup validation)
   - Next.js: `npm run lint` clean, `npm run build` 12/12 static routes compiled
