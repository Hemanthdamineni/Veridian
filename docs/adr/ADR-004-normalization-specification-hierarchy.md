# ADR-004: Normalization and Specification Hierarchy

- Status: Accepted
- Date: 2026-09-30

## Context

The repository has multiple normalization implementations with different output contracts. The mission requires deterministic parsers for core laptop specifications and preservation of raw inputs. The web catalog currently stores many fields as scalar columns while the Python data model carries arbitrary spec values.

## Decision

Normalization is deterministic and field-specific. Each normalized value must retain its raw source value, unit, normalized canonical value, parser/version identifier, source observation, and validation result. Unknown and ambiguous values remain raw and unresolved; no unit or enum is inferred without evidence. CPU, GPU, RAM, storage, display, battery, ports, weight/dimensions, and OS are separate parsers with explicit accepted formats and negative tests. Category-specific attributes are extensible, while stable commonly-filtered laptop attributes remain indexed fields.

## Consequences

- Parser upgrades do not overwrite source text.
- Multiple source claims for one field remain visible as separate claims until adjudication.
- Seed data without auditable sources cannot be upgraded to verified status by normalization alone.
