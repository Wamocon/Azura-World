# RELEASE STATUS — Azura World CATI (INTERNAL-107)

**Produced by:** W4-D · **Measured:** 2026-07-28 · **Tree:** `main` @ `bb9bf87` (+ this branch)
**Target date under discussion:** 29 July 2026

Evidence grading per `SYSTEM-PROMPT.md` §3 — `[V]` verified by running it here, `[I]` inference
from verified facts, `[GAP]` not established. Every exit code below was read directly from the
process. Nothing in this document was piped through `tail`, and nothing is quoted from a handoff
without being re-run.

> ## ⚠ SUPERSEDING RE-RUN — 2026-07-28, after W2-B completed
>
> Both runs below were executed with the corrected gate (see the two self-corrections at the end
> of this block). **Where any figure further down this document disagrees with this block, this
> block is right.**
>
> |                  | `main` @ `bb9bf87` (+W4-D)     | `main` + **W2-B** merged (preview)                                  |
> | ---------------- | ------------------------------ | ------------------------------------------------------------------- |
> | blocking PASS    | **9**                          | **10**                                                              |
> | blocking FAIL    | **2**                          | **2**                                                               |
> | blocking NOT RUN | **8**                          | **7**                                                               |
> | exit code        | **1**                          | **1**                                                               |
> | gate 3 Format    | FAIL — **121** source files    | FAIL — **145** source files                                         |
> | gate 7 OpenAPI   | **NOT RUN** — absent on `main` | **PASS** — `13 pass · 0 fail · 23 exempt`, 33 paths · 49 operations |
> | gate 18 Audit    | FAIL — 8 high + 7 moderate     | FAIL — 8 high + 7 moderate                                          |
>
> **W2-B is COMPLETE but NOT MERGED.** `origin/main` is still `bb9bf87` and carries no
> `scripts/validate-openapi.mjs`, so on `main` today gate 7 is honestly **NOT RUN**. The second
> column is a local preview merge (`git merge --no-ff origin/feature/INTERNAL-107-w2b-api`) made
> solely to exercise the gate; it was **not pushed**. It is what `main` becomes when W2-B lands.
>
> **Gate 7 passes with 23 of 36 checks EXEMPT.** 13 assertions executed, 13 passed, 0 failed, and
> 23 exempted by declaration — each exemption naming the window that owns it (14 declared write
> gaps, 9 public routes, 7 externally owned files). That is transparent by W2-B's design, but
> "OpenAPI contract: PASS" alone would misrepresent it, so the gate table now prints the tally.
>
> **Two corrections to my own earlier reporting, both defects in this gate rather than in the tree:**
>
> 1. Gate 3 first reported **"0 file(s) need formatting"** next to a red FAIL — prettier colourises
>    its output and the counter matched a raw literal. Fixed with `stripAnsi()`.
> 2. Gate 3 then reported **174 → 198 → 254** across three runs of an unchanged tree, because
>    `apps/web` has no `.prettierignore` and the glob was walking `.next/`: **108 of 255 hits were
>    build output**. Fixed with `--ignore-path ../../.gitignore`. The true figure is **121** on
>    `main`. A number that moves when nothing changed is not measuring what it claims to.

