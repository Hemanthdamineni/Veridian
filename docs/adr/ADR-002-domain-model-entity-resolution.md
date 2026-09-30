# ADR-002: Domain Model and Entity-Resolution Strategy

- Status: Accepted
- Date: 2026-09-30

## Context

The mission specifies this hierarchy:

`Manufacturer -> Product Family -> Series -> Generation -> Model -> Configuration (SKU) -> Regional Variant -> Retail Listing -> Price Observation`

The existing web schema models `Manufacturer -> Series -> Model -> Sku`, then `SkuRegionalPricing` and append-style `PriceObservation`. The Python schema models a broader knowledge graph but is not wired into the app.

## Decision

The canonical app-level model is:

`Manufacturer -> Series -> Model -> Sku -> Regional Pricing -> Retail Listing -> Price Observation`

An optional Generation field is added to Model when data justifies it. Entity resolution is staged, deterministic-first:

1. Exact match on `skuCode`/MPN.
2. Exact match on normalized model name + key spec signature (CPU/RAM/storage/display refresh).
3. Normalized candidate ranking.
4. Low-confidence or conflicting candidates are routed to a review queue and never auto-merged.

Conflicting source values are preserved as conflicts with provenance rather than silently resolved.

## Consequences

- New SKUs with no reliable signature must pass a human or rule-gated review before entering the catalog.
- All resolution decisions must be recorded with confidence, matched fields, and source URLs.
- The Python knowledge graph remains a future migration target, not the live app source of truth.
