# ADR-003: Ingestion and Adapter Contract

- Status: Accepted
- Date: 2026-09-30

## Context

The scraper fleet must ingest manufacturer specs and retailer prices without fabricating data, corrupting the canonical catalog, or violating terms. The current `BaseScraper` prototype collects into its own schema; the web app has no ingestion bridge, and the browser-triggered refresh endpoint cannot propagate scraper output into the catalog it queries.

## Decision

Define one ingestion contract with mandatory provenance:

1. **fetch** — polite HTTP with a Veridian user agent, per-source rate limiting, retry backoff, robots.txt check before the first request, and refusal when a source's terms or robots policy does not permit it.
2. **extract** — deterministic parsing (regex/JSON-LD/structured data), never guessed values.
3. **validate** — schema plus plausibility ranges; impossible values halt that source (fail visibly, no partial inserts as fact).
4. **emit raw observation** — every observation records source URL, observed-at timestamp, raw payload hash, extraction status, and confidence.

Raw observations are immutable. Canonical entities are only updated through an auditable write path that preserves the raw values and links every canonical field to its source observation. If source structure changes or validation fails, the pipeline halts that source and reports; it never inserts guessed or partial data as fact.

## Consequences

- Any scraper that cannot meet the contract (e.g., Lenovo India returning 403, sources whose terms prohibit automated access) is recorded as unavailable with the reason and not worked around.
- The web refresh endpoint must stop claiming it refreshes the catalog when no bridge exists.
- Ingestion runs out-of-band (CLI/worker), never as a side effect of public browsing.
