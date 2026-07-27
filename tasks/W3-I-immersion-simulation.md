# W3-I — Live simulation & immersion layer

**Wave:** 3 · **Depends on:** W0-B, W1-D, W2-A, W2-D · **Runs with:** all other W3-*

> Read `SYSTEM-PROMPT.md`, `HANDOFF/W1-D.md` (tokens, motion budget, provenance components).
> Then read these in full — they are the thing you are matching:
>
> | Component | Lines | What it is |
> |---|---|---|
> | `Cati\apps\web\components\live-erp-simulation.tsx` | 961 | Ticker of simulated ERP activity: tickets, payments, AI actions, sync |
> | `Cati\apps\web\components\phase4-live-operations.tsx` | 797 | Interactive unit explorer with live filter/search/online-offline |
> | `Cati\apps\web\components\isometric-erp-world.tsx` | 771 | **CSS** isometric world, step-through walkthrough |
> | `Cati\apps\web\components\people-directory-live.tsx` | 436 | Animated role/people directory |
> | `Cati\apps\web\components\finance-live-ledger.tsx` | 410 | Ledger entries posting in real time |
> | `Cati\apps\web\components\dashboard-preview.tsx` | 357 | SVG product preview |
> | `Cati\apps\web\components\site-command-simulation.tsx` | 182 | Site command overview from seed data |
> | `Cati\apps\web\components\3d-card.tsx` | 32 | Pointer-tracking tilt card |
> | `NewLevelPremium\components\three\TowerMaquette.tsx` | 235 | R3F WebGL maquette — the only real 3D in either repo |

---

## Why this task exists

My original wave plan specified **one** WebGL component and four motion primitives. 1Çatı has
roughly **4,100 lines** of live-simulation components, and they are its signature: the landing
page does not *describe* the ERP, it *runs* a simulation of it. Without this layer the Azura
build is functionally comparable and visibly thinner.

Note what these actually are: **Framer Motion + CSS, driven by real seed data.** Even
`isometric-erp-world` is CSS isometric, not three.js. `3d-card` is a 32-line tilt effect. The
only true WebGL in either reference repo is NLP's 235-line `TowerMaquette`. So the impressive
part is **choreographed real data**, not a renderer — build it that way.

---

## Files you own

```
apps/web/components/immersion/*
apps/web/app/sections/azura-immersion.tsx
apps/web/lib/simulation-clock.ts
HANDOFF/W3-I.md
```

W3-A owns the landing page and imports your sections. Agree the import surface with them early.

---

## Deliverables

### 1. `AzuraLiveSimulation` — the centrepiece

A ticker of plausible operational activity for a 656-unit, 188-room complex: service tickets
opening and closing, payments posting, reservations confirming, an AI action logged, a sync
badge flipping between realtime and polling.

**Non-negotiable honesty rules:**
- Driven by the **real seed dataset**, never invented figures
- Labelled **"Simulation"** in every locale, unmistakably, at all times
- Never mixed with, or styled like, a live-data surface
- A simulated ticket must not be reachable from a real ticket route

This is the one component in the build most able to mislead, so it carries the loudest label.

### 2. `AzuraSiteWorld` — CSS isometric masterplan

The 7 residence blocks, the hotel, the beach at 300 m, the 76,000 m² footprint. Step-through
walkthrough: block → floor → unit → hotel. CSS transforms, no WebGL.

Every figure through `ProvenanceValue`. The masterplan is a **schematic**, not a survey — say so
on the component, because a plausible-looking site plan reads as authoritative.

### 3. `AzuraUnitExplorer` — interactive, real data

Mirror `phase4-live-operations.tsx`: filter and search the 656 units live, with an
online/offline state. `modelled` units stay visually distinct here exactly as in W3-C.

### 4. `AzuraEvidenceFlow` — the Azura-specific one

An animated walk through the evidence pipeline: 23 sources → harvest → conflict detection →
resolution → the dataset. It ends on F-002 — four portals, four prices, one in USD, a 2.1×
spread — and shows the conflict *not* being resolved.

Nothing in the reference repos corresponds to this. It is the component that argues the whole
project, and it should be the one people remember.

### 5. `AzuraCoastMaquette` — WebGL, guarded

R3F abstract coastal massing. Model it on NLP's `TowerMaquette`. All of W1-D's guards apply:
lazy-loaded behind an intersection observer, poster fallback when WebGL is absent, rAF paused
off-screen, DPR capped at 2, disposed on unmount, ≤150KB gzipped.

### 6. Primitives

`TiltCard` (pointer tilt), `KineticHeadline` (word-by-word), `AnimatedCounter` (respects reduced
motion — no count-up, just the final value), `AuroraBackground` (CSS only).

### 7. `lib/simulation-clock.ts`

One deterministic clock driving every simulation. Seeded, not `Math.random()` — Playwright
snapshots must be stable, and a simulation that differs per load cannot be tested.

---

## Edge cases

- **`prefers-reduced-motion`** → simulations render their **final state**, complete and static.
  Not paused mid-animation, not empty. A user with vestibular sensitivity must see the same
  information.
- **No WebGL** → poster. Never a blank box or a permanent spinner.
- **Tab hidden** → pause every timer. A ticker running in a background tab for an hour is a
  battery bug.
- **Unmount** → clear every interval, kill every ScrollTrigger and GSAP context. Leaked timers
  cause the "page gets slower each navigation" bug.
- **Simulation vs live confusion** → the label is always visible, never hover-only, and survives
  a screenshot. Someone will screenshot this for a deck.
- **German/Russian copy** in tight simulation cards → the longest strings at 320px.
- **60fps budget** → animate `transform`/`opacity` only. Never `width`, `top`, or `box-shadow`.
- **Many simultaneous animations** → one shared rAF loop, not one per component.
- **Screen reader** → simulations are decorative; `aria-hidden` on the motion, with the same
  information available as text nearby. A ticker announcing every update is unusable.
- **Low-end mobile** → degrade tier: fewer particles, longer intervals, no WebGL under a
  hardware-concurrency threshold.

---

## Definition of done

```bash
pnpm --dir apps/web typecheck && pnpm --dir apps/web lint && pnpm --dir apps/web build
pnpm qa:perf     # landing route still within budget WITH the simulation layer
```

Evidence to paste:
1. Each component screenshotted, 4 locales, light + dark
2. `prefers-reduced-motion: reduce` → every simulation shows its complete final state
3. WebGL disabled → poster renders
4. **The "Simulation" label visible in every locale**, in a screenshot
5. 60s soak: no memory growth, no leaked timers (DevTools trace)
6. Unmount → timer and ScrollTrigger counts return to zero
7. Perf: LCP ≤ 2.5s and JS ≤ 250KB gz on the landing route **with** this layer present
8. `simulation-clock` determinism: two loads produce identical frames at t=0

---

## Handoff must state

- Component list, line counts, and the import surface W3-A consumes
- Measured perf delta the simulation layer adds to the landing route
- How simulated data is prevented from being mistaken for live data
- Reduced-motion behaviour per component
