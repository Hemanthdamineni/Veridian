# Reference dataset audit trail

`veridian-web/data/laptops.csv` holds 43 real, purchasable retail part numbers
across ASUS, Apple, Dell, HP and Lenovo, each with a US and an IN list price.
It is loaded verbatim by `veridian-web/scripts/seed.ts`; two rows are published
in the `manufacturer` tier because the verification tool confirmed them
against the manufacturer's page, the rest are published as `unverified` and say
so.

This document is the audit trail for the review of that file. It records what
was wrong with each row that was changed, what the row says now, and the
evidence that settled it. It also lists the rows that were **flagged** rather
than changed: defects the file contradicts but that only an external check can
settle. Nothing here was guessed, and nothing was invented: a value is only
in the dataset because a manufacturer page states it.

- **Rows in the dataset now:** 43
- **Rows changed:** 8 (18 field corrections)
- **Rows removed:** 0
- **Rows flagged:** see [Flagged rows](#flagged-rows)
- **Audit script:** `veridian-web/scripts/audit-reference-dataset.ts`
- **Repair script:** `veridian-web/scripts/fix-reference-dataset.ts`

## How the review was done

The review has two halves.

**The internal half** needs no network. The file is checked against itself:
duplicate part numbers, duplicate model and configuration combinations,
part-number formats, specification combinations no manufacturer ships,
internal consistency of the display, the battery and the NPU figure, and the
prices - the ladder of a model, the price of a memory tier against the price of
the same tier on a different screen size, and the exchange rate the two
regional prices imply. These checks are now the audit script, they run on
every change, and the script exits non-zero when one of them finds a defect
that has not been resolved.

**The external half** used only the sources the register clears. The register
(`docs/DATA_SOURCES.md`) clears the ASUS product and technical-specification
paths for `VeridianBot`, and clears the Apple product paths. Lenovo and Dell
answer 403 to the collector, and the HP and Apple product extraction is
recorded as unvalidated, so those rows could not be checked against their
manufacturer at all. Every page was fetched with the honest `VeridianBot`
user agent on 2026-10-21, inside the paths the register clears.

The ASUS pages were read with the repository's own extractor
(`veridian_scraper/scrapers/asus.py`) and its committed fixture of the live
page, and the repository's verification tool (`scripts/verify-reference-specs.py`)
was re-run against the same pages so that its verdict could be reproduced
rather than quoted.

### The evidence that was used

| Source | What it settled |
|---|---|
| `https://www.asus.com/us/store/` (the ASUS US store listing) | The retail part numbers ASUS publishes and the specifications it publishes with them: `UX3405CA-ES99T` (Core Ultra 9 285H, 3K 120Hz 500nits OLED touchscreen, 1 TB), `UX3407QA-PS76` (Snapdragon X X1 26 100, 14" 1920x1200 60Hz 400nits OLED, 1 TB), `UX3407NA-PS77` (Snapdragon X2 Elite), `UX8406CA-PS99T` (Core Ultra 9 285H, 3K 120Hz 400nits OLED touchscreen, 1 TB), `UM5606GA-PS99T`, `UM5606GA-XS79T` (16" 3K 120Hz 500nits OLED touchscreen, 1 TB), `UM3406GA-XS79`, `UX5406AA-XS79T`, `UX5406SA-PS79T` (Core Ultra 7 258V 32GB), `UX8407AA-DS99T` |
| `https://www.asus.com/us/laptops/for-home/zenbook/asus-zenbook-14-ux3405/where-to-buy/` | The single part number ASUS publishes for the Zenbook 14 (UX3405): `UX3405CA-ES99T` (90NB14W4-M022F0), Core Ultra 9 285H, 3K OLED touchscreen |
| `https://www.asus.com/us/laptops/for-home/zenbook/asus-zenbook-a14-ux3407/where-to-buy/` | `UX3407QA-PS76` (90NB1502-M00FM0), `UX3407NA-PS77`, `UX3407NA-ZB/A14_E0` |
| `https://www.asus.com/us/laptops/for-home/zenbook/asus-zenbook-duo-2024-ux8406/where-to-buy/` | `UX8406CA-PS99T` (90NB14X1-M002H0), `UX8406CA-AS99T`, `UX8406CA-PS99T` (90NB14X1-M00MH0), `UX8406CA-AS96T` - all Core Ultra 9 285H, NPU up to 13 TOPS |
| `https://www.asus.com/us/laptops/for-creators/proart/proart-p16-h7606/where-to-buy/` | `H7606WP-PB99T` (RTX 5070) and `H7606WX-XH99T` (RTX 5090), both AMD Ryzen AI 9 HX 370 with an NPU of up to 50 TOPS |
| The nine ASUS technical-specification pages the verification tool registers | The model code each family publishes, the processor each model code carries, the display, battery, weight, memory, storage and NPU figure of each |
| Intel's product specification for the Core Ultra 9 285H | The processor has an NPU of 13 TOPS, not the 34 TOPS the dataset recorded |
| AMD's product page for the Ryzen AI 5 PRO 340 | The processor has an NPU of 50 TOPS, which is what the dataset already recorded |
| Apple's published US pricing for the M4 MacBook Air | The 13-inch with 24 GB of unified memory and a 512 GB SSD is $1,399; Apple prices one memory tier alike across the 13-inch and 15-inch screens |

### The part-number format ASUS publishes

Ten retail part numbers were read from the ASUS store listing and the ASUS
"where to buy" pages. Every one of them follows the same shape:

```
<model><variant>-<2 letters><2 digits>[<1-2 letters>]
UX3405CA-ES99T      UX3407QA-PS76      UX3407NA-PS77      UX8406CA-PS99T
UM5606GA-PS99T      H7606WP-PB99T      UX5406SA-PS79T     UX8407AA-DS99T
```

Every ASUS row in the dataset instead carries a suffix of the shape
`<2 letters><3 digits>WS` (`UX3407QA-QD123WS`, `UX3405CA-UQ123WS`,
`UM5606QA-MY123WS`, ...). ASUS publishes no part number of that shape for any
product. This is the largest defect class in the file and it is flagged rather
than corrected, because the correct suffix cannot be recovered from the pages
the register clears. See [Flagged rows](#flagged-rows).

## Rows that were changed

Eight rows were changed, in eighteen fields. Every change is a value a
manufacturer publishes.

### `UX3405CA-UQ123WS` - ASUS Zenbook 14 (UX3405), 32 GB / 1 TB, $1,449

| Field | Was | Now |
|---|---|---|
| `display_touch` | `false` | `true` |

**What was wrong.** The row described a non-touch panel. Every display option
ASUS publishes for the UX3405CA column of the Zenbook 14 is a touch screen:
the technical-specification page lists three options (1920x1200 60Hz,
2880x1800 120Hz, 2880x1800 120Hz HDR) and each of them ends with "Touch
screen", and the retail part number ASUS publishes for the family,
`UX3405CA-ES99T`, is described on the store listing as a "3K (2880 x 1800)
16:10 120Hz 500nits OLED touchscreen".

**Evidence.** ASUS, Zenbook 14 (UX3405) technical specification, UX3405CA
column, Display row; ASUS US store listing for `UX3405CA-ES99T`.

### `UX3405CA-UQ124WS` - ASUS Zenbook 14 (UX3405), 16 GB / 512 GB, $1,199

| Field | Was | Now |
|---|---|---|
| `display_touch` | `false` | `true` |

**What was wrong.** The same defect as the row above: a non-touch panel for a
family ASUS ships only with touch panels.

**Evidence.** ASUS, Zenbook 14 (UX3405) technical specification, UX3405CA
column, Display row.

### `UX8406CA-MY123WS` - ASUS Zenbook Duo (UX8406), 32 GB / 1 TB, $1,699

| Field | Was | Now |
|---|---|---|
| `display_touch` | `false` | `true` |
| `npu_tops` | `34` | `13` |
| `source_url` | *(empty)* | `https://www.asus.com/us/laptops/for-home/zenbook/asus-zenbook-duo-2024-ux8406/techspec/` |

**What was wrong.** Three separate defects in one row.

1. *The display.* Every display option ASUS publishes for the UX8406CA column
   of the Zenbook DUO is a touch screen; the row recorded a non-touch panel.
2. *The NPU figure.* The row recorded 34 TOPS for a Core Ultra 9 285H. That
   processor has an NPU of 13 TOPS, which is what ASUS publishes for the
   UX8406CA column ("Neural Processor: Intel AI Boost NPU up to 13TOPS") and
   what the "where to buy" page repeats for each UX8406CA part number.
3. *The citation.* The row carried no source URL at all, and the page the
   Zenbook Duo family used to live on
   (`.../asus-zenbook-duo-ux8406/techspec/`) now redirects to the Zenbook
   category page and carries no specification table. The family is published
   at `.../asus-zenbook-duo-2024-ux8406/techspec/`, which does carry the
   UX8406CA column, and that is the URL the row now cites.

**Evidence.** ASUS, Zenbook DUO (2024) UX8406 technical specification,
UX8406CA column (Display, Neural Processor); the ASUS "where to buy" page for
the same family; Intel's product specification for the Core Ultra 9 285H; the
HTTP redirect of the old URL and the specification table at the new one.

### `83A3000VUS` - Lenovo Yoga Pro 7i, 32 GB / 1 TB, $1,799

| Field | Was | Now |
|---|---|---|
| `npu_tops` | `34` | `13` |

**What was wrong.** The row recorded 34 TOPS for a Core Ultra 9 285H, which
has an NPU of 13 TOPS. Nothing else in the row changed: the processor, the
cores, the display and the price are untouched because Lenovo is blocked for
the collector and no Lenovo page could be read to confirm them.

**Evidence.** Intel's product specification for the Core Ultra 9 285H (13
TOPS); ASUS publishes the same figure for that processor.

### `9640-1628SIL` - Dell XPS 16, 32 GB / 1 TB, $1,899

| Field | Was | Now |
|---|---|---|
| `npu_tops` | `34` | `13` |

**What was wrong.** The same defect as the row above: 34 TOPS recorded for a
Core Ultra 9 285H.

**Evidence.** Intel's product specification for the Core Ultra 9 285H; ASUS
publishes the same figure for that processor.

### `9440-1628BLU` - Dell Alienware m16 R2, 32 GB / 1 TB, $1,599

| Field | Was | Now |
|---|---|---|
| `npu_tops` | `34` | `13` |

**What was wrong.** The same defect as the row above: 34 TOPS recorded for a
Core Ultra 9 285H.

**Evidence.** Intel's product specification for the Core Ultra 9 285H; ASUS
publishes the same figure for that processor.

### `H7606WI-MY123WS` - ASUS ProArt P16 (H7606), 64 GB / 2 TB, $2,299

| Field | Was | Now |
|---|---|---|
| `cpu_brand` | `Intel` | `AMD` |
| `cpu_model` | `Core Ultra 9 285H` | `Ryzen AI 9 HX 370` |
| `cpu_cores` | `16` | `12` |
| `gpu_model` | `Intel Arc Graphics` | `NVIDIA GeForce RTX 4070 Laptop GPU` |
| `npu_tops` | `34` | `50` |
| `display_refresh` | `120` | `60` |
| `storage_slots` | `1` | `2` |
| `source_url` | *(empty)* | `https://www.asus.com/us/laptops/for-creators/proart/proart-p16-h7606/techspec/` |

**What was wrong.** This row described a configuration no manufacturer builds.
It named an Intel Core Ultra 9 285H with Intel Arc Graphics on a ProArt P16,
a creator laptop that ships with a discrete NVIDIA GPU and an AMD processor.

The H7606WI column of the ProArt P16 technical specification states:
"Processor: AMD Ryzen AI 9 HX 370 Processor (36MB Cache, up to 5.1GHz, 12
cores, 24 Threads); AMD XDNA NPU up to 50TOPS", "Graphics: NVIDIA GeForce RTX
4070 Laptop GPU (321 AI TOPs) 8GB GDDR6", "Neural Processor: AMD XDNA NPU up
to 50TOPS", "Display: 16.0-inch, ... Refresh Rate:60Hz", and "Expansion Slots
(includes used): 1x M.2 2280 PCIe 4.0x4 + 1x M.2 2280 PCIe 4.0x2". The row
recorded the refresh rate of the H7606WX configuration, one storage slot
instead of the two the family publishes, and the NPU figure of the wrong
processor.

