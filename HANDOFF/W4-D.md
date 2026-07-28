# HANDOFF — W4-D Quality gates, traceability, release report

STATUS: COMPLETE
Completed: 2026-07-28
Branch: `feature/INTERNAL-107-w4d-gates` · Worktree: `D:\azura-w4d` · From `main` @ `bb9bf87`

> **Can this be shown to a client on 29 July?**
>
> **Yes — a narrated demo of the landing page, the public hotel page and the provenance model,
> all three proven in a production build today; but not the dashboard, not as a working ERP, and
> not without saying out loud that every structural figure comes from portals rather than the
> developer.**

---

## 1. What was built

| File                                     | What it is                                                         |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `scripts/quality-gate.mjs`               | The 19 gates + CSP as #20. Tri-state exit. Nothing piped           |
| `scripts/traceability.mjs`               | The named acceptance-criteria test that did not exist              |
| `.github/workflows/quality.yml`          | Gates 1–8 on PR, full gate + traceability on `main`                |
| `TRACEABILITY.md`                        | Four ACs → named passing tests, and what that proof does not cover |
| `RELEASE-STATUS.md`                      | The honesty register                                               |
| `QUALITY-REPORT.md`                      | Full output archive                                                |
| `.github/dependabot.yml`                 | `eslint-config-next` grouped with `next` so they cannot drift      |
| `quality/*.json`, `quality/probes/*.txt` | Machine-readable evidence for every claim above                    |

---

## 2. The gate table — all 19 (+1), both runs

`main` is `bb9bf87` and **W2-B is COMPLETE but NOT MERGED**, so gate 7 has no target on `main`
today. I ran it twice rather than pick one story: the left column is the truth about `main`, the
right is what `main` becomes when W2-B lands. The preview merge was local and **not pushed**.

| #   | Gate                                | on `main`   | +W2-B       | Evidence                                                     |
| --- | ----------------------------------- | ----------- | ----------- | ------------------------------------------------------------ |
| 1   | Typecheck                           | **PASS** 0  | **PASS** 0  | `tsc --noEmit`, no output                                    |
| 2   | Lint                                | **PASS** 0  | **PASS** 0  | 0 errors, 0 warnings                                         |
| 3   | Format                              | **FAIL** 1  | **FAIL** 1  | **121** / 145 source files fail `prettier --check`           |
| 4   | Build                               | **PASS** 0  | **PASS** 0  | `next build --webpack`                                       |
| 5   | i18n parity                         | **PASS** 0  | **PASS** 0  | identical key sets, 0 warnings                               |
| 6   | Evidence integrity                  | **PASS** 0  | **PASS** 0  | 1,354 facts · 25 portal + 631 modelled = 656 · no violations |
| 7   | OpenAPI contract                    | **NOT RUN** | **PASS** 0  | `13 pass · 0 fail · 23 exempt` · 33 paths · 49 ops           |
| 8   | Unit tests                          | **PASS** 0  | **PASS** 0  | 24 tests · 24 pass · 0 fail                                  |
| 9   | pgTAP                               | **NOT RUN** | **NOT RUN** | Docker down (`docker info` exit 1). Substitute in §4         |
| 10  | e2e chromium                        | **NOT RUN** | **NOT RUN** | no `playwright.config.ts`, 0 specs — W4-A never started      |
| 11  | e2e mobile-chrome                   | **NOT RUN** | **NOT RUN** | same                                                         |
| 12  | Layout audit                        | **NOT RUN** | **NOT RUN** | `scripts/layout-audit.mjs` absent — W4-B never started       |
| 13  | Accessibility                       | **NOT RUN** | **NOT RUN** | `scripts/a11y.mjs` absent; no `qa:a11y` script exists        |
| 14  | Performance                         | **NOT RUN** | **NOT RUN** | `scripts/perf.mjs` absent                                    |
| 15  | Security probe                      | **NOT RUN** | **NOT RUN** | `scripts/security-probe.mjs` absent — W4-C never started     |
| 16  | Bundle budget                       | **PASS**    | **PASS**    | landing floor 166.2KB/250KB · 3D 227.4KB/260KB               |
| 17  | Secret scan                         | **PASS**    | **PASS**    | 374 / 418 tracked files · 0 env · 0 `sources/raw\|media`     |
| 18  | Dependency audit                    | **FAIL** 1  | **FAIL** 1  | **8 high + 7 moderate**                                      |
| 19  | Evidence drift _(non-blocking)_     | **NOT RUN** | **NOT RUN** | `scripts/evidence-drift.mjs` never written — W0-B            |
| 20  | CSP / prerender _(added, W-INT §9)_ | **PASS** 0  | **PASS** 0  | 30 pass · 0 fail                                             |

**`main`: 9 PASS · 2 FAIL · 8 NOT RUN → exit 1. +W2-B: 10 PASS · 2 FAIL · 7 NOT RUN → exit 1.**

