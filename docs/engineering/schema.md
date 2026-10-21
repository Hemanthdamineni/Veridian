# Veridian Schema

**Status:** Describes the schema as it exists.
**Source of truth:** `veridian-web/prisma/schema.prisma`. This document
explains it; it does not define it.

The PostgreSQL schema (`prisma/schema.postgres.prisma`) is **generated** from
the SQLite one by `scripts/generate-postgres-schema.mjs`, and CI fails when
the generated file is stale. The two were once maintained by hand and drifted
apart by six models, which is why this is now a generated artifact.

25 models, 5 relational groups.

---

## 1. The catalog

```
Category ──┐
           │ (Series.categoryId, optional)
Manufacturer ──< Series ──< Model ──< Sku
```

### `Manufacturer`
`id`, `name`, `slug` (unique), `country`, `websiteUrl`, `logoUrl`,
timestamps. 36 rows.

### `Category`
`id`, `name`, `slug` (unique), `description`, `parentId` (self-referencing,
for a hierarchy), timestamps.

`Series.categoryId` points at it. The field is **optional**: the catalog is
currently laptops only, and making the category mandatory before there is a
second category would be a claim about the future rather than a constraint
on the present. The moment a second category exists, the relation becomes
load-bearing and the series that belong to it are assigned.

### `Series`
`id`, `manufacturerId` → `Manufacturer`, `categoryId` → `Category`
(optional), `name`, `slug`, timestamps.
**Unique** `(manufacturerId, slug)`.

A series is a product family: "ThinkPad E14", "Zenbook 14". It is derived
from the name the source reported, not from a curated list.

### `Model`
`id`, `seriesId` → `Series`, `name`, `slug`, `launchDate`, `productUrl`,
`discontinued`, `successorId`, `predecessorId`, timestamps, and the family
list price:

| Field | Meaning |
|---|---|
| `priceFrom` | The manufacturer's published **starting** price for this family |
| `priceFromCurrency` | The currency that price is in |
| `priceFromUrl` | The page it was read from |
| `priceFromObservedAt` | When it was read |

A family price lives here and **never** on a configuration. A "starting at"
price is not a configuration's price — ADR-007 explains the reasoning.

`successorId` and `predecessorId` carry the derived lifecycle links.

**Unique** `(seriesId, slug)`.

### `Sku`
The primary filterable entity: 47 fields, 10 indexes.

Identity is `skuCode` (unique) — the canonical code derived from the part
number plus a hash of the configuration signature, so a re-certification of
one machine collapses onto one row while genuinely different configurations
stay apart.

| Group | Fields |
|---|---|
| Identity | `skuCode`, `mpn`, `upc`, `productType` |
| Provenance | `provenance` — `certified` \| `manufacturer` \| `unverified` |
| Processor | `cpuBrand`, `cpuModel`, `cpuCores`, `gpuModel`, `npuTops` |
| Memory | `ramGb`, `ramType`, `ramSoldered` |
| Storage | `storageGb`, `storageType`, `storageSlots` |
| Display | `displaySizeIn`, `displayResolution`, `displayType`, `displayRefreshHz`, `displayTouch`, `displayNits` |
| Physical | `weightKg`, `batteryWh`, `batteryLifeHours`, `buildMaterial` |
| Platform | `os`, `linuxCompat` |
| Lifecycle | `launchDate`, `discontinued` |

`provenance` is a **written field**, set by the ingestion path and never
inferred downstream (ADR-005). Every filter and every API response reads it
back.

Indexed on `ramGb`, `storageGb`, `weightKg`, `batteryWh`,
`displayRefreshHz`, `cpuBrand`, `displayType`, `provenance`, `mpn` and
`modelId` — the fields the catalog filters on.

### `SkuPort`
`id`, `skuId`, `portType`, `count`, `source`. Indexed on `skuId`.

---

## 2. Provenance and observation

This is the part of the schema that makes the rest trustworthy.

### `SkuSource`
One row per source that describes a configuration.

| Field | Meaning |
|---|---|
| `source` | The source's name — e.g. "US EPA ENERGY STAR Certified Computers V9.0" |
| `kind` | The evidence class — `certified` \| `manufacturer` \| `unverified` |
| `sourceUrl` | The URL the value can be checked against |
| `observedAt` | When it was read |
| `confidence` | The source's own confidence, 0–1 |
| `note` | A sentence explaining what this source establishes |

**Unique** `(skuId, source)`. Every configuration has at least one; the
catalog assertion test fails if any does not.

### `CertifiedSkuSpec`
The certification's own fields, kept separate from the convenience columns
on `Sku`: `cpuBrand`, `cpuModel`, `cpuCores`, `cpuBaseClockGHz`,
`cpuMaxClockGHz`, `cpuPackages`, `ramGb`, `storageType`, `storageDrives`,
`displaySizeIn`, `displayResolutionMp`, `displayAreaSqIn`, `touchScreen`,
`batteryWh`, `os`, `npu`, `markets`, plus `energyStarId`, `source`,
`sourceUrl`, `certifiedAt` and `marketDate`.

One row per certification event. A machine certified twice has two rows and
one `Sku`.

### `RawObservation`
The verbatim source payload, stored whatever happened:

| Field | Meaning |
|---|---|
| `source` | Which source |
| `sourceRecordId` | The record's identifier within that source |
| `rawPayload` | The payload, exactly as received |
| `payloadHash` | Its SHA-256 |
| `status` | `accepted` or `rejected` |
| `error` | The exact reason, when rejected |
| `observedAt` | When it was received |