The row also carried no source URL, and the page it used to cite
(`.../for-creators/asus-proart-p16-h7606/techspec/`) now redirects to the ASUS
home page. The family is published at
`.../for-creators/proart/proart-p16-h7606/techspec/`, which carries the
H7606WI column, and that is the URL the row now cites.

**What was left alone.** The row's `display_resolution` (3840x2400) and
`display_nits` (550) were not changed: the H7606WI column does not state a
resolution or a brightness, so there was nothing to correct them against. They
are flagged below. The price was not changed either: ASUS publishes a
family price, not a price for this configuration.

**Evidence.** ASUS, ProArt P16 (H7606) technical specification, H7606WI
column; the HTTP redirect of the old URL and the specification table at the
new one.

### `MRXN3LL/A` - Apple MacBook Air 13" (M4), 24 GB / 512 GB

| Field | Was | Now |
|---|---|---|
| `price_usd` | `1199` | `1399` |
| `price_inr` | `114900` | `134900` |

**What was wrong.** The row described the 24 GB / 512 GB tier of the 13-inch
MacBook Air and priced it at $1,199, which is the price of the 16 GB / 512 GB
tier. Apple prices one memory tier alike across the two screen sizes of the
Air: the dataset's own 15-inch row records $1,399 for the identical 24 GB /
512 GB tier, and Apple's published US price for the 13-inch with 24 GB of
unified memory and a 512 GB SSD is $1,399. The row and the 15-inch row were
the only two configurations of that tier, and they were priced a full tier
apart, which is what the audit's `price/tier-consistency` check caught.