> ## SUPERSEDES EVERYTHING BELOW — W-INT2 re-run on merged `main` @ `b5a0c83`, 2026-07-28
>
> Eight branches merged into `main` (w1c-w0d, w2b, w3c, w4b, w4c, w4d, wux, w4a). **All eight
> merged CLEAN** — `git merge-tree --write-tree` predicted zero conflicts cumulatively and the
> real merges produced zero, including in `messages/*.json` and `HANDOFF/NIGHT-LOG.md`.
>
> **The previous table's NOT RUN column was stale.** It reported W4-A, W4-B and W4-C's harnesses
> as absent because those windows had not pushed when it ran. They exist now. One entry was also
> wrong on its own terms: the gate looked for `scripts/a11y.mjs`, and W4-B shipped
> `scripts/a11y-audit.mjs`, so that gate had been reporting NOT RUN against a filename that never
> existed.
>
> |                  | previous run | **merged `main`** |
> | ---------------- | ------------ | ----------------- |
> | blocking PASS    | 9            | **10**            |
> | blocking FAIL    | 2            | **8**             |
> | blocking NOT RUN | 8            | **1**             |
> | exit             | 1            | **1**             |
>
> **NOT RUN fell from 8 to 1.** The only remaining one is gate 9, pgTAP, because the Docker daemon
> is still unavailable (`docker info` exit 1). W1-A's cloud substitute stands at 366/366 and is
> still recorded as a substitute, not as the gate.
>
> **Six gates moved from NOT RUN to FAIL, and that is the point of running them.** e2e chromium,
> e2e mobile-chrome, layout, a11y, performance and the security probe all execute now, and all six
> fail. Two moved to PASS: the OpenAPI contract (`13 pass · 0 fail · 23 exempt`) and evidence drift.
>
> ### The twelve named gates, exit codes captured directly from each process
>
> | Gate               | Exit  | Result                                                                                            |
> | ------------------ | ----- | ------------------------------------------------------------------------------------------------- |
> | `typecheck`        | **0** | PASS                                                                                              |
> | `lint`             | **0** | PASS, 0 errors 0 warnings                                                                         |
> | `build`            | **0** | PASS, 43 routes, compiled in 15.6s                                                                |
> | `verify-evidence`  | **0** | PASS, 1,354 facts, 25 portal_listing + 631 modelled = 656, no violations                          |
> | `check-i18n`       | **0** | PASS, 831 keys x 4, identical key sets                                                            |
> | `qa:csp`           | **0** | PASS, 30 pass · 0 fail                                                                            |
> | `validate-openapi` | **0** | PASS, 13 pass · 0 fail · **23 exempt**, 33 paths · 49 operations                                  |
> | `layout-audit`     | **1** | FAIL, **50 pass · 149 fail · 1,822 findings**                                                     |
> | `a11y-audit`       | **1** | FAIL, **6 pass · 18 fail** — 1 serious/critical on every locale of `/`, `/hotel`, `/kitchen-sink` |
> | `perf`             | **1** | FAIL, 9 pass · 3 fail — **CLS 0.1244 > 0.1** and **landing JS 264.7 KB gz > 250 KB**              |
> | `security-probe`   | **1** | FAIL, **1 critical + 3 high**                                                                     |
> | `e2e` (chromium)   | **1** | FAIL, **270 passed · 13 failed**                                                                  |
>
> `qa:csp` first reported 26 pass · 4 fail. That was **not** a merge regression: a stray
> `next dev` (PID 37592) held port 3200, the probe attached to it and correctly refused to pass
> itself against a dev policy. Re-run on a free port: 30 pass · 0 fail.
>
> ### The critical security finding, stated plainly
>
> **SEC-A03 [critical]** — `lib/auth.ts` selects `roles` and `anonymized_at` from
> `public.profiles`, and **no migration creates either column**. PostgREST answers 42703, the read
> fails, and **every authenticated user degrades to the minimal tenant**. Owner: W1-B / W1-A.
>
> Three highs, all W0-B's, all in committed data: F-002's narrative claims "across four
> publishers" while carrying three `competingValues`; F-002 states a ratio computed across EUR and
> USD, which can only come from a conversion this product forbids; and **four identifiable staff
> names are present in `lib/azura-world-data.ts` and `lib/hotel-data.ts` in a PUBLIC repository**.

---

## 1. Kurzfassung

**What is genuinely ready.** The evidence spine is real and it is the strongest part of the build.
1,354 sourced facts carry their source URL as a type-level requirement, 656 units are split
**25 real portal listings + 631 modelled** with that split machine-checked on every run, and 24
findings record where sources disagree rather than resolving them silently. Four locales are at
full key parity (576 keys × 4, zero English stubs). The public landing page and the public hotel
page both serve HTTP 200 from a **production** build with 203 and 148 outbound source links
respectively, and the four ticket acceptance criteria each have a named, re-runnable passing test
(`TRACEABILITY.md`). 1,151 assertions were executed by W4-D on this tree, all passing, plus 366
pgTAP assertions executed earlier by W1-A against the live cloud database.

