# DESIGN — Azura World CATI

> Written by **W1-D**, 2026-07-27. Neither reference repository has a design
> document; this one exists because "the tokens are in `globals.css`" is not a
> design system, it is a colour list. Every number here was measured or is
> reproducible from a named file.
>
> **Code wins over docs.** If this file and `apps/web/app/globals.css` disagree,
> the stylesheet is right and this file is stale.

---

## 1. The problem this design solves

`DESIGN-RESEARCH.md` §3 states the tension precisely, and it is worth restating
because every decision below follows from it:

> Award-winning real-estate sites split into two camps: **conversion
> infrastructure** (Zillow, Redfin — dense, fast, functional) and **brand
> theatre** (Sotheby's, Compass — cinematic, slow, immersive). Azura World CATI
> is neither, and that is the design problem. It is an _intelligence product
> about_ a brand-theatre property.

The proposed resolution was **"cinematic hero, forensic body"**. W1-D **accepts
it, with one amendment**.

The amendment: the register does not change _once, below the fold_. It changes
**at the level of the individual number**. A confirmed figure is quiet and
confident. A disputed one is loud, amber, and carries a control that opens
nineteen competing values. That happens in the hero, in a table row, and in the
report poster alike.

Making the switch positional would mean the top of the page gets to be
promotional — and the top of the page is where the most quotable numbers live.
An entry price with a 2.1× spread across four publishers must not read as
marketing anywhere, including in a screenshot someone pastes into a deck.

So: **the page is cinematic. The numbers are forensic. Everywhere.**

---

## 2. What makes this not 1Çatı

The stated acceptance test: _a screenshot of Azura next to a screenshot of
1Çatı, and nobody mistakes one for the other._

|                     | 1Çatı                                             | Azura World                                                          |
| ------------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| Primary             | `#066B63` deep teal                               | `#0B5E7D` azure                                                      |
| Accent              | `#B9822B` gold                                    | `#A75B12` warm sand — **CTAs only**                                  |
| Temperature         | Warm, institutional                               | Cool, coastal, luminous                                              |
| Body face           | Aptos (one face, everywhere)                      | Manrope                                                              |
| Display face        | **none** — no display face at all                 | **Playfair Display**, a serif                                        |
| Base radius         | `0.625rem`                                        | `0.875rem` — softer                                                  |
| Dark mode           | Written, then `forcedTheme="light"` — unreachable | Shipped and contrast-verified                                        |
| Chart tokens        | Mapped in `@theme`, never defined → transparent   | All five defined                                                     |
| Provenance language | none — no equivalent exists                       | dotted underlines, amber conflict badges, source chips, em-dash gaps |

The strongest differentiator is the last row, and it is not decorative. 1Çatı
has no concept of a number that argues with itself. Azura's entire visual
vocabulary is built around it.

The second strongest is the serif. A display serif over a geometric sans reads
as "resort", and one face for everything reads as "registry". 1Çatı is correct
to be a registry. Azura is selling a 5★ hotel 300 m from the Mediterranean.

**A note on the accent.** Warm sand is the only warm value in a cold palette,
and it appears exactly once per screen — on the primary CTA. Used twice it
stops being an accent and becomes a second brand colour, which is how 1Çatı's
gold ended up as both a highlight and a body treatment.

---

## 3. Tokens

Declared in `apps/web/app/globals.css`. Tailwind v4, CSS-first: `@theme inline`
maps `--color-x: var(--x)` and the literal values live in `:root` / `.dark`.
The indirection is load-bearing — resolving them eagerly (plain `@theme`) makes
the `.dark` override silently do nothing.

**Never hardcode a colour in a component.** Every value below has a semantic
name; `bg-[#0B5E7D]` in a W3-* surface is a review rejection.

### 3.1 Surface and text

| Token                                    | Light                 | Dark                  |
| ---------------------------------------- | --------------------- | --------------------- |
| `--background`                           | `#F4F9FB`             | `#04101A`             |
| `--foreground`                           | `#08161F`             | `#E8F3F8`             |
| `--card` / `--card-foreground`           | `#FFFFFF` / `#08161F` | `#0A1B27` / `#E8F3F8` |
| `--popover` / `--popover-foreground`     | `#FFFFFF` / `#08161F` | `#0C2030` / `#E8F3F8` |
| `--muted` / `--muted-foreground`         | `#E7F0F4` / `#4A6472` | `#0F2735` / `#9DB6C4` |
| `--secondary` / `--secondary-foreground` | `#E2EEF3` / `#0B3446` | `#122C3C` / `#CFE6F0` |

### 3.2 Action

| Token                                        | Light                 | Dark                  |
| -------------------------------------------- | --------------------- | --------------------- |
| `--primary` / `--primary-foreground`         | `#0B5E7D` / `#F4F9FB` | `#4FC9E8` / `#04101A` |
| `--accent` / `--accent-foreground`           | `#A75B12` / `#FFFFFF` | `#E8A24E` / `#231303` |
| `--destructive` / `--destructive-foreground` | `#B0243A` / `#FFFFFF` | `#FF7B8E` / `#2A0510` |
| `--ring`                                     | `#1188B4`             | `#4FC9E8`             |

`--destructive-foreground` does not exist in the 1Çatı reference, which renders
destructive as tinted text on a 10% wash — that reads as _disabled_, not as
_dangerous_. Azura's destructive button is filled.

### 3.3 Border vs input — a distinction worth keeping

| Token      | Light     | Dark      | Held to                       |
| ---------- | --------- | --------- | ----------------------------- |
| `--border` | `#C9DCE4` | `#1D3B4E` | nothing — decorative hairline |
| `--input`  | `#6E8FA0` | `#4A7288` | **3:1**, WCAG 1.4.11          |

WCAG 1.4.11 governs _UI component boundaries_, not separators. Collapsing the
two into one token forces a choice between a heavy-handed look and a failed
audit. Splitting them gets both: quiet dividers, and control edges you can
actually find. **A control's border uses `--input`.**

### 3.4 Provenance — the Azura-specific family

One colour per `Confidence` in `CONTRACTS.md` §1, in both themes.

| Token                                   | Light                 | Dark                  |
| --------------------------------------- | --------------------- | --------------------- |
| `--confidence-confirmed`                | `#0F6B4F`             | `#54D6A6`             |
| `--confidence-official`                 | `#0B5E7D`             | `#4FC9E8`             |
| `--confidence-single`                   | `#4A6472`             | `#9DB6C4`             |
| `--confidence-conflicted`               | `#8A5200`             | `#F0B45C`             |
| `--confidence-inferred`                 | `#5B4B8A`             | `#B9A6F0`             |
| `--confidence-gap`                      | `#61737E`             | `#8EA5B2`             |
| `--surface-conflict`                    | `#FDF3E3`             | `#2A1D08`             |
| `--quality-modelled`                    | `#5B4B8A`             | `#B9A6F0`             |
| `--quality-stale`                       | `#9A3412`             | `#F5A97F`             |
| `--simulation` / `--surface-simulation` | `#8A5200` / `#FDF3E3` | `#F0B45C` / `#2A1D08` |

Also defined: `--chart-1..5`, the full `--sidebar-*` set, and coastal tokens
(`--sea-deep`, `--sea-mid`, `--sea-shallow`, `--sea-foam`, `--sand`) used by
`.azura-aurora` and the 3D poster so those are themed rather than hardcoded.

### 3.5 Radius and motion

`--radius: 0.875rem`, with `--radius-sm/md/lg/xl/2xl/3xl` as `calc()` multiples
(0.5 / 0.75 / 1 / 1.35 / 1.8 / 2.4).

`--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77,
0, 0.175, 1)`, `--ease-coastal: cubic-bezier(0.16, 1, 0.3, 1)`, and
`--duration-instant/fast/base/slow/hero` = 120/200/320/500/800ms. `lib/motion.ts`
is the JS mirror and the two must agree — a CSS transition and a JS tween on the
same element with different curves produces a visible seam.

---

## 4. Measured contrast

Produced by the W1-D contrast harness against the exact token values above.
**0 gated failures.** Floors: 4.5:1 body text (1.4.3), 3:1 UI component
boundaries and focus indicators (1.4.11).

| Pair                                         | Light     | Dark      | Floor |
| -------------------------------------------- | --------- | --------- | ----- |
| foreground / background                      | **17.29** | **17.01** | 4.5   |
| foreground / card                            | **18.34** | **15.52** | 4.5   |
| foreground / popover                         | **18.34** | **14.71** | 4.5   |
| muted-foreground / background                | **5.90**  | **9.07**  | 4.5   |
| muted-foreground / card                      | **6.26**  | **8.28**  | 4.5   |
| muted-foreground / muted                     | **5.41**  | **7.29**  | 4.5   |
| primary / background (link)                  | **6.80**  | **9.92**  | 4.5   |
| primary / card (link)                        | **7.21**  | **9.05**  | 4.5   |
| primary-fg / primary (button)                | **6.80**  | **9.92**  | 4.5   |
| secondary-fg / secondary                     | **11.14** | **11.18** | 4.5   |
| accent / background (text)                   | **4.77**  | **8.87**  | 4.5   |
| accent-fg / accent (CTA)                     | **5.06**  | **8.33**  | 4.5   |
| destructive / background                     | **6.26**  | **7.75**  | 4.5   |
| destructive-fg / destructive                 | **6.65**  | **7.52**  | 4.5   |
| input / background (control edge)            | **3.24**  | **3.70**  | 3.0   |
| input / card (control edge)                  | **3.44**  | **3.38**  | 3.0   |
| ring / background (focus)                    | **3.80**  | **9.92**  | 3.0   |
| ring / card (focus)                          | **4.03**  | **9.05**  | 3.0   |
| confidence confirmed / card                  | **6.49**  | **9.63**  | 4.5   |
| confidence official / card                   | **7.21**  | **9.05**  | 4.5   |
| confidence single_source / card              | **6.26**  | **8.28**  | 4.5   |
| **confidence conflicted / card**             | **6.39**  | **9.50**  | 4.5   |
| **confidence conflicted / conflict surface** | **5.81**  | **8.91**  | 4.5   |
| confidence conflicted / background           | **6.02**  | **10.41** | 4.5   |
| confidence inferred / card                   | **7.45**  | **8.15**  | 4.5   |
| confidence gap / card                        | **4.93**  | **6.82**  | 4.5   |
| confidence gap / background                  | **4.64**  | **7.47**  | 4.5   |
| quality modelled / card                      | **7.45**  | **8.15**  | 4.5   |
| quality stale / card                         | **7.31**  | **9.06**  | 4.5   |
| SIMULATION label / sim surface               | **5.81**  | **8.91**  | 4.5   |
| SIMULATION label / card                      | **6.39**  | **9.50**  | 4.5   |

Informational, deliberately not gated — `--border` is a decorative separator,
not a UI component boundary: light 1.33 (background) / 1.41 (card); dark 1.63 /
1.49.

**The amber-on-dark case** the brief calls out as the usual failure: dark
`--confidence-conflicted #F0B45C` on `--surface-conflict #2A1D08` is **8.91**,
and on card **9.50**. It passes with room, because the dark conflict surface is
a very dark brown rather than the usual translucent-amber-over-slate, which is
what normally lands at 3:1.

The two values that were adjusted to reach their floor, rather than chosen and
then blessed: `--confidence-gap` light went `#6A7A84` → `#61737E` (4.44 → 4.93
on card), and `--input` was split out of `--border` entirely.

---

## 5. Type

Self-hosted under `apps/web/public/fonts`. This is forced, not preferred:
`proxy.ts` emits `font-src 'self' data:` and `style-src 'self' 'unsafe-inline'`,
so a Google Fonts link is blocked by our own CSP on both counts.

Both faces are variable and SIL OFL 1.1, so redistribution is fine — unlike
everything under `sources/media`, which is a competitor's material.

| File                             | Bytes       |
| -------------------------------- | ----------- |
| `manrope-var-latin.woff2`        | 24,836      |
| `manrope-var-latin-ext.woff2`    | 15,120      |
| `manrope-var-cyrillic.woff2`     | 14,500      |
| `manrope-var-cyrillic-ext.woff2` | 2,552       |
| `playfair-var-latin.woff2`       | 38,404      |
| `playfair-var-latin-ext.woff2`   | 21,140      |
| `playfair-var-cyrillic.woff2`    | 21,152      |
| **total**                        | **137,704** |

Seven files, not the twenty-nine Google's CSS implies: the per-weight URLs are
byte-identical variable fonts, verified by sha256. `font-weight: 200 800`
(Manrope) and `400 900` (Playfair) span the range from one file each.

`unicode-range` is what makes `ru` affordable — a de/en/tr visitor never
downloads the Cyrillic subsets. **Cyrillic coverage is verified, not assumed**
(§7).

Turkish `ı İ ş ğ ç` and German `ß` live in the latin-ext subset, which every
locale loads.

### Type scale

Tracking is **size-specific**. A single `letter-spacing` is wrong somewhere:
large text reads too loose as it grows and wants negative tracking, small text
wants slightly positive.

| Role                        | Size                | Line height | Tracking            |
| --------------------------- | ------------------- | ----------- | ------------------- |
| `h1`                        | `clamp` per surface | 1.04        | `-0.03em`           |
| `h2`, `h3`, `.font-display` | —                   | 1.1         | `-0.02em`           |
| body                        | `1rem`              | 1.6         | 0                   |
| small / caption             | `0.75–0.875rem`     | 1.4–1.5     | `+0.01em`…`+0.02em` |
| uppercase labels            | `0.6875rem`         | —           | `+0.06em`           |

Sizes are in `rem` so a user's larger default scales the layout with the text
instead of overflowing it.

`[data-numeric]` sets `font-variant-numeric: tabular-nums`. Any column of
prices, areas or counts must carry it — proportional digits make a money column
illegible.

---

## 6. Provenance visual language

The rules are a contract, not a style preference. Implemented in
`components/evidence/*`.

| Confidence               | Treatment                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `confirmed` / `official` | Normal weight. Quiet source affordance.                                             |
| `single_source`          | Dotted underline (`.azura-underline-dotted`).                                       |
| `conflicted`             | **Amber badge, always visible, never hover-only.** Range shown where one is honest. |
| `inferred`               | Italic + a "berechnet" marker + the derivation note.                                |
| `gap`                    | **"—" and "Nicht belegt". Never `0`. Never blank.**                                 |

Three decisions inside those rules are worth defending explicitly.

**The conflict affordance is a popover, not a tooltip.** A tooltip opens on
hover, so it does not exist on touch and is awkward for a screen reader.
`DESIGN-RESEARCH.md` §4.6 rules it out and the reasoning is the product's:
disagreement between sources is the thing being sold. The trigger is a real
`<button>`, in the tab order, Enter to open, Escape to close, focus restored.

**Currency is never converted.** F-002 spans EUR and USD. A range is computed
only when every competing value shares one currency; otherwise the display value
stands alone with the badge, and the popover lists each figure in its own
currency. `€ 185.000 – $ 239.171` is not a range, it is two numbers in different
units, and inventing a rate would be inventing a number.

**A range is not shown when it would be a lie.** `conflictRange()` returns
`null` — meaning "show the single value plus the badge" — for fewer than two
comparable numbers, more than one currency, or all values identical.

**Colour is never the only signal.** Each confidence level pairs a distinct icon
_shape_ with its colour, chosen to differ in silhouette: double-tick, shield,
minus, triangle (the only pointed shape), function glyph (the only one
containing a character), slashed circle (the only circle). State survives
greyscale, a monochrome A4 print, and colour vision deficiency (WCAG 1.4.1).

**Dead sources still cite.** 15 of 60 harvest attempts failed content
validation. A `SourceChip` with `reachable={false}` drops the outbound link
entirely — offering one would send the reader to a 404 and imply the citation is
verifiable — and links to the stored snapshot instead. `CONTRACTS.md` §1
invariant 6 exists for this: a citation you cannot re-open is not a citation.

**`modelled` is visible in the list, not just the detail page.** 631 of 656
units are synthesised to fill the inventory. `DataQualityMark` renders nothing
for a real listing and a purple marker for a modelled one, so the distinction is
legible at a glance in a table row.

---

## 7. Motion

Three tools, three jobs, no overlap: **GSAP + ScrollTrigger** for scroll
choreography, **Framer Motion** for component state, **Lenis** for scroll feel.
A fourth animation library is a bundle regression, not a capability.

All values live in `lib/motion.ts`. Nobody hardcodes a duration.

| Element         | Duration |
| --------------- | -------- |
| Button press    | 160ms    |
| Tooltip         | 125ms    |
| Popover, dialog | 200ms    |
| Tabs indicator  | 220ms    |
| Scroll reveal   | 500ms    |
| Hero            | 800ms    |

`ease-in` is deliberately absent from the token set. It delays the first frame —
the exact moment the user is watching hardest — so a 300ms `ease-in` _feels_
slower than a 300ms `ease-out`.

Springs use Apple's two-parameter model (damping ratio + response) expressed as
Framer Motion's `bounce` + `duration`. **Default is `bounce: 0`.** Overshoot is
only correct when the gesture itself carried momentum — a flick, a drag release.
A menu that faded in has no momentum to express.

Stagger is 30–80ms between siblings, capped at 12 items so long lists do not
accumulate seconds, and never gates interaction.

Only `transform` and `opacity` animate. Framer Motion's `x`/`y` shorthands are
avoided in favour of full `transform` strings, because the shorthands run on the
main thread via `requestAnimationFrame` and drop frames while the browser is
busy; a `transform` string goes to the compositor.

### The reduced-motion contract

**`prefers-reduced-motion: reduce` produces a page that is COMPLETE and STATIC —
not a faster one.** This is the rule most likely to be violated by accident, so
the mechanism matters more than the intent.

The common failure is the blanket clamp:

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.001ms;
  }
}
```

That stops the animation but leaves whatever set `opacity: 0` in place — so
scroll-revealed content is hidden **permanently**, from exactly the user who
asked for less motion. The 1Çatı reference hit this with Framer Motion and
patched it per-component afterwards.

So the policy is inverted. Ambient CSS motion is opted **in** under
`(prefers-reduced-motion: no-preference)`, never opted out under `reduce`. And
`components/anim/reveal.tsx` returns **before** it hides anything:

```ts
if (reduced) return; // ← nothing was hidden
gsap.set(targets, { y, opacity: 0 }); // ← only reached when animating
```

The `[data-reveal]` rule in `globals.css` that forces `opacity: 1` under
`reduce` is a backstop, not the mechanism.

Per component: simulations render their **final** state (not a paused first
frame), `Counter` renders the final number with no count-up, `ScrambleText`
leaves the real text alone, WebGL renders on demand or shows its poster, and
**Lenis does not mount at all** — smooth scroll is JS wheel interception that
the CSS reduced-motion rule cannot reach, and it is a common vestibular trigger.
The NLP reference runs Lenis unconditionally; Azura does not.

Reveals also fire on `beforeprint`. A printed page has no viewport and no
scrolling, so an element still waiting for its IntersectionObserver prints as a
blank band.

Also honoured: `prefers-reduced-transparency` (glass surfaces go solid) and
`prefers-contrast: more` (solid backgrounds, defined borders).

---

## 8. 3D

`components/three/coast-maquette.tsx` is the entry point; the scene lives in
`coast-maquette-scene.tsx` and is only ever reached through `dynamic(…, { ssr:
false })`, so three/drei stay out of the initial route JS.

Four gates, each falling back to the poster — never a blank box, never a spinner
that does not resolve:

1. reduced motion
2. motion tier below `full` (< 4 logical cores, or Save-Data)
3. WebGL unavailable — probed with a real `getContext`, not inferred
4. not yet near the viewport — IntersectionObserver with a 300px margin

The poster stays mounted _underneath_ the canvas rather than being swapped out,
so there is no frame in which the box is empty and a later context loss still
has something behind it.

**The poster is inline SVG, not a photograph, and that is a rights decision as
much as a performance one.** All 31 harvested media assets are
`usage: "internal_only"` (`MEDIA-LICENSE.md`) — a competitor's marketing
renders. Putting one on a public landing page would be a rights breach;
`apps/web/public/media` is empty for that reason. A drawn abstraction owes
nobody anything, costs ~2KB gzipped, needs no decode, and cannot 404.

Guards the NLP reference does **not** have, added here because the brief
requires them: the WebGL probe, a `visibilitychange` rAF pause, and disposal of
geometries/materials plus `forceContextLoss()` on unmount. Browsers cap live
WebGL contexts at roughly sixteen; leaking them is the "3D stops working after a
few navigations" bug. DPR is capped at 2 — uncapped DPR on a 3× phone renders
nine times the pixels for a difference nobody can see.

---

## 9. Accessibility floor

WCAG 2.2 AA, and these are gates rather than aspirations.

- Contrast ≥ 4.5:1 text, ≥ 3:1 UI boundaries, **in both themes** — §4.
- Focus visible on every interactive element, both themes. `:focus-visible` is a
  2px `--ring` outline with a 2px offset. **Never `outline: none` without a
  replacement.**
- Tap targets ≥ 24px, controls ≥ 44px. Verified in a browser, not by eye — the
  first pass found five 16px violations in `SourceChip`, because the chip's
  container had the min-height and the `<a>` inside it, which is the actual hit
  area, did not.
- Colour is never the only carrier of state — §6.
- Four states on every data surface. `DataSurface` makes `empty` and `error`
  **required props**, so a surface cannot ship with only its populated state.
- Skeletons match the real content's box, so nothing shifts on load (CLS ≤ 0.1).
- Reduced motion, reduced transparency, more contrast, forced colours — all
  handled.
- Decorative motion is `aria-hidden`; the same information is available as text.
  A ticker that announces every update is unusable with a screen reader.

---

## 10. Layout and language

German runs ~30% longer than English, Russian ~35%. A layout that only works in
English is not a layout.

- **320px with German is the test viewport**, not an afterthought. Verified: no
  horizontal page scroll, nothing overflowing, in both themes.
- `CardFooter` wraps by default — two German button labels do not fit on one
  line at 320px.
- Table headings wrap rather than truncate; truncating a heading loses the only
  label a column has.
- Tab lists scroll horizontally rather than wrapping — a wrapped tab strip
  changes height as the user moves through it and pushes the panel under their
  cursor.
- Wide content scrolls inside its own container. The page body never scrolls
  sideways.
- Sorting goes through `Intl.Collator` — `"I".toLowerCase()` is not `"ı"` in
  Turkish.
- RTL is explicitly **not** built; no Arabic or Hebrew locale is in scope.

---

## 11. Print

The report poster must come off A4 complete. `@media print` drops the aurora and
all animation, forces white, expands `href` after external links, and prefixes
conflicted values with `⚠` so a disagreement survives a greyscale printout.
`[data-print-hide]` removes chrome. Scroll reveals fire on `beforeprint` (§7).

---

## 12. What this design deliberately does not do

- **No hover-only information.** Anything a user must know is visible or
  focusable.
- **No count-up on a figure that matters.** The final value is in the markup.
- **No skeleton that is not the size of its content.**
- **No `transition: all`.** Every transition names its properties.
- **No animation on a keyboard-initiated action.** Those repeat hundreds of
  times a day and motion makes them feel slow.
- **No third animation library.**
- **No competitor photography on a public route.**
- **No invented number, ever** — including a converted currency, an averaged
  conflict, or a `0` standing in for a gap.
