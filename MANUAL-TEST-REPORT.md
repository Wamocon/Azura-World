# MANUAL TEST REPORT — Azura World CATI

**Session:** 29 July 2026 · **Owner:** W5 · **Build:** `main` @ `d74ec77`, 167 commits
**Servers driven:** production `next start` on 127.0.0.1:3200 (primary) · `next dev --webpack`
with QA access profiles on 127.0.0.1:3201 (role-gated passes only, and M-002 explains why that
distinction matters)
**Browser:** headed Chromium 1228, `slowMo` 250/120, video + trace on
**Evidence:** `quality/manual/pass0-production-truth/`, `pass4-eleven-roles/`, `pass5-7/`,
`pass3-8-12/`

> **This report supersedes the 28 July one**, which recorded READY WITH CAVEATS and said *"every
> `/dashboard` route 307s to `/de/login`, and `/de/login` is a 404."* `/de/login` now returns
> **200** and renders a real sign-in form, and there are 24 dashboard pages instead of 2. That
> verdict was correct when written and is obsolete.
>
> It is replaced by a narrower and more specific one. The dashboard is still unreachable in a
> production build, for a different reason: there is no database connection, so nobody can sign
> in. That is one file in the wrong directory, not a missing feature. See M-001.

---

## 1. Recommendation

- [ ] READY FOR CLIENT DEMO
- [ ] READY WITH CAVEATS
- [x] **NOT READY**

**Two independent reasons, both narrow, both fixable well inside a day.**

1. **In a production build nobody can sign in, so 20 of the 24 dashboard pages cannot be reached
   by anyone** (M-001). The ERP half of the product is undemonstrable in the artefact you would
   actually deploy.
2. **Two overclaims survive in the flagship evidence feature** (M-003, M-004). The brief is
   explicit that an overclaim blocks here regardless of severity elsewhere, and these are the
   exact kind this project exists to prevent: a computed figure that is not what it says it is,
   and a monthly rent presented as a sale price.

**What is genuinely good, on the record before the findings:** the public surface is demonstrable
today and it is strong. The concierge answered the question that was supposed to decide this
session, and answered it better than the brief required. Passes 5, 6, 7, 9, 10, 11 and 12 all pass
on their central claim. The failures below are concentrated, not systemic.

**Would I show this to the client on 29 July?** The public half, yes, this morning, with the two
data corrections made first. The dashboard, no — not because it is unfinished, but because in the
build you would put in front of them it cannot be opened.

---

## 2. What I verified personally in the running app

| Claim | Verdict |
| ----- | ------- |
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
| Sign-in as any of the 11 roles through the **real** auth path | M-001 (no data plane) and M-002 (would degrade to `tenant`). Pass 4 ran in access-profile mode, which SEC-002 says does not exercise the profile read |
| Saving `1.234,56` in a German amount field | Every write returns 503 with no database. The **input format** is documented and correct; **what gets stored** is untested |
| Editing a posted ledger entry; double-clicking payment submit | Same. The UI states both behaviours; neither was executed |
| A ticket through its full lifecycle; an invalid transition rejected by the API | The API answers 503 before any transition check, so the known W3-E gap (the API does not consult `canTransition`) is **still unverified in a running app** |
| Booking the last capacity slot | No `activity_bookings` table exists (W3-E's open request to W1-A) |
| The ICS feed in a real calendar client | `CALENDAR_FEED_TOKEN_SECRET` is unreachable without env. The serialiser is unit-proven (59/0) but no `.ics` was opened in Outlook or Apple Calendar |
| Public report idempotency (submit twice: one report or two?) | Requires persistence |
| Deep-linking to another owner's statement; guardian scope | Requires real sessions |
| axe-core, Lighthouse | Not installed; `pnpm install` is W0-A's |
| A real screen reader | None driven. Semantics inspected only |
| Real mobile hardware | Emulation only |
| Cold-cache throttled first-impression timing (pass 1) | Measured on a warm local server; W4-B's `perf.mjs` owns the lab numbers |

---

## 8. New tests handed to W4-A

One per finding automation should have caught. This is the most valuable output of the session:
each closes a class, not an instance.

| # | Test | Closes |
| - | ---- | ------ |
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

## 9. Where the app overclaims

Listed separately because the brief treats these as blockers regardless of severity elsewhere.

1. **M-003 — `2.1x` across two currencies**, rendered beside the sentence forbidding exactly that
   arithmetic.
2. **M-004 — monthly rents shown as asking prices** (€1,000 for 80 m²; €2,100 for 70 m²), against
   the codebase's own written rule.
3. **M-010 — F-002 understates its own evidence** ("four publishers" for six). An overclaim about
   the shape of the evidence, even though it errs toward modesty.

**And where it conspicuously does not overclaim**, which is the larger part of the picture: seed
data is badged `Demo-Daten` on every dashboard home; the sign-in refusal names the real cause; the
report form refuses to invent a reference number; the API returns 503 rather than a fake success;
unbooked activity capacity says *"Belegung nicht bekannt"* rather than showing zero; the units table
states 25 real against 631 modelled in four places; and the concierge refuses to average across
currencies. The honesty architecture is real and mostly working. The three overclaims above are
leaks in it, not the absence of it.

---

## 10. Sign-off

**NOT READY** for an unqualified client demo on 29 July.

**The path to READY WITH CAVEATS is short — I would expect it inside a day:**

1. Put the full `.env.local` at `apps/web/.env.local` (whole file, per W2-D's warning), and record
   a seed password. → M-001
2. ~~Remove `roles` and `anonymized_at` from `lib/auth.ts`'s select list.~~ **DONE by F1 on
   29 July** — `PROFILE_COLUMNS` in `lib/auth-resolution.ts`; all 11 roles proven to resolve to
   themselves against the live database. → M-002
3. Restate F-002's spread per currency. → M-003
4. Tag or drop the two rent-contaminated prices. → M-004
5. Add `common.notAvailable` and `common.dataSource.localSeedHint`. → M-005
6. Delete four stale `pending` flags; build or remove `deals`. → M-008, M-009

Items 3 to 6 are text and data edits. Items 1 and 2 are a file move and a one-line select change.
None is architectural.

**With those six done I would show the whole product.** Without items 1 and 2 I would show the
public surface only, and say plainly that the dashboard is not connected in this build.
