# ADR-007: Family-level list prices

**Status:** Accepted
**Date:** 2026-10-21
**Related:** ADR-005 (price tracking and provenance)

## Context

A manufacturer publishes one price for a product *family*, not one price per
configuration. ASUS's page for the Zenbook 14 (UX3405) publishes a price of
$1,799.99; the family covers at least two chassis codes and several memory
and storage options, and the published figure is a "starting at" price.

Veridian's catalog is configuration-level. Every row in `Sku` is a specific
configuration, with a part number and a specification signature.

The obvious implementation — read the family price and store it on each
configuration in the family — is wrong, and wrong in a way that is hard for a
reader to detect. A buyer who filters on "under $1,800" would see a machine
whose actual configuration costs less, and a buyer who sorts by price would
see several configurations with the same number, none of them being the price
of that configuration. The number would be attached to a page that claims to
describe a specific part number.

The alternative — refusing to record the price at all — throws away a real,
citable, manufacturer-published figure and leaves the product with no price
information whatsoever.

There is a third option the schema already anticipated: `Model` has
`priceFrom`, `priceFromCurrency`, `priceFromUrl` and `priceFromObservedAt`
fields. The family price can be recorded at the family level, where it is
true, and displayed with the wording that makes its scope obvious.

## Decision

### A family price is recorded on the family

`npm run db:prices` reads the manufacturer's product page, extracts the
price from schema.org `Product` markup, and writes it to the `Model` row
together with the URL it came from and the moment it was observed.

The same reading is also appended to the `PriceObservation` history of one
configuration in that family, so the price has the same provenance trail as
every other observation, and so that a future rollup can see it.

### It is never attached to a configuration

No `SkuRegionalPricing` row is written from a family price. A configuration's
price row comes from a price that belongs to that configuration.

### The reader is told what the number means

The product page shows the figure under an explicit label: the manufacturer
publishes one starting price for the whole family, not a price for each
configuration, with a link to the page it came from.

### The price is read from structured data only

`extractJsonLdPrice` reads a price from schema.org `Product` markup. It does
not scrape a price string out of a rendered page, and it does not infer a
price from a "from $X" phrase in prose. A page that publishes no structured
price yields nothing, and the failure is reported.

An `AggregateOffer`'s `lowPrice` is a starting price and is treated as such.
An array of offers is read in order, and the first offer with a usable price
wins.

### A configuration price and a family price are different kinds of thing

`PriceObservation.kind` already carries the evidence class — `retail`,
`manufacturer`, `review`. A family list price is `manufacturer` evidence about
a family. It is not a retail quote, and the UI never presents it as one.

## Consequences

- The product page can show a real, citable price for a family instead of
  nothing.
- No configuration is given a price that is not its own. A configuration
  with no price of its own shows "price not reported".
- Price filters operate on configuration prices, which means they operate on
  the reference tier's prices and on whatever retail feed is connected later.
  A family price does not widen the set of rows a price filter can select.
  That is correct: the family price cannot honestly answer "is this
  configuration under $1,800".
- The reference dataset's uncited MSRP values remain, and remain labelled as
  reference values. A family list price and a reference MSRP are both
  `manufacturer` or reference evidence, and the UI distinguishes a citable
  price from an uncited one by the presence of a source URL.
- As more manufacturers publish structured prices, the family price becomes
  the normal case and the reference MSRP becomes the exception.

## Alternatives considered

**Attaching the family price to every configuration in the family.** Rejected.
It would make the number wrong on every row it is attached to, and it would
be wrong in a way that looks exactly like a real price.

**Taking the cheapest configuration's price as the family price.** Rejected.
The same problem, with an extra layer of inference: it would attribute one
configuration's price to another.

**Ignoring family prices entirely.** Rejected. It discards a real figure that
a buyer wants, in order to preserve a purity that the reference tier already
violates in a visible and labelled way.

**Reading the price from the rendered page text.** Rejected. A price string
in a rendered page is ambiguous — it may be a strikethrough, an accessory, a
bundle, a monthly plan or a different currency — and a parser that cannot
tell the difference will eventually attach the wrong number to a
configuration. Structured markup states what the number means.