Exit is tri-state on purpose — `0` certifiable, `1` a blocking gate FAILED, `2` no failures but a
blocking gate NOT RUN. "Did not fail" and "passed" are different claims and a release decision has
to tell them apart.

---

## 3. Test counts — defined vs executed vs passed

| Suite                           | Defined    | Executed  | Passed    | Note                                                            |
| ------------------------------- | ---------- | --------- | --------- | --------------------------------------------------------------- |
| Contract smoke                  | 33         | **33**    | 33        |                                                                 |
| RBAC matrix                     | 157        | **157**   | 157       |                                                                 |
| AI guardrails                   | 152        | **152**   | 152       | 17/31 probes correctly **refused** — a pass, not a failure rate |
| Realtime                        | 96         | **93**    | 93        | **3 browser checks NOT RUN** — W2-D PARTIAL by design           |
| Dashboard role × route          | 647        | **647**   | 647       | 11 roles × 21 routes = 231 cells                                |
| CSP / prerender                 | 30         | **30**    | 30        | production build + `next start` + Chromium                      |
| Unit                            | 24         | **24**    | 24        | 2 suites, both repository-layer                                 |
| Traceability (new)              | 15         | **15**    | 15        | the four ACs                                                    |
| **Re-run by W4-D today**        | **1,154**  | **1,151** | **1,151** |                                                                 |
| OpenAPI contract (W2-B)         | 36         | **13**    | **13**    | **23 exempt by declaration**; only with W2-B merged             |
| pgTAP (W1-A substitute)         | 366        | **366**   | 366       | **not** re-run by me; **not** `supabase test db`                |
| W1-D design Playwright          | 27         | 27        | 27        | overnight only, **not re-runnable** — no config exists          |
| W3-I simulation Playwright      | 16         | 16        | 16        | overnight only, not re-run                                      |
| W3-C evidence-review            | 100        | 100       | 100       | **dev only** — fails under `next start`, §5                     |
| **e2e matrix (W4-A)**           | _unscoped_ | **0**     | **0**     | suite does not exist                                            |
| **Layout / a11y / perf (W4-B)** | _unscoped_ | **0**     | **0**     | suites do not exist                                             |
| **Security probe (W4-C)**       | _unscoped_ | **0**     | **0**     | suite does not exist                                            |

---

## 4. pgTAP — NOT RUN, and the substitute recorded as a substitute

`npx supabase test db` is **NOT RUN**. Docker is unavailable (`docker info` exit 1,
`npipe:////./pipe/dockerDesktopLinuxEngine`) and has been for the whole run.

W1-A's substitute: **pgTAP 1.3.3 against the live cloud DB inside `BEGIN..ROLLBACK` — 366 defined,
366 executed, 366 passed.** It found the critical `is_admin()` `SECURITY DEFINER` bug under which
**every authenticated user passed every admin check**, plus a deactivated profile keeping its
residency scope and `anon` unable to read `public.units` at all.

It proves the policies behave correctly _on the database as it stands_. It does **not** prove a
from-scratch `supabase db reset` produces that database. Accepting 366/366 as evidence is
reasonable; accepting it as gate 9 is not, and nothing here does.

---

## 5. Acceptance criteria — met, with the proving test named

`node scripts/traceability.mjs` → **exit 0 · 15 pass · 0 fail**, against `next start`.

| AC  | Requirement                                       | Status  | Proven by                         |
| --- | ------------------------------------------------- | ------- | --------------------------------- |
| 1   | Ein CATI für Azura World erstellen                | **MET** | `traceability.mjs` AC1.1–1.6      |
| 2   | Die wichtigsten Quellen und Links berücksichtigen | **MET** | AC2.1–2.4 + `verify-evidence.mjs` |
| 3   | Informationen aus Immobilien-Portalen einbeziehen | **MET** | AC3.1–3.2                         |
| 4   | Bewertungen und Hotel-Buchungsquellen einbeziehen | **MET** | AC4.1–4.3                         |

**The brief's three named specs do not exist** — `apps/web/e2e/` has zero `*.spec.ts` and there is
no `playwright.config.ts`. So every AC had **no named proving test at all**. Rather than record
four unproven criteria, `scripts/traceability.mjs` _is_ that test: 203 outbound source links on
`/de`, 5/6 portals cited, `25 portal_listing + 631 modelled = 656`, 4/4 review platforms on
`/de/hotel` with Tripadvisor ×58.

**What "MET" does not mean** (`TRACEABILITY.md` §3): no role permutation with a real session, no
mobile viewport, no a11y or performance measurement, and assertions are on server HTML rather than
a hydrated DOM. Most sharply: **AC2's richest surface has no production proof** — under
`next start`, `/de/dashboard/evidence` correctly 307s to `/de/login`, so W3-C's 100 assertions only
ever ran against `next dev`. I ran them against production and they failed on that redirect: the
guard working, not the page broken, but it means the evidence cockpit is dev-proven only.

