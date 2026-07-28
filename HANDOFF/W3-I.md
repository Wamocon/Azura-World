# HANDOFF — W3-I Live simulation & immersion layer

STATUS: COMPLETE
Completed: 2026-07-27

---

## What was built

| File                                                      | Lines | What it is                                                            |
| --------------------------------------------------------- | ----- | --------------------------------------------------------------------- |
| `apps/web/lib/simulation-clock.ts`                        | 196   | Seeded clock. mulberry32, fixed epoch, tab-visibility pause.          |
| `apps/web/components/immersion/simulation-label.tsx`      | 108   | `SimulationBanner` + `SimulationChip`.                                |
| `apps/web/components/immersion/primitives.tsx`            | 330   | `TiltCard`, `KineticHeadline`, `AnimatedCounter`, `AuroraBackground`. |
| `apps/web/components/immersion/azura-live-simulation.tsx` | 300   | The operational ticker.                                               |
| `apps/web/components/immersion/azura-site-world.tsx`      | 250   | CSS isometric masterplan + step-through.                              |
| `apps/web/components/immersion/azura-unit-explorer.tsx`   | 300   | 656 units, filter + search + connection state.                        |
| `apps/web/components/immersion/azura-evidence-flow.tsx`   | 290   | The evidence pipeline, ending unresolved on F-002.                    |
| `apps/web/app/sections/azura-immersion.tsx`               | 165   | The composed section — **W3-A's import surface**.                     |
| `apps/web/app/[locale]/kitchen-sink/immersion-demo.tsx`   | 275   | Mounts all of it against the real dataset.                            |

`AzuraCoastMaquette` is `components/three/coast-maquette.tsx`, built under W1-D
with all of its guards, and composed here inside a `TiltCard`.

Isometric CSS (`.azura-iso-*`) lives in `app/globals.css`, which W1-D also owns —
so no cross-window request was needed.

---

## The import surface W3-A consumes

One component, one props object, **all serialisable**:

```tsx
import { AzuraImmersionSection } from "@/app/sections/azura-immersion";

<AzuraImmersionSection
  locale={locale}
  labels={labels} // AzuraImmersionLabels — plain strings only
  blocks={blocks} // SiteBlock[]    — code, unitCount, kind
  units={units} // ExplorerUnit[] — pass all 656; it windows them
  facts={facts} // SiteWorldFacts — five SourcedFacts
  counts={counts} // EvidenceFlowCounts
  competingPrices={prices} // CompetingPrice[] — F-002
  entryPriceFact={fact} // SourcedFact<Money>
  realtime={false} // from W2-D
/>;
```

It is a **Server Component** and imports no data. Every figure arrives as a
prop, so the section cannot quietly start rendering a number nobody sourced.
`immersion-demo.tsx` shows the exact mapping from the generated dataset;
swapping it for W2-A's repositories is a change of source, not of shape —
`RepositoryResult.data` is already what these props expect.

**`labels` contains no functions.** These components are `"use client"` and
W3-A's page is a Server Component; React cannot serialise a function across that
boundary. Placeholders are `{count}`, `{visible}`, `{total}`.

---

## Verification actually run

| Command                                   | Result                               | Evidence                                                                              |
| ----------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| Scoped `tsc --noEmit` (W1-D + W3-I files) | **PASS** exit 0                      | scratchpad config; W3-I subtree included                                              |
| `eslint` over all owned paths             | **PASS** exit 0, 0 errors 0 warnings | see below                                                                             |
| Playwright, real Chromium                 | **PASS — 16/16**                     | output below                                                                          |
| `pnpm --dir apps/web build`               | **PASS** exit 0                      | Blocked on W2-C's `ai-retrieval.ts:147` for most of the run; green in the final pass. |
| `pnpm qa:perf`                            | **NOT RUN**                          | script does not exist; W4-B owns it                                                   |

### Lint — the five errors the supervisor flagged as S-002 were mine, and are fixed

All in W1-D files, all real, none suppressed:

- `reveal.tsx` passed `ref` inside a `Record<string, unknown>` cast to
  `createElement`, which reads to `react-hooks/refs` as a ref access during
  render. Replaced with JSX over a closed `RevealTag` union and a callback ref.
- `coast-maquette.tsx` (×2) and `theme-toggle.tsx` set state inside an effect.
  Both now use `useSyncExternalStore` with a `false` server snapshot.
- `TiltCard` mutated a ref's object in place and had a `useCallback` that
  referenced its own binding. The interaction moved into one effect with native
  listeners.

```
$ npx eslint components app/sections app/[locale]/kitchen-sink lib/cn.ts lib/motion.ts lib/simulation-clock.ts
LINT EXIT: 0
```

