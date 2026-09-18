# Veridian — Product Vision

## The framing question

If you're starting from scratch, the wrong question is *"How do I build a laptop database?"*

The right question is:

> **"Why would someone use Veridian instead of Notebookcheck, GSMArena, Amazon, Best Buy, or a manufacturer's own site?"**

The database is only the foundation. The value is everything built on top of it. Specs are a commodity — anyone can copy a spec sheet. **Verified, connected, decision-ready specs are not.**

---

## Part 1 — The Foundation: Data Quality

Everything else in this document is worthless if this layer is weak. This is the actual moat.

### 1.1 Canonical entities

- **One product = one master record.** No duplicates, no near-duplicates.
- **One component = one master record.** Every CPU, GPU, SSD, display panel, Wi-Fi module and battery exists exactly once and is referenced, never re-typed.

This matters because it makes questions like *"show me every laptop using this exact panel"* or *"which machines ship this known-buggy Wi-Fi chip"* trivially answerable.

### 1.2 Alias resolution

Manufacturers and retailers name the same thing five different ways. Normalize automatically:

```
"Core Ultra 7 255H"
"Intel Core Ultra 7 Processor 255H"   →   cpu_id #183
"Ultra 7 255H"
```

Aliases are stored, not discarded — so a future scraper hitting an unfamiliar string can be matched and the mapping cached.

### 1.3 Validation on write

Reject physically impossible values at ingest rather than discovering them in production.

```
battery_wh = 700   →   ✗ rejected (outside plausible range for the category)
weight_kg  = 0.2   →   ✗ rejected
```

### 1.4 Unit normalization

Store one canonical value; derive every display unit from it. Never store both.

```
Stored:    display_size_mm = 355.6
Rendered:  14.0 in  /  35.6 cm  /  355.6 mm
```

### 1.5 Provenance on every field

Not per record — **per field**. Each value carries:

| Attribute | Purpose |
|---|---|
| `source` | Manufacturer page, review site, manual, community, retailer |
| `source_url` | Auditable link |
| `observed_at` | Freshness |
| `collector_version` | Reproducibility when a parser regresses |
| `confidence` | Drives the confidence meter shown to users |

### 1.6 Multi-source verification and conflict detection

Never trust a single source. Collect the same field from manufacturer, retailer, independent review, and manual — then compare.

```
display_nits
  Dell (official)      500
  Independent review   430
  →  CONFLICT: flagged for review, both values retained
```

Crucially: **claimed values and measured values are different data types.** A manufacturer's "up to 18 hours" and a measured 9.2-hour Wi-Fi browsing result should never be shown in the same column.

---

## Part 2 — Community as a Data Engine

No small team can maintain a catalog this deep by hand. The community is not a feature bolted on; it's the scaling mechanism.

**Contribution types**

- Corrections (`battery should be 84 Wh`) and gap reports (`keyboard travel missing`)
- Uploads: benchmark runs, battery tests, photos, thermal images, teardowns
- Structured submissions: Linux compatibility reports, BIOS versions, actual SSD/panel model shipped in a given unit, repair guides

**Trust mechanics**

- Contributions require **evidence** — screenshot, photo, manual page, or link.
- Other users vote: *confirmed / disputed / needs verification*.
- Contributors accrue reputation; high-reputation edits carry more weight and can auto-apply below a risk threshold.
- All edits are versioned and reversible.

This is what turns a static catalog into something that gets *more* accurate over time instead of decaying.

---

## Part 3 — What Users Actually See

### 3.1 Product pages that answer questions

A spec table is table stakes. A Veridian product page should cover:

| Section | Contents |
|---|---|
| **Specifications** | Full spec set, each with a confidence indicator |
| **Measured performance** | Benchmarks, thermals, fan noise, battery runtime, SSD speeds |
| **Ownership reality** | Known issues, firmware/BIOS history, driver problems, defect patterns |
| **Serviceability** | Repairability and upgradeability scores, what's soldered, what's replaceable |
| **Linux** | Component-level compatibility, required kernel version, known fixes |
| **Commerce** | Current price, price history, regional availability, variants |
| **Resources** | Manuals, drivers, BIOS downloads, accessories |
| **Context** | Predecessor, successor, direct competitors |
| **Community** | Q&A, owner reports, photos |

### 3.2 Comparisons that interpret, not just tabulate

Most sites put two spec sheets side by side and leave the user to do the reasoning. Veridian should do the reasoning:

- Mark each row **better / worse / equivalent** rather than only printing numbers.
- **Explain the difference:**
  > *"Laptop A scores 12% higher in sustained multi-core despite the identical CPU, because it sustains a 35 W package power limit versus 25 W."*