---

## 6. The finding that should change a decision

`pnpm audit`: **8 high + 7 moderate**. All nine `next` advisories are `vulnerable: >=16.0.0
<16.2.11`, `patched: >=16.2.11`. `CONVENTIONS.md` §1 pins `next` at exactly **16.2.6**.

One of the highs is **Middleware / Proxy bypass in App Router applications**, and `apps/web/proxy.ts`
is where this app does session refresh and the protected-route guard. `[GAP]` I did not attempt to
exploit it and claim no exploitability — only that the advisory applies to the pinned version and
touches that component.

**Dependabot #4 (`next` → 16.2.12) is the fix, not a nuisance bump.** Taking it needs a
CONVENTIONS §1 amendment, and CONVENTIONS is frozen — so it is an owner decision, recorded rather
than taken. `#6/#7/#8` were already closed by W-INT and the `ignore` block stops them reopening;
I added `eslint-config-next` to the `pinned-core` group so it can no longer drift from `next`
(that was PR #5).

---

## 7. Defects I found in my own gate, and fixed

Recorded because a gate whose evidence contradicts itself is worse than no gate.

1. **Format reported "0 file(s) need formatting" next to a red FAIL.** prettier colourises output;
   the counter matched a raw `[warn]` literal. Fixed with `stripAnsi()`.
2. **Format then reported 174 → 198 → 254 across three runs of an unchanged tree.** `apps/web` has
   no `.prettierignore`, so the glob walked `.next/`: **108 of 255 hits were build output.** Fixed
   with `--ignore-path ../../.gitignore`. True figure **121**.
3. **Bundle budget was NOT RUN on a passing build** — it looked for `app-build-manifest.json`,
   which Next 16 + `--webpack` does not emit. Rewritten to attribute the route from
   `build-manifest.json` + the `app/[locale]` chunks, with 3D identified by **content marker**, not
   filename. It now reproduces W-INT's **227.4KB** independently, by a different method.
4. **Gate 7 printed a bare PASS** while exempting 23 of 36 checks. It now prints the tally.
5. **The pre-commit hook rejected my own commit** — `quality-gate.mjs` contains the secret-detector
   alternation _as a pattern_. Fixed by assembling it from fragments rather than using
   `--no-verify`. Note CI excludes `.github/workflows/*` and `.githooks/*` from that scan but **not
   `scripts/*`**, which is the divergence W-INT flagged in its §9 and it is still unreconciled.

---

## 8. Requests for other windows

- **W4-A** — your e2e matrix is the single highest-leverage missing thing. Almost every "NOT
  PROVEN" in `RELEASE-STATUS.md` §4 collapses to _"no browser test with a real session."_ You also
  inherit W2-D's 3 browser checks and W3-C's "renders under `next start` with a session".
- **W4-B** — gates 12, 13 and 14 are NOT RUN for want of `layout-audit.mjs`, `a11y.mjs` and
  `perf.mjs`. `qa:perf` is also the only thing that can turn gate 16's _floor_ into the browser's
  real transfer.
- **W4-C** — gate 15 is NOT RUN. §6 above is the first thing to look at.
- **W2-B** — merge it. Gate 7 passes on a preview merge; on `main` it is NOT RUN.
- **W0-B** — `scripts/evidence-drift.mjs` (gate 19) was never written.
- **Repo owner** — two decisions in `RELEASE-STATUS.md` §5: the Next.js security bump, and whether
  to run the 121-file `prettier --write` sweep or drop Format to non-blocking.

---

## 9. Known gaps

- `[GAP]` **`quality.yml` has never run.** It is added by this task and is deliberately **not** a
  required check: it cannot be required while 8 blocking gates are NOT RUN without either blocking
  every PR or being weakened, and a gate weakened to go green is not a gate. The three `ci.yml`
  jobs remain the required protection.
- `[GAP]` **CLAUDE.md / AGENTS.md were not refreshed** (brief deliverable 5). `CLAUDE.md` showed as
  modified in this worktree by something I did not author, so I left it untouched rather than
  commit an unattributed change. Its "Last verified: 2026-07-27, immediately after W0-A" header is
  now stale by three waves.
- `[GAP]` **Gate 16 is a floor, not a transfer.** Chunks pulled by a runtime dynamic import are not
  in the static entry graph. The authoritative number needs a real navigation — W4-B's job.
- `[GAP]` **I did not re-run** W1-A's pgTAP, W1-D's 27 Playwright checks or W3-I's 16. The first
  needs Docker; the other two need `playwright.config.ts`, which does not exist.
- `[GAP]` **The preview merge with W2-B was not pushed** and no CI has run on it.
