---
name: azura-ui-ux
description: UI/UX and motion standard for the Azura World CATI. Use when building or reviewing any user-facing surface — landing page, dashboard, evidence cockpit, hotel pages, 3D, scroll choreography, typography, or provenance components. Covers the design tension this project has to resolve, the exact GSAP/Lenis/R3F practice, the craft techniques (ScrambleText, metallic wordmark, em tracking, CSS grading, PBR/HDRI), the accessibility and performance floors, and the honesty rules that outrank aesthetics.
---

# Azura World — UI/UX standard

You are designing a **competitor-intelligence product about a 5★ resort**. That is the whole
design problem in one sentence, and everything below follows from it.

## 0. Read first

- `DESIGN-RESEARCH.md` — reference libraries, inspiration, identity direction
- `LANDING-CRAFT.md` — the craft techniques with working code, and the media rights line
- `HANDOFF/W1-D.md` — the token system and provenance component API as built
- `HANDOFF/W3-I.md` — the simulation layer you compose

**Then read the house style before writing anything**, because it already ships:

| For | Read |
|---|---|
| WebGL | `D:\Real Estate CRM\New Level Premium\components\three\TowerMaquette.tsx` (235 lines) |
| Motion primitives | `…\New Level Premium\components\anim\{Reveal,ScrambleText,CountUp}.tsx` |
| Section construction | `D:\Real Estate CRM\Cati\apps\web\components\new-level-premium\*.tsx` |
| Live simulation | `…\Cati\apps\web\components\live-erp-simulation.tsx` (961 lines, Framer + CSS, no WebGL) |

Also load **`emil-design-eng`** and **`apple-design`**. The first is Emil Kowalski's philosophy
directly; the second covers spring physics, interruptible motion and material depth.

## 1. The design tension — resolve it, don't split the difference

