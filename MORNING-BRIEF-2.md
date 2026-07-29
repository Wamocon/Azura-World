# MORNING BRIEF — 29 July 2026

Night 2 complete. Everything merged, pushed and green. **`main` at 167 commits, zero unmerged
branches, zero unpushed commits.**

---

## 1. All six gates green, verified independently

```
typecheck 0   ·   lint 0   ·   build 0
evidence  0   ·   i18n 0   ·   csp 0
```

## 2. What the night built

The dashboard went from **2 modules to 20**.

| Window | Modules |
|---|---|
| n1 | `listings` **(AC3)** · `leads` · `buyer-pipeline` |
| n2 | `finance` · `wallet` · `vendor-invoices` |
| n3 | `tickets` · `activities` · `calendar` · `communications` |
| n4 | `admin` · `compliance` · `documents` · `reports` · `settings` · `users` |
| w3h | `report/` · `signup/` |
| w3g | `dashboard/hotel` · `dashboard/reviews` |

**Current surface:** 24 dashboard pages · 7 public routes · 1,834 i18n keys × 4 locales ·
12 e2e specs · 46 live database tables · 49 API operations.

## 3. Two rule violations I found and fixed

Both were things you had asked for explicitly, and every window had been idle 8+ hours, so there
was nobody left to hand them back to.

**33 em dashes** across all four locales, every one a label/explanation separator, and they had
landed in the strings that matter most:

```
Modellierter Datensatz — kein reales Inserat
  →  Modellierter Datensatz: kein reales Inserat
```

**`Nicht belegt` → `Keine Angabe`.** *"Belegt"* reads as **occupied** to a German property
manager, so the gap label was saying the opposite of what it meant.

## 4. One thing I deliberately did not do

At 00:45 thirteen German finance strings failed `check-i18n` rule 6 (German >1.4× English with no
`_long` variant). I held the push rather than ship a red `main`.

I did **not** widen the threshold in `check-i18n.mjs`, and I did **not** add `_long` variants that
nothing renders. Both would have turned the gate green while removing the only protection this
project has against German overflow at 320px, which is where layouts actually break.

I shortened the German instead, and it is better copy for it:

```
Keine zusammengehörenden Vorgänge im gewählten Ausschnitt.
  →  Keine Vorgänge in dieser Ansicht.
```

## 5. The honesty sweep is clean

```
bare numeric literals in dashboard JSX ... 0
em dashes in user-visible strings ........ 0
dev harness on a real route .............. 0
cross-platform review averaging .......... 0
tracked .env or sources/ content ......... 0  (only .gitkeep)
```

The control most likely to slip did not: the **modelled-vs-real split is rendered** in
`units/page.tsx`, `inventory-split-summary.tsx` and `unit-provenance-badge.tsx`. 25 real listings
against 631 modelled, visible in the list rather than buried on a detail page.

## 6. The one honest gap

**Nothing here has been driven by a human in a browser.**

`HANDOFF/W5.md` still carries its old verdict — *"the dashboard is not demonstrable at all;
every /dashboard route 307s to /de/login, and /de/login is a 404."* That was measured when **2
modules existed and there was no login page**. There are now 20 modules and a working login.

**Passes 4, 5 and 7 of the manual plan have never actually run**: the 11 roles, the 656-unit
table, and the money screens. They could not run before; they can now.

That is the difference between *built and statically verified* and *demonstrable*. It is one
headed-browser session.

## 7. Re-run W5 first thing

```
cd "D:\Azura World"
Read HANDOFF\W4-A.md ("what the suite does NOT cover"), HANDOFF\W4-B.md (harness
blind spots), SECURITY-REVIEW.md, then tasks\W5-manual-playwright.md.

Your previous verdict is OBSOLETE. It was written when 2 dashboard modules existed
and /de/login was a 404. There are now 20 modules and a working login, so passes
4, 5 and 7 can run for the first time.

Build production, `next start`, drive Chromium HEADED at --slow-mo=250 with video
and trace on. Twelve passes. LOOK AT THE PAGE.

Pass 6 still decides it: ask the concierge "Was kostet eine 1+1 Wohnung?" If it
picks one price instead of presenting the conflict, that is a blocker.

End with READY FOR CLIENT DEMO / READY WITH CAVEATS / NOT READY, and name anything
where the app OVERCLAIMS.
```

## 8. Known follow-ups, none blocking

- **W3-E PARTIAL**, six named structural gaps: no live ticket updates, the API does not enforce
  the ticket state machine, `verified` has no state, the feed-token derivation is duplicated,
  reservations and handovers are absent from the calendar, and **the SLA targets are ours rather
  than the client's**. That last one is the right kind of gap: it says the numbers are invented
  rather than dressing them up as policy.
- Prettier still fails repo-wide.
- 8 high + 7 moderate dependency advisories.
- Media manifest: 9 of 13 video entries are labelled `subject: "project"` but are different
  buildings entirely.
