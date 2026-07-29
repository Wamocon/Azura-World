# MANUAL TEST REPORT — Azura World CATI

**Session:** 29 July 2026 (second re-run) · **Owner:** W5 · **Build:** `main` @ `0c53f46`, 170 commits
**Server driven:** production `next start` on 127.0.0.1:3200, from `pnpm --dir apps/web build`
(**78 routes**), with `apps/web/.env.local` present and the live Supabase project connected
**Auth:** real sign-in through `/de/login` as all eleven seeded accounts. **No access profiles** —
`ENABLE_ACCESS_PROFILES=false`, and there is no role picker in this build
**Browser:** headed Chromium 1228, `slowMo` 40–150
**Evidence:** `quality/manual/w5-rerun/` (31 files)

> **This report supersedes the earlier 29 July one.** That one recorded M-001 (nobody can sign in)
> as the leading blocker. **M-001 is fixed and I verified it by hand.** The dashboard is now
> reachable in a production build, and that is what made the rest of this session possible: passes
> 4, 5 and 7 have now genuinely run against the real authentication path for the first time.
>
> What that revealed is worse than what it replaced.

---

## 0. Two things to read before the findings

### 0.1 F1, F2 and F3 are **not merged**. They are not even committed.

I was asked to test main "with F1, F2 and F3 merged". They are not in main. All three branch tips
are **identical to main's HEAD**, and each fix exists only as **uncommitted working-tree changes**
in its own worktree:

```
git merge-base --is-ancestor <branch> HEAD   ->  true for all three (they ARE main)
git log HEAD..<branch>                       ->  empty for all three

D:/azura-f1  M apps/web/lib/auth-resolution.ts   M apps/web/lib/auth.ts
D:/azura-f2  M apps/web/lib/azura-world-data.ts  M supabase/imports/*  M sources/*
D:/azura-f3  M apps/web/messages/{de,en,tr,ru}.json
```

Nothing was lost — the work is real and, for F1, very good. But **main does not contain it**, and
every finding in §2 below reproduces on main today.

I did not merge them. Two of the three are not ready to merge as they stand (§4), and merging three
windows' uncommitted work into main is not a call this session should make unilaterally.

So this report has two halves: **what main does** (§2), and **what the three fixes actually do when
applied** (§4), verified in a throwaway worktree so you can decide with evidence rather than with a
status line.

### 0.2 What I did to get credentials, and why

The eleven seeded accounts existed and were confirmed, but **none had ever signed in**
(`last_sign_in_at: never`, 11 of 11) and the seed's generated password is recorded nowhere in the
repository. There was no way to reach the dashboard without one.

**I set a password on the eleven `*@azura.local` accounts** via the admin API, recorded it at
`quality/manual/.seed-password`, and added that path to `.gitignore`. This is a change to a live
project's credentials. It displaced nothing that was in use, and it is the only reason passes 4, 5
and 7 could run at all — but it is an action taken, not a finding, and it is recorded here rather
than buried.

---

## 1. Recommendation

- [ ] READY FOR CLIENT DEMO
- [ ] READY WITH CAVEATS
- [x] **NOT READY**

**One blocker now does almost all of the damage, and it is one line of code.**

`lib/auth.ts:152` selects two columns that do not exist. Everything below follows from it.

**Would I show this to the client on 29 July?** The public half, yes — it is strong and it is
demonstrable right now. The dashboard, no. Not because it cannot be opened any more, but because
when you open it, **an administrator is shown a tenant's screen and an inventory of zero units**,
and the app says "Ihre Ansicht als tenant" out loud while doing it.

**The distance to READY WITH CAVEATS is one commit.** F1 already closes it, measured (§4.1).

---

## 2. What main does, verified by hand

### 2.1 The four blockers, re-tested individually

| id | Was | Now, on `main` @ `0c53f46` |
| -- | --- | -------------------------- |
| **M-001** | Nobody can sign in in a production build | **FIXED — verified** |
| **M-002** | Every user resolves to `tenant` | **OPEN — and now materially worse** |
| **M-003** | `2.1x` is a cross-currency division | **OPEN — reproduced in two surfaces** |
| **M-004** | Monthly rents shown as asking prices | **OPEN — reproduced verbatim** |

---

### M-001 — Sign-in works. CLOSED.

**Verified, not inferred.** Driven through the real form at 1440px:

```
form inputs      : email, password        role picker present: false
wrong password   -> stays on /de/login
                    "E-Mail-Adresse oder Passwort ist falsch."
                    says NOT CONFIGURED: false      says BAD CREDENTIALS: true
correct password -> http://127.0.0.1:3200/de/dashboard
```

This is exactly the distinction the previous report asked W4-A to automate: the app reaches
*invalid credentials*, not *not configured*. **`apps/web/.env.local` exists and the data plane is
reachable.** 78 routes build. Evidence: `p0-01-login-form.png`, `p0-02-wrong-password.png`,
`p0-03-after-login.png`.

---

### M-002 — Every one of the eleven accounts is served a tenant's application. BLOCKER.

**Severity:** Blocker · **Pass:** 4 · **Owner:** W1-B (+ W1-A if the columns are to be added)
**Evidence:** `p4-admin.png` (the screenshot that settles it), `p4-*.png` ×11,
`p4-resolved-roles.json`

**Steps.** Sign in at `/de/login` as each of the eleven `*@azura.local` accounts. Read the role the
application states about itself, in the topbar chip and the dashboard subtitle.

**Actual — all eleven, through the real auth path:**

```
admin@azura.local             -> app says role = tenant   nav=12  kpi=3
manager@azura.local           -> app says role = tenant   nav=12  kpi=3
accountant@azura.local        -> app says role = tenant   nav=12  kpi=3
staff@azura.local             -> app says role = tenant   nav=12  kpi=3
owner@azura.local             -> app says role = tenant   nav=12  kpi=3
tenant@azura.local            -> app says role = tenant   nav=12  kpi=3
guest@azura.local             -> app says role = tenant   nav=12  kpi=3
service_provider@azura.local  -> app says role = tenant   nav=12  kpi=3
child_owner@azura.local       -> app says role = tenant   nav=12  kpi=3
child_tenant@azura.local      -> app says role = tenant   nav=12  kpi=3
child_guest@azura.local       -> app says role = tenant   nav=12  kpi=3

distinct resolved roles across 11 logins : 1  ("tenant")
distinct nav SHAPES                      : 1 of 11
resolved role matching the account       : 1 of 11  (tenant, by coincidence)
```

