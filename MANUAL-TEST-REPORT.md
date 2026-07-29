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

Items 1 and 3 are ready now. Item 2 is half-done. Items 4 and 5 are minutes.

**With 1, 3 and 4 done I would show the whole product with two stated caveats** — that the evidence
cockpit's F-002 text still quotes a cross-currency ratio, and that the ERP screens are reachable but
thinly populated because the live project was only partly seeded.

**Without item 1 I would show the public surface only**, and say plainly that the dashboard signs
every user in as a tenant. That is not a caveat you can talk past in a room.