**What that does not add up to.** This is a **demo-ready evidence showcase, not a release-ready
ERP.** Of 19 blocking gates, **9 pass, 2 fail and 8 could not run at all** — the windows that own
end-to-end tests (W4-A), the layout/a11y/performance harness (W4-B), the security review (W4-C)
were never started, and the API contract (W2-B) is complete but unmerged, so those gates have no target to execute. Four of
eight wave-3 surfaces exist and two of those are PARTIAL; finance, operations, governance and the
public concierge do not exist. Nothing has been proven against a real authenticated session, no
data has been proven to persist through the UI, and `pnpm audit` reports **8 high-severity
vulnerabilities**, four of them in the pinned Next.js version and one of those a Middleware/Proxy
bypass in exactly the mechanism this app uses for its route guard.

---

## 2. Verified technical state

`node scripts/quality-gate.mjs` → **exit 1** · blocking: **9 PASS · 2 FAIL · 8 NOT RUN**

| #   | Gate                                     | State       | Exit | What the evidence actually is                                                                              |
| --- | ---------------------------------------- | ----------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Typecheck                                | **PASS**    | 0    | `tsc --noEmit`, whole app, no output                                                                       |
| 2   | Lint                                     | **PASS**    | 0    | `eslint`, 0 errors 0 warnings                                                                              |
| 3   | Format                                   | **FAIL**    | 1    | **121 source files** fail `prettier --check`. Never enforced; not a code defect                            |
| 4   | Build                                    | **PASS**    | 0    | `next build --webpack`, compiled in 18.9s                                                                  |
| 5   | i18n parity                              | **PASS**    | 0    | 576 keys × 4 locales, identical key sets, 0 warnings                                                       |
| 6   | Evidence integrity                       | **PASS**    | 0    | 1,354 facts · 25 portal_listing + 631 modelled = 656 · no violations                                       |
| 7   | OpenAPI contract                         | **NOT RUN** | —    | `scripts/validate-openapi.mjs` absent **on `main`**. W2-B is COMPLETE on its own branch and unmerged — §2a |
| 8   | Unit tests                               | **PASS**    | 0    | 24 tests · 24 pass · 0 fail — 2 suites, both repository-layer                                              |
| 9   | pgTAP                                    | **NOT RUN** | —    | Docker daemon down (`docker info` exit 1). **Substitute below**                                            |
| 10  | e2e chromium                             | **NOT RUN** | —    | `apps/web/playwright.config.ts` absent, 0 spec files. **W4-A never started**                               |
| 11  | e2e mobile-chrome                        | **NOT RUN** | —    | same                                                                                                       |
| 12  | Layout audit                             | **NOT RUN** | —    | `scripts/layout-audit.mjs` absent. **W4-B never started**                                                  |
| 13  | Accessibility                            | **NOT RUN** | —    | `scripts/a11y.mjs` absent; no `qa:a11y` script exists                                                      |
| 14  | Performance LCP/CLS/INP                  | **NOT RUN** | —    | `scripts/perf.mjs` absent                                                                                  |
| 15  | Security probe                           | **NOT RUN** | —    | `scripts/security-probe.mjs` absent. **W4-C never started**                                                |
| 16  | Bundle budget                            | **PASS**    | —    | landing floor **166.2KB / 250KB**; 3D chunks **227.4KB / 260KB**                                           |
| 17  | Secret scan                              | **PASS**    | —    | 357 tracked files · 0 env · 0 `sources/raw\|media` · 0 secret-shaped                                       |
| 18  | Dependency audit                         | **FAIL**    | 1    | **8 high + 7 moderate**. §5①                                                                               |
| 19  | Evidence drift _(non-blocking)_          | **NOT RUN** | —    | `scripts/evidence-drift.mjs` was never written                                                             |
| 20  | CSP / prerender _(added, W-INT request)_ | **PASS**    | 0    | 30 pass · 0 fail — the S-009 regression gate                                                               |

Gate 16 independently reproduces W-INT's 3D measurement to the decimal (227.4KB gz), by a
different method — W-INT gzipped the built files, this gate attributes chunks by content marker.
Two independent measurements agreeing is why that budget can be trusted.

### Test counts — planned vs executed vs passed

The distinction the reference status document insists on, because "326 planned" and "139 executed"
are different claims:

