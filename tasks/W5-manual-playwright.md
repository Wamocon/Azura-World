# W5 — Manual Playwright walkthrough & sign-off

**Wave:** 5 · **Depends on:** all of wave 4 · **Runs:** alone, one window, human in the loop

> Read `SYSTEM-PROMPT.md`, `HANDOFF/W4-A.md` (**especially "what the suite does not cover"**),
> `HANDOFF/W4-B.md` (harness blind spots), `SECURITY-REVIEW.md`, `RELEASE-STATUS.md`.

---

## Mission

Drive the application by hand, in a visible browser, and look at it.

Ataberg's README makes the argument better than I can: its layout harness *"is also fallible: it
exempted the header and ignored `<select>`/`<svg>`, so a screenshot caught what it missed.
**Look at the page.**"*

Automated suites verify what someone thought to assert. This session catches what nobody thought
of — the thing that is technically passing and visibly wrong. **Synthetic QA is not sign-off.**

---

## Files you own

```
MANUAL-TEST-REPORT.md · quality/manual/** · scripts/manual-session.mjs
HANDOFF/W5.md
```

---

## Setup

```bash
# production build, not dev — dev-mode e2e OOMs and dev perf is meaningless
pnpm --dir apps/web build
pnpm --dir apps/web start        # 127.0.0.1:3200

# headed, slowed, with a video and a trace
npx playwright test --headed --project=chromium --slow-mo=250 --trace on --video on
# or drive interactively:
node scripts/manual-session.mjs --role=manager --locale=de
```

`scripts/manual-session.mjs` opens a headed browser, logs in as a given role and locale, and
leaves the session open for hand-driving while recording video, console output and network
failures to `quality/manual/`.

**Run with the browser visible. Watch the screen, do not just read the assertions.**

---

## The walkthrough — 12 passes

### Pass 1 — First impression, cold
Landing page, German, 1440px, cold cache, throttled. Watch it load. Does the hero land before the
3D? Is anything janky? Would you believe this was built by a competent team?
**Then scroll slowly through the whole page.** Note anything that feels wrong even if you cannot
name why — that instinct is the point of this pass.

### Pass 2 — The evidence claim
The landing page's evidence band. Click into a conflicted figure. Follow a source link. Does it
open the real page? Follow the snapshot link. Does it open the stored copy?
**Then: pick any number on the page and try to find out where it came from in under 10 seconds.**
If you cannot, the provenance UI has failed regardless of what the tests say.

### Pass 3 — Four locales, side by side
`/de`, `/en`, `/tr`, `/ru` at 1440px and 375px. Look for clipping, overlap, wrong number
formats, untranslated strings, and boxes where Cyrillic glyphs should be.
**Specifically check `112.000,00 €` in German and that the USD figure is still USD.**

### Pass 4 — Every role's first screen
Log in as all 11 roles in turn. For each: does the dashboard make sense as *their* home? Is the
nav right? Any empty state that looks broken rather than empty?
`guest` and `child_guest` are where this usually falls apart.

### Pass 5 — The 656-unit table
Scroll it. Filter it. Sort by price with nulls present. Filter to zero results.
**Can you tell a `modelled` unit from a real listing at a glance, without opening it?** If not,
that is a blocking finding — it is the honesty control for the whole inventory.

### Pass 6 — The conflict, end to end
Find F-002 in the evidence cockpit. All four 1+1 prices visible? Publisher, date, URL on each?
USD shown as USD? Then ask the concierge *"Was kostet eine 1+1 Wohnung?"* and read the answer
carefully. **Does it present the conflict, or does it pick one?** Picking one is a blocking
failure.

### Pass 7 — Money
As `accountant`: the ledger with mixed EUR and USD. Are the totals separate? Type `1.234,56` into
a German amount field and save it — what was stored? Try to edit a posted entry. Double-click a
payment submit button.

### Pass 8 — Operations
Take a ticket through its full lifecycle. Try an invalid transition. Book the last capacity slot.
Subscribe to the ICS feed **in a real calendar client** and check the times as a Berlin viewer.

### Pass 9 — The public write paths
Submit a public report. Note the reference number. Look it up. Submit the same thing again —
is there one report or two? Then stop Supabase and submit again: do you get a 503, or a
reference number the system cannot honour?

### Pass 10 — Adversarial, by hand
Paste an XSS payload into the report form and then look at it in the dashboard. Ask the concierge
to ignore its instructions. Try `?next=https://evil.com`. Deep-link to another owner's statement.
**Re-run the three findings W4-C rated highest and confirm they are actually fixed** — a status
of FIXED in a document is not the same as fixed in the running app.

### Pass 11 — Accessibility, by hand
Unplug the mouse. Complete: login → dashboard → units → filter → open a unit → view its sources →
go back. Then turn on a screen reader for the landing page and the concierge. Then set
`prefers-reduced-motion` and reload every animated surface — **is any content missing?**

### Pass 12 — Mobile, on a real device if possible
375px. Sidebar sheet, 656-row table under touch scroll, the 3D hero, the concierge keyboard
behaviour. Real device beats emulation for the last two.

---

## What to record

For every issue:

```markdown
### M-001 — <title>
**Severity:** Blocker | Major | Minor | Cosmetic
**Pass:** 5 · **Role:** manager · **Locale:** de · **Viewport:** 1440
**Owner:** W3-C
**Steps:** ...
**Expected / Actual:** ...
**Evidence:** quality/manual/M-001.png (+ video timestamp)
**Automated coverage:** was there a test that should have caught this? If yes, why didn't it?
```

That last line matters most. Every manual finding that an automated test *should* have caught is
a gap in the suite, and it goes back to W4-A as a new test — otherwise the same class of bug
returns next release.

---

## Sign-off

`MANUAL-TEST-REPORT.md` ends with an explicit recommendation:

- [ ] **READY FOR CLIENT DEMO** — no blockers, majors documented and accepted
- [ ] **READY WITH CAVEATS** — demonstrable, with named limitations to state up front
- [ ] **NOT READY** — blockers listed, with what each needs

Plus, stated plainly:

- What was tested manually, and what was not
- Which `RELEASE-STATUS.md` claims you **personally verified in the running app**
- Any place the app **overclaims** — seed data reading as live, an unconfigured integration
  showing healthy, a fake success, a modelled unit reading as a real listing. These are blockers
  in this project regardless of severity elsewhere.

---

## Handoff must state

- Findings by severity, with owners
- The sign-off recommendation and its reasoning
- **New tests handed to W4-A**, one per manual finding that automation should have caught
- The honest one-line answer: *would you show this to the client on 29 July?*
