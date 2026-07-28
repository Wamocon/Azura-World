# HANDOFF — W1-D Design system, motion, provenance UI

STATUS: COMPLETE
Completed: 2026-07-27

---

## What was built

- **`apps/web/app/globals.css`** — Tailwind v4 CSS-first token system mirroring
  1Çatı's file structure (imports → `@custom-variant dark` → `@theme inline`
  indirection → `:root`/`.dark` literals → base → utilities → keyframes) with
  Azura's azure palette. Adds what the reference leaves broken: `--chart-1..5`
  are actually defined (mapped-but-undefined there, so `bg-chart-1` resolves to
  transparent), `--destructive-foreground` exists, and `--border` is split from
  `--input` so control boundaries can be gated at 3:1 while hairlines are not.
- **Self-hosted type** under `apps/web/public/fonts` — Manrope + Playfair
  Display, variable, SIL OFL, 7 woff2 files, 137,704 B total, `unicode-range`
  split so de/en/tr never fetch Cyrillic. Forced by our own CSP, not preferred:
  `proxy.ts` emits `font-src 'self' data:` **and** `style-src 'self'`, so a
  Google Fonts link is blocked on both counts.
- **`apps/web/lib/motion.ts`** — durations, easings, springs, stagger, the
  reduced-motion contract, a memoised WebGL probe, and a device motion tier.
  **`apps/web/lib/cn.ts`** — the single class-merge implementation.
- **`apps/web/components/evidence/*`** — `ProvenanceValue`, `SourceChip` +
  `SourceChipList`, `ConfidenceBadge`, `ConflictPopover`, `DataQualityMark`,
  and `format.ts`.
- **`apps/web/components/ui/*`** — button, badge, card + glass card, input +
  label + field, skeleton, empty/error/loading + `DataSurface`, tooltip, dialog,
  tabs, table with windowing.
- **`apps/web/components/anim/*`** — `gsap.ts` (single registration point),
  `reveal.tsx` + `StaggerReveal`, `counter.tsx`, `scramble-text.tsx`,
  `stagger.tsx` (`StaggerList`, `StaggerItem`).
- **`apps/web/components/three/*`** — `coast-maquette.tsx` (four guards),
  `coast-maquette-scene.tsx` (R3F), `coast-poster.tsx` (inline SVG fallback).
- **`apps/web/components/providers/*`** — theme, Lenis, motion-preference.
- **`apps/web/app/[locale]/kitchen-sink/*`** — the dev-only proof route.
- **`DESIGN.md`** — tokens with reasoning, measured contrast, the provenance
  visual language, motion principles, the a11y floor, and an explicit "what
  makes this not 1Çatı".

---

## Verification actually run

| Command                                     | Result                               | Evidence                                                                                                                                                         |
| ------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scoped `tsc --noEmit` over W1-D files       | **PASS**                             | exit 0. Config at `scratchpad/tsconfig.w1d.json`, includes `components/{ui,evidence,anim,three,providers}`, `lib/{cn,motion}`, `app/[locale]/kitchen-sink`.      |
| `pnpm --dir apps/web typecheck` (full tree) | **PASS** exit 0                      | Was failing on W1-B/W1-C files mid-run; green once they landed.                                                                                                  |
| `pnpm --dir apps/web build`                 | **PASS** exit 0                      | `✓ Compiled successfully` · all 4 locale routes emitted. Blocked earlier on W2-C's `ai-retrieval.ts:147`; green once they fixed it.                              |
| `pnpm --dir apps/web lint`                  | **PASS** exit 0, 0 errors 0 warnings | Whole tree. The 5 errors the supervisor logged as S-002 were mine and are fixed — see HANDOFF/W3-I.md.                                                           |
| PostCSS compile of `globals.css`            | **PASS**                             | 61,766 B output; provenance utilities generate, alpha modifiers emit `color-mix(in oklab, var(--confidence-conflicted) 45%, transparent)` with a solid fallback. |
| Contrast harness                            | **PASS — 0 gated failures**          | 33 pairs × 2 themes. Full table in `DESIGN.md` §4.                                                                                                               |
| Playwright design review, Chromium          | **PASS — 27/27**                     | Output below.                                                                                                                                                    |

### Playwright, `/de/kitchen-sink`, real Chromium

