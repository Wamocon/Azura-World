# HANDOFF — W4-B  Automation harness: layout, performance, evidence, phases

STATUS: COMPLETE
Completed: 2026-07-28
Branch: `feature/INTERNAL-107-w4b-harness` (from `main` @ `bb9bf87`, own git worktree `D:\azura-w4b`)

**The three perf `[GAP]`s W1-D, W3-A and W3-I have been carrying are closed with measured
numbers** (§2). Every one of them passes its budget.

**Five real defects surfaced, one of them blocking.** `/[locale]/login` returns 404, so every
protected route redirects into a dead page and there is currently no way to sign in (§4.1). None
of the five is mine to fix; all are routed in §6.

---

## 1. What was written

| File | Lines | What it does |
|---|---|---|
| `scripts/qa-lib.mjs` | 428 | Shared: server lifecycle, Chromium resolution, reporter, result dirs |
| `scripts/layout-audit.mjs` | 996 | 8 widths × 4 locales × 2 themes × 3 routes |
| `scripts/perf.mjs` | 470 | LCP/CLS/INP/TTFB/bytes, bundle budgets, 60s soak |
| `scripts/a11y-audit.mjs` | 344 | axe-core + landmark, single-h1, label, focus, lang |
| `scripts/browser-audit.mjs` | 163 | Every route × locale: console errors, failed requests |
| `scripts/evidence-drift.mjs` | 266 | Re-fetches a source sample, diffs against the dataset |
| `scripts/phase-harness.mjs` | 144 | `--wave <0-5> --profile <smoke\|full>` orchestration |

---

## 2. The three closed `[GAP]`s

W1-D, W3-A and W3-I each shipped with the same open gap. All three are now measured, on a
production build under `next start`, on this machine.

### 3D chunk size — **CLOSED, PASS**

| | |
|---|---|
| Static, gzip level 9, chunks carrying three.js/R3F markers | **227.4 KB** across 3 files |
| Transferred to the browser, compressed body | **228.1 KB** |
| Budget (CONVENTIONS §7, S-010) | 260 KB |

This confirms W-INT's S-010 figure independently: they recorded 227.4 KB static and W1-D measured
236.4 KB transfer; I measure 228.1 KB. The 260 KB ceiling has ~14% headroom.

### LCP / CLS / INP — **CLOSED**, one over budget

Throttled mobile is Slow 4G (1.6 Mbit/s, 150 ms RTT) + 4× CPU, median of 3 runs.

| Route | LCP mobile cold | CLS worst | INP max | TTFB |
|---|---|---|---|---|
| landing `/de` | **1216 ms** ✓ | **0.1244** ✗ (desktop cold) | 72 ms ✓ | 50 ms |
| hotel `/de/hotel` | **1212 ms** ✓ | **0.0007** ✓ | 56 ms ✓ | 35 ms |

LCP is at **49% of budget** on the landing route and INP at **36%**. The 3D chunk is genuinely off
the LCP path — the `IntersectionObserver` + poster arrangement works.

**CLS on landing fails, and only on desktop** — see §4.2. Mobile measures 0.0008.

### 60-second soak on the 3D route — **CLOSED, PASS**

| | Start | End | |
|---|---|---|---|
| JS heap | 12.8 MB | 12.1 MB | **−0.71 MB** |
| DOM nodes | 1008 | 1008 | no growth |
| `<canvas>` elements | 1 | 1 | no leak |

No runaway growth, no canvas leak, no DOM accumulation. W3-I's disposal-on-unmount work holds.
The soak did surface a console 404 (§4.3).

---

## 3. Verification actually run

Exit codes captured from the command, never through a pipe.

| Command | Exit | Result |
|---|---|---|
| `pnpm --dir apps/web build` | **0** | all routes `ƒ (Dynamic)` |
| `node scripts/perf.mjs` | **1** | 9 pass · 3 fail |
| `node scripts/layout-audit.mjs` | **1** | 98 pass · 101 fail · 222 findings · 192 page loads |
| `node scripts/a11y-audit.mjs` | **1** | 6 pass · 18 fail |
| `node scripts/browser-audit.mjs` | **1** | 8 pass · 12 fail |
| `node scripts/evidence-drift.mjs --report-only` | **0** | 6 sources sampled, 1 drifted |

`pnpm qa:layout` and `pnpm qa:perf` exist in `package.json`. **`qa:a11y`, `qa:browser` and
`qa:drift` do not** — that file is W0-A's; request in §6.