### Playwright, `/de/kitchen-sink` §8

```
PASS  simulation-clock determinism: two loads, identical frame at t=0
        309 chars, identical=true
PASS  simulation label is visible text, in flow
        "SIMULIERTER BETRIEB — KEINE ECHTDATEN …"
PASS  simulation label survives a screenshot (not fixed, not transparent)
        position=static opacity=1
PASS  simulated feed shows NO monetary amounts        no currency markers
PASS  no simulated record is reachable as a link      0 <a> inside the feed
PASS  masterplan declares itself a schematic
PASS  evidence flow: competing values in two currencies, unconverted
        18 rows, USD=true EUR=true
PASS  unit explorer windows the full inventory
        23 <tr> in DOM · "656 von 656 Einheiten"
PASS  tab hidden: ticker pauses      feed unchanged over ~3 tick intervals
PASS  tab visible again: ticker resumes, does not fast-forward
PASS  reduced motion: ticker renders a FULL feed, not an empty box   6 events
PASS  reduced motion: nothing in the immersion layer is left invisible  0 offenders
PASS  reduced motion: maquette shows the poster      data-webgl=false
PASS  320px German: no horizontal page scroll        scrollWidth=320 clientWidth=320
PASS  320px German: nothing in the immersion layer overflows   0 offenders
PASS  320px: simulation label still visible          visible=true

16 pass · 0 fail
```

### Two defects a browser found that reading the code did not

1. **Incoherent feed rows.** The ticker picked a block code and a unit id
   independently, producing `B03 · AZW-B01-0056` — a unit shown against a block
   its own id contradicts. The events are simulated and labelled as such; being
   _internally incoherent_ is a different failure and reads as a data bug. The
   block now comes from the unit.
2. **A sentence in a `Badge`.** `Badge` was `whitespace-nowrap`, so the
   masterplan's schematic warning blew the page out to 971px at a 320px
   viewport. Split into a short badge label plus a paragraph — **and `Badge`
   itself now wraps rather than overflowing**, so the next misuse degrades
   instead of breaking. Truncation was the alternative and is worse: it hides
   meaning silently.

---

## How simulated data is prevented from being mistaken for live data

Six mechanisms, not one label:

1. **A banner in normal flow** on every immersion surface: `position: static`,
   `opacity: 1`, real text. Verified — it survives a screenshot and a print, and
   it is not hover-only.
2. **A chip in the header**, beside the heading, in the simulation colour.
3. **Its own colour.** `--simulation` / `--surface-simulation` are used by
   nothing else. The whole card is tinted and bordered in it.
4. **No money at all.** The feed shows no amount in any currency — verified by
   assertion. A simulated euro figure is a fabricated number, and no label makes
   one safe beside a project whose real prices are an open conflict (F-002).
5. **Nothing is a link.** Ids render as text, so a simulated ticket is not
   reachable from a real ticket route.
6. **The sync badge is not W2-D's.** A simulated surface must not borrow a live
   surface's freshness vocabulary, and it never says "offline" — it names the
   fallback in effect.

The masterplan carries its own version of this: it states that only the block
count and the unit total are corroborated and that **the arrangement is drawn**.
No source publishes a site plan, and a plausible-looking one reads as a survey.

---

## Reduced-motion behaviour, per component

| Component             | Under `prefers-reduced-motion: reduce`                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `AzuraLiveSimulation` | Renders a **full six-event feed** — its complete final state, not a paused first frame. The clock never starts.                |
| `AzuraSiteWorld`      | Scene renders statically; the CSS float is opted in under `no-preference` so it never starts. All figures are text regardless. |
| `AzuraUnitExplorer`   | No motion to begin with.                                                                                                       |
| `AzuraEvidenceFlow`   | Static. The F-002 panel renders whether or not the reader steps through, so the argument is never behind an interaction.       |
| `TiltCard`            | Returns a plain `div`. No listeners, no rAF.                                                                                   |
| `KineticHeadline`     | Returns plain text, no motion wrapper.                                                                                         |
| `AnimatedCounter`     | Renders the final value. No count-up.                                                                                          |
| `AuroraBackground`    | Static gradient stays; only the drifting layer is withheld.                                                                    |
| `CoastMaquette`       | Poster.                                                                                                                        |

Verified: **0 elements left below 5% opacity** anywhere in the section.

---

## Determinism

`lib/simulation-clock.ts` is seeded (mulberry32 over a stable string hash) with
a fixed epoch — never `Date.now()`, never `Math.random()`. Three reasons, all
load-bearing: Playwright snapshots must be stable; SSR and hydration must agree
on the first frame; and a bug in a simulated feed is only reproducible if the
feed is.