- Compare by **dimension that matters to a human** — battery life, keyboard, thermals, noise, display quality, repairability, Linux support — not just by raw component.
- Compare by **use case** — programming, ML workloads, video editing, travel, students, business fleets.
- Distinguish claimed vs. measured throughout.

### 3.3 Search that speaks the user's language

Structured facets are the base layer:

```
OLED · < 1.2 kg · USB4 · ≥ 32 GB · ≥ 80 Wh · no PWM · matte
```

On top of that, natural language:

```
"Laptop for local AI work under ₹80k with a good keyboard"
```

This should parse into a structured query against the existing filter schema — **not** a vibes-based embedding search. Results stay exact, explainable, and debuggable, and the parsed filters are shown to the user so they can adjust them.

### 3.4 Variant handling

A model is a family, not a row. `16 GB / 32 GB / 64 GB`, `OLED / IPS`, `1 TB / 2 TB` are all linked, and switching between them should be one click that preserves the user's place — not a search for a different product.

---

## Part 4 — Supporting Systems

### 4.1 Price intelligence
Price history, lowest-ever, rolling averages, regional pricing, discount depth vs. MSRP, drop and restock alerts, student/coupon awareness.

### 4.2 Benchmarks
Broad coverage, not one synthetic score: Geekbench, Cinebench, 3DMark, PCMark, real battery runtime, SSD throughput, gaming FPS, AI/inference throughput, compile times, media export times.

### 4.3 Automation
Automated price refresh, spec change detection, new-model discovery, discontinuation detection, driver/BIOS/manual updates, and review/benchmark discovery — with human review in the loop for anything low-confidence.

### 4.4 Data quality dashboard
Internal, but essential: missing fields, stale fields, unresolved conflicts, unverified values, broken links and images, duplicate candidates, pending community edits, and per-category coverage percentage.

### 4.5 APIs
Internal API first, then a documented public/developer API with search, comparison, recommendation and bulk export endpoints.

### 4.6 User features
Wishlists, collections, saved comparisons, saved searches, alerts, private notes, recently viewed, owned-device tracking.

### 4.7 Fundamentals
Fast loads, full keyboard navigation, screen-reader support, dark mode, responsive layout, offline caching. Non-negotiable, not a phase-two item.

---

## Part 5 — The Knowledge Graph

The long-term structural advantage is that everything is **connected**, not siloed:

```
Products ─┬─ Components ─── shared across products
          ├─ Benchmarks  ─── tied to specific configs
          ├─ Prices      ─── per region, per seller, over time
          ├─ Reviews & community reports
          ├─ Known issues ── often traceable to a component
          ├─ Accessories & compatibility
          └─ Predecessors / successors / competitors
```

This enables queries no spec-sheet site can answer: *"which laptops share this panel,"* *"which models are affected by this firmware bug,"* *"what replaced this machine and is it actually better."*

---

## Part 6 — Designing for Expansion

Laptops are the first category, not the only one. The schema should treat "laptop" as a **category with its own spec schema**, sitting on shared infrastructure for products, components, sources, pricing, community and provenance.

Future categories — phones, tablets, monitors, GPUs, CPUs, motherboards, SSDs, keyboards, mice, routers, cameras, TVs, wearables, headphones — should require **adding a category schema, not redesigning the platform.**

---

## What Actually Differentiates Veridian

Most comparison sites stop at specs. The opportunity is to be a **trusted decision platform** rather than a catalog. The highest-leverage differentiators:

1. **Spec confidence meter** — every value visibly labelled by how well it's verified.
2. **Claimed vs. measured separation** — manufacturer marketing never silently mixed with independent measurement.
3. **Explained differences** — the *why* behind a performance gap, not just the delta.
4. **Real-world usage profiles** — programming, AI/ML, office, creative, student, travel — instead of a single meaningless "score."
5. **Known issues database** — aggregated recurring faults: display flicker, sleep failures, hinge cracks, BIOS regressions, coil whine.
6. **Lifecycle tracking** — release date, firmware support status, warranty window, and whether a model is about to be replaced.
7. **Evidence-backed community workflow** — proposed edits with attached proof, peer verification, and reputation earned through accuracy.

Items 1, 2, 5 and 6 are the ones no competitor does well. Those are the wedge.

---

## Guiding Principle

For every proposed feature, ask one question:

> **"Does this help someone make a better buying decision?"**

If **yes**, it likely belongs in Veridian.
If **no**, it's more data — not more value — and it adds maintenance cost forever.

A database tells you *what a laptop is.*
**Veridian should tell you whether it's the right laptop for you — and show its work.**
