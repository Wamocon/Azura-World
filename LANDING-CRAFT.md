# LANDING CRAFT — techniques, assets, and the rights line

Companion to `tasks/W3-A-landing.md` and `DESIGN-RESEARCH.md`. Read all three before building.

---

## 1. What we actually have

W0-D harvested **833 assets → 8,649 encoded renditions** (AVIF/WebP/JPEG at 400/800/1200/1600/2400
+ LQIP). By category:

| | Count | | Count |
|---|---|---|---|
| photo | 514 | floorplan | 13 |
| render | 201 | video | 13 |
| document | 70 | siteplan | 7 |
| **logo** | **15** *(4 SVG)* | | |

The brand marks are real vectors, not scrapes of raster headers:

```
sources/media/originals/azw-azuraworldhotel-com-861da88ce9b6.svg
sources/media/originals/azw-azuraworldhotel-com-8a3dc5e73f6d.svg
sources/media/originals/azw-azuraworldhotel-com-e032cf9ea6f4.svg
```

By subject: project 368 · hotel 222 · unit 187 · amenity 35 · location 19 · developer 2.

## 2. The rights line — read before using any of it

**Current classification: 789 `internal_only` · 44 `unknown` · 0 `attributed_display`.**
`public/media/` holds one file. W0-D defaulted everything closed, correctly: these are Cebeci
Group's copyrighted marketing assets and **this repository is public**.

There is a defensible path, and a line it must not cross:

- **Identification is defensible.** Using Azura World's name and logo to identify the subject of a
  competitive analysis is nominative use — the same reason a review may show the product's box.
  Every use must be visibly attributed and unambiguously analytical.
- **Promotion is not.** The logo must never appear as *our* branding, in *our* header, or in a way
  that implies endorsement, partnership, or that this is an official Azura World property.
- **Photography is the harder case.** A hero built from Cebeci's marketing renders is republishing
  their creative work at full bleed. Prefer: our own abstractions (the R3F coast maquette),
  schematic masterplans, and data visualisation. Use their photography **small, captioned, and
  sourced** — as evidence inside the analysis, not as decoration.

**Practical rule for W3-A:** the page's *visual identity* is ours; their assets appear as
**cited evidence**, each with a `SourceChip`. Anything promoted from `internal_only` needs the
decision written into `MEDIA-LICENSE.md` with the term you relied on.

> Every one of these is already fetchable through the manifest with its `SourceRef`, so
> attribution is a prop, not extra work.

## 3. Techniques to implement

### 3.1 ScrambleText — and a correction

`CONVENTIONS.md` §1 says "GSAP free tier only — no Club plugins." **That is out of date.** GSAP's
full plugin set, ScrambleText and SplitText included, is free as of GSAP 3.13. The reference repo
confirms it in its own README: *"GSAP 3.15 (ScrollTrigger + ScrambleText, all free)."*

```ts
gsap.registerPlugin(ScrambleTextPlugin)
gsap.to(el, {
  duration: 1.2,
  scrambleText: { text: "Azura World", chars: "upperCase", speed: 0.4, revealDelay: 0.2 },
})
```

The mechanic: each letter cycles random characters, then locks to its real value left-to-right, so
the word decodes into place. Use it **once**, on the hero wordmark. Scrambling three headings is
a gimmick; scrambling one is a signature.

Under `prefers-reduced-motion`, render the final string directly — never a partially-scrambled
frame.

### 3.2 Metallic wordmark

```css
.wordmark {
  background: linear-gradient(175deg, #0b2b3a 0%, #7fa8bb 42%, #ffffff 50%, #7fa8bb 58%, #0b2b3a 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
```

Dark → silver gradient with **one** white highlight band at the optical centre makes flat type read
as polished metal. Keep the highlight narrow. Verify contrast against both themes — `color:
transparent` defeats automated contrast checks, so measure the rendered pixels or provide an
accessible fallback.

### 3.3 Letter-spacing in `em`, never `px`

`1em` = the current font-size, so `0.2em` holds its proportion at 20px and at 200px. This is why
wide-tracked display type survives the jump to mobile. Applies to every tracking value in
`globals.css` — no `letter-spacing: 2px` anywhere.