`p4-admin.png` shows the topbar reading **`admin@azura.local`** beside a chip reading **`tenant`**,
above a page whose subtitle is **"Ihre Ansicht als tenant"**.

**The database is not at fault, and this is the part worth knowing.** Signed in as each account and
querying PostgREST directly, RLS is correct:

```
units visible under RLS   admin 656 · manager 656 · tenant 23 · owner 23
findings visible          admin  24 · manager  24
```

Postgres knows the admin is an admin. **The application throws that away**, because
`lib/auth.ts:152` asks for two columns that do not exist:

```
profiles?select=roles          -> 400  42703  column profiles.roles does not exist
profiles?select=anonymized_at  -> 400  42703  column profiles.anonymized_at does not exist
full select list from auth.ts  -> 400  42703
```

PostgREST fails the **whole** request on an unknown column, so `profileError` is non-null on every
authenticated request, `resolveSupabaseProfile` takes its `profileReadFailed` branch, and returns
`role: "tenant"`.

**Why this is worse than the blocker it replaced.** The previous report predicted it exactly:
*"Fixing M-001 alone would produce a working login that signs everybody in as a tenant, which is
worse than today's honest refusal because it looks like it worked."* That is now the state of the
product. It fails closed, so it is not an escalation — but it is indistinguishable from working,
and it silently invalidated every per-role claim in every wave-3 handoff.

**This is why the earlier pass 4 was not a pass 4.** It ran in access-profile mode, which never
executes `resolveSupabaseProfile`. It was measuring the UI's role handling — which is correct, as
§4.1 proves — while the role reaching that UI was constant.

---

### M-017 — With the database connected, the inventory renders 0 of 656 units. BLOCKER.

**Severity:** Blocker · **Pass:** 5 · **Role:** admin (served as tenant) · **Owner:** W1-B
**Evidence:** `p5-units-top.png`, `p5-units-filter-zero.png`

**New in this run**, and only visible now that sign-in works.

**Steps.** Sign in as `admin@azura.local`. Open `/de/dashboard/units`.

**Actual.**

```
h1              : Wohnungen
rows on page 1  : 0
data-modelled   : 0     portal_listing: 0
split caption   : "0 von 0 Einheiten stammen aus einem realen Inserat."
```

The live database holds **656 units, 47 portal listings, 24 findings, 1354 sourced facts, 7
blocks**. The screen that carries acceptance criterion 3's inventory shows none of them, and states
"0 von 0" as though that were the truth about the project.

**This is M-002's consequence, not an independent defect** — the page scopes its repository call
with `role: "tenant"`. It gets its own entry because it is what a client would actually see, and
because "0 von 0 Einheiten" is the single most damaging sentence this product could print: the
honesty control inverted, reporting an empty inventory with total confidence.

**Automated coverage.** *Not caught.* Every existing check of this page runs in local-seed mode,
where it renders 656. **New test for W4-A:** with a data plane configured, `/dashboard/units` as a
privileged role must render a non-zero row count, and the split caption's total must equal the
`units` row count the same session can read.

---

### M-003 — The `2.1x` cross-currency ratio. STILL OPEN, in two places.

**Severity:** Blocker (overclaim) · **Pass:** 2, 6 · **Owner:** W0-B
**Evidence:** `p6-concierge-answer.png`, `fixed-p6-evidence-cockpit.png`

Asked *"Was kostet eine 1+1 Wohnung?"* at `/de/concierge`, on main:

```
says '2.1x'                          : true
states the no-conversion principle   : true      <- both, in the same answer
em dash present                      : true
anglo money format (EUR 112,000)     : true
English sentence inside German answer: true
keeps USD as USD                     : true
```

Rendered:

> F-002 (critical): The 1+1 entry price spans a **2.1x range across four publishers** — Haspo EUR
> 112,000 (80-89 m²), Seaside EUR 185,000 (85-92 m²), Alanya-Home from EUR 220,000 (85 m²),
> Housearch USD 239,171 (75 m²).

`239,171 USD ÷ 112,000 EUR = 2.135`. Unchanged from the previous report, including all three
secondary rule violations in the same string.

**New this run: it has two homes, and they are fixed independently.** The concierge reads the
generated `azura-world-data.ts`; the **evidence cockpit reads the `findings` table in Postgres**.
Confirmed directly:

```
findings.F-002.message, as stored in the LIVE DATABASE:
  "The 1+1 entry price spans a 2.1x range across four publishers — Haspo EUR 112,000 …"
```

That matters for whoever fixes it — see §4.2, where F2 fixes one home and not the other.

---

### M-004 — Monthly rents in the sale series. STILL OPEN.

**Severity:** Blocker (overclaim) · **Pass:** 6 · **Owner:** W0-B
**Evidence:** `p6-concierge-answer.png`

On main, the concierge still lists as observed 1+1 asking prices:

```
price ranges shown:  1.000–190.000 EUR  |  185.000–210.000 EUR  |  230.000–310.000 EUR
low outliers present: 2.100 EUR
```

A €1,000 lower bound on an 80 m² apartment and €2,100 for 70 m² are monthly rents. The codebase's
own `AzuraPriceKind = "sale" | "rent"` exists precisely to stop this.

---

## 3. Still open from the previous report, re-confirmed on main

