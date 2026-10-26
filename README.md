# Veridian

> A trusted decision platform for laptops — not just specs, but verified, connected, decision-ready data.

Veridian is an open-source project building a structured, source-tracked catalog of laptop configurations. The goal is a single place where you can filter on the details that decide a purchase — processor, memory, display, weight, battery — and see, for every row, exactly where the figures came from and how much they can be trusted.

## The North Star

> **A trusted decision platform for laptops — not just specs, but verified, connected, decision-ready data.**

Three things follow from that, and they shape the whole codebase:

1. **Provenance is a field, not a footnote.** Every configuration carries an explicit tier — `certified`, `manufacturer` or `unverified` — written by the ingestion path, plus a row per source with the URL you can check it against.
2. **Nothing is invented.** A missing value is shown as missing. A configuration that cannot be verified is labelled unverified rather than quietly presented as fact. The catalog is deliberately smaller than a fabricated one would be.
3. **Shared components are first-class.** Configurations are broken down into the processors, display classes and storage technologies they are built around, so you can follow a part across the catalog instead of reading every specification sheet.

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend & API** | Next.js 14 (App Router) |
| **Language** | TypeScript |
| **Database** | PostgreSQL 16 (hosted on Neon) · SQLite for local development |
| **ORM** | Prisma |
| **Styling** | Tailwind CSS v4 |
| **Tests** | Vitest (web) · pytest (domain engine) |
| **Deployment** | Vercel |

## Where the data comes from

| Tier | Configurations | Source | Prices |
|------|---------------:|--------|--------|
| **Certified** | 1,125 | US EPA ENERGY STAR Certified Computers V9.0 — cited record, certification date, SHA-256 of the verbatim payload | none — the source publishes no price |
| **Manufacturer** | 2 | Checked against the manufacturer's own technical specification page, which is cited | reference MSRP |
| **Unverified** | 41 | Our own reference dataset. Not independently checked. Labelled as such on every surface | reference MSRP |

Everything is disclosed in the UI: each card, each product page, the filter panel and the methodology page state which tier a row belongs to.

Retailer price feeds are gated by credentials and terms, not implemented
against them; the operator-facing registry is [docs/PRICE_FEEDS.md](./docs/PRICE_FEEDS.md).

## Project Structure

- `/veridian-web`: The Next.js application (UI + API routes) and the data tooling.
- `/veridian_scraper`: The manufacturer scraper fleet, its health reporting and its domain engine.
- `/veridian_db`: The Python domain model (normalization, identity resolution).
- `/docs`: Technical specifications, research, ADRs and engineering architecture.
- `Veridian-spec.md`: The full system specification.

## Getting Started

### Prerequisites
- Node.js 18+
- Python 3.11+ (for the scraper fleet and the domain engine)
- PostgreSQL 16 (Neon is recommended) or SQLite for local work

### The web application

```bash
cd veridian-web
npm install
cp .env.example .env          # DATABASE_URL="file:./dev.db" for local work
npx prisma generate
npx prisma db push
```

### Loading the catalog

The catalog is built from cited sources, so it is loaded rather than invented:

```bash
npm run db:ingest:es          # ingest the ENERGY STAR certification dataset
npm run db:seed               # load the reference dataset
npm run db:components         # build the component knowledge graph
npm run db:audit              # measure the catalog
npm run db:assert             # assert the catalog is really populated
```

`npm run db:audit` is the one to read. It measures duplicate part numbers, impossible values, missing provenance, price plausibility per currency and orphan rows, and exits non-zero on an error-severity finding. `npm run db:audit:repair` additionally removes empty structural rows.

### PostgreSQL

The PostgreSQL schema is generated from the SQLite schema, which is the single source of truth, so the two engines always expose the same models and fields.

```bash
cp .env.postgres.example .env.postgres
export DATABASE_URL="postgresql://veridian:veridian@localhost:5432/veridian"

npm run db:schema:pg         # regenerate prisma/schema.postgres.prisma
npx prisma generate --schema prisma/schema.postgres.prisma
npx prisma db push --schema prisma/schema.postgres.prisma
```

CI applies the schema to a live PostgreSQL server, ingests, populates the component graph, audits and asserts the result — a schema that only validates structurally cannot pass unnoticed.

### The scraper fleet

```bash
pip install -r requirements-dev.txt
python run_scrapers.py --tier all        # or --incremental
python run_scrapers.py --report          # per-manufacturer health report
```

The fleet respects `robots.txt`, identifies itself honestly, and records a health report per manufacturer. A source that cannot be reached is reported as blocked with the reason; it is never worked around.

## Data integrity rules

These are the rules the code enforces, not aspirations:

- **Raw observations are immutable.** Every source record is stored verbatim with a SHA-256 hash of its payload, whether it was accepted or rejected. A rejected record keeps its exact error.
- **Canonical entities are written through an audited path.** A configuration is keyed on the part number plus a signature of the specifications the source asserts, so re-certifications collapse onto one entry and genuinely different configurations stay apart.
- **Values are validated before they become facts.** Impossible values are rejected with a reason. Nothing is partially inserted.
- **Prices are append-only.** History is never rewritten. A price without a source is labelled as a reference value, not presented as a market quote.
- **Provenance is explicit.** `Sku.provenance` is written by the ingestion path, never inferred downstream.

## Contributing

We welcome contributions! Please read our [CONTRIBUTING.md](./CONTRIBUTING.md) to get started with our setup and coding standards.

## License

MIT