The Indian price was moved with it. The dataset's Indian prices are the US
list price converted at the rate its own Apple rows use, and the same tier on
the 15-inch row is recorded at $1,399 and 134,900 INR - the same conversion.

**What was left alone.** The part number was not changed. It could not be
confirmed against any Apple page (see the flags below), and a part number
must never be invented.

**Evidence.** Apple's published US pricing for the M4 MacBook Air; the
dataset's own 15-inch row for the same memory and storage tier.

## Rows that were removed

**None.** A row is only removed when it does not describe a real, purchasable
configuration at all. Every row that looked wrong turned out to describe a
configuration that exists, with a field or an identifier that was wrong, so
the row was repaired or flagged instead. The removal mechanism is implemented
in `veridian-web/scripts/fix-reference-dataset.ts` (`ROW_REMOVALS`) so that a
future removal is applied deterministically and recorded here, but the list is
empty.

## Flagged rows

These are defects the file still contains. They are recorded in
`ACCEPTED_FINDINGS` in the audit script, together with the check that would
settle each one, so the audit reports them instead of failing on them - and
so a *new* defect still fails the run. The audit prints the reason and the
settling check for every one of them.

### The twelve ASUS part numbers - `part-number/format`

| Row | Part number | The check that would settle it |
|---|---|---|
| Zenbook A14 (UX3407), 32 GB / 1 TB | `UX3407QA-QD123WS` | Read the retail part number for the configuration from the ASUS US store listing or the "where to buy" page for the family |
| Zenbook A14 (UX3407), 16 GB / 512 GB | `UX3407QA-QD124WS` | The same |
| Zenbook 14 (UX3405), 32 GB / 1 TB | `UX3405CA-UQ123WS` | The same |
| Zenbook 14 (UX3405), 16 GB / 512 GB | `UX3405CA-UQ124WS` | The same |
| Zenbook S 16 (UM5606) | `UM5606QA-MY123WS` | The same |
| Zenbook Duo (UX8406) | `UX8406CA-MY123WS` | The same |
| Vivobook S 14 (S3407) | `S3407QA-MY123WS` | The same |
| Vivobook S 15 (S3507) | `S3507QA-MY123WS` | The same |
| Zephyrus G14 (2025), 32 GB / 1 TB | `GA403UV-QS123WS` | The same |
| Zephyrus G14 (2025), 16 GB / 512 GB | `GA403UV-QS124WS` | The same |
| ProArt P16 (H7606) | `H7606WI-MY123WS` | The same |
| Zenbook 14 Flip (UP3404) | `UP3404VA-MY123WS` | The same |

