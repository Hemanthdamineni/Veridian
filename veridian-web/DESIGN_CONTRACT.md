# Veridian — Design & Engineering Contract

Read this before writing ANY UI. The whole product must feel like one coherent,
hand-crafted system. Do not introduce colors, radii, shadows, or type that
violate this contract.

## Design language

- **Direction:** Premium utilitarian minimalism / editorial. Warm, document-like.
- **Palette** (from `globals.css` tokens — use `var(--x)` or exact hex):
  - canvas `#f7f6f3`, surface `#ffffff`, surface-soft `#fbfbfa`
  - ink `#171817`, muted `#716f69`, quiet `#9a9891`
  - line `#e5e3de`, line-strong `#d3d0c8`
  - accent `#9a5a2f` (used SPARINGLY — decoration + eyebrow + one CTA per screen max ~2 roles)
  - accent-soft `#f4e9df`, accent-dark `#78421f`
  - success `#35634a`, success-soft `#edf3ec`; warning `#8e6414`, warning-soft `#fbf3db`; danger `#9f2f2d`, danger-soft `#fdebec`
- **Typography:** body = SF Pro Display / Helvetica Neue stack; display headings = `font-display` (serif); numerics/meta = `font-mono`. Use tight tracking on display (eg `tracking-[-.03em]`), sentence case (no title-case everywhere).

## Reusable classes (defined in globals.css — use them, don't re-invent)

- `.surface` `.surface-soft` — card panels (white bg, 1px var(--line) border, radius 8px). Do NOT add heavy shadows; max is a faint `0 4px 16px rgba(25,22,17,.05)`.
- `.container` — `width:min(1180px, calc(100% - 40px)); margin-inline:auto`
- `.btn-primary` `.btn-secondary` `.btn-quiet`
- `.field` — form inputs
- `.eyebrow` (mono uppercase accent label), `.label` (uppercase muted small), `.muted`, `.quiet`
- `.font-display`, `.font-mono`, `.text-balance`
- `.reveal` — gentle fade-up on entry. Apply to major blocks.

## Rules

- NO gradients, NO glassmorphism, NO heavy shadows, NO emoji, NO decorative 3D.
- Exactly ONE accent (rust #9a5a2f). Never make a large section a filled accent background.
- Buttons: rounded 5px, `min-height:40px`. Primary = ink bg + white text; Secondary = surface + border.
- Cards: `border:1px solid var(--line)`, radius 8px, generous padding (24px+).
- Links: text links use `var(--accent-dark)` with underline, hover to ink.
- Motion: only transform+opacity, <300ms, ease-out. Disable under `prefers-reduced-motion` (already global).
- Accessibility: semantic HTML (`<nav> <main> <section> <article> <dl>`), visible focus ring (global outline auto), `aria-label`s where needed, keyboard-clear controls. Empty/loading/error states on every data view.
- Responsive: works at 375 / 768 / 1440. Use `.container`. Mobile nav exists in SiteNav.
- Text must never clip/overflow horizontally. Wrap long strings.

## Files you interact with

- Tokens/classes: `src/app/globals.css`
- Shared format helpers: `src/lib/format.ts` (formatPrice, formatStorage, formatWeight, formatBattery, formatSize, formatDate, plural)
- Shared types: `src/types/index.ts`
- Root layout + nav: `src/app/layout.tsx`, `src/components/SiteNav.tsx`

## Getting a real SKU for detail examples

Use the API `http://127.0.0.1:3000/api/skus?q=Zenbook&limit=2&region=US` for
rich entries, or `/api/skus/:id`. A freetext search may return sparse rows — the
detail page MUST render "—" / "Not reported" for null numeric/string fields and
hide sections whose data is entirely absent. Never invent values.