| Suite                           | Planned    | Executed  | Passed    | Note                                                           |
| ------------------------------- | ---------- | --------- | --------- | -------------------------------------------------------------- |
| Contract smoke                  | 33         | **33**    | 33        | `pnpm smoke:contracts`                                         |
| RBAC matrix                     | 157        | **157**   | 157       | `scripts/rbac-probe.mts`                                       |
| AI guardrails                   | 152        | **152**   | 152       | 17/31 probes correctly **refused**                             |
| Realtime                        | 96         | **93**    | 93        | **3 browser checks NOT RUN** — W2-D PARTIAL by design          |
| Dashboard role × route          | 647        | **647**   | 647       | 11 roles × 21 routes = 231 cells enumerated                    |
| CSP / prerender                 | 30         | **30**    | 30        | production build + `next start` + Chromium                     |
| Unit                            | 24         | **24**    | 24        |                                                                |
| Traceability (W4-D)             | 15         | **15**    | 15        | new; the four ACs                                              |
| **W4-D subtotal**               | **1,154**  | **1,151** | **1,151** | all re-run on this tree today                                  |
| pgTAP (W1-A, cloud substitute)  | 366        | **366**   | 366       | `[V]` by W1-A, **not** re-run by W4-D                          |
| W1-D design Playwright          | 27         | 27        | 27        | overnight only; **not re-run**, no config exists               |
| W3-I simulation Playwright      | 16         | 16        | 16        | overnight only; **not re-run**                                 |
| W3-C evidence-review            | 100        | 100       | 100       | **dev only** — fails under `next start`, §3                    |
| **e2e matrix (W4-A)**           | _unscoped_ | **0**     | **0**     | **suite does not exist**                                       |
| **OpenAPI contract (W2-B)**     | 36         | **13**    | **13**    | **23 exempt by declaration.** Runs only with W2-B merged — §2a |
| **Layout / a11y / perf (W4-B)** | _unscoped_ | **0**     | **0**     | **suites do not exist**                                        |
| **Security probe (W4-C)**       | _unscoped_ | **0**     | **0**     | **suite does not exist**                                       |

### The pgTAP substitution — recorded as a substitute

`[V]` `npx supabase test db` is **NOT RUN**. The Docker daemon is unavailable on this machine
(`docker info` → exit 1, `failed to connect to the docker API at
npipe:////./pipe/dockerDesktopLinuxEngine`), and it has been down for the whole run.

W1-A's substitute stands: **pgTAP 1.3.3 against the live cloud database inside
`BEGIN..ROLLBACK` — 366 planned, 366 executed, 366 passed.** That suite found a **critical** real
bug that a passing build would never have surfaced: `is_admin()` is `SECURITY DEFINER`, so
`current_user` resolved to the function owner and **every authenticated user passed every admin
check**. It also caught a deactivated profile keeping its residency scope, and `anon` being unable
to read `public.units` at all — which would have shipped an empty landing page.

**What the substitute does and does not cover.** It proves the policies behave correctly _on the
database as it currently stands_. It does **not** prove a from-scratch `supabase db reset` produces
that database — migrations have never been applied to an empty database in one run and verified.
That remains W1-A's own open `[GAP]`. Accepting 366/366 as evidence is reasonable; accepting it as
equivalent to gate 9 is not, and this document does not.

---

## 3. Functional limits of synthetic QA

Per feature, what is actually proven today.