Award-winning real-estate sites split two ways: **conversion infrastructure** (Zillow, Redfin —
dense, fast, functional) and **brand theatre** (Sotheby's, Compass — cinematic, immersive).

Azura World CATI is neither. It is an intelligence product *about* a brand-theatre property. It
must look premium enough to be credible about a 5★ resort, and read as rigorous rather than
promotional.

**The resolution: cinematic hero, forensic body.** The top of the page earns attention with
motion and photography. Below the fold the register changes visibly — provenance chips,
confidence badges, source counts, conflicts. The transition *is* the argument: this looks like
marketing, then shows you its working.

## 2. Identity

1Çatı is deep teal `#066B63` + gold `#B9822B` — warm, institutional. **Azura is azure**:
Mediterranean water, 300 m from the sea. Cool, luminous, coastal.

```
--primary #0E6B8C   azure          --accent #D98E3A   warm sand, CTAs only
--ring    #1594BE                  dark --primary #46C8E8
```

Type: **Playfair Display** (display) + **Manrope** (body), both covering Latin-ext **and
Cyrillic** — `ru` requires it. Verify the shipped subset actually contains Cyrillic; a missing
glyph renders as a silent box.

**The test:** a screenshot of Azura beside one of 1Çatı, and nobody mistakes them.

## 3. Craft techniques

### ScrambleText — once, on the hero wordmark
Free at GSAP 3.15 (all plugins went free at 3.13; `CONVENTIONS.md` §1 is out of date on this).

```ts
gsap.registerPlugin(ScrambleTextPlugin)
gsap.to(el, { duration: 1.2, scrambleText: { text: "Azura World", chars: "upperCase", speed: 0.4, revealDelay: 0.2 } })
```

Each letter cycles random characters, then locks left-to-right so the word decodes into place.
Scrambling one heading is a signature; scrambling three is a gimmick. Under reduced motion,
render the final string — never a partially-scrambled frame.

### Metallic wordmark
`background-clip: text` + dark→silver gradient + **one** narrow white highlight at the optical
centre. `color: transparent` defeats automated contrast checks — measure rendered pixels or
provide an accessible fallback.

### Tracking in `em`, never `px`
`1em` = current font-size, so `0.2em` holds proportion at 20px and 200px. This is why wide-tracked
display type survives mobile. No `letter-spacing: 2px` anywhere.

### CSS video grading
`filter: saturate(1.1) contrast(1.05) sepia(0.15)` unifies clips into one warm palette, tunable
live in devtools. Vignette = a `radial-gradient` overlay, clear centre to dark edges,
`pointer-events: none`.

### 3D
**Do:** PBR materials, procedural HDRI via drei's `Environment`, subtle bloom.
**Keep specs in the DOM** — block counts, areas and distances as real HTML with provenance, never
painted into canvas. A canvas is invisible to search, to screen readers, and to the evidence gate.

**DRACO / KTX2 — it depends on which 3D you are building:**
- *Coast maquette* (procedural, no imported model) → **do not add them.** Nothing to compress;
  the loaders would grow the bundle to solve a non-problem.
- *Unit configurator* (below, real geometry) → **add both.** DRACO for mesh, KTX2 for textures.
  That is exactly the case they exist for.

### The unit configurator — the highest-value 3D idea for this dataset

A product configurator is what R3F is actually for, and this dataset is built for one: **7 blocks
· 656 units · layouts 1+1 → 6+1 · townhouses · villas · a 188-room hotel.**

```
block (7)  →  floor  →  unit  →  layout + area + price + provenance
```

Why it beats a static hero: it turns 656 rows of inventory into something a person can *explore*,
and every selection is backed by real harvested data. Pick B3, floor 4, a 2+1 — and the panel
shows its area, its asking price **with the four disagreeing portal sources**, and whether it is
one of the 25 real listings or one of the 631 modelled records.

Rules if you build it:
- **Specs live in the DOM**, driven by the same selection state as the canvas. The canvas is the
  view; the DOM is the truth. SEO and screen readers get the real content.
- **Modelled units stay visibly modelled** inside the configurator too — the honesty control does
  not get suspended because the surface is prettier.
- Geometry stays schematic. A believable massing model is honest; a photoreal render of a unit
  we have no floor plan for is a fabrication.
- Deep-linkable: `?block=B3&floor=4&unit=AZW-B03-0412` so a finding can be cited.
- Same guards as any 3D here: lazy, poster fallback, reduced-motion static, DPR capped, disposed
  on unmount.

## 4. Scroll choreography

Lenis (feel) · GSAP ScrollTrigger (choreography) · Framer Motion (component state). Three tools,
three jobs. **Do not add a fourth.**

**One rAF loop.** Drive GSAP's ticker from Lenis and R3F's frameloop from the same source — the
classic failure is three libraries each running their own. Read Codrops' *"The Architecture Behind
Trionn"* (July 2026) before wiring them.

Animate `transform` and `opacity` only. Never `width`, `height`, `top`, or `box-shadow`. Kill
every ScrollTrigger and GSAP context on unmount, or scroll breaks on the second navigation.

## 5. Floors that outrank aesthetics

A design violating any of these is rejected regardless of how it looks.

1. **`prefers-reduced-motion` yields a complete, static page** — not a faster one. Content
   revealed only by ScrollTrigger is invisible to that user. Verify with the flag on and check
   nothing is missing.
2. **No WebGL → a poster image.** Not a blank box, not a spinner that never resolves.
3. **Provenance is visible, never hover-only.** A conflict badge behind a mouse hover is invisible
   to touch and to screen readers — and the conflicts are the product.
4. **LCP ≤ 2.5s throttled mobile · CLS ≤ 0.1 · INP ≤ 200ms · landing JS ≤ 250 KB gz.**
   3D is lazy-loaded behind an intersection observer and never blocks LCP.
5. **Contrast ≥ 4.5:1 in both themes**, measured, not eyeballed.
6. **German runs ~30% longer than English, Russian ~35%.** Test at 320px in German — that is
   where layouts actually break.
7. **Tap targets ≥ 24px.** Four states on every data surface: loading, empty, error, populated.
8. **Verify under `next start`, never `next dev`.** A CSP bug shipped pages with zero working
   JavaScript for a full night and passed every dev check. `pnpm qa:csp` is the regression gate.

## 6. Provenance rendering

Every number goes through `ProvenanceValue`. A bare numeric literal in JSX is a defect — grep
your own output before finishing.

| Confidence | Treatment |
|---|---|
| `confirmed` / `official` | Normal. Quiet source affordance on hover/focus |
| `single_source` | Subtle dotted underline |
| `conflicted` | **Amber badge, always visible.** Range where possible |
| `inferred` | Italic + "berechnet" marker |
| `gap` | **"Keine Angabe"** (de) / "Not stated" / "Belirtilmemiş" / "Нет данных". Never an em dash, never `0`, never blank |

A `modelled` unit must be distinguishable from a real listing **at a glance in the list**, not
only on the detail page. 25 of 656 units are real portal listings; the other 631 are modelled.
That distinction is the honesty control for the whole product.

## 7. Media rights

833 harvested assets carry `usage: internal_only`. They are Cebeci Group's copyrighted marketing
work and **this repository is public**.

- Their logo **identifying the subject of an analysis** — defensible nominative use, attributed,
  unambiguously analytical.
- Their logo **as our branding or in our header** — not defensible. Implies endorsement.
- Their photography **small, captioned, sourced, as evidence** — yes. **Full-bleed hero
  decoration** — no.

The page's visual identity is ours; their assets appear as cited evidence with a `SourceChip`.
Anything promoted to `attributed_display` gets its reason written into `MEDIA-LICENSE.md`.

## 7b. Language

**No em dashes in any user-visible string.** An em dash in body copy is the strongest tell of
machine-written text, and this is client-facing German. Use a full stop, a comma, or brackets.

Write for a non-technical property manager. No component names (`DataTable`), no state names
(`ready`/`loading`), no implementation detail (`virtualisiert ab 100`), no internal jargon
(`Cockpit`, `Beleg`). Every user-visible string lives in `messages/*`, never hardcoded in a
`.tsx`. Read it aloud: if it does not sound like a person explaining something to a colleague,
rewrite it.

Plain language must make a limitation *more* obvious, never less. `Preis nicht von der Quelle
bestätigt` beats `modelliert` because it is clearer, not because it is softer.

## 8. The line

A page that looks extraordinary and misrepresents its certainty has failed. Craft serves the
evidence; it does not decorate over it.
