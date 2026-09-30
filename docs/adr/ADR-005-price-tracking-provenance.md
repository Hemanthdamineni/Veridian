# ADR-005: Price Tracking and Provenance Model

- Status: Accepted
- Date: 2026-09-30

## Context

Price observations currently mix `SkuRegionalPricing` (current MSRP snapshots) with `PriceObservation` (history). Seed rows label their source as "csv seed" but have no source URL, and the UI can present them as live history. Mission rule 1 and 7 require real-data validation and no fake completion.

## Decision

Price provenance is immutable and explicit. Every observation stores price, currency, region, retailer/listing, source URL or official feed identifier, observed-at timestamp, availability, and data provenance (manufacturer/retail/review/synthetic). Historical min/max/average/trend calculations are computed from observations only. Synthetic seed data is labeled synthetic in every user-facing surface and is excluded from "verified" or "current price" claims.

## Consequences

- A real price chart requires at least one legitimate, citable observation; seed data can only be shown as "seed reference values".
- Provenance and freshness indicators must distinguish verified, pending, conflicting, synthetic, and unavailable sources.
- The data quality dashboard must report provenance directly, not infer it from a `sourceName` field.
