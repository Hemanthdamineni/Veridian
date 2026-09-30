# Veridian Mission Task Graph

**Status:** 2026-10-01 — Live state of the mission's phases and tasks. This graph is
the authoritative record of what is done, what is blocked, and what remains. It is
maintained alongside `docs/research/mission-current-state.md`, which carries the
honest current-state audit of the repository.

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
| B6 Source register gate | DONE | `docs/DATA_SOURCES.md` — US EPA ENERGY STAR V9.0 cleared 2026-09-30 |
| B7 Task graph | DONE | This file + `task_graph.json` |

## Phase C — Domain model & schema

| Task | State | Notes |
|------|-------|-------|
| C1 Prisma domain model | DONE | `veridian-web/prisma/schema.prisma` |
| C2 PostgreSQL schema variant | BLOCKED | `prisma/schema.postgres.prisma` exists but not validated against a live Postgres |
| C3 SQLAlchemy knowledge graph | EXISTING | `veridian_db/` (separate from web Prisma DB) |

## Phase D — Core engine, backend, frontend, real-data ingestion

| Task | State | Notes |
|------|-------|-------|
| D1 Normalization engine | PARTIAL | Python prototypes in `veridian_scraper/`; not wired to web DB |
| D2 Entity resolution | PARTIAL | Prototype only |
| D3 Price tracking | PARTIAL | `PriceObservation` model + history API exist; only synthetic seed rows |
| D4 Search / filter / comparison backend | DONE | `src/lib/api.ts`, `/api/skus`, comparison APIs |
| D5 Frontend catalog + SKU detail | DONE | Pages render; synthetic seed disclosed |
| D6 Real-data ingestion + validation | DONE | `EnergyStarAdapter` (ADR-003) + audited write path; 100 notebook records fetched, 99 accepted, 1 visibly rejected, 99 certified-spec rows, 99 visible ES SKUs |

## Phase E — Rigorous testing

| Task | State | Notes |
|------|-------|-------|
| E1 Python test suite | DONE | `.venv/bin/python -m pytest -q` → 6 passed |
| E2 Next.js build/lint | DONE | `npm run lint` clean; `npm run build` succeeds |
| E3 Adversarial/negative tests (malformed payloads, impossible specs, fractional RAM, variant collision, hostile chars, SSRF, audited write path) | DONE | `veridian-web/tests/energy-star.test.ts` — 22 vitest tests pass, incl. 2 temp-DB integration tests |

## Phase F — Final audit, docs, verification report

| Task | State | Notes |
|------|-------|-------|
| F1 Security/provenance remediation | DONE | constant-time admin auth; unauthenticated write endpoints 503; synthetic seed disclosure |
| F2 Final audit | DONE | See `mission-current-state.md` + `VERIFICATION_REPORT.md` |
| F3 Comprehensive verification report | DONE | `docs/mission/VERIFICATION_REPORT.md` — 2026-10-01 |

---

## Blocking items (must resolve before the mission can be marked complete)

1. **PostgreSQL schema variant is unvalidated** against a live instance. The
   `prisma/schema.postgres.prisma` variant has no verified end-to-end test, so
   the cross-database claim cannot be honestly made.
2. **Normalization and entity resolution remain prototypes** in the Python
   domain (`veridian_db/`, `veridian_scraper/`), not wired through a verified
   ingestion contract into the web catalog.
3. **Only one source is cleared.** The register gate is open for US EPA ENERGY
   STAR V9.0 only; retail price sourcing still requires a source-specific legal
   gate per `docs/DATA_SOURCES.md`.

The core phase-2 objectives (cleared source, adapter contract, 99-100 real
notebook records with provenance, adversarial suite, verification report) are
complete. The mission stays **open** pending the items above.
