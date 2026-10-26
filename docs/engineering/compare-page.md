# Comparison page rebuild — `feat/compare-page`

A comparison page that answers the question a buyer actually has: **which of
these should I pick, and why?**

---

## Base branch (important)

The dispatched worktree `orca/workspaces/Veridian/compare-upgrade` was checked out on
`Hemanthdamineni/compare-upgrade` at `12bdd34`, which predates almost everything this task
describes: it had no `src/app/globals.css` design tokens, no `src/lib/format.ts`, no
`src/app/compare/page.tsx`, no `tests/` directory and no vitest. The task brief matches
`main` exactly.

`feat/compare-page` was therefore branched from **`main`**, and rebased onto the current
`main` (`527437d`, which merges `feat/admin-dashboard` and `feat/lifecycle`) before hand-off,
so it merges cleanly. The old `Hemanthdamineni/compare-upgrade` branch is untouched at
`12bdd34`.

| | |
|---|---|
| Branch | `feat/compare-page` |
| Commit | one commit — *feat(compare): rebuild the comparison page around what actually differs* |
| Base | `main` @ `527437d` |


---

## Changed files

| File | Change |
|---|---|
| `veridian-web/src/lib/compare.ts` | **New.** All comparison logic: metric definitions, the winner rule, the differences summary, the provenance statement, the winner map the public API returns, and the URL state helpers. Pure, no database, no React. |
| `veridian-web/src/app/compare/page.tsx` | **Rewritten** as a React Server Component. Reads `?ids=` and `?region=` from the URL, loads the rows from the database directly, and renders the picker, the highlights and the table. |
| `veridian-web/src/components/compare/ComparisonPicker.tsx` | **New.** Client component (the only one). Search, the visible current selection, add/remove, the price-region control, and a copy-link button. Every control is a real button or input. |
| `veridian-web/src/components/compare/ComparisonTable.tsx` | **New.** The side-by-side table. Proper `<caption>`, `scope="col"` / `scope="colgroup"` / `scope="row"` headers, best values marked with a text badge (never colour alone), missing values stated in words. |
| `veridian-web/src/components/compare/ComparisonHighlights.tsx` | **New.** The honest summary: the verdict sentence, what separates them, where each one leads, and where the figures came from. |
| `veridian-web/src/app/api/v1/compare/route.ts` | **Internals only.** The inline `generateComparisonAnalysis` was replaced by a call into `@/lib/compare`. The response shape (`region`, `comparison`, `analysis`, `availableRegions`) and every explanation string are unchanged. |
| `veridian-web/tests/compare.test.ts` | **New.** 36 unit tests over the comparison rules. |

Nothing else was touched: no schema, no `src/types/index.ts`, no `src/lib/api.ts`, no
`src/lib/format.ts`, no `package.json`.

---

## Commands run, and their results

All run from `veridian-web/` in the worktree.

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean, no errors |
| `npm run lint` | clean, no errors |
| `npx vitest run tests/compare.test.ts` | **36 passed** (12 test files / 203 tests for the full suite) |
| `npm run build` | succeeded; `/compare` is `ƒ (Dynamic)` |
| `npm run db:api:smoke` | **all 12 checks pass**, including `GET /api/v1/compare compares two configurations` |

Extra check (not required, run to prove the API did not change): the old inline
`generateComparisonAnalysis` and the new `buildComparisonAnalysis` were run over **1,770 real
catalog pairs**. The `analysis` objects were byte-identical in every case — 0 mismatches.

The page was also rendered against the live catalog with `next start` and checked for the
two-configuration, three-configuration, one-configuration, six-configuration,
missing-configuration and empty-selection cases.

---

## A real differences summary

ASUS Zenbook A14 (UX3407) — `cmviaf8oe0006iggtteocjsor` — against
Lenovo ThinkPad X1 Carbon Gen 12 — `cmviafdji003biggtfd5xve9w`, region `US`:

> These two differ in price, processor, core count, graphics, storage, weight, battery,
> battery life and operating system; everything else is identical.

And the highlights panel then says, for the same pair:

- **ASUS Zenbook A14 (UX3407)** — Lowest price: $1,299 · Most cores: 12 · Most storage: 1 TB ·
  Largest battery: 75 Wh · Longest claimed battery life: 22 h
- **Lenovo ThinkPad X1 Carbon Gen 12** — Lightest: 1.09 kg

Three configurations (adding ASUS Zenbook S 16 (UM5606)) read:

> These three differ in price, processor, core count, graphics, memory, storage, display size,
> weight, battery and battery life; everything else is identical.

Two identical configurations read:

> These two are identical across every metric they report.

---

## How a missing metric is presented

Comparing the **unverified** ASUS Zenbook A14 (UX3407) with the **certified**
ASUS CX9406CAA (`cmviacsy100072gz7t8me0ljg`) — the certified row carries no retail price and
several fields are absent:

> These two differ in processor, core count, memory, storage type, touch, battery and
> operating system. price, graphics, memory type, memory upgradeability, storage, storage
> slots, resolution, display type, refresh rate, brightness, weight and battery life are not
> reported by every configuration, so nothing is concluded from them.

In the table, that row is never ranked:

- The metric's row header carries the note
  **“Not reported by 1 configuration, so no best value is declared.”**
- The cell of the configuration that does not report it shows `—`, with a screen-reader-only
  “Not reported”.
- **No cell in that row is marked as the best value**, and the metric never appears in the
  “what separates them” list.
- The provenance line says so as well:
  *“These configurations come from different sources: 1 certified, 1 unverified. A difference
  between them may reflect how each was recorded, not a difference between the products.”*

A port type is a special case: a row that reports *some* ports but not that type is
reporting zero of them (`0×`), while a row that reports no ports at all is reporting nothing.

---

## Prices

Prices are labelled the way the rest of the product labels them. The price row is
“Suggested price (US)”, the table footnote reads *“Prices are the manufacturer’s suggested
price for the region shown, recorded at our last update — not a live retail price.”*, and the
highlights panel repeats it. Nothing on the page presents a reference price as a live price.
The price is ranked like any other comparable metric, so a configuration with no price for
the region cannot win the price row.

---

## Accessibility

- The table has a `<caption>`, `scope="col"` column headers, `scope="colgroup"` group headers
  and `scope="row"` metric headers. Each group is its own `<tbody>`.
- Best values are marked with a **text badge** (“Most RAM”, “Lightest”, “Lowest price”), not
  with colour alone. Differing rows carry a “Differs” tag.
- Missing values are announced as “Not reported” to a screen reader.
- The picker is built from real `<button>` and `<input>` elements, so it is fully keyboard
  reachable; the region control is a `role="radiogroup"` with `aria-checked`.
- The current selection is always visible, and the “copy link” result is announced through a
  live region.

---

## Edge cases handled

| Case | Behaviour |
|---|---|
| One configuration selected | “Add a second configuration to see what differs.” The single row's table and provenance are still shown. |
| More than five | Capped at five. The page says: “A comparison holds at most 5 configurations, so the last one in this link was left out.” The picker also says the comparison is full. |
| A configuration that no longer exists | “One configuration in this link is no longer in the catalog and was left out.” The remaining ones still compare. If none exist: “None of the configurations in this link exist any more.” |
| Repeated ids in the URL | De-duplicated, and the page says how many were dropped. |
| Nothing can be compared | “There is nothing to compare: these configurations report no metric in common.” |
| A metric only some rows report | Listed as not reported by every configuration; never counted as a difference or as a similarity. |

---

## Known limitations

1. **The search is name/SKU only.** The picker queries the public `/api/skus?q=` endpoint,
   which matches the model name and the SKU code. It cannot filter by spec.
2. **Ports are compared per type, and only when a row reports ports at all.** The ENERGY
   STAR certified rows in the current dataset carry no port rows, so a comparison against one
   marks every port type as not reported.
3. **The display “best” is a composite score** (panel type, then refresh rate, then
   brightness). It is the same score the public API has always used, kept for consistency; it
   is not a claim about how a display feels to use. The table does not rank display as a
   single metric — it ranks size, type, refresh rate and brightness separately.
4. **The page reads the database directly** rather than calling `/api/v1/compare`, because
   that endpoint is API-key protected and a browser page has no key. The rules are shared
   through `@/lib/compare`, so the two cannot disagree.
5. The comparison is capped at five columns because the table stops being readable past that.

---

## Remaining work / changes needed in files outside this task's ownership

1. **`veridian-web/src/app/compare/CompareClient.tsx` is now dead code.** It was the old
   client component that fetched `/api/v1/compare` without an API key — which returns `401`
   since API keys landed in `d368cd7` — so the compare page was already broken on `main`.
   The new page does not use it. **It should be deleted**, but it was not in this task's
   ownership list, so it was left untouched.
2. **The page title.** The old page set `title: "Compare laptops | Veridian"` while the root
   layout applies a `"%s | Veridian"` template, so the rendered title was
   “Compare laptops | Veridian | Veridian”. The new page sets `title: "Compare laptops"` and
   lets the template do its job.
3. `src/app/skus/[id]/page.tsx` has the same double-suffix title pattern
   (`` `${mfr} ${model} — specs & pricing | Veridian` ``). Not touched here; it is outside
   this task's ownership.
4. `src/app/page.tsx` (the catalog) and `src/app/skus/[id]/page.tsx` link to
   `/compare?ids=<id>`. That link still works — it now lands on the new page with one
   configuration selected and the “add a second” prompt.
5. **Not done:** the comparison is not linkable from the catalog in bulk (“compare these
   three”), and the picker's search does not offer the recommendation engine's ranked picks.