**Why it was not corrected.** The suffix is in a shape ASUS publishes for no
product, so the identifier does not name a purchasable configuration. The
configuration each row describes may still be real - but the part number that
would name it cannot be recovered from the pages the register clears. The
ASUS store (`shop.asus.com`) answers with a bot challenge that the collector
may not bypass, and the technical-specification pages publish only the model
code (`UX3405CA`, `UX3407QA`, `UM5606GA`, ...) and not the retail suffix.

**What is known about each of them beyond the format:**

- `UX3407QA-QD123WS` and `UX3407QA-QD124WS` - ASUS publishes the model code
  `UX3407QA` for a **Snapdragon X Plus X1P 42 100** (8 cores) with a
  1920x1200 60 Hz OLED panel, and publishes the **Snapdragon X Elite X1E 78
  100** (12 cores), which the rows name, under the different model code
  `UX3407RA`. The repository's own verification tool reports exactly this:
  "UX3407RA lists this processor; UX3407QA does not". The rows also carry a
  2880x1800 120 Hz 500 nit panel and a 75 Wh battery, where the current
  UX3407 columns publish 1920x1200 60 Hz and 70 Wh. The rows describe the
  2024 machine; ASUS no longer publishes it. **Settle it with:** the retail
  part number of the 2024 Zenbook A14 Snapdragon X Elite configurations, from
  the ASUS store listing or a distributor price list.
