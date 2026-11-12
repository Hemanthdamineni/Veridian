# Manufacturer Verification Expansion (Epic 2.9)

**Status:** Proposed — first work item after the 2026-11-12 reconciliation.
Grounds Epic 2.9 in `ROADMAP.md`: *"Live re-verification of the remaining
manufacturers"* and the "unverified tier shrinks toward zero" goal.

**Owner decision:** After Epic 3.7's per-configuration retail path was built
(Phase 1 + 2, credential-gated), the roadmap's "Now" item moves to extending
manufacturer verification beyond ASUS (Lenovo, Dell, HP, and the rest).

---

## 1. The gap

The catalog marks a configuration `certified`, `manufacturer` or `unverified`
(`Sku.provenance`). The `manufacturer` tier means: *a configuration's values
were checked against the manufacturer's own technical-specification page.* Only
two manufacturers are covered today:

| Manufacturer | State | Evidence |
|---|---|---|
| ASUS | ✅ Working | 12 families registered in `data/verify-sources.csv` and `TECHSPEC_PAGES`; the saved-page test suite passes |
| Apple | ✅ Family-level only | Per-family spec pages confirm display size/RAM/storage; the SKU-specific fields (part number, CPU, weight) are reported **unconfirmable**, never guessed |
| Lenovo, Dell, HP, Acer, MSI, Samsung, Microsoft, LG, Razer, Gigabyte, Framework | 🟡 Unverified / blocked | The verification code paths exist and have tests, but **no live page is registered for these rows**, so `runVerification` reports them `notAttempted` |

`db:audit` provenance split (2026-11-12): **certified 1,125 · manufacturer 2 ·
unverified 41**. The `manufacturer` count is 2 because only the ASUS rows that
were confirmed against a live page were promoted; the reference-dataset rows
for Lenovo/Dell/HP carry no registered page, so they stay `unverified`.

The work is therefore not new machinery — the runner, parser, comparator,
robots policy and rate limiter already exist (`src/lib/verify/`) — it is
**coverage**: register and validate specification pages for more manufacturers,
and make the unconfirmable/unverified outcome machine-readable per SKU so the
tier can shrink deliberately rather than by guesswork.

## 2. Goals and non-goals

### Goals

1. Extend `data/verify-sources.csv` (and the Python `TECHSPEC_PAGES` where the
   page shape needs a bespoke adapter) to cover **Lenovo, Dell and HP** first —
   the three manufacturers with the largest unverified share.
2. Verify each newly registered page against a **saved fixture** so the adapter
   is tested without live network access, exactly as the ASUS/Apple fixtures
   are tested today in `tests/manufacturer-verify.test.ts`.
3. Record per-SKU outcomes as machine-readable states: `confirmed`,
   `contradicted`, `unconfirmable(reason)`, `notAttempted`, `error` — reusing
   the existing `RowResult` shape and the allowlist reason vocabulary
   (`src/lib/allowlist.ts`), so a SKU that can never be confirmed by a page has
   a documented, machine-readable reason instead of silently staying
   `unverified`.
4. Promote a row to `manufacturer` provenance **only** on a live `confirmed`
   result; a row that is `unconfirmable` keeps its tier and its reason.
5. Add an integration guard so `verify-all.sh` asserts that every registered
   source URL is one of {reachable-and-confirmed at registration time} or
   explicitly marked unconfirmable with a reason — the registry cannot silently
   rot.

### Non-goals

- No change to the ingestion path or the reference dataset values in this
  increment (that is `--apply`, gated separately).
- No new scrapers beyond manufacturer specification pages; no retailer pages.
- No Framework bypass (Cloudflare) — it stays 🔴 Blocked with a documented
  reason.
- Not attempting to promote every `unverified` row; the goal is correct
  coverage and honest tiers, not a target number.

## 3. Data model

Everything needed already exists — **no migration**.

