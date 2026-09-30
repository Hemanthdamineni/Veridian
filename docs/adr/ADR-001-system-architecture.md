# ADR-001: System Architecture and Technology Stack

- Status: Accepted
- Date: 2026-09-30

## Context

The repository currently contains a Next.js/TypeScript app using Prisma, with a SQLite development schema and PostgreSQL schema variants, plus a separate Python/SQLAlchemy domain and scraper prototype. The product MVP spec in `Veridian-spec.md` selects a single Next.js app and PostgreSQL. The mission requires ingestion and provenance beyond the MVP.

## Decision

Keep the Next.js App Router application as the public web/API deployment and Prisma/PostgreSQL as the canonical product store. Treat SQLite strictly as local development/test storage, not a separate source of truth. Keep Python collection and normalization workers isolated behind versioned, validated observation contracts; workers must not write directly into public catalog tables. Use PostgreSQL filtering and indexes at MVP scale. Do not add Redis, Meilisearch, or paid services until measured requirements justify them.

## Consequences

- The duplicate SQLAlchemy domain must not silently compete with Prisma for canonical data; migration and interoperability remain an explicit future task.
- Local SQLite and production PostgreSQL schemas must have parity for user-visible features.
- Ingestion requires durable raw observations, provenance, validation outcomes, and auditable review before canonical writes.
- Existing data and seed scripts must not be treated as verified merely because code labels it that way.