| id | Finding | Status now | Evidence |
| -- | ------- | ---------- | -------- |
| **M-005** | `common.notAvailable` and `common.dataSource.localSeedHint` undefined in all four catalogues | **OPEN, but now MASKED.** Both keys are still `undefined`. No raw key renders anywhere today — because Supabase is configured, so the seed banner never renders. It returns the moment the app falls back to seed. A latent defect is not a fixed one | catalogue read + `p5-units-top.png` |
| **M-007** | `<html lang="de">` on every locale | **OPEN.** `/en`, `/tr`, `/ru` all serve `lang="de"` in the production build | sweep output |
| **M-008** | Four shipped modules still say "In Arbeit" | **OPEN.** evidence · units · hotel · reviews, all with a `page.tsx` | `p4-admin.png` |
| **M-009** | `deals` is a nav entry with no page and no translation | **OPEN.** Renders the lowercase slug `deals` among German labels | `p4-admin.png` |
| **M-011** | Raw role identifiers in user copy | **OPEN, and now unmissable.** Every user sees "Ihre Ansicht als tenant" | `p4-admin.png` |
| **M-006** | SEC-003, evidence content in the RSC payload of a refused role | **NOT RE-TESTED this run.** Every role is `tenant`, so the per-role payload comparison M-006 needs cannot be constructed until M-002 is fixed | — |
| **M-010, M-012–M-016** | | **NOT RE-TESTED.** Nothing in this session touched them; treat the previous report as current | — |

**Good news that survived re-testing on main:** no raw message keys on any public route
(`/de`, `/de/hotel`, `/de/concierge`, `/de/report`, `/de/login`); no horizontal scroll and no tofu
in any of the four locales at 1440px; the USD figure renders as `239.171 $` in German and is never
converted; no anglo-formatted money on the landing page.

---

## 4. What F1, F2 and F3 actually do

Applied to a throwaway worktree from `main` (`D:/azura-w5verify`, detached), built, and served on a
port I verified I owned. **This is not main.**

> **A process note that nearly cost this session its credibility.** My first run of this comparison
> reported that F1 *broke login entirely* — eleven blank dashboards and "nicht konfiguriert". That
> was false. Port 3210 was held by a **stale server from `D:\azura-w3h`**, another worktree, and I
> was driving it instead of my own build. I found it by checking the PID that owned the port. Every
> number in this section comes from a run where I confirmed the listening process was
> `D:\azura-w5verify` first. W3-C hit the identical trap on `qa:csp` and recorded it; I hit it
> anyway. **Check the PID, not the port.**

### 4.1 F1 — closes M-002 completely, and M-017 with it. Ready to merge.

`lib/auth.ts` stops asking for the two absent columns; the projection becomes a named
`PROFILE_COLUMNS` constant in `auth-resolution.ts`, which is importable outside a Next runtime so a
test can assert it against the schema. The rationale in the diff is thorough and correct.

**Measured, eleven real logins:**

```
admin            -> resolved=admin             nav=21  kpi=12
manager          -> resolved=manager           nav=21  kpi=7
accountant       -> resolved=accountant        nav=12  kpi=3
staff            -> resolved=staff             nav=13  kpi=4
owner            -> resolved=owner             nav=13  kpi=4
tenant           -> resolved=tenant            nav=12  kpi=3
guest            -> resolved=guest             nav=8   kpi=2
service_provider -> resolved=service_provider  nav=8   kpi=2
child_owner      -> resolved=child_owner       nav=9   kpi=2
child_tenant     -> resolved=child_tenant      nav=9   kpi=2
child_guest      -> resolved=child_guest       nav=7   kpi=1

resolved role matches the account : 11 of 11
distinct nav sizes                : 21, 13, 12, 9, 8, 7   (six)
distinct KPI counts               : 12, 7, 4, 3, 2, 1     (six)
```

Those numbers are **identical to the access-profile pass-4 table** in the previous report. That is
the proof the UI's role handling was right all along: only the role reaching it was wrong.

**Pass 5, now a real pass** (`fixed-p5-units.png`): 50 rows on page 1, 25 `data-modelled` markers,
caption *"25 von 656 Einheiten stammen aus einem realen Inserat."* — M-017 gone.

**Pass 7, now a real pass** (`fixed-p7-*.png`): `accountant` reaches **Finanzen** (`5.000,00 €`,
per-currency note present) and **Lieferantenrechnungen** instead of "Kein Zugriff auf diesen
Bereich". `typecheck` exits 0 with F1 applied.

**Verdict: merge it.** It is the single highest-value change available and it closes two blockers.

### 4.2 F2 — fixes one of F-002's two homes. Do not merge as-is.

With F2 applied, the **concierge** improves materially:

> F-002 (critical): The 1+1 entry price is **unresolved across 19 observations from 6 publishers**
> (Alanya-Home, Capital Estate, Haspo Realty, Housearch, Seaside Alanya, TERRA Real Estate).

`says '2.1x': false`. That also closes **M-010** (four publishers claimed, six carried) in the same
edit, and drops the `1.000 EUR` outlier.

**But the evidence cockpit is unchanged** (`fixed-p6-evidence-cockpit.png`):

```
evidence cockpit, F2 applied, admin, database-backed
  says '2.1x' : true
  em dash     : true
  F-002 as rendered: "… spans a 2.1x range across four publishers — Haspo EUR 112,000 …"
```

F2 patches the generated `apps/web/lib/azura-world-data.ts`. The cockpit reads `public.findings`,
which still holds the old text. **The flagship evidence screen keeps the overclaim.** F2 also
carries `supabase/imports/*` changes, which is presumably the intended route — but nothing has been
imported, so the running product is unfixed.

Also still true with F2 applied: `2.100 EUR` remains (M-004 half-fixed), and the em dash, the anglo
money format and the English-inside-German all survive.

**Verdict: F2 is incomplete.** It needs the dataset re-imported into Supabase, and it needs the
three language-rule violations addressed in the same pass. Merging the file alone would make the
concierge and the cockpit disagree with each other about the same finding, which is worse than
either state.

### 4.3 F3 — correct and small. Merge it, but it closes less than it looks.

Adds `common.notAvailable` ("Keine Angabe") and `common.dataSource.localSeedHint` to all four
catalogues. That is exactly right and closes **M-005**.

It does **not** touch `dashboard-routing.ts`, so **M-008 and M-009 remain open with F3 applied** —
confirmed in the running fixed tree:

```
/dashboard/evidence   "Quellen und Nachweise  In Arbeit"
/dashboard/units      "Wohnungen  In Arbeit"
/dashboard/hotel      "Hotelbetrieb  In Arbeit"
/dashboard/reviews    "Bewertungen  In Arbeit"
/dashboard/deals      "deals  In Arbeit"
```

---

## 5. What I verified personally in the running app

| Claim | Verdict |
| ----- | ------- |
| A production build serves 78 routes | **VERIFIED** |
| `/de/login` renders and authenticates against a real backend | **VERIFIED** — wrong password reaches *invalid credentials*, not *not configured* |
| There is no role picker in this build | **VERIFIED** — `ENABLE_ACCESS_PROFILES=false`, no role control in the form |
| The dashboard is reachable in production | **VERIFIED** — `/de/dashboard` after sign-in |
| Eleven roles produce eleven different surfaces | **FALSE on main** — 1 of 11 correct, one nav shape (M-002) |
| The 656-unit inventory renders | **FALSE on main** — 0 rows, "0 von 0" (M-017) |
| RLS scopes correctly per account in the database | **VERIFIED** — admin 656 · tenant 23 |
| `accountant` can reach the money screens | **FALSE on main** — refused; **TRUE with F1** |
| F-002's `2.1x` is a cross-currency division, rendered to users | **CONFIRMED OPEN** — in the concierge *and* the cockpit |
| Monthly rents appear as asking prices | **CONFIRMED OPEN** |
| The concierge refuses to average across currencies | **VERIFIED** — the principle is stated; the ratio contradicts it |
| USD stays USD | **VERIFIED** — `239.171 $`, all four locales |
| No raw message keys on any public route | **VERIFIED** |
| `<html lang>` matches the locale | **FALSE** — `de` on all four (M-007) |
| F1 closes M-002 | **VERIFIED** — 11 of 11, six nav sizes, six KPI counts |
| F2 closes M-003 | **PARTLY FALSE** — concierge yes, evidence cockpit no |
| F3 closes M-005 | **VERIFIED** |

---

## 6. What was NOT tested, and why
| `/de/login` exists and renders | **VERIFIED** — HTTP 200, real email/password form |
| The dashboard is reachable in production | **FALSE** — no sign-in is possible (M-001) |
| The QA role picker cannot be enabled in production | **VERIFIED** — cookie ignored, redirected to login |
| `/kitchen-sink` ships publicly (SEC-019) | **FIXED** — 404 in the production build |
| `?next=` open redirect | **DEFENDED** — 4/4 hostile values collapse to `/dashboard` |
| `profiles.roles` / `anonymized_at` exist (SEC-002) | **CONFIRMED OPEN** — live DB returns `42703` |
| Evidence cockpit leaks to unprivileged roles (SEC-003) | **NOT REPRODUCIBLE** — retracted by F1; see M-006 |
| F-002's `2.1x` is a cross-currency division (SEC-007) | **CONFIRMED OPEN** — and rendered to users |
| Modelled units distinguishable at a glance | **VERIFIED** — badge, recession, greyed price |
| Mixed-currency totals stay separate | **VERIFIED** — per-currency subtotals, never blended |
| A write with no database returns 503, not a fake success | **VERIFIED** — API 503; report form says "keine Nummer" |
| Reduced motion yields a complete page | **VERIFIED** — 10 sections, 0 invisible blocks |
| CSP with a per-request nonce in production | **VERIFIED** — `strict-dynamic`, fresh nonce per request |

---

## 3. Blockers

### M-001 — Nobody can sign in to a production build, so the whole dashboard is unreachable

**Severity:** Blocker · **Pass:** 0, 4 · **Role:** all · **Locale:** de · **Viewport:** 1440
**Owner:** W0-A · **Evidence:** `quality/manual/pass0-production-truth/02-login-wrong-password.png`

**Steps.** `pnpm --dir apps/web build` → `pnpm --dir apps/web start` → `/de/login` → enter
`admin@azura.local` and any password → submit.

**Expected.** Either a session, or "wrong credentials".

**Actual.** The form returns, in German:

> **Die Anmeldung ist in dieser Umgebung nicht konfiguriert. Es gibt keine Datenbankverbindung.**

