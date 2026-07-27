# W4-B — Automation harness: layout, performance, evidence, phases

**Wave:** 4 · **Depends on:** all of wave 3 · **Runs with:** W4-A, W4-C, W4-D

> Read `SYSTEM-PROMPT.md`. Then read `D:\Ataberg\scripts\layout.mjs` and `perf.mjs` (the layout
> harness there found real bugs), and `D:\Real Estate CRM\Cati\scripts\phase-harness.mjs`.

---

## Mission

The automated checks that catch what e2e tests do not: layout breakage under long translations,
performance regressions, evidence-integrity drift, and phase-level completeness.

Ataberg's README is worth quoting on the value here — its layout harness *"found the header
colliding with the hero in Russian, the filter panel shipping permanently open, and tap targets
under 24px"* — **and** it is honest that the harness was fallible, exempting the header and
ignoring `<select>`/`<svg>` so a screenshot caught what it missed. Build with the same
scepticism: report what the harness cannot see.

---

## Files you own

```
scripts/layout-audit.mjs · scripts/perf.mjs · scripts/browser-audit.mjs
scripts/phase-harness.mjs · scripts/evidence-drift.mjs · scripts/a11y-audit.mjs
quality/**
HANDOFF/W4-B.md
```

---

## Deliverables

### 1. `layout-audit.mjs` — the one that earns its keep

**8 widths × 4 locales × 2 themes**, over every route.

Widths: 320, 375, 414, 768, 1024, 1280, 1440, 1920.

Detects:
- Horizontal overflow — `scrollWidth > clientWidth` on `body` or any container
- Element clipping — content wider than its box with `overflow: hidden`
- Overlap between interactive elements (bounding-box intersection)
- Tap targets under 24×24 CSS px
- Text contrast below 4.5:1 (sampled, both themes)
- Unreadable truncation — text ending in `…` with no title or expand affordance

**German and Russian are where this finds bugs.** They run ~30% and ~35% longer than English.

Be explicit about coverage: if the harness exempts fixed headers or ignores `<svg>`/`<select>`,
**print the exemption list in the report**. An unstated exemption reads as a clean pass.

Output: `quality/layout/<timestamp>/report.json` + annotated screenshots of every violation.

### 2. `perf.mjs`

Desktop and throttled mobile (Slow 4G, 4× CPU). Measures LCP, CLS, INP, TTFB, total bytes, JS
bytes per route.

Budgets from `CONVENTIONS.md` §7 — **exceeding one fails the run**, it does not warn. A budget
that only warns is a suggestion.

Include a cold-cache and a warm-cache pass; report both.

### 3. `evidence-drift.mjs`

Re-harvests a sample of sources and diffs against the stored dataset. Reports:
- A source that changed its stated figures since the last harvest
- A source that became unreachable (or recovered)
- A fact whose confidence would change on re-harvest
- A price that moved

This is the check that keeps competitor intelligence from silently going stale. Run it weekly;
in the gate, run it in `--report-only` mode so a competitor's site edit does not break the build.

### 4. `a11y-audit.mjs`

axe-core over every route × 4 locales. Zero serious/critical is the gate. Also checks landmark
structure, a single `<h1>` per page, form-label association, and focus visibility in both themes.

### 5. `phase-harness.mjs`

Per-wave orchestration: `--wave <0-5> --profile <smoke|full>`. Runs the relevant gates for a wave
and writes `quality/results/wave-<n>/`. Used at each wave gate (ORCHESTRATION §5).

### 6. `browser-audit.mjs`

Starts the server, walks every route in every locale as every role, captures console errors,
failed network requests, and unhandled rejections. **Any console error is a finding** — they are
almost always real bugs that nobody looked at.

---

## Edge cases

- **The harness itself is fallible.** State its blind spots in every report. Ataberg's did, and a
  screenshot still caught what it missed.
- **Screenshot flake** from animation → disable animations (`prefers-reduced-motion` + a CSS
  override) before capturing, or every run diffs.
- **Font loading** shifts layout → wait for `document.fonts.ready` before measuring.
- **Lazy content** below the fold → scroll through the page before the overflow check.
- **The 3D route** → measure with WebGL both on and off.
- **Throttled runs are slow** — 8 widths × 4 locales × 20 routes is 640 page loads. Parallelise
  across workers, cap at CPU-2, and make it resumable.
- **Windows paths** with spaces (`D:\Azura World`) → quote every path in every spawn.
- **Exit codes**: never pipe through `tail`. Capture explicitly. This exact mistake is recorded in
  the reference project's lessons file.
- **A route requiring auth** → the harness needs a session per role; reuse storage state rather
  than logging in 640 times.
- **CI has no display** → headless, but keep a `--headed` flag for debugging.

---

## Definition of done

```bash
pnpm qa:layout    ; echo "exit=$?"
pnpm qa:perf      ; echo "exit=$?"
pnpm qa:a11y      ; echo "exit=$?"
node scripts/browser-audit.mjs ; echo "exit=$?"
node scripts/evidence-drift.mjs --report-only
```

Paste, for each: the summary, the exit code, and the **exemption list**.

Required outcomes:
- Layout: zero overflow/clipping/overlap violations at any width × locale × theme
- Perf: every route within budget, cold and warm
- a11y: zero serious/critical
- Browser audit: **zero console errors** across every route × locale × role
- Evidence drift: reported, not necessarily zero

---

## Handoff must state

- Each harness's coverage **and its blind spots**, explicitly
- Violations found and whether they were fixed or handed to a module owner
- Measured performance numbers per route (they go in the project docs)
- Total harness runtime, so the team knows what a full run costs
