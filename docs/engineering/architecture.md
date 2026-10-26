# Veridian Architecture

**Status:** Describes the system as it is, not as it is planned.
**Last verified against the code:** 2026-10-21.

Where this document disagrees with the code, the code is right and this
document is out of date. Every number below can be reproduced with the
commands in the "Verifying this document" section.

---

## 1. What the system is

A single Next.js application that serves a source-tracked catalog of laptop
configurations, together with a Python scraper fleet that reads
manufacturer pages and writes into that catalog.

There is no microservice boundary, no message queue, no separate search
index, and no model API in the request path. Those were considered and
rejected; §8 says why.

The design is driven by one property: **every figure in the catalog must be
traceable to a source that a reader can check.** That single constraint
determines the schema, the ingestion path, the API shape and the UI.

---

## 2. The stack, as it actually is

| Layer | Technology | Notes |
|---|---|---|
| Application | Next.js 14 (App Router), React server components | 43 routes |
| Language | TypeScript, strict mode | `npm run typecheck` is clean |
| Styling | Tailwind CSS v4 with a token set in `src/app/globals.css` | No component library |
| Database | SQLite for local work, PostgreSQL 16 for production | One schema, two projections — §4 |
| ORM | Prisma | `prisma/schema.prisma` is the single source of truth |
| Tests | Vitest (web), pytest (Python) | 520 web tests, 216 Python tests |
| CI | GitHub Actions | Three jobs: web, Python, live PostgreSQL — §6 |
| Scraper fleet | Python, `httpx` + BeautifulSoup | `veridian_scraper/`, 13 manufacturers |
| Domain engine | Python, SQLAlchemy models | `veridian_db/`, §7 |

There is no tRPC, no Meilisearch, no Redis, no BullMQ, no Playwright, no LLM
provider in the request path, and no Resend/Telegram integration wired into
the web application. An earlier revision of this document listed all of
those. They did not exist.

---

## 3. Module boundaries

```
veridian-web/
  prisma/schema.prisma          the source of truth for all 25 models
  prisma/schema.postgres.prisma GENERATED from the above — never edited by hand
  src/lib/
    db.ts                       the Prisma client
    api.ts                      the shared catalog query builder and formatters
    ai.ts                       the natural-language parser and the scorer
    api-key.ts                  key issuance, hashing, the durable rate limit
    admin-keys.ts               the admin API-key workspace (key views, scopes, windows)
    public-api.ts               the queries behind /api/v1
    openapi.ts                  the hand-written OpenAPI 3.1 description
    catalog.ts                  filter state and URL serialisation
    contracts.ts                the catalog's trust contract as executable checks
    data-quality.ts             the data-quality audit shared by CLI and dashboard
    alerts.ts                   price-alert evaluation
    notifications.ts            notification dispatch (email/telegram/discord/push)
    contributions.ts            the community correction workflow
    compare.ts                  side-by-side comparison logic
    lifecycle.ts                product lineage derivation
    audit/                      the extended data-quality checks
    prices/source.ts            the PriceSource contract
    prices/stats.ts             windowed price statistics
    energy-star/                the certification ingestion path
    verify/                     manufacturer specification verification
    wikidata/                   the Wikidata (CC0) ingestion path
    icecat/                     the Icecat open-product-data connection
  src/app/                      pages and route handlers
  scripts/                      the data tooling, one script per job
  tests/                        Vitest
```

`src/app/api/**` are the browser-facing endpoints. `src/app/api/v1/**` are
the public developer API, which requires an API key. The two are separate on
purpose: the browser API serves the application, the v1 API serves
developers who have not accepted the site's terms of use.

---

## 4. One schema, two engines

`prisma/schema.prisma` (SQLite) is the source of truth. `scripts/generate-postgres-schema.mjs`
generates `prisma/schema.postgres.prisma` from it, and `npm run
db:schema:pg-check` fails CI when the generated file is stale.

This exists because the two schema files were once maintained by hand and
drifted apart: six models existed in only one of them, and the parity test
compared one direction, so it could not have noticed. A generated file cannot
drift.

Both engines run the full pipeline and produce identical numbers. CI applies
the PostgreSQL schema to a live server, ingests, populates the component
graph, audits the result and exercises the public API against it — so a
schema that only validates structurally cannot pass unnoticed.

### The entity graph

```
Manufacturer ──< Series ──< Model ──< Sku ──< SkuSource
                                        ├──< CertifiedSkuSpec
                                        ├──< RawObservation        (immutable)
                                        ├──< PriceObservation      (append-only)
                                        ├──< SkuRegionalPricing    (current snapshot)
                                        ├──< SkuComponent >── Component ──< ComponentAlias
                                        ├──< ComponentSpec                  └──< ComponentSpec
                                        ├──< RetailerListing >── Seller
                                        └──< Alert, Contribution
```

`Sku.provenance` is a written field, never an inference (ADR-005). It takes
one of `certified`, `manufacturer` or `unverified`, and the ingestion path is
the only thing that sets it.

---

## 5. The ingestion path

There is exactly one audited write path, and every source goes through it.

```
fetch ──> validate field by field ──> store the raw payload + SHA-256 hash
                                        │
                    ┌───────────────────┴───────────────────┐
                    │ accepted                              │ rejected
                    v                                       v
        Manufacturer > Series > Model > Sku              RawObservation
                    > CertifiedSkuSpec                     with the exact
                    > SkuSource (provenance + source URL)   reason
```

