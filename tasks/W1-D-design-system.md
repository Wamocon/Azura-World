# W1-D — Design system, motion, provenance UI

**Wave:** 1 · **Depends on:** W0-A · **Blocks:** every W3-* surface · **Runs with:** W1-A, W1-B, W1-C

> Read `SYSTEM-PROMPT.md`, `CONVENTIONS.md` first. Then:
> `D:\Real Estate CRM\Cati\apps\web\app\globals.css` (token structure),
> `D:\Real Estate CRM\New Level Premium\components\anim\` and `components\three\` (motion + 3D).
>
> **Read `DESIGN-RESEARCH.md` first** — reference libraries, inspiration sources, the identity
> direction, and the design tension you must resolve.
>
> Load the `emil-design-eng` and `apple-design` skills before designing interactions.
> `emil-design-eng` encodes Emil Kowalski's philosophy directly and is the most relevant one here.
>
> Browse the inspiration sources yourself before designing — Awwwards' real-estate category, the
> Codrops Trionn write-up on coordinating GSAP + Three.js + Lenis, Animate UI's React primitives.
> Playwright is installed locally, so you can drive a real browser for this.
>
> **Note:** the live-simulation layer is **W3-I**, not you. You build the primitives it composes.

---

## Mission

A visual identity that is unmistakably **not** 1Çatı, built on the same technical foundations —
and the component that makes this project honest: the **provenance chip**, which renders a
number together with where it came from and whether sources agree.

1Çatı is deep teal `#066B63` + gold `#B9822B` — warm, institutional, Turkish-market. Azura is
_azure_: Mediterranean water, 300 m from the sea, a 5★ resort. Cool, luminous, coastal. If a
screenshot of the two sits side by side, nobody should mistake one for the other.

---

## Files you own

```
apps/web/app/globals.css
apps/web/components/ui/*                (button, input, label, card, badge, table, dialog, tabs, tooltip, skeleton, empty-state)
apps/web/components/evidence/*          (source-chip, confidence-badge, conflict-popover, provenance-value)
apps/web/components/anim/*              (reveal, scramble-text, counter, stagger)
apps/web/components/three/*             (coast-maquette + poster fallback)
apps/web/components/providers/*         (theme, lenis, motion-preference)
apps/web/lib/motion.ts · apps/web/lib/cn.ts
DESIGN.md
HANDOFF/W1-D.md
```

---

## Deliverables

### 1. Token system — `globals.css`, Tailwind v4 CSS-first

**No `tailwind.config.js`.** `@theme inline` block, mirroring 1Çatı's structure with Azura's palette.

```css
:root {
  --font-sans: "Manrope", "Segoe UI", system-ui, sans-serif;
  --font-display: "Playfair Display", Georgia, serif;
  color-scheme: light;

  --background: #f6fafc;
  --foreground: #0a1620;
  --primary: #0e6b8c; /* azure — the identity colour */
  --accent: #d98e3a; /* warm sand, for CTAs only */
  --ring: #1594be;
  /* ...full token set: card, popover, secondary, muted, destructive, border, input, sidebar, chart-1..5 */
}

.dark {
  --background: #04101a;
  --primary: #46c8e8;
  /* ... */
}
```

Both themes must hit **4.5:1 contrast**. Verify with a real checker and paste the numbers — do
not eyeball it. Fonts cover Latin-ext **and Cyrillic** (Manrope and Playfair Display both do);
verify the subset you actually ship, because a missing glyph renders as a silent box.

### 2. Provenance components — the heart of this project

Every number in this app renders through these. They are why a competitor CATI is defensible.

```tsx
<ProvenanceValue fact={project.plotAreaSqm} format="area" locale={locale} />
// → "76.000 m²"  with a subtle source affordance

<SourceChip source={ref} />
// → "Seaside Alanya · 27.07.2026" — links to the live URL AND the local snapshot

<ConfidenceBadge confidence="conflicted" />
// → amber "Quellen widersprechen sich"

<ConflictPopover fact={unit.askingPrice} />
// → all competing values, each with publisher, date, tier, and its URL
```

Visual rules, non-negotiable:

| Confidence               | Treatment                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `confirmed` / `official` | Normal. Quiet source affordance on hover/focus.                                           |
| `single_source`          | Subtle dotted underline.                                                                  |
| `conflicted`             | **Amber badge, always visible, never hover-only.** Value shown as a range where possible. |
| `inferred`               | Italic + a "berechnet" marker.                                                            |
| `gap`                    | Render **"—"** with "Nicht belegt". **Never render 0, never render blank.**               |

- A `modelled` unit is visually distinct from a `portal_listing` **at a glance, in the list, not
  only on the detail page.**