### Total harness runtime

| Harness | Runtime | Page loads |
|---|---|---|
| layout-audit | **319 s** | 192 |
| perf | **189 s** | 20 + a 60 s soak |
| browser-audit | **36 s** | 20 |
| a11y-audit | ~150 s | 24 |
| evidence-drift | ~20 s | 6 network fetches |
| **Full sweep** | **≈ 12 minutes** | 262 |

A full run costs about twelve minutes on this machine and produces 139 MB of artifacts, 134 MB of
which is 182 violation screenshots. `quality/layout/` is gitignored; only the JSON is committed.

---

## 4. What the harness found

### 4.1 `/[locale]/login` returns 404 — **BLOCKING** · owner W1-B

`app/[locale]/login/` contains **`actions.ts` and no `page.tsx`**. The route is absent from
`routes-manifest.json` and the server answers 404.

```
GET /de/dashboard            → 307  /de/login?next=%2Fdashboard
GET /de/login                → 404
```

So the guard works, redirects correctly, and lands on nothing. **There is currently no way to sign
in to this application**, in any locale. The public landing page also prefetches a login link, so
`/tr/` and `/ru/` log a console 404 on a page that otherwise passes.

This was invisible to every other window because they all authenticated through the QA
access-profile cookie, which bypasses the login page entirely. It blocks W4-A's e2e work outright.

### 4.2 Landing CLS 0.1244–0.1619 on desktop, caused entirely by the entrance animation · owner W1-D + W3-A

Five layout shifts between 677 ms and 1080 ms. Four of them alternate between the *same two*
heights — the hero plate `div.relative.rounded-[var(--radius-sm)]...` flips 449 px ↔ 524 px, and
the subtitle `p.max-w-[52ch]` moves 287 ↔ 362 in lockstep.

The decisive measurement:

```
animated                       CLS 0.1619 across 5 shifts
prefers-reduced-motion: reduce CLS 0.0000 across 0 shifts
```

Zero shifts under reduced motion rules out font loading and late content. It is the entrance
animation, and the timing window (677–1080 ms) matches ScrambleText's 1.2 s run on the wordmark:
the scrambled placeholder glyphs are not the width of the final string, the heading rewraps, and
everything below it moves. `azura-ui-ux` §4 is explicit — animate `transform` and `opacity` only —
and a text-content animation that changes line count is a reflow wearing an animation's clothes.

Mobile measures 0.0008, so the narrower viewport already wraps the same way in both states. **A
desktop-only regression that a mobile-first check would never see.**

### 4.3 The manifest points at a favicon that does not exist · owner W2-D

`app/manifest.ts` declares exactly one icon, `/favicon.ico`. There is no `favicon.ico` in
`apps/web/public/` and none in `app/`. `curl` returns 404.

The file's own comment says: *"an entry pointing at a missing file is worse than a sparse icon
list, because it fails installability silently."* That is precisely the state it is in. It is the
console 404 the soak caught, and it fires on the landing route of every locale.

It does not surface as a failed network response to Playwright, because the manifest icon is
fetched by the browser's manifest processor rather than the page's fetch stack — which is why the
harness could see the console line and not the URL. Found by elimination against the served
manifest.

### 4.4 Layout — 4 distinct defects, repeated across the matrix

1439 raw violations reduce to four things:

| Kind | Count | What it actually is | Owner |
|---|---|---|---|
| tap-target | 64 | **One element**: `/hotel`'s syndicated-source link, 167 × **17 px**, needs ≥ 24. "Dieselbe Zahl bei OnTheBeach". 64 = 8 widths × 4 locales × 2 themes. | **W3-G** |
| clipping | 16 | Masterplan block labels: **`Modellenmiş` overflows its box by 5–6 px**, `tr` and `ru` only. German and English pass, so nobody reading the German page would ever see it. | **W3-A** |
| contrast | 6 | 3 styles below 4.5:1 at 375 px: landing `p.text-[0.6875rem].uppercase` = **4.24**; kitchen-sink `text-muted-foreground` = **4.12** and **4.35** | **W1-D** |
| theme-not-applied | 1 | §4.5 | — |

The clipping case is the brief's own thesis landing: *"German and Russian are where this finds
bugs."* It found Turkish and Russian, on the honesty control — the `MODELLED` badge — which is the
one label on the masterplan that must stay legible.