**Root cause, confirmed.** `apps/web/.env.local` does not exist. Next loads environment from the
app root (`apps/web`), not the repository root, and `.env.local` lives at the repository root. So
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` never reach the server, every
repository falls back to `local-seed`, and `signInWithPassword` has nothing to call.

**This was reported and never actioned.** `HANDOFF/W2-D.md` §Requests, row A, to W0-A: *"Make
`apps/web` load the root `.env.local`, or move it."* It also warns that a **partial** copy is
worse than none, because every route then 500s on `lib/env.ts`'s server schema.

**The message itself is correct and deserves credit.** It does not say "wrong password", it does
not fake a session, it names the real reason. That is the standard this project sets. The blocker
is the configuration, not the behaviour.

**Note for whoever fixes it.** The eleven seeded users take their password from
`current_setting('azura.seed_password')`, and where that is unset the seed generates
`encode(gen_random_bytes(24),'base64')`. No password is recorded anywhere in the repository, so
after the env fix a known password is still needed. Resetting one is a credential rotation, and
this session deliberately did not perform one.

**Automated coverage.** *Should have been caught.* Nothing asserts that a **production** server can
reach its data plane. `e2e/production/live-harness-absent.spec.ts` runs against production and only
asserts that a dev route 404s. **New test for W4-A:** in the `production` project, assert that
signing in with a known-bad password reaches the *invalid-credentials* state and **not** the
*not-configured* state — that is, that an auth backend is reachable at all.

---

### M-002 — SEC-002 is live: with the database connected, every user would still be `tenant`

**Severity:** Blocker · **Pass:** 4, 10 · **Owner:** W1-B + W1-A

**Steps.** Query the live project's PostgREST with the exact select list from
`apps/web/lib/auth.ts:152`.

**Actual.**

```
profiles?select=id             -> 200
profiles?select=role           -> 200   {"role":"admin"}
profiles?select=roles          -> 400   42703  column profiles.roles does not exist
profiles?select=anonymized_at  -> 400   42703  column profiles.anonymized_at does not exist
full list from lib/auth.ts     -> 400   42703
```

**Impact.** `resolveSupabaseProfile` takes its `profileReadFailed` branch on every request and
returns `role: "tenant"`. Fixing M-001 alone would therefore produce **a working login that signs
everybody in as a tenant**, which is worse than today's honest refusal because it looks like it
worked.

**This is why pass 4 is labelled below.** The eleven-role walk had to run in access-profile mode,
and access-profile mode does not execute this code path. Every per-role result in this report, and
in every wave-3 handoff, describes the UI's role handling and **not** the database's.

**Automated coverage.** *Should have been caught.* `scripts/security-probe.mjs` finds it statically
(SEC-A03); nothing executes it. **New test for W4-A:** a contract test that issues the select list
from `lib/auth.ts` against the configured PostgREST and fails on any non-200. It would have caught
this the day the column list drifted.

---

### M-003 — The `2.1x` headline is a division across two currencies, printed beside the sentence forbidding it

**Severity:** Blocker (overclaim) · **Pass:** 6 · **Locale:** de · **Viewport:** 1440
**Owner:** W0-B · **Evidence:** `quality/manual/pass5-7/p6-concierge-after.png`

**Steps.** `/de/concierge` → ask *"Was kostet eine 1+1 Wohnung?"*

**Actual.** The same reply contains both of these:

> Die Beträge stehen in unterschiedlichen Währungen und werden nicht umgerechnet; ein Mittelwert
> wäre eine erfundene Zahl.

> F-002 (critical): The 1+1 entry price spans a **2.1x range** across four publishers — Haspo EUR
> 112,000 …, Housearch USD 239,171 …

`239,171 USD ÷ 112,000 EUR = 2.135`. The ratio **is** the cross-currency arithmetic the sentence
above it refuses to perform. SEC-007 recorded this; it is still rendered to users.

**Why blocker, not major.** The project's strongest claim is that it never mixes currencies. Here
it states the principle and violates it two lines later, inside the critical finding, in the
feature meant to demonstrate the principle. A client who notices has reason to doubt every other
figure on the screen.

**Fix.** State the spread per currency (`EUR 112,000–220,000`, `USD 238,967–239,171`), or express
it within EUR only and say so. Do not convert.

**Three further rule violations in the same string:** the finding text is **English inside a German
answer**, contains an **em dash**, and formats money **anglo-style (`EUR 112,000`)** in German copy.

**Automated coverage.** *Should have been caught.* `pnpm qa:evidence` validates provenance
structure, not arithmetic. **New test for W4-A / W4-D:** no `AzuraFinding.message` may state a
ratio, multiple or percentage derived from `competingValues` carrying more than one `currency`.
Mechanical, and it would have failed the build.

---

### M-004 — Monthly rents are presented as asking prices

**Severity:** Blocker (overclaim) · **Pass:** 6 · **Locale:** de · **Owner:** W0-B

**Actual.** The concierge lists, as observed asking prices for 1+1 apartments:

```
Haspo Realty:      1.000–190.000 EUR, 80–89 m²   (9 Inserate)
Alto Real Estate:  2.100 EUR, 70 m²
```

A €1,000 lower bound on an 80 m² apartment (€12.50/m²) and €2,100 for 70 m² are not sale prices.
They are almost certainly monthly rents that entered the sale series.

**The codebase already knows.** `apps/web/lib/azura-world-data.ts`:

```ts
/** A monthly rent must never enter the sale-price series — see F-002. */
export type AzuraPriceKind = "sale" | "rent"
```

The type exists, the rule is written down, and the data violates it. Confirmed in the dataset: the
only two stored amounts below €100,000 are exactly `1000 EUR` and `2100 EUR`.

**Automated coverage.** *Should have been caught.* **New test for W4-A / W0-B:** no `sale`-kind
price may imply €/m² below a floor (say €400/m²) without an explicit `priceKind: "rent"` tag or a
recorded justification.

---

## 4. Major

### M-005 — The "this is demo data" banner renders as a raw message key on `/dashboard/units`

**Severity:** Major · **Pass:** 5 · **Role:** manager · **Locale:** all · **Viewport:** 1440
**Owner:** W3-C + W1-C · **Evidence:** `quality/manual/pass5-7/p5-units-top.png`

**Actual.** The banner at the top of the inventory page reads, literally:

```
common.dataSource.localSeedHint
```

`common.notAvailable` and `common.dataSource` **do not exist in any of the four catalogues**;
`common` holds only `actions states errors units pagination table filters time boolean required
optional`. next-intl renders the key path rather than throwing.

**Why Major rather than Minor.** This is the control that tells a viewer the numbers are seed data,
on the screen carrying the 656-unit inventory. The warning is not merely ugly, it is unreadable —
so on this page the app shows demo data with its demo-data notice broken.

I hit the same two missing keys while building the operations modules and moved those strings into
module namespaces; the request to W1-C/W3-C is in `HANDOFF/W3-E.md` §11 and is still open.

**Automated coverage.** *Should have been caught.* **New test for W4-A:** on every route × locale,
no visible text may match `/^(common|dashboard|auth|landing)\.[a-z]/i`. Cheap, and it closes the
whole class permanently.

---

### ~~M-006 — SEC-003 is live: evidence content ships to roles that are shown a 403~~ — **WITHDRAWN, this was my false positive**

**Status:** **NOT REPRODUCIBLE. Retracted 29 July by F1**, which re-measured it properly before
fixing it and found nothing to fix. Recorded rather than deleted, because the way it was wrong is
the point.

**What I originally reported.** That `/dashboard/evidence` returned the 403 panel to four
unprivileged roles while carrying `F-002` and Haspo pricing in the RSC payload.

**Why that was wrong.** My probe counted `/F-002|F-013|Haspo|Widersprüch|competingValues/i` in the
whole document. **`F-002` appears in the shipped `evidence` message namespace**, and `getTranslations({ namespace: "evidence" })` is called by finance, wallet, vendor-invoices and
several other pages. So the token appears in the payload of dashboard pages that read no evidence
data at all — which is precisely what F1 measured: exactly 3 occurrences of `F-002` on
`/dashboard/finance`, `/dashboard/wallet` and `/dashboard/vendor-invoices` as well as on
`/dashboard/evidence`. A translated string, not a row.

**What a correct measurement shows.** Splitting visible DOM from payload and counting markers that
only a repository row can produce (`Housearch`, `hasporealty.com`, `238.967`, `snapshotHash`):

```
/dashboard/evidence   role               HTTP  visible  payload  refusal
                      tenant             200   0        1        yes
                      guest              200   0        1        yes
                      child_guest        200   0        1        yes
                      service_provider   200   0        1        yes
                      owner/staff/accountant 200 0      1        yes