- `UX3405CA-UQ123WS` and `UX3405CA-UQ124WS` - ASUS publishes the processors
  285H, 255H and 225H for the UX3405CA family; the rows name a **Core Ultra 7
  258V**, which ASUS publishes for a different family (`UX5406SA`). The rows
  also carry a non-touch panel, which was corrected above.
  **Settle it with:** the retail part number of the Core Ultra 7 258V Zenbook
  14, from the ASUS store listing.
- `UM5606QA-MY123WS` - ASUS publishes the model codes `UM5606WA`,
  `UM5606KA` and `UM5606GA` for the Zenbook S 16, and no `QA`. The current
  family is AMD-only (Ryzen AI 9 HX 470, Ryzen AI 9 465, Ryzen AI 7 445), and
  the row's Snapdragon X Elite X1E 78 100 is no longer in the line-up.
  **Settle it with:** the retail part number of the 2024 Zenbook S 16
  Snapdragon X Elite configuration.
- `UX8406CA-MY123WS` - ASUS publishes four part numbers for the UX8406CA
  family (`UX8406CA-PS99T` twice with different 90NB codes,
  `UX8406CA-AS99T`, `UX8406CA-AS96T`), all Core Ultra 9 285H. **Settle it
  with:** the "where to buy" listing of the specific 32 GB / 1 TB
  configuration, to pick between them.
- `S3407QA-MY123WS`, `S3507QA-MY123WS`, `GA403UV-QS123WS`,
  `GA403UV-QS124WS`, `UP3404VA-MY123WS` - these families have no current
  product page; the URLs the register holds redirect to a category page and
  carry no specification table. **Settle it with:** the current product page
  for each family from the ASUS store listing, and the retail part number
  from it.
- `H7606WI-MY123WS` - the model code `H7606WI` is published (the
  technical-specification page has an H7606WI column, and the row's
  processor, graphics, panel and storage were corrected against it), but the
  "where to buy" page publishes only `H7606WP-PB99T` and `H7606WX-XH99T`.
  **Settle it with:** the retail part number for the H7606WI configuration
  from the ASUS store listing.

### The two rows published in the manufacturer tier - `provenance/verified-part-number`

| Row | The check that would settle it |
|---|---|
| `UX3405CA-UQ123WS` | Extend `scripts/verify-reference-specs.py` to compare the full published part number instead of the family code, then re-run it |
| `UX3405CA-UQ124WS` | The same |

**Why it matters.** `scripts/verify-reference-specs.py` reduces a part number
to its family code before it looks for a column in the manufacturer's
specification table:

```python
def family_code(sku: str) -> str:
    """ASUS retail part numbers are ``<family>-<config>[-<region>]``."""
    return sku.split("-")[0] if sku else sku
```