| Surface                               | Proven                                                                                      | The honest limit                                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Landing (W3-A)**                    | HTTP 200 from production, 303KB HTML, 203 outbound source links, hydrates, 0 CSP violations | No LCP/CLS/INP measurement. No mobile viewport. No a11y audit. No screen-reader pass                                                                                                                                                                                   |
| **Hotel + reviews (W3-G)**            | HTTP 200 from production, 148 links, 4/4 review platforms cited, Tripadvisor ×58            | **PARTIAL.** Dashboard hotel surfaces not built. No review-language labels. `distanceToBeachM` renders "1.000 m" while prose says "1 km"                                                                                                                               |
| **Dashboard shell (W3-B)**            | 647 static matrix assertions; 104 browser acceptance checks over 11 roles                   | Browser checks ran **overnight, against dev**, and are not re-runnable — no Playwright config exists. Global search has no endpoint; CSV export is a callback stub                                                                                                     |
| **Evidence cockpit (W3-C)**           | 100 assertions in Chromium — **against `next dev`**                                         | **PARTIAL, and the weakest link.** `[V]` Under `next start` the page 307s to `/de/login`; the probe times out. Correct guard behaviour, but it means **AC2's richest surface has no production proof**. The modelled/portal split is not rendered on it. No CSV export |
| **Inventory**                         | Dataset split machine-checked                                                               | `[GAP]` **The 656-unit inventory table is not built.** W3-C is PARTIAL and the tables are the missing half                                                                                                                                                             |
| **Finance / Operations / Governance** | —                                                                                           | **`[GAP]` Do not exist.** W3-D, W3-E, W3-F never started                                                                                                                                                                                                               |
| **Public concierge (W3-H)**           | —                                                                                           | **`[GAP]` Does not exist.** The AI layer (W2-C) is built and probed (152 assertions) but has no public surface                                                                                                                                                         |
| **AI layer (W2-C)**                   | 152 assertions, 17/31 refused, RBAC decided before the model call                           | `[GAP]` **Never called a live provider.** All 152 assertions run against the deterministic fallback                                                                                                                                                                    |
| **Realtime (W2-D)**                   | 93 assertions                                                                               | **PARTIAL by design.** 3 browser checks NOT RUN, handed to W4-A, which never started                                                                                                                                                                                   |
| **i18n (W1-C)**                       | 576 keys × 4, parity gate green, all 4 locales serve 200                                    | `[GAP]` `<html lang>` is hard-coded `de` for **all four** locales — measured, still open. Turkish and Russian never native-reviewed                                                                                                                                    |
| **Media (W0-D)**                      | 833 assets, 828 encoded, rights-gated                                                       | Working as designed: **0 assets are publishable.** Every one is `internal_only`/`unknown`, so `public/media/` is empty and the landing page uses no harvested imagery                                                                                                  |

---

## 4. What is NOT proven

Named explicitly, because each is a thing a client would reasonably assume works.

1. **`[GAP]` Persistence.** No data has been created, saved, reloaded and confirmed through the
   UI. The repositories return `source: "supabase" | "local-seed"` and the seed path is what the
   surfaces were exercised against. **Seed or process data is not proof of persistence.** Five seed
   tables are still empty; W2-A correctly refused to invent fixtures for them.
2. **`[GAP]` Real authentication.** Nobody has signed in. The route guard is proven to _redirect_
   (`/de/dashboard` → 307 `/de/login?next=…`), and RBAC is proven _statically_ over the config
   (647 + 157 assertions), but no browser has ever held an authenticated session against this
   build. Every dashboard surface is therefore unproven in production.
3. **`[GAP]` Provider integrations.** No live AI provider call. No email. No payment. No document
   storage round-trip against real Supabase Storage.
4. **`[GAP]` Production UAT.** Never deployed anywhere. No staging URL, no production host, no
   smoke test against a deployed instance. Everything measured here is `localhost`.
5. **`[GAP]` Backup and restore.** Never attempted. Migrations were applied forward to the live
   cloud project; a restore has never been tested, and a from-scratch `supabase db reset` has never
   been verified.
6. **`[GAP]` Load, soak and concurrency.** No 60s soak, no concurrent-edit test. Optimistic
   concurrency exists in the schema and has never been exercised through the UI.
7. **`[GAP]` Accessibility.** No axe run, no screen-reader pass, no contrast re-measurement on the
   built surfaces. WCAG 2.2 AA is a stated target with **no measurement behind it**.
8. **`[GAP]` Performance.** LCP, CLS and INP are unmeasured. Only bundle size is measured, and only
   as a static floor (§2 gate 16).
9. **`[GAP]` CI parity for the full gate.** `quality.yml` is added by this task and **has never
   run**. The three `ci.yml` jobs pass; the 19-gate workflow is unproven on a runner.

---

## 5. Open decisions — the things code cannot resolve

**① The pinned Next.js version is now a security liability.** `[V]` `pnpm audit` reports **8 high

- 7 moderate**. Nine advisories are against `next`, every one `vulnerable: >=16.0.0 <16.2.11`,
  `patched: >=16.2.11`. The pinned version is **16.2.6**. The highs include _Middleware / Proxy
  bypass in App Router applications_ — and `apps/web/proxy.ts` is where this app's session refresh
  and route guard live. Dependabot **PR #4** moves next to 16.2.12 and react to 19.2.8, so it is the
  **fix, not a nuisance bump**. Taking it contradicts `CONVENTIONS.md` §1, which pins `16.2.6`
  exactly and is frozen. _Decision needed: amend CONVENTIONS §1 and take #4, or accept 4 highs into
  a client demo with the reason recorded._ Remaining advisories: `postcss` ×3 and `sharp` ×1
  (transitive through next), `brace-expansion` (via eslint), `@hono/node-server` (via shadcn).
  `[GAP]` I did not verify whether #4 also lifts postcss/sharp.

