# DESIGN RESEARCH — reference brief for W1-D

Seed material for the `DESIGN.md` that W1-D writes. Not the design system itself — the inputs,
with the ones that actually apply to our stack separated from the ones that don't.

---

## 1. Component-library references — what actually fits

| Library | Stack | Verdict |
|---|---|---|
| **Animate UI** — animate-ui.com | **React** + TS + Tailwind + Motion + shadcn CLI | ✅ **Fits.** Same stack as ours. Best source for animated primitives |
| **Inspira UI** — inspira-ui.com | **Vue** + shadcn-vue + @vueuse/motion | ❌ **Vue, not React.** Do not try to install. Read it for *ideas* — glow border, lamp effect, particle image — and reimplement in React |
| **Lenis** — darkroomengineering/lenis | framework-agnostic | ✅ Already pinned at `1.3.25` (proven in the NLP repo) |
| **GSAP + ScrollTrigger** | agnostic | ✅ Pinned `3.15.0`. Free tier only — no Club plugins |
| **Motion (Framer Motion 12)** | React | ✅ Pinned `12.40.0` |
| **shadcn / Base UI** | React | ✅ Already the primitive layer in 1Çatı |

**Do not add a new animation library.** Three tools, three jobs — GSAP for scroll choreography,
Motion for component state, Lenis for scroll feel. A fourth overlaps and bloats the bundle.

## 2. Inspiration sources to study

Study these for *judgement*, not for copying. W1-D should browse and take notes before designing.

- **Awwwards → Real Estate** — `awwwards.com/websites/real-estate/`. Recent honourees include
  Village Properties (Site of the Day + Developer Award), Hubtown (SOTD, June 2026), ARETÈ
  Immobiliare, Elyse Residence.
- **Codrops** — *"The Architecture Behind Trionn: Coordinating GSAP, Three.js, Lenis and Web
  Audio"* (July 2026) is the single most relevant technical write-up: how to make these four
  cooperate without fighting each other's rAF loops.
- **Refero** (`refero.design`) — real product UI patterns, useful for the dashboard rather than
  the landing page.
- **Dribbble / aura.build** — visual direction only. Dribbble shots are not shipped products;
  never copy a layout that has no scroll, no empty state and no error state.
- **Emil Kowalski** — `emilkowal.ski` (his `/ui` path 404s; the writing is under `/blog` and his
  *Animations on the Web* course). **The `emil-design-eng` skill is installed in this
  environment and encodes his philosophy — load it, it is the real thing.**

## 3. The design tension to resolve

Award-winning real-estate sites split into two camps:

- **Conversion infrastructure** — Zillow, Redfin, Opendoor. Dense, fast, functional.
- **Brand theatre** — Sotheby's, Compass, Douglas Elliman. Cinematic, slow, immersive.

**Azura World CATI is neither, and that is the design problem.** It is an *intelligence product
about* a brand-theatre property. The landing page has to feel premium enough to be credible about
a 5★ resort, while the evidence layer has to read as rigorous rather than promotional.

Proposed resolution for W1-D to accept, refine, or reject with reasons:

> **Cinematic hero, forensic body.** The top of the page earns attention with motion and
> photography. Below the fold it becomes visibly analytical — provenance chips, conflict badges,
> source counts. The transition is the point: *this looks like marketing, then shows you its
> working.* The evidence band (W3-A §6) is where the register changes.

## 4. Non-negotiables that outrank aesthetics

Anything from the references above is subordinate to these:

1. **`prefers-reduced-motion` produces a complete, static page** — not a faster one. Content
   revealed only by ScrollTrigger is invisible to that user.
2. **LCP ≤ 2.5s throttled mobile, JS ≤ 250KB gz on the landing route.** A 3MB hero disqualifies
   itself no matter how good it looks.
3. **No WebGL → poster fallback.** Never a blank box.
4. **Contrast ≥ 4.5:1 in both themes**, measured, not eyeballed.
5. **German runs ~30% longer than English, Russian ~35%.** A layout that only works in English
   is not a layout.
6. **Provenance is visible, not hover-only.** A conflict badge behind a mouse hover is invisible
   to touch and to screen readers, and the conflicts are the product.

A design that violates 1, 2 or 6 gets rejected in review regardless of how it looks.

## 5. Identity direction

1Çatı is deep teal `#066B63` + gold `#B9822B` — warm, institutional, Turkish-market.

Azura is **azure**: Mediterranean water, 300 m from the sea, a 5★ resort. Cool, luminous,
coastal. Starting point in W1-D — refine it, don't just accept it:

```
--primary  #0E6B8C   azure
--accent   #D98E3A   warm sand, CTAs only
--ring     #1594BE
dark --primary #46C8E8
```

Type: **Playfair Display** (display) + **Manrope** (body) — both cover Latin-ext **and Cyrillic**,
which `ru` requires. Verify the shipped subset actually contains Cyrillic; a missing glyph
renders as a silent box.

**The test:** a screenshot of Azura next to a screenshot of 1Çatı, and nobody mistakes one for
the other.

## 6. Tooling reality

Available in this environment and worth loading: **`emil-design-eng`**, `apple-design`,
`improve-animations`, `find-animation-opportunities`, `animation-vocabulary`, `artifact-design`,
`dataviz`.

Not available and cannot be installed here: a `motion.dev` skill, a `gsap` skill, a `three.js`
skill, a "taste" or "UI/UX pro max" skill, and Playwright MCP. Substitutes that are as good or
better:

- **The libraries themselves are already pinned and proven** in `D:\Real Estate CRM\New Level
  Premium` — GSAP 3.15, three 0.185.1, R3F 9.6.1, drei 10.7.7, postprocessing 3.0.4, Lenis
  1.3.25. Reading `components/three/TowerMaquette.tsx` beats any generic skill, because it is
  the house style and it already works.
- **Playwright is installed locally**, so W1-D and W4-B can drive a real browser for design
  review and screenshots without MCP.
- **WebFetch/WebSearch** are available for browsing the inspiration sources directly.
