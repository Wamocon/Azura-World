# MANUAL-TEST-REPORT.md — Azura World CATI

Manual walkthrough, W5 · 2026-07-28 · `main` @ `1de48e4`
Headed Chromium, `--slow-mo=250`, video and trace on. Artifacts in `quality/manual/`.

---

## Recommendation

> ### ☑ READY WITH CAVEATS
>
> **Demonstrable: the public landing page, the public hotel page, and the provenance model.**
> All three were driven in a real `next start` production build today and they are good — the
> evidence argument lands, the conflict is visible, and the concierge refuses to invent a price.
>
> **Not demonstrable: the dashboard, in any form.** In a production build every `/dashboard`
> route 307s to `/de/login`, and `/de/login` is a 404. There is no way to reach an authenticated
> screen. This is not a caveat you can talk around on stage; the surface does not exist at
> runtime.
>
> **Two security findings are live on `main` right now** — one of them has a fix sitting on an
> unmerged branch (§4.2).

If the demo is scoped to the public surfaces and narrated as *"the evidence model, on the public
pages; the ERP behind it is wave-5 work"*, it holds up. If anyone clicks "Zugang", it dead-ends.

---

## 1. How this was run, and one thing that nearly produced a false report

```bash
pnpm --dir apps/web build                       # exit 0
npx next start --hostname 127.0.0.1 --port 3250 # the real production runtime
node scripts/manual-session.mjs --base http://127.0.0.1:3251 --slow-mo 250
```

**Two servers, because one cannot show both halves.** `next start` (3250) is the honest production
runtime and is where every public-surface claim below was measured. It cannot reach the dashboard
(§4.1), so the authenticated passes ran against the same production **build** served through Next's
programmatic API with the access profile reachable (3251) — W4-A's fixture. Every authenticated
result below is labelled with which server produced it.

**The near-miss, recorded because it is a live hazard in this repository.** My first `next start`
failed with `EADDRINUSE` — a stale server from another worktree held port 3200 — and *something*
answered my probes anyway. I measured `anon → /de/dashboard → 200` and was one step from filing a
catastrophic auth bypass. It was a different process. On a clean port the same probe returns
**307 → /de/login** for every role including `admin`, which is correct.

This is the second time this session that a stale cross-worktree server produced a false failure
(`csp-probe` reported `25 pass · 5 fail` for the same reason). **Any gate that starts its own
server should refuse to run if the port is already held**, rather than attaching to whatever is
there. Handed to W4-D as §6.

---

## 2. The twelve passes — what ran and what could not

| # | Pass | Status | Why |
|---|---|---|---|
| 1 | First impression, cold | **RUN** | 8 screenshots, slow scroll through the whole page |
| 2 | The evidence claim | **RUN** | conflict affordance, source links |
| 3 | Four locales × 2 viewports | **RUN** | 8 full-page captures |
| 4 | Every role's first screen | **RUN** (build fixture) | all 11 roles |
| 5 | The 656-unit table | **RUN** (build fixture) | the blocking question answered — §3.3 |
| 6 | The conflict, end to end | **RUN** | cockpit + concierge — §3.4 |
| 7 | Money | **NOT RUN** | `/dashboard/finance` does not exist |
| 8 | Operations | **NOT RUN** | `/dashboard/tickets`, `/dashboard/activities`, ICS UI do not exist |
| 9 | Public write paths | **PARTIAL** | no report form UI exists; the API was exercised by W2-B's matrix, not here |
| 10 | Adversarial, by hand | **RUN** | W4-C's top findings re-verified in the running app — §4.2 |
| 11 | Accessibility | **PARTIAL** | reduced motion verified; **no screen reader, no keyboard-only traversal** |
| 12 | Mobile 375px | **RUN** (emulated) | no real device available |

Five of twelve could not be driven because the surface does not exist. That is the honest shape of
this release: **six routes exist** (`/`, `/hotel`, `/kitchen-sink`, `/dashboard`,
`/dashboard/evidence`, `/dashboard/units`) out of roughly twenty-six the nav advertises.

---

## 3. What I looked at, and what it showed

### 3.1 Pass 1 — the landing page is good

`quality/manual/pass01-landing-1440-above-fold.png`

The thesis lands in the first viewport, exactly as W3-A designed it: **76.000 m² (8 Quellen) · 7
Blöcke (4) · 656 Wohnungen (5)** in the same type at the same size as **125.000 €** carrying an
always-visible amber *Widerspruch* badge and a sentence explaining that this is the only figure a
publisher itself labels as a "from" price. A visitor who leaves after one screen has seen a number
the product trusts beside one it does not.

The 3D maquette renders seven blocks with one in the sand accent. It did not block the hero.