### 4.5 The "both themes" budget cannot currently be checked

`themeResolution` from the report:

```json
"dark": { "requested": "dark", "htmlClass": "light", "resolved": "light",
          "background": "rgb(244, 249, 251)" }
```

W3-C's `forcedTheme="light"` means the app cannot enter dark mode. **Every "dark" row in the
layout report describes the light theme.** The harness detects this and emits a
`theme-not-applied` violation rather than silently doubling its own pass count — but the practical
consequence is that CONVENTIONS §7's *"contrast ≥ 4.5:1 in both themes"* is **unverifiable today**,
and half the 192 page loads are duplicates of the other half.

### 4.6 a11y — one serious rule, 18 times · owner W0-A

```
18  [serious]   html-lang-matches-route     <html lang="de"> on every /en, /tr, /ru route
18  [moderate]  skip-to-content
16  [moderate]  duplicate-id
```

`<html lang>` is hard-coded to `de` in `app/layout.tsx`, so a screen reader pronounces the English,
Turkish and Russian pages with a German voice. W1-C raised this as an open request and W3-A
repeated it; this is the measurement. The gate is zero serious/critical, so a11y **fails**.

### 4.7 Landing JS is 264.7 KB gz against a 250 KB budget · owner W3-A + W-INT

| | |
|---|---|
| Landing route, compressed body, excluding 3D | **264.7 KB** |
| Same, including response headers | 270.9 KB |
| Budget (§7) | 250 KB |
| Over by | **14.7 KB, +5.9%** |

W3-A measured 250.5 KB when only their branch was merged and flagged the 0.5 KB overage as an
owner decision. Main has since gained W3-B, W3-C and W3-G, and the shared chunks grew. This is not
a new regression in the landing page; it is the cost of the wave landing around it.

### 4.8 Evidence drift — 1 of 6 sampled sources

```
DRIFT  Azura World Hotel — now unreachable (was 200); 10 fact(s) cite it
```

The harness's own caveat applies and is printed with the result: **Node's TLS is stricter than a
browser's**, and F-012 records exactly this host sending an incomplete certificate chain. So this
is *inconclusive*, not proof the site is down — but ten facts cite it and it is worth a manual
look. `--report-only` exits 0 by design: a competitor editing their site must not break our build.

---

## 5. Coverage and blind spots

Every harness prints its own blind spots on every run. Consolidated, because *"an unstated
exemption reads as a clean pass"*:

**layout-audit**
- Only 3 routes exist to walk: `/`, `/hotel`, `/kitchen-sink`. The dashboard is behind a guard the
  harness has no session for, so **no dashboard surface has been layout-tested at all**.
- 1216 of 1439 violations are `contrast-indeterminate` — text over a gradient, where the computed
  `background-color` is `transparent` and the ratio cannot be derived. A separate pixel-sampling
  pass covers those at 375 px only: 42 gradient-backed styles measured, 6 below threshold.
- "Dark" is not dark (§4.5).
- Overlap detection is bounding-box based, so it cannot distinguish a deliberate overlap
  (a badge on a card corner) from a collision.

**perf**
- Lab numbers from one machine. Catches regressions; does not predict field data.
- Throttling is CDP emulation — bandwidth and latency, not packet loss or a congested radio.
- **INP is synthetic**: clicks on the first few interactive elements, reported as the maximum
  rather than the p98 the real metric uses. A slow interaction the harness never clicks is
  invisible.
- No Lighthouse score, so §7's *"Lighthouse a11y ≥ 95"* is **not checked**. `lighthouse` is not a
  dependency and `pnpm install` is W0-A's.
- Authenticated routes unmeasured — same reason as layout.
- The soak reads `performance.memory`, which is Chromium-only and quantised. It detects a large
  leak, not a slow one.

**a11y-audit** — axe-core cannot detect a wrong reading order, a misleading label that is
technically present, or whether a focus ring is *visible enough*. No screen reader was driven.

**browser-audit** — walks routes as an anonymous visitor only. The per-role walk the brief asks
for needs the login page that does not exist (§4.1).

**evidence-drift** — samples 6 of 60 sources; a digest change is not necessarily a meaningful
change; per-host parsers are not re-run, so it reports *"this page moved"*, never *"the price went
from X to Y"*; `robots_disallowed` sources are never fetched, deliberately.

### Three defects in the harness itself, found and fixed during this run

Recorded because each one made a budget lie, and the third is the dangerous kind.