```
PASS  theme class applied (light)              <html class="light">
PASS  background resolves (light)              rgb(244, 249, 251)
PASS  WebGL positive case: maquette mounts and draws
                                               data-webgl=true canvases=1 drawingBuffer=560x364
PASS  scroll reveals all fired (light)         0 still hidden
PASS  theme class applied (dark)               <html class="dark">
PASS  background resolves (dark)               rgb(4, 16, 26)
PASS  scroll reveals all fired (dark)          0 still hidden
PASS  all six confidence levels render         confirmed, conflicted, gap, inferred, official, single_source
PASS  gap renders "—" and not 0/blank          "— Nicht belegt …"
PASS  conflict trigger is keyboard focusable   document.activeElement data-slot = conflict-trigger
PASS  F-002: all four competing prices visible 112k=true 185k=true 220k=true 239171=true
PASS  USD shown in USD, not converted to EUR   USD marker=true EUR marker=true
PASS  conflict list is a scroll container      overflow-y=auto clientHeight=256
PASS  656-row table is windowed                23 <tr> in the DOM for 656 rows
PASS  Cyrillic subset loads for both faces     manrope=true playfair=true
PASS  Cyrillic renders in the webfonts         manrope=422.3 playfair=420.5 monospace=461.8
PASS  reduced motion: nothing left at opacity 0   0 offenders
PASS  reduced motion: all sections rendered    8 sections
PASS  reduced motion: counter shows final value   "656"
PASS  reduced motion: WebGL not started        data-webgl=false
PASS  no WebGL: poster renders                 data-webgl=false poster=560x364
PASS  no WebGL: no canvas mounted               0 <canvas>
PASS  320px light: no horizontal page scroll   scrollWidth=320 clientWidth=320
PASS  320px light: nothing overflows           0 offenders
PASS  tap targets >= 24px                      0 violations
PASS  320px dark: no horizontal page scroll    scrollWidth=320 clientWidth=320
PASS  320px dark: nothing overflows            0 offenders

27 pass · 0 fail
```

Screenshots: light, dark, reduced-motion, WebGL-disabled, 320px light, 320px
dark, and the open conflict popover.

### Blocked verifications — NOT RUN, with the reason

_(Typecheck, lint and build were all blocked on other windows' files for most
of the run — W1-B's `auth.ts`/`rbac.ts`, W1-C's `i18n/request.ts`, W2-C's
`ai-retrieval.ts:147`. All three are green as of the final pass; the scoped
config above is what let W1-D be verified while they were red.)_

- **3D route chunk size is now MEASURED** — the build unblocked later in the
  night once W2-C fixed `ai-retrieval.ts`. See "Measured bundle sizes" above:
  236.4 KB gz against a 150 KB budget.
- **LCP / INP / CLS** NOT MEASURED — `pnpm qa:perf` is W4-B's script and does
  not exist yet.

---

## Contracts I consumed

`CONTRACTS.md` §1 (`Confidence`, `SourceRef`, `SourceTier`, `SourcedFact<T>`,
`Money`) and §7 (`Locale`). All fitted; nothing needed amending.

Two notes for later waves:

- The generated dataset declares its own `Azura*` twins (`AzuraSourcedFact`,
  `AzuraSourceRef`). They are structurally identical, so a dataset fact passes
  straight into these components. **Type against `lib/contracts.ts`**, not the
  dataset's copies.
- `SourceTier` is a literal union `1|2|3|4|5|6`. A `tier: number` will not
  assign — this is exactly what is currently breaking W2-C's build.

---

## Decisions I made

1. **"Cinematic hero, forensic body" accepted, with an amendment.** The register
   changes per _number_, not per _page position_. A disputed figure reads as
   disputed in the hero too, because that is where the most quotable numbers
   are. Rationale in `DESIGN.md` §1.
2. **Conflicts are a popover, not a tooltip.** A real focusable button. Hover is
   unreachable on touch and hostile to screen readers, and the conflicts are the
   product.
3. **`--border` split from `--input`.** WCAG 1.4.11 governs control boundaries,
   not separators. One token forces a choice between heavy-handed and failing.
4. **Self-hosted fonts** — forced by our own CSP, and the files are OFL so
   redistribution is fine.
5. **Poster is inline SVG, never a photograph.** All 31 harvested media assets
   are `internal_only`; one on a public route is a rights breach.
6. **ScrambleText is hand-rolled**, not GSAP's plugin: the plugin shuffles with
   `Math.random()` and W3-I needs reproducible frames for Playwright. The filler
   glyph here is a pure function of (index, frame) — no seeded state at all.
