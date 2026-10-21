# ADR-006: Public API authentication and rate limiting

**Status:** Accepted
**Date:** 2026-10-21
**Supersedes:** nothing
**Related:** ADR-005 (price tracking and provenance)

## Context

Veridian exposes a public developer API under `/api/v1`. The first version of
it advertised endpoints that did not exist (`/api/v1/skus`,
`/api/v1/skus/:id`, `/api/v1/manufacturers`, `/api/v1/recommendations`) and
authenticated nothing at all: `GET /api/v1` listed those endpoints and the
promise was never kept.

A public catalog API has a specific problem: the catalog is public data, so
there is no obvious secret to protect, but the *service* is not free. An
unauthenticated endpoint on a deployed instance invites scraping, and an
unlimited one invites abuse of the underlying database.

Three requirements follow:

1. A caller must be identifiable, so that an abusive caller can be found and
   its budget withdrawn.
2. A caller must be bounded, so that one caller cannot consume the service.
3. The budget must hold across server instances and across restarts, because
   the deployment target is a serverless or horizontally scaled one where an
   in-process counter is per-instance and resets on every cold start.

There is a second, quieter requirement: the API is a *documentation* surface
as much as a data surface. A developer has to be able to read the contract
before they have a key, which means the contract itself cannot be behind the
key.

## Decision

### Keys are stored only as hashes

An API key is a random 24-byte value, rendered as `vk_<base64url>`. The
database stores only its SHA-256 hash, looked up through a unique index. The
plaintext is shown to the operator exactly once, when it is issued.

A database leak therefore does not hand over working credentials: the hash
cannot be used to authenticate, because the lookup hashes the presented value
and compares. The cost is that a lost key cannot be recovered — it must be
replaced. That is the correct trade for a credential that can be reissued in
one command.

### The budget lives in the database

`ApiKeyUsage` holds one row per key per hour, keyed by `(apiKeyId,
windowStart)` where `windowStart` is the hour truncated to the minute. Each
request increments that row with an upsert, so the counter is durable and
shared by every instance of the service.

The counter is incremented *before* the limit is checked, and the request is
rejected when the resulting count exceeds the key's limit. That ordering
means a rejected request still counts against the budget, so a caller cannot
hammer a full key for free.

Exhausting the budget returns `429` with `Retry-After` and the standard
`X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers.

The hourly window is a fixed bucket rather than a sliding window. A sliding
window is more precise, but it needs a request log to be precise, and the
request log grows without bound. A fixed bucket is one row per key per hour,
which is bounded by the number of keys.

### The contract is public; the data is not

The API index (`GET /api/v1`) and the OpenAPI description
(`GET /api/v1/openapi`) are served without a key. Every endpoint that
returns catalog data requires one. A developer reads the contract, gets a
key, and starts.

### Scopes

A key carries scopes (`read`, `write`, `admin`). An endpoint declares the
scope it needs; a key without it gets `403`. This is deliberately minimal —
there is one scope today — but it means adding a write endpoint later does
not hand every existing key the ability to write.

## Consequences

- A caller is identifiable by key, and a key can be revoked by deleting it.
- The limit is shared across instances and survives a restart.
- A lost key is unrecoverable and must be reissued. This is stated in the
  CLI output at the moment of issue, not discovered later.
- The rate limiter counts rejected requests. A caller that keeps trying
  after a `429` stays over budget until the hour rolls over. This is
  intentional: it is what stops a retry storm.
- The fixed hourly bucket means a caller can burst at the start of an hour
  and again at the start of the next. A caller that needs a smoother limit
  needs a different mechanism, and the interface is where that would go.
- The OpenAPI document is hand-written rather than generated, because the
  document has to describe the provenance model precisely: the three
  provenance tiers, and the fact that no price in the system is a live retail
  quote. A generated document would describe the shapes and lose the
  meaning.

## Alternatives considered

**Unauthenticated access.** Rejected. The catalog is public, but the service
is not: an unbounded endpoint is a denial-of-service vector against the
database, and there is no way to withdraw a specific caller's access.

**A per-IP limit.** Rejected as the only mechanism. It punishes shared
networks (a university, a mobile carrier, a corporate NAT) and it does not
identify the caller, so there is nothing to revoke.

**An in-process counter.** Rejected. It is per-instance, so a horizontally
scaled deployment gives every caller N times the intended budget, and a
restart resets it. The database counter costs one upsert per request and is
correct in every deployment shape.

**Storing the key in plaintext.** Rejected. A hashed key is useless to
someone who reads the database, and the reissue cost is one command.

**A third-party API gateway.** Rejected for now. It would work, but it adds
an external dependency, a second configuration surface and another failure
mode, in exchange for rate limiting and an API key store that this schema
now expresses directly. It remains the right answer if the deployment ever
needs per-route quotas, request signing, or an API catalogue with per-plan
limits.