1. The landing-JS check asserted against the sum of **every** app chunk on disk (516.7 KB) rather
   than what the route fetches. A false **fail**.
2. Fixing that exposed a second bug: `aggregate()` had a fixed numeric key list and silently
   dropped the resource array, so the corrected check read 0 KB and **passed**. A budget that
   passes because its input went missing is worse than one that fails wrongly — the failure gets
   investigated, the pass does not. There is now an explicit check that the resource list is
   non-empty.
3. CLS was read from `mobile:cold` only. It reported 0.0008 and passed while desktop sat at 0.16.
   It now takes the worst of all four configurations, which is how §4.2 was found.

A fourth is still open: the byte metric was `transferSize` (body + headers) where §7 says gzipped.
Both figures are now reported and the check uses the compressed body.

---

## 6. Requests for other windows

| # | Owner | Request |
|---|---|---|
| 1 | **W1-B** | **BLOCKING — build `app/[locale]/login/page.tsx`.** `actions.ts` exists and `safeNextPath` is written; there is no page. Every protected route 307s to a 404 and nobody can sign in. W4-A cannot start an authenticated e2e pass until this lands. |
| 2 | **W1-D + W3-A** | **Landing CLS 0.1244 desktop, budget 0.1** (§4.2). The hero plate oscillates 449↔524 px through the ScrambleText window; reduced motion measures exactly 0.0000, which pins the cause. Reserve the wordmark's final box before scrambling — a fixed `min-height`, or scramble inside a container sized to the final string — so the plate cannot resize. |
| 3 | **W3-G** | **One tap target, 64 failures** (§4.4). `platform-score-card.tsx`'s syndicated-source `<a>` is 17 px high. W1-D solved the identical problem on `SourceChip` with `min-h-6`; this link did not get it. |
| 4 | **W3-A** | **`Modellenmiş` is clipped by 5–6 px** in `tr` and `ru` on the masterplan (§4.4). It is the honesty control, so it is the worst label on the page to lose. German and English pass, which is why it survived review. |
| 5 | **W1-D** | **Three text styles below 4.5:1** at 375 px: landing's uppercase micro-label at **4.24**, and two kitchen-sink `text-muted-foreground` styles at **4.12** and **4.35**. Measured from rendered pixels, not computed from tokens. |
| 6 | **W2-D** | **The manifest's only icon 404s** (§4.3). Your own comment predicted this exact failure mode. Either ship a `favicon.ico` or drop the `icons` array until W0-D's icon set lands. |
| 7 | **W0-A** | Three things: (a) `<html lang>` is hard-coded to `de` — 18 serious a11y violations (§4.6); (b) add `qa:a11y`, `qa:browser`, `qa:drift` to `package.json`, which is yours — the scripts run today only as `node scripts/<name>.mjs`; (c) `.gitignore` excludes `quality/browser-audit/` but the harness writes `quality/browser/`. The reports are small so nothing broke, but the rule does not match the path. |
| 8 | **W-INT / owner** | **Landing JS is 264.7 KB gz against 250** (§4.7). Not a landing-page regression — the shared chunks grew as wave 3 merged. Either trim, or move the line the way S-010 moved the 3D one, with the reasoning recorded. Do not leave a budget the build cannot meet: §7's own closing paragraph says why. |
| 9 | **W3-C / owner** | While `forcedTheme="light"` stands, *"contrast ≥ 4.5:1 in both themes"* is unverifiable and half of every layout run is a duplicate (§4.5). If light-only is permanent, drop the theme axis from the harness and the budget; if it is temporary, say so, and I will leave the axis in place. |

---

## 7. Is the harness ready for the wave gate?

**Yes, and it is currently red — which is the correct state.** Five real defects, one blocking.
`phase-harness.mjs --wave <n>` runs the relevant subset and writes `quality/results/wave-<n>/`.

Three things a later window should not undo:

1. **Budgets fail the run; they do not warn.** `tasks/W4-B`: *"A budget that only warns is a
   suggestion."* Every one of the three harness bugs in §5 was found because something failed
   loudly and got investigated.
2. **The blind-spot list prints on every run, not just in this document.** A report that lists only
   what it checked reads as a clean pass on everything else.
3. **`theme-not-applied` and `landing JS resources were captured` are checks about the harness, not
   the app.** They exist so a measurement that silently produced nothing cannot be mistaken for a
   measurement that produced a good number. Do not delete them to make a run green.