7. **Reduced motion is opted IN under `no-preference`**, never clamped under
   `reduce`, and `Reveal` returns before it hides anything. The blanket clamp
   leaves `opacity: 0` in place and hides content permanently.
8. **Lenis does not mount under reduced motion.** Smooth scroll is JS wheel
   interception that the CSS rule cannot reach, and a common vestibular trigger.
   The NLP reference runs it unconditionally; this does not.
9. **Labels are strings with `{count}` placeholders, not functions** — see
   "Requests" below. This one changes call sites.
10. **Dark mode ships.** 1Çatı sets `forcedTheme="light"`, making its whole
    `.dark` block unreachable. Both Azura themes are contrast-verified.

---

## Requests for other windows

_*1. Every W3-* window — the label API is strings, not callbacks._*

`ProvenanceValue`, `SourceChipList` and `ConflictPopover` are `"use client"` and
their callers are Server Components. React cannot serialise a function across
that boundary — a `(count: number) => string` prop throws _"Functions cannot be
passed directly to Client Components"_ the first time a page renders one. So:

```ts
labels.conflict.summary = "{count} Quellen, keine Auflösung"; // not (n) => …
labels.more = "+{count} weitere"; // not (n) => …
snapshotBasePath = "/api/evidence/snapshot"; // not (hash) => …
```

`Counter` takes `locale` + `formatOptions` for the same reason, not a formatter.
This is also the shape next-intl messages already have, so W1-C's strings drop
in with no adapter.

**2. W1-C — please add the provenance label keys to `messages/*.json`.** The
kitchen sink hardcodes German because it is a dev-only gallery. Shape needed:
`confidence.{confirmed,official,single_source,conflicted,inferred,gap}`,
`conflict.{trigger,heading,summary,displayed,unresolvedNote,close}`,
`source.{openSource,snapshot,unreachable,tier.*}`, `gap`, `inferred`, `more`,
`sources`.