- `data/verify-sources.csv` — the registry, one row per SKU:
  `sku_code,manufacturer,model,region,spec_url,part_number,checked_on`.
  Adding coverage is adding rows here (plus a fixture per new page shape).
- `data/laptops.csv` — the reference dataset the runner reads
  (`ReferenceRow`); `--apply` writes corrected values back with a citable URL.
- `Sku.provenance` (`certified|manufacturer|unverified`) — the tier the
  promotion step sets.
- `src/lib/allowlist.ts` — the existing machine-readable reason vocabulary
  used for source-less provenance; Epic 2.9 extends the same pattern with
  verification-specific reasons.

New (small) surface:

- `src/lib/verify/reasons.ts` — a `UnverifiableReason` union and a
  `UNVERIFIABLE_SKUS` map keyed by `skuCode`, mirroring `allowlist.ts`:
  - `no_spec_page` — the manufacturer publishes no per-SKU spec page.
  - `family_page_only` — the page confirms family-level fields but not this
    configuration (the Apple case, generalised).
  - `bot_blocked` — the site blocks automated verification (Cloudflare etc.).
  - `page_retired` — the spec page existed but now 404s / has moved.
- `RowResult.reason?: UnverifiableReason` — populated when a row is
  `unconfirmed` for a documented reason, so the report distinguishes
  "couldn't reach it" from "there is nothing to reach".

## 4. Verification contract (existing, extended)

The runner contract is unchanged (`src/lib/verify/runner.ts`):

```ts
runVerification(options: RunnerOptions): Promise<VerifyReport>
```

with `RunnerOptions { referencePath, sourcesPath, userAgent?, timeoutMs?,
minIntervalMs?, fetchImpl?, only? }` and `VerifyReport { rowsChecked,
confirmed, contradicted, unconfirmed, notAttempted, errors, contradictions,
results, pages }`. The invariants the expansion must preserve:

- **Unambiguous-only comparison.** A cell that lists several options for a
  family is ambiguous; an ambiguous cell can never be used to claim a row is
  wrong (`compare.ts`). This is why Apple is family-level-only.
- **A page that cannot be reached is never a pass and never a failure — it is
  `unconfirmed`.** `notAttempted` (no registered page) is distinct from
  `unconfirmed` (page registered, not confirmable).
- **Robots and politeness.** `RobotsPolicy` + `HostRateLimiter` gate every
  fetch; a disallowed path is `unconfirmed(bot_blocked)`, never forced.
- **Nothing is written without `--apply`.** The report path is read-only;
  `applyCorrections` writes the corrected value *and* the citable page URL.

The only contract change: `RowResult` gains an optional `reason` and
`VerifyReport` gains a `byReason: Record<UnverifiableReason, number>` count, so
the shrink of the unverified tier is measurable.

## 5. Coverage increments

Each increment is self-contained: register pages, add a saved fixture, add the
adapter if the page shape differs, test, then run the live check manually and
record `checked_on`.

1. **Lenovo (ThinkPad / Yoga).** Lenovo spec pages are client-side rendered;
   the current Python `Lenovo` scraper reports `Partial`. The increment adds a
   spec-page adapter that reads the server-rendered spec table (or the JSON
   payload the page hydrates from) and registers the ThinkPad X1 Carbon Gen 12,
   T14s Gen 6 and Yoga Slim/Pro 7i rows from `db:audit`'s unverified set.
2. **Dell (XPS / Latitude).** Register the Dell support/spec URLs; the adapter
   reads the "Tech Specs" section table.
3. **HP (Spectre / OmniBook / EliteBook).** Register the HP product-spec URLs;
   adapter reads the "Specifications" table.
4. **Documented blockers.** Framework (Cloudflare) and any manufacturer with no
   per-SKU page are entered in `UNVERIFIABLE_SKUS` with a reason, so the
   unverified tier's residue is explained rather than unexplained.

## 6. Test plan