**A rejected record is kept.** It is the reason a bad figure can never
quietly become a catalog fact, and it is why the rejection rate itself is a
measurable number.

---

## 3. Prices

Three models, three different jobs.

### `PriceObservation`
The append-only history. `skuId`, `region`, `currency`, `price`, `retailer`,
`sourceUrl`, `timestamp`, `sourceName`, `kind` (`retail` \| `manufacturer` \|
`review`), `inStock`, `shipping`, `confidence`.

Indexed on `skuId`, `region`, `timestamp` and `sourceUrl`.

Rows are never updated. A refresh appends.

### `SkuRegionalPricing`
The current snapshot, one row per `(skuId, region)`, with `msrp`,
`currency`, `available` and `observedAt`. This is what the catalog shows and
what the price filters read.

### `PriceHistory`
The rolled-up view: `skuId`, `region`, `window` (7/30/90/all),
`lowestPrice`, `highestPrice`, `averagePrice`, `sampleCount`, `evidenceKind`,
`computedAt`. `sampleCount` and `evidenceKind` are the point: a statistic
computed from one observation is not an average, and a statistic computed
only from manufacturer list prices is not a street price.

### `Seller` and `RetailerListing`
`sellers` identifies a seller (`name`, `slug`, `websiteUrl`, `country`,
`region`, `affiliateProgram`). `retailer_listings` ties a seller to a
configuration: `skuId`, `sellerId`, `retailerSku`, `url`, `price`,
`currency`, `condition`, `availability`, `observedAt`, `matchConfidence`,
`matchMethod`.

`matchConfidence` and `matchMethod` exist because a retailer's string for a
product is not the same thing as our canonical code, and a reader needs to
know how sure the match is.

---

## 4. The component graph

```
Component ──< ComponentAlias
     │      └──< ComponentSpec
     └──< SkuComponent >── Sku
```

### `Component`
A shared part: `kind` (`cpu`, `display`, `storage`), `canonicalName`,
`slug` (unique), `brand`, `model`, `manufacturerId`.

A component is an *entity*, not a string. Two configurations that carry the
same processor point at one row, which is what makes "which machines are
built around this processor?" a join rather than a text search.

### `ComponentAlias`
Every spelling a source has used for a component: `alias`, `normalized`
(unique with the component), `source`, `sourceUrl`, `confidence`,
`observedAt`.

### `ComponentSpec`
A fact about a component: `key`, `value`, `unit`, `source`, `sourceUrl`,
`observedAt`. Unique on `(componentId, key)`.

### `SkuComponent`
The link: `skuId`, `componentId`, `role` (`primary` / `secondary`),
`source`, `sourceUrl`, `confidence`, `observedAt`. Unique on
`(skuId, componentId, role)`.

477 components, 498 aliases, 1,399 component specs and 3,359 links in the
current catalog.

---

## 5. Community and accounts

### `User`, `Session`
`users` carries `email` (unique), `name`, `passwordHash`, `role`
(`user`/`curator`/`admin`), `reputation`, `emailVerified`, `image`,
timestamps. `sessions` carries `sessionToken` (unique), `userId`,
`expiresAt`.

### `Contribution`
A proposed correction: `skuId`, `userId`, `field`, `oldValue`, `newValue`,
`evidenceUrl`, `note`, `status` (`pending`/`approved`/`rejected`),
`reviewedById`, `reviewedAt`.

A contribution never changes a catalog fact on submission. It changes one
only after a reviewer accepts it, and then it is recorded as a **new source**
rather than as an edit that erases the old value.

### `Vote`
`contributionId`, `userId`, `value` (+1/−1), `reason`. Unique on
`(contributionId, userId)`.

### `Alert`
A price alert: `userId`, `skuId`, `type` (`below_price`/`lowest_ever`/
`pct_off`/`any_price_drop`), `targetPrice`, `region`, `isActive`,
`lastTriggeredAt`, `notificationChannel`.

---

## 6. The public API

### `ApiKey`
`name`, `keyHash` (unique), `scopes`, `rateLimit`, `lastUsedAt`,
`expiresAt`, `userId`.

**Only the hash is stored.** The plaintext is shown once, at issue, and
cannot be recovered afterwards (ADR-006).

### `ApiKeyUsage`
`apiKeyId`, `windowStart` (the hour, truncated), `count`, `updatedAt`.
Unique on `(apiKeyId, windowStart)`.

One row per key per hour. The budget is durable, so several server instances
share it and a restart does not reset it.

---

## 7. Conventions

- **Primary keys** are `cuid`, not UUID. Short, URL-safe, and sortable by
  creation time.
- **Timestamps** are `DateTime`, stored in UTC.
- **Money** is a `Float` with an explicit `currency` column. A decimal type
  would be more correct for money; it is not used because every price in the
  catalog is a published list price recorded from a source, not an amount
  this system computes, so no arithmetic is performed on it. If it ever is,
  this changes.
- **Booleans** that describe an unknown value are nullable. `displayTouch`
  being `null` means the source did not say, which is different from `false`.
- **Slug uniqueness** is scoped: a slug is unique within its parent (a
  series within a manufacturer, a model within a series, a component
  globally), so the same family name can exist under two manufacturers.
- **Soft deletion** is not used anywhere. A row that is wrong is corrected
  by a new observation, not by deleting the old one.

---

## 8. Verifying this document

```bash
cd veridian-web
npm run db:schema:pg-check   # the PostgreSQL schema matches the SQLite one
npm run db:audit             # the row counts and the provenance split
npm run db:assert            # every configuration carries a provenance record
```

`prisma/schema.prisma` is the definition. This document explains it.