**Would I believe a competent team built this? Yes.** The chart-plate grammar is distinctive, the
type is disciplined, and nothing reads as templated.

One open question rather than a defect: the subtitle renders several letters in a different tint
(*"5-Sterne-**H**otel"*, *"**M**ittelmeerküste"*, *"**voll**ständig"*). It is either a deliberate
letter-level accent or an artefact. It is visible; somebody who chose it should confirm they chose
it.

### 3.2 Pass 3 — four locales

No horizontal overflow at 375px in any locale (`scrollWidth === clientWidth === 375`, all four).
Cyrillic renders — no tofu boxes. German prices format as `112.000,00 €` and the Housearch figure
stays `239.171 $`.

Not done: a native reading of the Turkish and Russian copy. Three windows have already flagged
this; I did not close it and it stays open.

### 3.3 Pass 5 — **the honesty control works**

`quality/manual/pass05-modelled-row.png`

The brief calls this blocking: *can you tell a modelled unit from a real listing at a glance,
without opening it?* **Yes, on three simultaneous signals:**

| | real listing | modelled |
|---|---|---|
| badge | green `↗ Reales Inserat` | grey `Σ Modelliert` |
| price | full weight | **muted** |
| row | teal left accent | no accent |

Rows 19–25 and 26–28 are unmistakably different in a screenshot with no legend. The header states
*"25 von 656 Einheiten stammen aus einem realen Inserat. Die übrigen 631 sind modelliert"* with a
proportion bar where 3.8% lands before any digit is read. This is the strongest honesty surface in
the product.

### 3.4 Pass 6 — **the one that matters: the concierge does NOT pick a price**

There is **no concierge UI** — W3-H was never built — so the question went to the only surface that
exists, `POST /api/ai/public-chat`, on the real production server (3250).

> **Q: „Was kostet eine 1+1 Wohnung?"**
>
> „**Die Quellen widersprechen sich.** Beobachtete Angebotspreise verschiedener Portale für dasselbe
> Projekt: Haspo Realty: 1.000–190.000 EUR … Seaside Alanya: 185.000–210.000 EUR … Capital Estate:
> 230.000–310.000 EUR … Housearch: 238.967–239.171 USD … **Die Beträge stehen in unterschiedlichen
> Währungen und werden nicht umgerechnet; ein Mittelwert wäre eine erfundene Zahl.** … Erfasste
> Widersprüche: F-002 (critical) … F-013 (high) … F-019 (high). Bewusst offen gelassen." [7 Quellen]

`source: "deterministic-fallback"` · `refused: false` · **19 citations**.

**It presents the conflict. It does not pick. It does not convert.** It names the currencies, says
an average would be an invented number, flags stale listings against F-006, and surfaces three
findings by id. This is the single best answer in the product and it is not close.

**But the numbers at the edges are wrong — see M-005.** Two of the figures it quotes as apartment
prices are monthly rents.

---

## 4. Findings

### 4.1 M-001 — the dashboard does not exist in a production build · **BLOCKER**

**Pass:** 4 · **Role:** all · **Owner:** W1-B · **Server:** real `next start` (3250)

```
admin    /de/dashboard -> 307  ->  /de/login?next=%2Fdashboard
manager  /de/dashboard -> 307
tenant   /de/dashboard -> 307
anon     /de/dashboard -> 307
/de/login                -> 404
```

Every role, including `admin` with a QA cookie, is redirected to a page that does not exist.
`app/[locale]/login/` holds `actions.ts` and no `page.tsx`. The access-profile kill-switch is
working exactly as designed — it is supposed to be inert in production — but nothing replaces it,
so **there is no route into any authenticated surface at all.**

**Automated coverage:** W4-A found this (§4.1) and W4-B found it (§4.1). It is not a gap in the
suite; it is a known blocker that has not been fixed. This report re-confirms it in the running
production build.

### 4.2 M-002 — SEC-003 is live on `main`; the fix is on an unmerged branch · **BLOCKER**

**Pass:** 10 · **Role:** tenant · **Owner:** W3-C · **Server:** production build fixture (3251)

```
curl -H "Cookie: access_profile_role=tenant" .../de/dashboard/evidence
  → 112.000  239.171  Housearch   (all present in the response body)
```

A role without `evidence:view` still receives the cockpit's evidence in the RSC flight payload,
while the visible page shows a correct 403. Nine of eleven roles hold `dashboard:view` without
`evidence:view`.

**A fix exists and is verified** — branch `feature/INTERNAL-107-w3c-gaps`, which adds a
server-side permission check before any repository call and was proven with 48 assertions against
a production build. **It is not merged.** `origin/main` is two commits behind it.

**This report tests `main`, not that branch.** On `main` today the finding is open.