A rejected record is **kept**, with its verbatim reason. Nothing is dropped
silently, so a bad figure can never quietly become a catalog fact, and the
rejection is itself auditable.

Three things make a configuration's identity stable:

1. **Canonical SKU code** — the part number plus a hash of a signature of the
   specifications the source asserts. Re-certifications of one machine
   collapse onto one row; genuinely different configurations stay apart.
2. **Series derivation** — derived from the name the source reported, with
   the source's wildcard legends (`* can be 0-9`) and enumeration prefixes
   excluded, and marketing names preferred over internal chassis codes where
   the source provides one.
3. **Provenance** — an explicit tier and one `SkuSource` row per source,
   each with the URL it can be checked against.

### Adapters

| Adapter | Source | Tier written |
|---|---|---|
| `src/lib/energy-star/` | US EPA ENERGY STAR Certified Computers V9.0 (Socrata open data) | `certified` |
| `src/lib/verify/` | A manufacturer's own specification page | `manufacturer` |
| `scripts/seed.ts` | The internal reference dataset | `unverified` unless verified |
| `src/lib/wikidata/` | Wikidata (CC0) | `manufacturer` |

### Prices

Prices are append-only and carry their evidence class (`retail`,
`manufacturer`, `review`) in `PriceObservation.kind`. A manufacturer's family
list price is recorded on the family, never on a configuration — ADR-007
explains why, and the reasoning matters: a "starting at" price is not a
configuration's price.

---

## 6. Request paths

### Browser API (`/api/**`)

Unauthenticated, read-only, and shaped for the application. The natural
language search at `/api/search` returns the filters it derived alongside the
results, so the reader can check the interpretation.

### Public developer API (`/api/v1/**`)

Requires an API key. Keys are stored only as SHA-256 hashes and shown once.
Each key has an hourly budget counted in the database, so instances share it
and a restart does not reset it (ADR-006). Exceeding it returns `429` with
`Retry-After`.

`GET /api/v1` and `GET /api/v1/openapi` are public: a developer has to be
able to read the contract before they have a key.

### Admin (`/admin/**`, `/api/admin/**`)

A single shared bearer token, compared in constant time, or a session cookie.
`POST /api/refresh` runs the audited ingestion path under the same
authentication.

---

## 7. The Python side

`veridian_scraper/` is the manufacturer scraper fleet: 13 scrapers, one YAML
config each, a shared `HTTPClient`, and a per-manufacturer health report.
The fleet enforces `robots.txt` before every request and refuses a
disallowed path rather than fetching it. A source that cannot be reached is
reported as blocked, with the reason.

`veridian_db/` is a richer SQLAlchemy knowledge graph — components and their
relationships, product relationships, benchmarks, reviews, community reports,
knowledge entries, an audit log, pending entities. It holds more than the
Prisma schema does, and is the intended home for the parts of the domain
that the live application does not use yet. The three models it shares with
Prisma (`Seller`, `PriceListing`, `PriceHistory`) are the known duplication;
the boundary is documented but not yet collapsed.

---

## 8. What is deliberately not there

**A separate search engine.** Postgres filtering is sufficient below roughly
5,000 configurations. The catalog is at 1,165. Meilisearch would add a second
store to keep in sync with the first, for a speedup nobody can currently
perceive. The decision is reviewed when the catalog passes the threshold.

**An LLM in the request path.** The natural-language parser is
deterministic, rule-based and free. It can be wrong, and when it is it says
so: it returns the filters it applied, the words it could not interpret and
the assumptions it made. A model call would be less predictable, would cost
money per request, and would make the "how was my question read" explanation
harder rather than easier.

**A message queue.** Ingestion runs as a job, out of band. There is one
writer and one database; a queue would add a component that has to be
operated, for a workload that is measured in minutes per day.

**Microservices.** The application and its data tooling share one schema, one
Prisma client and one type system. Splitting them would mean either a
network hop or a duplicated schema — which is exactly the defect that the
hand-maintained PostgreSQL schema was.

**A separate authentication service.** The API key model is a hash and a
rate-limit counter. It is a table, and it stays a table.

---

## 9. Deployment and CI

| Target | Configuration |
|---|---|
| Hosting | Vercel (the Next.js application) |
| Database | PostgreSQL 16 (Neon in production, a local server in development) |
| Workers | The scraper fleet, run out of band |

Three CI jobs run on every push and pull request:

1. **web** — lint, typecheck, tests, production build, and the schema-drift
   check.
2. **python** — the scraper fleet's test suite.
3. **postgres** — a live PostgreSQL service: apply the schema, ingest, load
   the reference dataset, populate the component graph, audit the result,
   exercise the public API end to end, and assert the catalog is really
   populated.

The third job is the one that matters most. A schema that validates is not a
catalog that works, and only running the pipeline against a real server
proves the two agree.

---

## 10. Verifying this document

```bash
cd veridian-web
npm run db:audit          # the catalog's own measurements
npm run db:assert         # asserts the catalog is populated
npm run db:api:smoke      # exercises the public API end to end
npm run db:schema:pg-check
npm run build             # the route list
```

```bash
.venv/bin/python -m pytest -q
```

Every number quoted in the README, the roadmap and this document comes from
`npm run db:audit`.