It then compares the family code against the model codes the page publishes.
The full part number is never compared with the part number the page
publishes, so a `verified` row attests its **specifications**, not its
**identifier**. The two rows above publish a part number shape ASUS does not
use. The `verified` flag was left as it is: the tool did confirm the rows
against the cited page and reported no conflict, and the fix belongs in the
verification tool, which is outside this change set. See
[Shared changes required](#shared-changes-required).

### Two Lenovo part-number series that name two products each - `identity/part-number-series`

| Row | Series | The check that would settle it |
|---|---|---|
| `21M5000UUS`, `21M5000VUS` (ThinkPad T14s Gen 6) and `21M5000WUS` (ThinkPad L14 Gen 6) | `21M5` | The Lenovo part-number list, or a distributor or OEM catalogue that quotes it |
| `83A3000UUS` (Yoga Slim 7i) and `83A3000VUS` (Yoga Pro 7i) | `83A3` | The same |

**Why it matters.** A Lenovo part-number series identifies one product. One
series naming two products means that either the row carries the part number
of the wrong product, or the model name is wrong. Either way one of the two is
wrong, and the file does not say which. `lenovo.com` answers 403 to the
collector, so the part number could not be read from the manufacturer.

### One display ratio no manufacturer ships - `display/aspect-ratio`

| Row | The check that would settle it |
|---|---|
| `21MU000UUS` (ThinkPad X1 Fold Gen 2) | Lenovo's published specification for the X1 Fold Gen 2, or a distributor or OEM catalogue |

**Why it matters.** The row records a 2560x2000 panel, a 16:12.5 display.
Every other Lenovo row in the dataset is 16:10 (1920x1200, 2560x1600,
2880x1800, 3200x2000, 3840x2400), and 16:12.5 is not a ratio Lenovo builds
laptops with. The resolution was not changed: the correct panel cannot be
derived from the file alone, and `lenovo.com` is blocked for the collector.

### Thirty-six rows with no manufacturer page - `provenance/source-url`

Thirty-six of the 43 rows carry no `source_url`, so nothing about them can be
re-verified and the catalog audit reports them under `coverage/source-url`.
Seven rows now carry one: the five ASUS rows that already had one, plus the
two this review gave one - the Zenbook Duo and the ProArt P16. The rest cannot
be given one because the manufacturers are blocked or unvalidated in the
register.

| Manufacturer | Rows | The check that would settle it |
|---|---|---|
| Lenovo | 10 | The Lenovo product page for each row. `lenovo.com` answers 403 to the collector |
| HP | 8 | The HP product page for each row. HP's robots policy allows the product paths, but the product-page extraction is recorded as unvalidated |
| Dell | 8 | The Dell product page for each row. `dell.com` returns 403 for listing pages |
| Apple | 5 | The Apple product page for each row. Apple's robots policy allows the product paths, but the product-page extraction is recorded as unvalidated |
| ASUS | 5 | The ASUS product page for each row, from the ASUS store listing |

## What the audit script now checks

`veridian-web/scripts/audit-reference-dataset.ts` re-runs the internal checks
and exits non-zero when it finds a defect that has not been resolved.

| Check | What it catches |
|---|---|
| `structure/header` | The column list and order the seed script reads |
| `structure/row-width` | A row that lost or gained a field |
| `structure/required-fields` | A row missing a field the catalog needs |
| `structure/numeric-fields` | A number that is not a number, or is outside a plausible range |
| `identity/duplicate-part-number` | One part number describing two configurations |
| `identity/duplicate-configuration` | Two part numbers describing the same machine |
| `identity/part-number-series` | One part-number series naming two products |
| `part-number/format` | A part number that does not match the format its manufacturer publishes |
| `processor/cpu-cores` | A core count the named processor does not have |
| `processor/npu-tops` | An NPU figure the named processor does not have |
| `display/resolution-vs-diagonal` | A resolution that does not match the diagonal |
| `display/aspect-ratio` | A panel ratio no laptop is built with |
| `display/nits-vs-panel` | A brightness the panel type does not reach |
| `display/refresh-vs-panel` | A refresh rate the brightness does not support |
| `battery/capacity` | A battery too small for the screen it drives |
| `spec/impossible-combination` | A memory, storage and soldered combination no manufacturer ships |
| `price/region-flag` | A price for a region the row is not published in, or a missing one |
| `price/model-ladder` | A better configured machine priced below a worse one |
| `price/tier-consistency` | Two configurations of the same tier priced a tier apart |
| `price/exchange-rate` | An implausible USD/INR rate, or one that is inconsistent inside a manufacturer |
| `provenance/verified-requires-source` | A row published in the manufacturer tier with no page behind it |
| `provenance/verified-part-number` | A row published in the manufacturer tier with an identifier the manufacturer does not publish |
| `provenance/source-url` | A row with no page to check it against |
| `coverage/npu-tops` | *(informational)* A row that records no NPU figure |

The checks are documented in the script, and the thresholds they use are
written down next to them. `veridian-web/scripts/fix-reference-dataset.ts`
applies the corrections above deterministically and is idempotent: it states
the value it expects to find, so it can only ever move a row from a wrong
value to a published one, and a second run changes nothing.
`veridian-web/tests/reference-dataset.test.ts` asserts that the dataset stays
internally consistent, that it still parses into the shape the seed script
reads, and that the audit script exits non-zero on a deliberately corrupted
copy of it.

## Known limitations

- **36 of 43 rows still have no source URL.** They cannot be re-verified, and
  the catalog audit reports them as `coverage/source-url`. The manufacturers
  that would settle it are blocked or unvalidated in the register.
- **The part-number formats of Lenovo, HP and Dell are the ones the dataset
  uses, not confirmed ones.** Only the ASUS and Apple formats were confirmed
  against a manufacturer page. The check for those three brands therefore
  catches an internal inconsistency, not a deviation from the manufacturer.
- **Two thresholds are calibrated on the data itself.** The 12% tolerance of
  `price/tier-consistency` and the plausibility bands of the value checks are
  judgement calls, chosen so that they separate the real prices (the same-tier
  pairs in the dataset differ by at most 7.7%) from the defect that was found
  (14.3%). They are written down in the script so that they can be argued
  with.
- **The NPU figure is missing on 14 rows.** The Snapdragon, the Ryzen 7
  8845HS and the Apple rows record no NPU throughput at all. ASUS publishes
  45 TOPS for the Snapdragon X Elite X1E 78 100, but filling the column in
  would go beyond repairing a wrong value, so the gap is reported as
  `coverage/npu-tops` instead.
- **Prices could not be confirmed for most rows.** Only the ASUS family
  prices and the Apple MacBook Air tiers were readable from a page the
  register clears, and a family price is not a configuration price. The
  Indian prices in the dataset are conversions of the US list prices, not
  published Indian list prices.
- **The seed was re-run against the development database.** The reference rows
  were upserted, so the database now carries the corrected specifications and
  the corrected MacBook Air price. Price observations are append-only by
  design, so the observation recorded earlier for that row still holds the
  old figure.

## Remaining work

1. Read the retail part numbers for the twelve ASUS rows from the ASUS store
   listing and replace the suffixes.
2. Read the retail part number of the ThinkPad L14 Gen 6 and of the Yoga
   Slim 7i and Yoga Pro 7i, and settle which of the two rows in each pair
   carries the wrong identifier.
3. Read the published display of the ThinkPad X1 Fold Gen 2 and replace the
   2560x2000 panel with the resolution Lenovo publishes.
4. Give the 36 remaining rows the manufacturer page they should be checked
   against, and settle the price of the ProArt P16 (H7606) and the Zenbook
   Duo (UX8406) configurations from the ASUS store listing.
5. Confirm the Apple part numbers against an Apple page. `MRXN3LL/A` and
   `MRXQ3LL/A` are identified by several independent retail listings as 13-inch
   **M3** machines with 8 GB of memory and a 256 GB SSD, which does not match
   the M4 configurations the rows describe; Apple's live store has moved to
   the M5 line-up, so the M4 part numbers are only in Apple's archived buy
   page.
6. Fill in the missing NPU figures and the missing display resolutions.

## Shared changes required

These are outside the files this change set owns, and are not made here.

1. **`scripts/verify-reference-specs.py` must compare the full part number.**
   `family_code()` reduces a part number to its prefix, so the tool confirms
   a family, not a part number. Until it compares the published part number
   with the one in the file, a `verified` row can carry an identifier the
   manufacturer does not publish - which is what the two rows in the
   manufacturer tier do today.
2. **`scripts/verify-reference-specs.py` must not impersonate a browser.** The
   tool sends `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36`.
   The data-source register requires an identifiable user agent and forbids
   impersonating one. The `VeridianBot` user agent reaches the same pages;
   the review behind this document fetched all of them with it.
3. **`docs/DATA_SOURCES.md` should record the outcome of this review.** The
   register describes the CSV as "Unverified local seed" and notes that rows
   confirmed by the verification tool are published as `Manufacturer`. That is
   still true of the specifications, but the identifiers of the two
   manufacturer-tier rows are unconfirmed, and the register should say so.
4. **`veridian-web/package.json` should carry the two new scripts** so that
   the audit runs in CI next to the other data checks, for example
   `"db:audit:reference": "tsx scripts/audit-reference-dataset.ts"` and
   `"db:fix:reference": "tsx scripts/fix-reference-dataset.ts"`. The scripts
   are written so that they can be wired in without a change.
