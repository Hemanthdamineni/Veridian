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
| E2 Next.js build/lint | DONE | `npm run lint` clean; `npm run build` succeeds (16/16 static routes) |
| E3 Adversarial/negative & parity tests | DONE | `veridian-web/tests/energy-star.test.ts` + `tests/schema-parity.test.ts` — 25 vitest tests pass |

## Phase F — Final audit, docs, verification report

| Task | State | Notes |
|------|-------|-------|
| F1 Security/provenance remediation | DONE | Constant-time admin auth; unauthenticated write endpoints 503-gated; synthetic seed disclosed; SSRF protection |
| F2 Final audit | DONE | See `mission-current-state.md` + `VERIFICATION_REPORT.md` |
| F3 Comprehensive verification report | DONE | `docs/mission/VERIFICATION_REPORT.md` |

## Phase G — Trust, correctness and usability remediation (2026-10-21)

A defect inventory was compiled against the running system and every finding was
either fixed or explicitly recorded as a known gap. The organising principle was
**disclosure over silence**: nothing may imply a fact the data does not support.

| Task | State | Notes |
|------|-------|-------|
| G1 Region semantics — stop hiding unpriced rows | DONE | `buildSkusQuery` no longer requires a regional price row for the region to match; only an explicit price bound does. All 99 certified SKUs are now reachable in browse and search. |
| G2 Server/client region mismatch | DONE | `page.tsx` resolves the region once (`params.region \|\| "US"`) and uses it for the query, the pricing include and the serializer. The homepage previously rendered INR prices on first paint, then swapped to USD. |
| G3 Price sort put priceless rows first | DONE | Shared `sortSkusByPrice` keeps rows with no price for the region last in both directions. Previously `price_desc` led with 99 priceless rows. |
| G4 Fabricated homepage statistics | DONE | "5 regions covered" and "24 spec fields per listing" replaced by counts computed from the database (2,164 / 99 / 18 / 2). |
| G5 Methodology page misstated provenance | DONE | Rewritten to disclose the two tiers and to state that the reference tier is seed-derived, not scraped from manufacturer pages. |
| G6 Provenance tier is visible and filterable | DONE | Every card and detail page is labelled `Certified` or `Reference`; a Source filter and a result-set tier breakdown were added. |
| G7 Price filters were absent from the UI | DONE | MSRP min/max inputs, clearly caveated as seed reference values; `price_asc`/`price_desc` added to the sort control. |
| G8 Dead regions offered with no data | DONE | Region controls are populated from the regions that actually hold prices (US, IN) instead of a hard-coded list of five. |
| G9 Admin login gave no signal when unconfigured | DONE | The login page is now a server component that reports plainly when `ADMIN_TOKEN` is unset. |
| G10 Vitest failure — ingestion suite timed out | DONE | `vitest.config.ts` sets a 30s timeout; the suite provisions a throwaway SQLite file via the Prisma CLI, which exceeded the 5s default. |
| G11 Unused import lint warning | DONE | `formatPrice` was imported but unused in `CompareClient.tsx`; it now renders the actual regional price in the comparison header. |
| G12 Orphan dead route at the repo root | DONE | `src/app/api/admin/quality-summary/route.ts` referenced a non-existent `prisma.product` model and a non-existent `@/lib/prisma` module, and was never compiled. Deleted. |
| G13 No continuous integration | DONE | `.github/workflows/ci.yml` runs lint → types → vitest → build → pytest on every push and pull request. |
| G14 Python `datetime.utcnow()` deprecation | DONE | Replaced with a shared `veridian_db.clock.utcnow()` that preserves naive-UTC semantics for the naive `DateTime` columns. 4 warnings → 0. |
| G15 Documentation drifted from the code | DONE | `TODO.md`, `ROADMAP.md` and this graph were rewritten against the verified implementation, including the gaps that remain. |
| G16 Regression tests for the new rules | DONE | `veridian-web/tests/catalog-filters.test.ts` — 17 tests covering region semantics, price bounds, the provenance tier, price ordering and URL state. |
| G17 Link prefetch storm removed from catalog cards | DONE | Every filter change fired 24 background RSC renders — one per visible card, each a full SKU detail page render. `prefetch={false}` on the card link removed them. |
| G18 Catalog URL sync no longer re-renders the server page | DONE | `router.replace` awaited an RSC round trip that duplicated the client's own `/api/skus` fetch and delayed the URL update past a second. Replaced with the native History API, which the Next.js router integrates with without a server round trip. |

---

## Verification Summary

1. **Dual Cleared Sources**: US EPA ENERGY STAR Certified Computers V9.0 (Socrata REST API, US Public Domain) and Wikidata (CC0 1.0 Universal).
2. **Real Data Ingested**: 99 authentic certified notebook configurations with verbatim SHA-256 raw observations, citations, certified dates, and market availability.
3. **Database Parity**: Full parity between SQLite (`schema.prisma`) and PostgreSQL (`schema.postgres.prisma`), validated via automated AST tests.
4. **Test Matrix**:
   - Vitest: 56/56 passed (adversarial, negative payloads, SSRF prevention, schema parity, catalog filters, price ordering)
   - Pytest: 13/13 passed (specification normalization, unit conversion, price rollup validation)
   - Next.js: `npm run lint` clean (0 errors, 0 warnings), `npm run build` 16/16 routes, `npx tsc --noEmit` clean
   - Runtime QA: no console errors, no horizontal overflow at 375 / 768 / 1440 px
5. **CI**: `.github/workflows/ci.yml` gates every push and pull request on all of the above.