**② Gate 3 — 121 unformatted source files.** `prettier --check` has evidently never been run. Fixing it is
mechanical (`prettier --write`) but touches 121 files across every window's ownership, so it is one
person's single commit, not W4-D reaching across eight ownership boundaries. _Decision: run the
sweep, or drop Format to non-blocking._

**③ Wave 3 is half-built.** W3-D/E/F/H never started; W3-C and W3-G are PARTIAL. _Decision: is the
29 July demo scoped to landing + hotel + evidence, or does it need the ERP modules?_ This is the
single biggest scope question and §7 assumes the former.

**④ `<html lang>` is `de` for all four locales.** Measured, small, has an owner (W0-A), unfixed.
Screen-reader pronunciation and hyphenation both read it.

**⑤ The full gate is not a required check.** `quality.yml` runs for visibility only. It cannot be
required while 8 blocking gates are NOT RUN without either blocking every PR or being weakened —
and a gate weakened to go green is not a gate.

---

## 6. Source authority gap — a first-class limitation

This belongs in a release document rather than a footnote, because it bounds what any figure on
any screen can be claimed to mean.

`[V]` **Two developer sources were never recovered.** Source #2, the `cebecigroup.com` project
page, returns HTTP 500 with a real application error (`Unable to load the requested file:
front/404.php`) — broken, not bot-walled. Source #4, `alanyacebeci.com`, does not resolve in DNS.
Neither is recoverable by any harvester; both need the site owner.

`[V]` Five tier ≤3 captures did validate — the hotel site, the Cebeci projects index,
`azuraworld.com`, and two Instagram accounts. **Not one of them states a single structural figure.**
No block count, no unit count, no area, no date, no distance, no price.

**Therefore every structural number in this dataset rests on tier 4–6 sources** — property portals,
booking sites and press. That is finding **F-010**, and it is measured, not inferred.

What follows from it, stated plainly:

- Plot area, green area, block count, unit count, floor counts, completion date and every distance
  are **portal claims**, not developer statements.
- The system handles this correctly rather than hiding it: `confidence` is typed, `conflicted`
  facts keep every competing value, and **F-002 (the 1+1 price) is permanently unresolved** with
  `resolvedTo: null` — and `qa:evidence` **fails the build** if anyone sets it. 21 deduplicated
  observations across 6 publishers, and it still refuses to pick one.
- `[I]` For a competitive-intelligence product this is the honest and correct posture. But if the
  client reads these as the developer's own figures, they will be over-trusting them. **The UI must
  keep saying so, and the demo narration must too.**

---

## 7. Recommendation

**Ready for a scoped, narrated demo on 29 July. Not ready for UAT, and not ready to be handed over
as a working ERP.**

**Show:** the landing page, the public hotel and review page, and the provenance model — source
links, confidence levels, the conflict register, and F-002 as the centrepiece, because a system
that refuses to invent a price is the most persuasive thing in this build. All three are proven in
a production build today (`TRACEABILITY.md`, 15/15).

**Do not show, or show only with the limitation stated aloud:** anything behind the login. No
browser has held an authenticated session against this build, so the dashboard, the evidence
cockpit and the inventory tables are dev-proven at best and absent at worst. Finance, operations,
governance and the concierge do not exist.

**Before UAT, in order:** ① decide the Next.js security bump; ② W4-A's e2e matrix, since almost
every "NOT PROVEN" above collapses to "no browser test with a real session"; ③ W4-B's
layout/a11y/perf harness; ④ W4-C's security review; ⑤ prove persistence end-to-end through the UI.

**One caution about the greenness of this document.** 1,151 assertions passing looks decisive, and
they are real — but they are concentrated where the tests were easy to write and honest to run:
contracts, RBAC config, i18n parity, the CSP regression. The eight NOT RUN gates are exactly the
expensive ones — real browsers, real sessions, real databases, real measurements. **The gaps are
not random; they are systematically the hard half.** Read §4 as the balance of this document, not
as an appendix to §2.