**Automated coverage:** caught by W4-C's probe and W4-A's suite. Both were right; the fix simply
has not landed.

### 4.3 M-003 — three real people are named on a public page · **MAJOR**

**Pass:** 10 · **Owner:** W0-B · **Server:** real `next start` (3250)

`sanemsii`, `Tulane` (and `Han`) still render verbatim in the 5/5 review on `/de/hotel`, in all
four locales. W4-C filed this as SEC-004 and W3-G declined to add a display-time filter for the
right reason: the names are in `apps/web/lib/azura-world-data.ts`, which is committed, and the
GitHub repository is **public**. Redaction has to happen at ingestion.

Unchanged since W4-C measured it.

### 4.4 M-004 — the seed notice renders as a machine key · **MAJOR (overclaim)**

**Pass:** 5 · **Locale:** de · **Owner:** W3-C + W1-C · **Evidence:** `quality/manual/pass05-units-top.png`

The most prominent banner on `/de/dashboard/units` reads:

```
common.dataSource.localSeedHint
```

`common.dataSource.localSeedHint` **does not exist in any catalogue** — `messages/de.json` resolves
it to `None`. The call site is `app/[locale]/dashboard/units/page.tsx:201`.

**This is an overclaim in the precise sense §5 asks about.** The banner exists to stop seed data
reading as live. It renders as a machine string, so a reader gets no warning at all — and the one
who notices sees a broken app instead. The honesty control is the thing that broke.

**Automated coverage:** W4-A added a "no message key renders as its own name" test — but only on
`/hotel`, because that is where the class was found. **It should run on every route.** Handed to
W4-A as T-001.

### 4.5 M-005 — the concierge answers a purchase question with rental prices · **MAJOR**

**Pass:** 6 · **Owner:** W2-C · **Server:** real `next start` (3250)

The answer quotes *"Haspo Realty: **1.000**–190.000 EUR"* and *"Alto Real Estate: **2.100** EUR,
70 m²"*. Verified against the dataset:

```
Haspo Realty        1000 EUR  kind=rent  85m2  layout=1+1
Alto Real Estate    2100 EUR  kind=rent  70m2  layout=1+1
sale-only EUR range: 112.000 – 1.450.000
```

Both are **monthly rents**, folded unlabelled into a range presented as apartment prices. The
evidence cockpit filters exactly this out, and its own code says why:

> *"a rental at €1,000/month is not a competing claim about a purchase price, and mixing the two
> would manufacture a 310× spread out of nothing."*

The UI applies that filter; `lib/ai-retrieval.ts` does not. So the concierge reports a 190× Haspo
spread where the truth is 112.000–190.000.

**Not the blocking failure** — it presents the conflict rather than picking one, and it converts
nothing. But "€1.000 for a 1+1 apartment" is precisely the number that gets screenshotted and
quoted, and this is an intelligence product.

**Automated coverage:** none. W2-C's AI probe asserts refusals and grounding, not the plausibility
of the figures it grounds in. Handed to W4-A as T-002.

### 4.6 M-006 — a 3 m² two-bedroom apartment at €242.000 · **MINOR**

**Pass:** 5 · **Evidence:** `quality/manual/pass05-units-top.png`, row 7 · **Owner:** W0-B

```
7   Block 01   2+1   3 m²   242.000,00 €   Verfügbar   Reales Inserat
6   Block 01   2+1   129 m² 242.000,00 €   Verfügbar   Reales Inserat
```

Row 7 is marked a **real listing**, not modelled. Either the publisher stated 3 m² and we are
faithfully reproducing an obvious typo — in which case it needs the same "wrong-district suspect"
treatment other anomalies get — or the parser dropped a digit. Nothing in the UI flags it.

**Automated coverage:** none. No gate asserts plausibility ranges on a dimension. Handed to W4-A
as T-003.

### 4.7 M-007 — 118 failed prefetches per dashboard load · **MINOR**

**Pass:** 4 · **Owner:** W3-B

The sidebar advertises 21 routes and prefetches them; 19 do not exist. Every dashboard visit
produces a burst of `404` RSC prefetches and 119 console errors. Users see nothing — the links
carry an honest *"In Arbeit"* badge — but the console noise would bury a real error, and
`tasks/W4-B` is explicit that any console error is a finding.

Either suppress prefetch on `pending: true` routes, or do not render them as links.

### 4.8 Verified as FIXED since W4-C / W4-A measured them

Worth stating, because a status of FIXED in a document is not the same as fixed in the app:

- **SEC-019** — `/de/kitchen-sink` returned 200 in a production build when W4-C tested it. It now
  returns **404**, gated behind `AZURA_ENABLE_KITCHEN_SINK`. **Confirmed fixed.**
