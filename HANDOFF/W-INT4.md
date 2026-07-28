# HANDOFF — W-INT4  The two blocker fixes, merged

STATUS: COMPLETE
Completed: 2026-07-28
`main`: `8a7716a` → **`86d2344`**, pushed

---

## 1. The merge

Simulated first with `git merge-tree --write-tree`.

| Branch | Simulated | Actual |
|---|---|---|
| `w3h-auth` | CLEAN | exit 0 |
| `w2d-browser` | 1 conflict, `HANDOFF/W2-D.md` | exit 1, resolved |

No `messages/*.json` conflict. The only collision was W2-D's own handoff, and it was an add/add on
a file its author had rewritten: **`theirs` is a strict superset** — 623 lines against 331, with no
heading present in `main`'s copy and absent from the incoming one. Taking `theirs` therefore loses
nothing, and taking `ours` would have preserved a claim the author had explicitly withdrawn.

**`w3h-auth` closes the worst finding in the project.** `app/[locale]/login/page.tsx` now exists
and builds (`ƒ /[locale]/login`, 47 routes). Before it, every `/dashboard` route 307'd to
`/de/login` and that URL 404'd, so the entire authenticated surface was unreachable — and gates 10
and 11 had been "testing" a dashboard nothing could get to.

## 2. The claim W2-D withdrew

Its commit says *"one claim does not survive it"*, and the handoff marks the spot:

> **This is the correction that matters most in this document.** The table above describes
> `nextBackoffDelay`, which is correct and unit-proven. It does **not** describe observed retry
> timing, because `supabase-js` retries first in both failure modes and the hook's `attempt`
> counter never climbs far enough to reach its own cap.

So the previously published reconnect-backoff table was presented as what happens in a browser. It
is only what W2-D's own function would compute if it were ever reached. Measured in Chromium,
`supabase-js` retries first every time.

**And the root cause underneath it, which explains why realtime had never connected at all:**
`.env.local` sits at the **repo root**, but Next loads env from its own project root, `apps/web`.
Any dev server started the documented way ran with no Supabase URL in the client bundle,
`isSupabaseConfigured()` was false in the browser, and every live surface reported `static`. Fixed
locally with a copy at `apps/web/.env.local`; the real fix is W0-A's, either move the file or have
`next.config.ts` load the root one.

## 3. Gates, exit codes read directly off each process

| Gate | Exit | Result |
|---|---|---|
| `typecheck` | **0** | PASS |
| `lint` | **0** | PASS |
| `prettier --check` | **0** | PASS (after formatting the 13 files the merges brought in) |
| `build` | **0** | PASS, **47 routes**, `/[locale]/login` among them |
| `verify-evidence` | **0** | PASS, 1,354 facts · 25 + 631 = 656 · no violations |
| `check-i18n` | **0** | PASS, identical key sets |
| `validate-openapi` | **0** | PASS, 13 pass · 0 fail · 23 exempt |
| `qa:csp` | **0** | PASS, 30 pass · 0 fail |
| `layout-audit` | **1** | FAIL, 50 pass · 149 fail · 1,822 findings — identical to W-INT2 |
| `a11y-audit` | **1** | FAIL, 6 pass · 18 fail — unchanged |
| `perf` | **1** | FAIL, **10 pass · 2 fail** — improved from 9/3 |
| `security-probe` | **1** | FAIL, 10 open findings — unchanged |
| `e2e` | **1** | **NOT VALIDLY RUN — see §4** |

**8 pass, 4 fail, 1 invalid.**

## 4. e2e is still not validly measured, and I was wrong about why

**I need to correct W-INT3.** There I concluded the 273/10 result came from Playwright attaching to
a stale stray `next dev` on port 3200. That diagnosis was wrong. This time 3200 was **verified
free** before the run and Playwright started its own server, and the same failure reproduced:
**30 passed · 263 failed, 26 `FORMATTING_ERROR`s.**

The actual situation is that `playwright.config.ts` is built to run the suite **twice**, and its
own comment says so. The default pass runs a dev server, where next-intl **throws** on a missing
ICU argument; production silently falls back, which is why a plain `next start` on a free port
serves `/de`, `/de/hotel` and `/en/hotel` at 200 with zero such errors.

So the `FORMATTING_ERROR`s are real — callers genuinely do not pass `count`, `formerName`,
`platform`, `publisher`, `rating` and `total` to those strings — but they are dev-visible only, and
they are **not** what the gating run is supposed to measure.

The gating run is `AZURA_E2E_MODE=prod`. I ran it: **0 passed · 294 failed**, every one
`net::ERR_CONNECTION_REFUSED at http://127.0.0.1:3200`. In prod mode the webServer starts on
`PROD_PORT` while `baseURL` still points at `DEV_PORT`. **That is a defect in the harness config,
not in the app.**

Neither pass measures this build. Gate 12 is **NOT VALIDLY RUN**, and it has now been unmeasurable
across two integrations for two different reasons.

## 5. Requests for other windows

- **W4-A — `apps/web/playwright.config.ts` has two defects.** `baseURL` is not switched to
  `PROD_PORT` under `AZURA_E2E_MODE=prod`, so the gating pass cannot connect at all. And the dev
  pass fails wholesale on dev-strict ICU errors. Until one of the two passes is green, e2e reports
  nothing about this product.
- **Whoever owns the hotel and evidence surfaces** — the ICU arguments are genuinely missing:
  `{count}`, `{formerName}`, `{platform}`, `{publisher}`, `{rating}`, `{total}`. Production masks
  it; dev does not. Worth fixing regardless of the harness.
- **W0-A — `.env.local` is in the wrong directory** (§2). It is the reason realtime never connected.
- **W1-B / W1-A** — SEC-A03 still open and still critical.
- **W0-B** — SEC-H05 still open: staff names in committed data, public repo.

## 6. Known gaps

- `[GAP]` **Gate 12 (e2e) not validly run**, both passes, §4.
- `[GAP]` **W4-D's 19-gate suite was not re-run**, and `RELEASE-STATUS.md` / `TRACEABILITY.md` were
  not updated. Both were asked for. With e2e unmeasurable the suite's gates 10 and 11 would report
  a number as meaningless as the last one, and I ran out of room to fix the harness first. The
  documents therefore still carry W-INT2's figures, which are stale in exactly the way the request
  said: measured on a build where `/de/login` 404'd.
- `[GAP]` **No CI run** on `86d2344`.