- A `stale` listing carries its badge next to the price, not in a footnote.
- The conflict affordance must be reachable by keyboard and readable by a screen reader. Hiding
  disagreement behind a mouse hover defeats the point.

### 3. Motion — GSAP + Lenis + Framer Motion

`lib/motion.ts` centralises durations and easings. Nobody hardcodes a duration in a component.

```ts
export const duration = { instant: 0.12, fast: 0.2, base: 0.32, slow: 0.5, hero: 0.8 } as const
export const ease = { out: "power2.out", inOut: "power2.inOut", spring: [0.34, 1.56, 0.64, 1] } as const
export const prefersReducedMotion = () => /* matchMedia, SSR-safe */
```

- GSAP + ScrollTrigger for scroll choreography; Framer Motion for component-level state; Lenis
  for smooth scroll. Three tools, three jobs, no overlap.
- **`prefers-reduced-motion` must produce a static, complete, correct page** — not a faster
  animation. Content that only appears via a scroll-triggered reveal is invisible to that user.
  Test with the flag on; if anything is missing, the implementation is wrong.
- No layout thrash: animate `transform` and `opacity` only. Never `width`/`height`/`top`.
- Kill every ScrollTrigger and GSAP context on unmount. Leaked triggers cause the "scroll breaks
  after navigating twice" bug.

### 4. 3D — `components/three/coast-maquette.tsx`

An abstract coastal massing model (7 blocks, sea plane, sun) for the landing hero. Not a
photoreal render — a confident abstraction reads better and loads in a fraction of the bytes.

**Mandatory guards:**

- Lazy-load behind an intersection observer. **Never blocks LCP.**
- WebGL unavailable or `prefers-reduced-motion` → a static poster image. Not a blank box, not a
  spinner that never resolves.
- Pause `requestAnimationFrame` when off-screen or the tab is hidden.
- Cap DPR at 2. Uncapped DPR on a 3× phone melts the GPU.
- Hard budget: ≤150KB gzipped for the whole 3D route chunk.
- Dispose geometries, materials and textures on unmount.

### 5. UI primitives

shadcn-style on Base UI. Every data component ships **four states**: loading (skeleton), empty
(explained, with an action), error (recoverable, with a retry), and populated. A component with
only the populated state will be sent back in review.

### 6. `DESIGN.md`

The design documentation this project does not inherit from anywhere — the reference repos have
no `design.md`. Write it: tokens and their reasoning, the type scale, spacing rhythm, the
provenance visual language, motion principles, the accessibility floor, and an explicit
"what makes this not 1Çatı" section. Include contrast measurements as measured numbers.

---

## Edge cases

- German strings ~30% longer, Russian ~35% (get the measured ratios from W1-C's handoff). Buttons
  and table headers must not clip. Test at 320px with German.
- Dark mode + amber conflict badge — verify contrast **in both themes**. Amber on dark is the
  usual failure.
- `ProvenanceValue` with a `gap` fact → "—", never `0`, never empty. This is the single most
  important edge case in the component library.
- A fact with 6 competing sources → the popover scrolls, does not overflow the viewport.
- A source URL that is now dead → chip still renders, links to the **local snapshot**, marked
  "Quelle nicht erreichbar". This will happen: 9 of 23 sources were already unreachable at probe
  time.
- Tap targets ≥ 24px. Ataberg's harness caught real violations under this threshold.
- Focus must be visible on every interactive element in both themes. Never `outline: none`
  without a replacement.
- Skeletons must match the real content's dimensions, or the page shifts on load and CLS spikes.
- 656 rows: the table primitive must support virtualisation. Do not render 656 DOM nodes.
- Print styles: the report poster page must print cleanly on A4.

---

## Definition of done

```bash
pnpm --dir apps/web typecheck
pnpm --dir apps/web lint
pnpm --dir apps/web build
```

Plus a `/de/kitchen-sink` dev-only route rendering every primitive in every state, both themes,
which you screenshot and attach. Specifically prove:

1. `ProvenanceValue` for all six confidence levels, including `gap` → "—"
2. `ConflictPopover` with F-002's four competing 1+1 prices (€112k / €185k / €220k / $239k)
   — **all four visible, USD not converted**
3. Contrast ratios measured for primary/foreground/accent in both themes — paste the numbers
4. `prefers-reduced-motion: reduce` → page complete and static, nothing missing
5. WebGL disabled → poster fallback renders
6. 320px viewport with German copy → no clipping, no horizontal scroll

---

## Handoff must state

- The full token list, so W3-* windows never hardcode a colour
- The `ProvenanceValue` / `SourceChip` API — every W3-* window calls these
- Measured contrast ratios (numbers, not "passes")
- The motion budget: which surfaces may animate, and the reduced-motion contract
- The 3D chunk size as built