`eventForTick(n)` is a **pure function of the tick**, so frame N can be
reproduced without replaying 0…N−1. The RNG advances once per tick whether or
not anyone reads it, so mounting a second consumer cannot change the first
one's output.

Measured: two independent page loads produce a byte-identical first frame.

This matches the 1Çatı reference, which contains no `Math.random()` in any
displayed value — its variation is arithmetic over real records.

---

## Contracts I consumed

`SourcedFact<T>`, `SourceRef`, `Money`-shaped values, and `AzuraUnit`'s
`dataQuality` union. All fitted.

One note: `AzuraWorldDataset` types `project`, `hotel` and `blocks` as
`Record<string, unknown>` in its declared interface, but the const is written
`… satisfies AzuraWorldDataset`, so the literal type survives and
`dataset.project.plotAreaSqm` is reachable. `immersion-demo.tsx` still casts
through a one-line `asFact` helper, because the dataset declares its own
`Azura*` twins rather than importing `contracts.ts` (it is dependency-free by
design). The two are identical field-for-field.

---

## Requests for other windows

1. **W3-A** — mount `LenisProvider` around the landing route yourself. It is
   deliberately not global (a 656-row table should not have its wheel hijacked).
   Also see the label-shape note above: strings with `{count}`, never functions.
2. **W1-C** — the immersion layer needs its own message keys. The full German
   set is in `immersion-demo.tsx` and can be lifted verbatim into
   `messages/*.json`: `immersion.{eyebrow,headline,intro,maquetteAlt}`,
   `immersion.liveSimulation.*`, `.siteWorld.*`, `.unitExplorer.*`,
   `.evidenceFlow.*`.
3. **W2-D** — `AzuraUnitExplorer` takes a `realtime` boolean and renders its own
   connection chip. It deliberately does **not** import your `SyncBadge`: a
   simulated surface must not share a live surface's freshness vocabulary. The
   explorer is real data, so it _may_ use yours later — but the ticker must not.
4. **W2-C** — still blocking the production build: `lib/ai-retrieval.ts:147`,
   `Type 'number' is not assignable to type 'SourceTier'`.

---

## Known gaps

- **Bundle sizes are now MEASURED** (the build unblocked once W2-C fixed
  `ai-retrieval.ts`). Real transfer sizes from `next start` + Chromium: **lazy
  3D chunk 236.4 KB gz against a 150 KB budget — over by 86 KB**, and
  `/de/kitchen-sink` initial JS 297.3 KB gz (a dev-only route importing the
  whole dataset plus every primitive plus this layer, so not the landing
  route). Removing `@react-three/drei` saved 10 bytes and was reverted — it was
  already tree-shaken, so the 236 KB is three.js + R3F itself. Full reasoning
  and the decision it forces are in HANDOFF/W1-D.md.
- **`[GAP]` LCP ≤ 2.5s, INP, CLS** still NOT MEASURED — `pnpm qa:perf` is
  W4-B's script and does not exist.
- **PRODUCTION CSP: a statically rendered page runs zero JavaScript.** Found
  while measuring, and it would have silently disabled this entire layer in
  production. Evidence and the fix applied to my own route are in
  HANDOFF/W1-D.md — **W3-A must read that before choosing a rendering mode.**
- **`[GAP]` 60s soak / DevTools memory trace.** NOT RUN. The behavioural
  equivalent was measured — the ticker provably stops while the tab reports
  hidden and resumes without fast-forwarding, and the clock's `stop()` clears
  its interval and removes its listener — but no heap trace was taken.
- **`[GAP]` Four-locale screenshots.** Only `de` was rendered. The other three
  locales have no message keys for this layer yet (see request 2), so a `tr`
  screenshot today would be a German screenshot at a different URL. The
  component takes every string as a prop, so nothing is hardcoded.
- **`[GAP]` Screen-reader pass.** Semantics are correct by construction — the
  moving feed is `aria-hidden` with a text summary beside it, the isometric
  scene is `aria-hidden` with the same figures as a `<dl>`, `aria-live="polite"`
  on the result count — but nothing was driven with NVDA or VoiceOver.
- **The step-through walkthrough changes detail, not camera.** Matching the
  reference, which also keeps the camera fixed and varies opacity/scale per
  step. A moving camera on a CSS isometric scene means animating a transform on
  a `preserve-3d` parent, which re-rasterises every child each frame.

---

## Environment note

`next dev` (Turbopack) cannot compile `globals.css` on this machine under load —
it spawns a subprocess per PostCSS asset and Windows returns `0xc0000142` with
~30 node processes alive across four windows. **`next dev --webpack` works**,
and is what every measurement above was taken against.