### 3.4 Video grading in CSS

```css
.graded { filter: saturate(1.1) contrast(1.05) sepia(0.15); }
.vignette::after {
  content: "";
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at center, transparent 45%, rgba(4,16,26,0.55) 100%);
  pointer-events: none;
}
```

One warm palette across every clip, tunable live in devtools. We have **13 harvested videos** —
but see §2: prefer a poster frame plus attribution over rehosting a competitor's promotional film.

### 3.5 3D — what applies and what doesn't

Do apply: **PBR materials** for believable surfaces, **HDRI lighting** via drei's `Environment`
(procedural, no external file), subtle bloom via `@react-three/postprocessing`.

**DRACO and KTX2 do not apply here** and should not be added. They compress *imported* geometry
and textures; our maquette is procedural — there is no GLB to compress. Adding the loaders would
grow the bundle to solve a problem we do not have. If a real model is ever imported, revisit.

**Keep the specs in the DOM.** The block counts, areas and distances must be real HTML with
provenance, not labels painted into a canvas. A canvas is invisible to search engines and to
screen readers, and in this project it would also be invisible to the evidence gate.

**Measured constraint:** the lazy 3D chunk is **236.4 KB gz** against a 150 KB budget. Removing
`drei` saved 10 bytes — already tree-shaken, so that is three.js + R3F itself. W-INT must either
raise the budget with this number or record the decision to drop WebGL. Do not silently exceed it.

## 4. Scroll choreography

Lenis for scroll feel · GSAP ScrollTrigger for choreography · Framer Motion for component state.
Three tools, three jobs — do not add a fourth.

Read Codrops' *"The Architecture Behind Trionn: Coordinating GSAP, Three.js, Lenis and Web Audio"*
(July 2026) before wiring them together; the failure mode is three libraries each running their
own `requestAnimationFrame` and fighting.

**One rAF loop.** Drive GSAP's ticker from Lenis, and R3F's frameloop from the same source.

## 5. Reference libraries — what fits our stack

| | Verdict |
|---|---|
| **Animate UI** (animate-ui.com) | ✅ React + TS + Tailwind + Motion + shadcn CLI. Same stack. Best source for primitives. |
| **Inspira UI** (inspira-ui.com) | ❌ **Vue**, not React. Read for ideas — glow border, lamp effect, particle image — reimplement in React. Do not try to install. |
| **Lenis** (darkroomengineering) | ✅ Pinned 1.3.25 |
| **GSAP + ScrollTrigger + ScrambleText** | ✅ Pinned 3.15, all plugins free |

Study for judgement, not for copying: Awwwards → Real Estate (Village Properties, Hubtown, ARETÈ
Immobiliare, Elyse Residence), Refero for product UI, aura.build and Dribbble for direction only —
a Dribbble shot has no empty state, no error state and no scroll.

## 6. Tooling, stated plainly

**Available and worth loading:** `emil-design-eng` — this is Emil Kowalski's philosophy directly,
which is what was asked for. Also `apple-design`, `improve-animations`,
`find-animation-opportunities`, `animation-vocabulary`, `dataviz`.

**Not available in this environment and cannot be installed:** a `motion.dev` skill, a `gsap`
skill, a `three.js` skill, a "taste" skill, a "UI/UX pro max" skill, Playwright MCP, and the
Chrome extension. Asking again will not change it.

**What replaces them, and is better:** the libraries are already pinned and working in
`D:\Real Estate CRM\New Level Premium` — GSAP 3.15, three 0.185.1, R3F 9.6.1, drei 10.7.7,
postprocessing 3.0.4, Lenis 1.3.25. Read `components/three/TowerMaquette.tsx` (235 lines) and
`components/anim/{Reveal,ScrambleText,CountUp}.tsx`. That is house style that already ships, which
beats any generic skill. **Playwright is installed locally** — drive a real browser for design
review and screenshots without MCP.

## 7. The line that governs all of it

A page that looks extraordinary and misrepresents its certainty has failed. Provenance stays
visible, conflicts stay on the front page, `prefers-reduced-motion` yields a complete static page,
and no WebGL yields a poster rather than a blank box. **Craft serves the evidence; it does not
decorate over it.**