### 6.1 Unit tests — `tests/manufacturer-verify.test.ts` (extend)

Saved-page fixtures only; no network.

- **U1** Lenovo saved spec page → `parseSpecTable` yields one column per part
  number with unambiguous CPU/RAM/storage/display/weight values.
- **U2** Dell saved "Tech Specs" table → same, and the comparator confirms a
  matching row.
- **U3** HP saved "Specifications" table → same.
- **U4** An ambiguous Lenovo cell (e.g. "16GB or 32GB") is treated as
  ambiguous and never produces a contradiction.
- **U5** A new-manufacturer page that lists several part numbers across columns
  is matched to the right column by part number (reuses the existing
  "part number published in several columns" behaviour).
- **U6** `RowResult.reason` is set for a registered-but-404 page
  (`page_retired`) and for a robots-disallowed path (`bot_blocked`).
- **U7** `VerifyReport.byReason` counts each reason correctly.

### 6.2 Reason registry tests — `tests/verify-reasons.test.ts` (new)

Mirrors `tests/allowlist.test.ts`.

- **R1** every `UnverifiableReason` value matches `/^[a-z_]+$/`.
- **R2** `unverifiableReasonForSku(skuCode)` returns the reason for a mapped
  SKU and `null` otherwise.
- **R3** a SKU that is `confirmed` by a page is never present in
  `UNVERIFIABLE_SKUS` (guard against a stale entry suppressing a real confirm).
- **R4** Framework rows are present with `bot_blocked`.

### 6.3 Registry integrity — `scripts/verify-registry.ts` (new) + guard

- **G1** every `spec_url` in `data/verify-sources.csv` is a well-formed
  `https://` URL on a known manufacturer host.
- **G2** every registered `sku_code` exists in `data/laptops.csv`.
- **G3** every `unverified` row is either registered here **or** present in
  `UNVERIFIABLE_SKUS` with a reason — the "no unexplained residue" invariant.
- **G4** `npm run verify:registry` exits non-zero when a source URL is stale
  (a saved-page hash changed) so registration rot surfaces early.
- **G5** added as a `step` to `scripts/verify-all.sh` (see §7), so the gate
  covers it.

## 7. Integration with `verify-all.sh`

Add one step after `catalog assertions`:

```
step "manufacturer registry" bash -c "cd '$WEB' && npm run verify:registry"
```

It runs entirely against saved files (no network), so it is CI-safe. `npm run
verify:registry` maps to `tsx scripts/verify-registry.ts`. The live
`verify-manufacturer-specs.ts` run stays a manual, operator-initiated command
(it needs network); the CI gate checks registry integrity, not live reachability.

## 8. Definition of done

- Lenovo, Dell and HP specification pages are registered and verified against
  saved fixtures; their adapters are unit-tested (U1–U7).
- `UNVERIFIABLE_SKUS` documents every remaining unverified manufacturer with a
  machine-readable reason (R1–R4).
- `scripts/verify-registry.ts` enforces the no-unexplained-residue invariant
  and is a `verify-all.sh` step (G1–G5).
- A manual live run promotes confirmed rows to `manufacturer` provenance and
  the `db:audit` split shows the new count; the report records
  `checked_on` per row.
- `bash scripts/verify-all.sh` passes with the new step (baseline before this
  increment: 549 web tests / 28 files, 216 Python tests).
- No migration; no change to reference-dataset values in this increment.

## 9. Out of scope

- Retailer pages and price verification (that is Epic 3.7 / `retail-price-feed.md`).
- `--apply` back-writes to `laptops.csv` for newly covered manufacturers
  beyond what the existing apply path already does (tracked separately).
- Framework bypass; multi-category verification.
- LLM-assisted spec extraction (the parser stays deterministic and testable).

---

*Measured 2026-11-12. Provenance split and counts from `npm run db:audit`;
runner contract from `src/lib/verify/runner.ts`; registry format from
`data/verify-sources.csv`.*