**3. W1-C — `lib/format.ts` is yours and is the canonical formatter.**
`components/evidence/format.ts` is deliberately narrow (rendering a
`SourcedFact`'s value). `ProvenanceValue`'s `format` prop accepts a function, so
once yours lands, callers can pass it. Please do not duplicate the currency
rules: **never convert**, `Money` renders in its own currency.

**4. W2-C — `lib/ai-retrieval.ts:147` breaks the production build.**
`Type 'number' is not assignable to type 'SourceTier'`. Your `SourceRef.tier`
needs the literal union from `lib/contracts.ts`, not `number`.

**5. W3-A — Lenis is not mounted globally.** `app/layout.tsx` wraps only
`ThemeProvider` + `TooltipProvider`. Smooth scroll belongs on marketing
surfaces, not on a 656-row dashboard table, so wrap the landing route in
`LenisProvider` yourself.

**6. W0-A / whoever owns `app/layout.tsx` next** — I filled both W1-D seams as
they were written: `import "./globals.css"` at the top, and the two providers
inside `<body>`. No other change.

---

## Known gaps

- **`[GAP]` 3D chunk size and the ≤150KB gz budget** — unmeasured, see above.
- **`[GAP]` Lighthouse a11y ≥ 95, LCP, INP, CLS** — W4-B's harness does not
  exist yet. Structural a11y is verified (focus, tap targets, contrast, four
  states, colour-independence); the score is not.
- **`[GAP]` The `inferred` fixture in the kitchen sink is constructed**, and the
  page says so. The generated dataset contains no inferred fact (14 confirmed,
  19 single_source, 13 conflicted, 2 gap). The component must handle the level
  regardless; inventing a "harvested" number would be the exact failure this
  project exists to avoid.
- **`[GAP]` Screen-reader pass** — semantics are correct by construction
  (`sr-only` reasons on every gap and dotted underline, `role="alert"` on
  errors, `aria-busy` on loading, decorative motion `aria-hidden`), but nothing
  has been driven with NVDA or VoiceOver.
- **Deferred deliberately:** no `sonner`/toast primitive (nothing in wave 1
  needs one), and no `select`/`combobox` (the kitchen sink uses native controls;
  W3-C should request one if the unit filters need it).

---

## PRODUCTION IS BROKEN FOR ANY STATICALLY RENDERED PAGE — read this

**Every script is blocked by our own CSP on a prerendered page. Zero JavaScript
runs.** Found by serving `next start` and driving a browser; it does not
reproduce under `next dev`.

`proxy.ts` emits a per-request CSP containing `'nonce-...' 'strict-dynamic'`.
Next can only stamp that nonce onto its script tags when there IS a request —
it reads it back out of the request header. A statically prerendered page is
built without one, so its scripts carry **no nonce at all**, and under
`strict-dynamic` an unnonced script does not load.

Measured on `/de/kitchen-sink` while it had `export const dynamic = "force-static"`:

```
script nonces in HTML: []
INITIAL page JS transferred: 0 B across 0 files
canvas mounted: 0
console: "Loading the script '.../chunks/0225uih-r_h93.js' violates the
          following Content Security Policy directive: script-src 'self'
          'nonce-1DHkEpV+/8gL66EvST+fqw==' 'strict-dynamic'"   (x every chunk)
```

The page renders and _looks_ correct, because the server-rendered HTML is fine.
Nothing is interactive.

I fixed my own route (`force-dynamic`) and re-measured: canvas mounts, three
hydrated theme-toggle buttons, JS transfers normally.

**W3-A: do not ship a `force-static` landing page** until this is resolved.
**W0-A / W1-B (`proxy.ts` owners):** the real fix is a decision rather than a
patch — either every page renders dynamically, or the CSP drops the nonce and
`strict-dynamic` in favour of hashes, or static routes get their own CSP
without a nonce. I did not touch `proxy.ts`; it is not mine.

---

## Measured bundle sizes

From a real `next build` + `next start`, recording actual transfer sizes in
Chromium — not from reading the chunk directory.

|                               | Measured (gz)               | Budget |                   |
| ----------------------------- | --------------------------- | ------ | ----------------- |
| Lazy 3D chunk                 | **236.4 KB** across 5 files | 150 KB | **OVER by 86 KB** |
| `/de/kitchen-sink` initial JS | 297.3 KB across 11 files    | —      | dev-only route    |

**The 150 KB budget for the 3D chunk is not reachable with the pinned stack,
and that is a stack fact rather than a coding one.** three.js 0.185 + R3F is
~236 KB gzipped before any of our code runs. I tested the obvious lever and it
failed: removing `@react-three/drei` entirely — replacing `RoundedBox`,
`ContactShadows` and `AdaptiveDpr` with a plain `boxGeometry`, a darkened plane
and the existing `dpr` cap — saved **10 bytes**, because drei was already
tree-shaken. Reverted, since it cost rounded corners and soft contact shadows
for nothing.

What this does NOT mean: it does not put the landing route over. The maquette
sits behind an IntersectionObserver with a 300px margin and a poster
underneath, so those 236 KB are never on the LCP path and are never fetched at
all by a reduced-motion, low-tier, or WebGL-less visitor. The 297 KB figure is
the kitchen sink, which imports the whole dataset, every primitive AND the
immersion layer; it is not the landing route.

**The remaining decision, for W4-B / W5:** accept the maquette as an opt-in
enhancement that exceeds a budget written before the stack was measured, or
drop WebGL and ship `CoastPoster` alone — ~2 KB, already the fallback, and
already drawing the same massing.

---

## Environment notes the next window will hit

- **`next dev` (Turbopack) cannot compile `globals.css` on this machine under
  load.** It spawns a subprocess per PostCSS asset and Windows returns
  `0xc0000142` (STATUS_DLL_INIT_FAILED — process/desktop-heap exhaustion) with
  ~30 node processes alive across four windows. It is not a CSS fault: the same
  file compiles through the same plugin standalone, and `next build --webpack`
  compiles it in 10.4s. **Use `next dev --webpack`.**
- **The four windows share one working tree and one HEAD.** Commit `4d8d8ec`
  ("W1-C: four-locale i18n…") is **W1-C's own commit** and it landed on
  `feature/INTERNAL-107-w1d-w3i-design`, because that branch was checked out
  when they committed. It is left intact on purpose — it may be the only copy of
  that work. **W1-C should cherry-pick `4d8d8ec` onto their branch.**
- I twice staged files I do not own via a too-broad `git add` (W1-B's
  `user-provider.tsx` and `api/access-profile`, W2-C's four `api/ai` routes,
  `[locale]/login/actions.ts`). Removed from the branch with `git rm --cached`
  in `19ed7a0` and the follow-up, so they remain on disk untouched. Not amended:
  the commits were already pushed and OVERNIGHT §4 forbids force-push.
- `/de` legitimately 404s — no `app/[locale]/page.tsx` until W3-A.