- **W4-A §4.2, the eight ICU message keys on `/hotel`** — `hotel.platform.open`,
  `hotel.quotes.intro` and the rest rendered as their own names in all four locales. `/de/hotel`
  now shows **zero** raw keys. **Confirmed fixed.**

---

## 5. Where the app overclaims

The brief asks for these specifically. They are blockers in this project regardless of severity
elsewhere.

| Overclaim | Status |
|---|---|
| Seed data reading as live | **YES — M-004.** The seed banner on `/dashboard/units` renders as a machine key, so nothing warns the reader. On `/dashboard/evidence` and `/dashboard` the notice renders correctly. |
| A fake write success | **No.** There is one write surface (AI feedback) and it returns `persisted: false`. The annotation action on the unmerged W3-C branch returns 503 rather than pretending. |
| An unconfigured integration shown healthy | **No.** `AiResponse.source` reports `deterministic-fallback` honestly, and the seed notice works on two of three surfaces. |
| A modelled unit reading as a real listing | **No — and this is done well.** §3.3. |
| A gap rendering as 0 | **No.** Verified on `/hotel`: gaps render "—" / "Nicht belegt". |
| A figure that is not what it claims to be | **YES — M-005.** Monthly rents presented inside an apartment-price range by the concierge. |

---

## 6. `RELEASE-STATUS.md` claims I personally verified in the running app

| Claim | Verdict |
|---|---|
| "a narrated demo of the landing page, the public hotel page and the provenance model, all three proven in a production build" | **CONFIRMED.** Both render 200 under real `next start`; the provenance model is visible and traceable. |
| "but not the dashboard, not as a working ERP" | **CONFIRMED, and stronger than stated** — in production the dashboard is not merely incomplete, it is unreachable (M-001). |
| Every route is dynamic, S-009 holds | **CONFIRMED** — pages render with working JavaScript under `next start`. |
| 25 portal_listing + 631 modelled = 656 | **CONFIRMED on screen**, header and per-row marks agree. |
| Reduced motion yields a complete page | **CONFIRMED** — 0 elements left at `opacity: 0`, 0 canvases. |
| F-002 renders all four competing prices, USD unconverted | **CONFIRMED** — 112.000 · 185.000 · 220.000 · 239.171 $, no EUR twin. |

Not verified by me: every gate figure in `RELEASE-STATUS.md` §2 (I did not re-run the gates), the
pgTAP substitute, and anything requiring a database.

---

## 7. What was NOT tested

1. **Authentication. At all.** There is no login page, so no sign-in, sign-out, session expiry or
   password reset was exercised. Identity was a cookie.
2. **Finance, operations, leads, pipeline, listings, reviews, hotel dashboard, compliance,
   documents, users, settings** — no route exists.
3. **Screen reader.** Not run. Standing gap since W1-D.
4. **Keyboard-only traversal.** Pass 11's mouse-unplugged path could not complete because it
   requires login → dashboard → units → filter, and login does not exist.
5. **A real mobile device.** 375px was emulated.
6. **ICS in a real calendar client** — no ICS UI.
7. **Anything requiring Postgres** — no Docker, no `psql`.
8. **The `feature/INTERNAL-107-w3c-gaps` branch**, which fixes M-002 and adds the CSV export. This
   report tests `main`.

---

## 8. New tests handed to W4-A

One per manual finding that automation should have caught.

| id | Test | Because |
|---|---|---|
| **T-001** | Run the "no message key renders as its own name" assertion on **every** route, not only `/hotel` | M-004 — the same class recurred in a different namespace on a different page, and the existing test was scoped to where it was first found |
| **T-002** | Assert the concierge's price answer contains no listing whose `priceKind !== "sale"` | M-005 — no gate checks the plausibility of the figures the AI grounds in |
| **T-003** | Assert a dimension-plausibility floor on rendered units (interior area ≥ 15 m² for any layout ≥ 1+1) | M-006 — a 3 m² apartment passed every gate |
| **T-004** | Assert zero 4xx RSC prefetches on a dashboard load | M-007 — 118 failures per load, invisible to every existing assertion |
| **T-005** | A gate that starts a server must fail if the port is already bound, rather than attaching | §1 — produced two false results this session, one of them a phantom auth bypass |

---

## 9. Would I show this to the client on 29 July?

**Yes — the public pages, narrated, with the dashboard explicitly out of scope.**

The landing page and the hotel page are genuinely good and they make the argument the project
exists to make: here is a number we trust, here is one we do not, here is why, and here is every
source. The concierge answering *"the sources contradict each other"* with nineteen citations and a
refusal to average is the most persuasive thing in the build.

**I would not click "Zugang" in front of the client**, and I would fix M-004 first — a demo that
shows a machine key where the seed warning should be undercuts the one claim the whole product
rests on.