```

Zero row content visible, and the single payload hit is likewise catalogue text, not data. The page
**already returns before any repository read** — `evidence/page.tsx` computes `mayView` and returns
the refusal at line 117, and the `Promise.all` of `getFinding`/`getPortalListings`/`getSources`
starts at line 137. Its own comment says so: *"Nothing is fetched for a caller who may not see
it."* All twenty module pages guard server-side.

**The lesson, which is the same one W4-B recorded about a cached URL containing the word
`dashboard`:** a substring search over a whole response is not a leak test. The marker has to be
something only the data can produce. My W5 finding was the exact failure mode I quoted W4-B for in
that same report.

**Automated coverage.** The replacement test is still worth having, and its assertion is now
specified correctly: for every role lacking a route's permission, assert the **response body**
contains no marker that only a repository row can produce — never a token that also exists in a
message catalogue.

---

### M-007 — `<html lang="de">` on every locale

**Severity:** Major · **Pass:** 3, 11 · **Locales:** en, tr, ru · **Viewports:** 1440 and 375
**Owner:** W1-C + W0-A

**Actual.** `/en`, `/tr` and `/ru` all serve `lang="de"`, measured at both viewports. A screen
reader pronounces Russian and Turkish with a German voice. This is W4-B's *"18 serious `html-lang`
violations"* confirmed by hand in the production build.

**Automated coverage.** *Caught by W4-B's `a11y-audit.mjs` and not gating.* The finding exists and
the build ships. **Action for W4-D:** make `html-lang` a gate, not a report line.

---

### M-008 — Four shipped modules still advertise themselves as unfinished

**Severity:** Major · **Pass:** 4 · **Role:** all · **Owner:** W3-B (routing) + module owners
**Evidence:** `quality/manual/pass4-eleven-roles/admin.png`

**Actual.** `lib/dashboard-routing.ts` still carries `pending: true` for routes whose `page.tsx`
exists:

```
PENDING  /dashboard/evidence   page.tsx exists = True
PENDING  /dashboard/units      page.tsx exists = True
PENDING  /dashboard/hotel      page.tsx exists = True
PENDING  /dashboard/reviews    page.tsx exists = True
PENDING  /dashboard/deals      page.tsx exists = False   <- M-009
```

Every role's sidebar shows "In Arbeit" badges against Wohnungen, Hotelbetrieb, Bewertungen and
Quellen und Nachweise; admin sees five.

This is an **under**claim rather than an overclaim, and still wrong: in a client demo the navigation
says four finished modules are unfinished, including the inventory screen carrying acceptance
criterion 3.

**Automated coverage.** *Not caught, trivially catchable.* **New test for W4-A:** `pending === true`
if and only if that route has no `page.tsx`. A pure filesystem check.

---

### M-009 — `deals` is a navigation entry with no page and no translation

**Severity:** Major · **Pass:** 4 · **Locale:** all · **Owner:** W3-B + W1-C

**Actual.** The sidebar renders the lowercase English slug **`deals`** among German labels.
`dashboard.deals` is undefined in all four catalogues (the sidebar's `t.has()` fallback degrades to
the slug) and `app/[locale]/dashboard/deals/page.tsx` does not exist. W3-B reported the missing key;
what the entry does when clicked was not reported — it is a nav item that cannot lead anywhere.

**Automated coverage.** *Should have been caught.* The filesystem test from M-008 or the raw-key
test from M-005 catches it.

---

### M-010 — F-002 says "four publishers"; the record carries six

**Severity:** Major · **Pass:** 6 · **Owner:** W0-B

**Actual.** The message says *"across four publishers"* and names four. The `competingValues` array
holds **19 entries across 6 distinct publishers**: Alanya-Home, Capital Estate, Haspo Realty,
Housearch, Seaside Alanya, TERRA Real Estate.

`SECURITY-REVIEW.md` SEC-006 records this as *"claims four publishers and carries three"*. **Both
the finding text and the security review are wrong about the data, in opposite directions.** The
record is richer than either says.

**Automated coverage.** *Should have been caught.* **New test:** a publisher count stated in a
message must equal the distinct count in its own `competingValues`.

---

## 5. Minor

| id | Finding | Pass | Owner | Automated coverage |
| -- | ------- | ---- | ----- | ------------------ |
| **M-011** | Raw role identifiers in user copy: *"Ihre Ansicht als child_guest"*, *"…als admin"*; the topbar chip shows `service_provider`. The topbar subtitle already carries a proper label ("QA · Gast (Unterkonto)"), so the human string exists and is not used. | 4 | W3-B | Not caught. **New test:** no rendered text may equal a raw `Role` union member. |
| **M-012** | `lib/ai-responses.ts:454` holds a user-visible German string containing an **em dash**, hardcoded outside `messages/*`. It renders in the concierge's injection refusal. | 6, 10 | W2-C | The em-dash sweep covers `messages/*` only. **New test:** extend it to string literals in `lib/ai-*.ts`. |
| **M-013** | Em dashes in seed ledger descriptions, user-visible: *"Elektrik — ortak alanlar 06/2026"*, *"Poolanlage — Instandsetzung Umwälzpumpe"*; same class in `operations-data.ts`: *"Fassadenriss Block B03 — Gutachten ausstehend"*. | 7 | W2-A | Same gap — the sweep does not read `*-data.ts`. |
| **M-014** | `/dashboard/units` page 1, row 7: a **2+1 with 3 m²** priced at 242.000,00 €, identical to the 129 m² unit above it. | 5 | W0-B / W2-A | **New test:** `interiorM2` must be plausible for its layout. |
| **M-015** | `child_guest`'s home is a single KPI, "Hotelzimmer 188", above a large empty area. Not broken; not coherent as *their* home either. | 4 | W3-B | Judgement, not assertable. Design call. |
| **M-016** | HSTS absent. Immaterial over plain HTTP on localhost; required behind TLS. | 0 | W0-A | **New test:** assert the header once a TLS origin exists. |

---

## 6. Passes that succeeded, and what specifically succeeded

**Pass 5 — the 656-unit table. Not a blocker.** The brief said failure here blocks. It does not
fail. A modelled unit is distinguishable from a real listing at a glance through **four** redundant
channels: a green `Reales Inserat` vs grey `Σ Modelliert` badge in a dedicated Herkunft column, a
recessed row background, a greyed price, and a header stating *"25 von 656 Einheiten stammen aus
einem realen Inserat. Die übrigen 631 sind modelliert: sie füllen den Bestand auf und bilden kein
reales Angebot ab."* with a 3.8% proportion bar and filter chips. Filtering to an empty provenance
class yields 0 rows and an empty state, not an error.

**Pass 6 — the concierge. Not a blocker, and the best thing in the build.** Asked *"Was kostet eine
1+1 Wohnung?"* it opens *"Die Quellen widersprechen sich."*, lists five publishers with ranges,
sizes and listing counts, keeps `238.967–239.171 USD` in USD, cites F-002, F-013 and F-019 as
*"bewusst offen gelassen"*, lists seven sources with dates, and states:

> Die Beträge stehen in unterschiedlichen Währungen und werden nicht umgerechnet; ein Mittelwert
> wäre eine erfundene Zahl.

It does not pick a price. That was the question that decided this session and it passes. M-003 and
M-004 are defects *inside* an otherwise exemplary answer.

**Pass 7 — money. Passes on its central claim.** `Summen je Währung` shows per-currency subtotals
(`EUR 9.110,00 €` beside `TRY 12.500,00 TRY`) and every card repeats *"Eine gemeinsame Summe über
mehrere Währungen wäre ohne Umrechnungskurs nicht aussagekräftig."* Nothing is blended. German
formatting is correct throughout (`45.000,00 TRY`), no anglo-formatted amounts appear in German
copy, negative balances are amber, posted entries are documented as immutable, and the payment form
states *"Ein zweiter Klick auf diesen Knopf erzeugt keine zweite Zahlung. Jede Erfassung trägt einen
einmaligen Schlüssel."* The amount field's placeholder and hint are exactly `1.234,56`.

**Pass 9 — public writes with no database. Exemplary.** Submitting the report form returns
*"Nicht gespeichert. Die Meldung wurde nicht erfasst, und es gibt keine Nummer. Bitte später erneut
senden."* No reference number is invented for a report that was not stored.

**Pass 10 — adversarial.** An XSS payload (`<img onerror>` plus `<script>`) into every report field
produced no dialog and no execution. Prompt injection was refused: *"Ich folge keinen Anweisungen,
die in eine Anfrage eingebettet sind."* `?next=` with `https://evil.com`, `//evil.com` and
`\\evil.com` all collapse to `/dashboard` while `/dashboard/units` passes through. `/de/kitchen-sink`
and `/de/dev/live-harness` both 404 in production. CSP carries a per-request nonce with
`strict-dynamic`; `X-Frame-Options: DENY`, `nosniff`, `no-referrer` and a `permissions-policy` are
present.

**Pass 11 — reduced motion and keyboard.** With `prefers-reduced-motion: reduce` the landing page
renders 6,521 characters across 10 sections with **0** invisible blocks: nothing is animation-gated.
12 of 12 tab hops reached a focusable element, all 12 with a visible focus indicator.

**Pass 12 — mobile.** No horizontal page scroll at 375px on units, finance or tickets. Russian at
375px renders Cyrillic correctly, no tofu, no clipping.

**Pass 3 — locales.** No horizontal scroll in any locale at either viewport, no replacement glyphs,
no raw keys on the public pages, and USD stays USD in all four (`239.171 $` / `$239,171` /
`$239.171`). The only defect is M-007.

**Pass 4 — the eleven roles (access-profile mode, see M-002).** All eleven render HTTP 200 with a
coherent and genuinely different surface: nav sizes `admin 21 · manager 21 · staff 13 · owner 13 ·
accountant 12 · tenant 12 · child_owner 9 · child_tenant 9 · guest 8 · service_provider 8 ·
child_guest 7` — six distinct sizes. KPI counts fall from 12 to 1 along the same gradient. No raw
message keys on any role's home, no console errors except one on manager, and every home carries
the amber `Demo-Daten` badge.

---

## 7. What was NOT tested, and why

| Not tested | Reason |
| ---------- | ------ |
| Passes 8, 9, 10, 11, 12 | Not re-run. Nothing in this session changed them; the previous report's results stand. This run was scoped to the four blockers and to passes 4, 5 and 7, which had never truly executed |
| M-006 (evidence in the RSC payload of a refused role) | Structurally impossible on main: every role is `tenant`, so there is no privileged/unprivileged pair to compare. **Re-test the moment F1 lands** |
| Writing money: `1.234,56` saved and read back; editing a posted entry; double-clicking submit | The money screens are unreachable on main (M-002). With F1 applied they render, but `finance_ledger_entries` holds **0 rows** in the live project, so there is nothing to edit and no posted entry to protect |
| Leads and buyer pipeline against real data | `leads` and `buyer_pipeline_entries` are **0 rows** in the live project |
| A ticket lifecycle; ICS in a real calendar client; capacity booking | `tickets` does not exist as a table in the live project (`PGRST205`). The operations seed did not reach this database |
| axe-core, Lighthouse, a real screen reader, real mobile hardware | Unchanged from the previous report |
| Cold-cache throttled first impression (pass 1) | Warm local server only |

**A finding in its own right:** the live project is **partially seeded**. `units` 656, `sources` 56,
`findings` 24, `sourced_facts` 1354, `portal_listings` 47, `site_blocks` 7, `profiles` 11 — but
`leads` 0, `buyer_pipeline_entries` 0, `documents` 0, `finance_ledger_entries` 0, and no `tickets`
table at all. Fixing M-002 makes the ERP screens reachable; it does not make them populated.

---

## 7. New tests handed to W4-A

Carried forward from the previous report, plus what this run adds. Items 1, 3–12 are unchanged and
still owed.

| # | Test | Closes |
| - | ---- | ------ |
| 2 | Issue `lib/auth.ts`'s literal select list against the configured PostgREST; fail on any non-200. **F1 makes this trivial** — it moves the list to an importable `PROFILE_COLUMNS` constant precisely so a test can assert it | M-002 |
| **13** | **With a data plane configured, sign in as each of the eleven accounts and assert the resolved role equals the account.** One assertion, and it is the one that would have caught M-002 on the day the column list drifted | M-002 |
| **14** | **With a data plane configured, `/dashboard/units` as a privileged role must render a non-zero row count, and its split caption's total must equal the `units` count the same session can read** | M-017 |
| **15** | **`findings.message` in the database and `AzuraFinding.message` in the generated file must be byte-identical.** F-002 has two homes and F2 fixed one; nothing detects the divergence | M-003 |
| **16** | **A QA run must assert the PID listening on its port belongs to its own tree** before making any claim about the application | process |
| 1 | In the `production` project, sign-in with a known-bad password must reach *invalid-credentials*, never *not-configured* | M-001 |
| 2 | Issue `lib/auth.ts`'s literal select list against the configured PostgREST; fail on any non-200 | M-002 |
| 3 | No `AzuraFinding.message` may state a ratio/multiple/percentage derived from `competingValues` spanning more than one currency | M-003 |
| 4 | No `sale`-kind price may imply €/m² below a floor without an explicit rent tag | M-004 |
| 5 | On every route × locale, no visible text may match `/^(common\|dashboard\|auth\|landing)\.[a-z]/` | M-005, M-009 |
| 6 | For every role lacking a route's permission, the **response body** must contain no marker that only a repository row can produce (never a token that also exists in a message catalogue) | M-006 |
| 7 | `<html lang>` must equal the requested locale — promote W4-B's rule to a gate | M-007 |
| 8 | `pending === true` if and only if that route has no `page.tsx` | M-008, M-009 |
| 9 | A publisher count stated in a message must equal the distinct count in its `competingValues` | M-010 |
| 10 | No rendered text may equal a raw `Role` union member | M-011 |
| 11 | Extend the em-dash sweep from `messages/*` to user-visible string literals in `lib/ai-*.ts` and `lib/*-data.ts` | M-012, M-013 |
| 12 | `interiorM2` must be plausible for its layout | M-014 |

---

## 8. Where the app overclaims

1. **M-017 — "0 von 0 Einheiten stammen aus einem realen Inserat."** New, and the worst of them.
   An inventory of 656 rendered as an inventory of nothing, stated with the confidence of a
   measurement. Everything else here is a wrong number; this is a wrong number wearing the honesty
   control's own uniform.
2. **M-003 — `2.1x` across two currencies**, rendered beside the sentence forbidding that
   arithmetic, in both the concierge and the evidence cockpit.
3. **M-004 — monthly rents shown as asking prices**, against the codebase's own written rule.

**And where it conspicuously does not overclaim:** the sign-in refusal named its real cause before
it was fixed and now names the real cause again ("E-Mail-Adresse oder Passwort ist falsch"); the
concierge states plainly that it will not average across currencies; USD stays USD in all four
locales; the KPI cards a role may not see say *"Dieser Bereich gehört nicht zu Ihrer Rolle. Das ist
die richtige Antwort, kein Fehler."* rather than rendering zero. The honesty architecture is real.
M-002 is a leak that empties it from underneath.

---

## 9. Sign-off

**NOT READY** for a client demo on 29 July, in the current state of `main`.

**The path to READY WITH CAVEATS is one merge and one import:**

1. **Merge F1.** Measured to close M-002 and M-017: 11 of 11 roles resolve correctly, six distinct
   navigations, the inventory renders 25 of 656, the accountant reaches Finanzen. → M-002, M-017
2. **Finish F2 and import it.** The file fix is right; the database still holds the old F-002 text,
   and the evidence cockpit reads the database. Fix the em dash, the anglo money format and the
   English-in-German while the string is open. → M-003, M-004, M-010
3. **Merge F3.** Two keys in four catalogues. → M-005
4. **Delete four `pending` flags; build or remove `deals`.** Untouched by all three branches. →
   M-008, M-009
5. **Re-run M-006** once F1 lands — it cannot be tested before then.
1. Put the full `.env.local` at `apps/web/.env.local` (whole file, per W2-D's warning), and record
   a seed password. → M-001
2. ~~Remove `roles` and `anonymized_at` from `lib/auth.ts`'s select list.~~ **DONE by F1 on
   29 July** — `PROFILE_COLUMNS` in `lib/auth-resolution.ts`; all 11 roles proven to resolve to
   themselves against the live database. → M-002
3. Restate F-002's spread per currency. → M-003
4. Tag or drop the two rent-contaminated prices. → M-004
5. Add `common.notAvailable` and `common.dataSource.localSeedHint`. → M-005
6. Delete four stale `pending` flags; build or remove `deals`. → M-008, M-009

Items 1 and 3 are ready now. Item 2 is half-done. Items 4 and 5 are minutes.

**With 1, 3 and 4 done I would show the whole product with two stated caveats** — that the evidence
cockpit's F-002 text still quotes a cross-currency ratio, and that the ERP screens are reachable but
thinly populated because the live project was only partly seeded.

**Without item 1 I would show the public surface only**, and say plainly that the dashboard signs
every user in as a tenant. That is not a caveat you can talk past in a room.
