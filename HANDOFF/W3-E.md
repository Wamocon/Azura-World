# HANDOFF — W3-E Tickets, activities, calendar, communications

STATUS: **PARTIAL** — four modules built, routable and verified in a browser; three of the
brief's ten evidence items are fully closed, four are partly closed, three are NOT RUN with
named blockers. Every gap below is structural (a file another window owns, a table that does not
exist, a provider that is not wired), not unfinished work.

Completed: 2026-07-28 · Window: N3 (overnight run 2) · Branch:
`feature/INTERNAL-107-n3-operations` · Worktree: `D:\azura-n3`

---

## 1. What is routable

| Route | Renders |
| ----- | ------- |
| `/dashboard/tickets` | Queue with status and SLA filters, four counters, server-side paging |
| `/dashboard/tickets/[id]` | One ticket: header, routing proposal, action bar, history, field evidence |
| `/dashboard/activities` | Programme grouped by day, capacity per activity |
| `/dashboard/calendar` | Month / week / day, activities plus ticket deadlines, feed section |
| `/dashboard/communications` | Threads, filtered by status |
| `/dashboard/communications/[threadId]` | One thread, paginated at 50 messages |

The four `pending: true` flags in `lib/dashboard-routing.ts` are deleted, per W3-B's module
contract §2. Nothing else in that file changed.

All six are Server Components with no rendering-mode export. `next build` emits every one as
**ƒ (Dynamic)**. The single client island is the ticket action bar.

---

## 2. The transition table, as implemented

**The states are the database's, not the brief's.** `tasks/W3-E` describes the lifecycle using
`new · triaged · awaiting_parts · verified · reopened · rejected`. None of those exist:
`public.ticket_status` (migration 06, line 50) is a Postgres enum with exactly eight members, and
`updateTicketStatus()` writes that column. A table built on the brief's vocabulary would
typecheck and then be rejected by Postgres on the first transition.

Five of the six survive as **edges** rather than states, because
`public.ticket_event_kind` already carries the verbs:

| Brief | Here |
| ----- | ---- |
| `new` | `draft` |
| `triaged` | `open` |
| `awaiting_parts` | `blocked`, hold reason on the event |
| `reopened` | edge to `assigned`, event kind `reopened` |
| `rejected` | `open` → `cancelled`, reason mandatory |
| **`verified`** | **lost.** Folded into `verify_and_close`, which needs `tickets:approve` |

`verified` is the one real casualty: the interval between "the engineer says it is fixed" and
"the manager agrees" is not a queryable state. The migration that would restore it is a
two-value `alter type` plus two edges here; it is W1-A's file, so it is a request, not a change.

### The 15 edges

```
from            -> to              id                permission        note
draft           -> open            submit            tickets:create    -
draft           -> cancelled       discard_draft     tickets:create    -
open            -> assigned        assign            tickets:assign    -
open            -> cancelled       reject            tickets:approve   required
assigned        -> in_progress     start             tickets:update    -
in_progress     -> blocked         hold              tickets:update    required
blocked         -> in_progress     resume            tickets:update    -
in_progress     -> resolved        resolve           tickets:update    -
resolved        -> closed          verify_and_close  tickets:approve   -
resolved        -> assigned        reopen            tickets:update    required
closed          -> assigned        reopen_closed     tickets:approve   required
open            -> cancelled       cancel            tickets:delete    required
assigned        -> cancelled       cancel            tickets:delete    required
in_progress     -> cancelled       cancel            tickets:delete    required
blocked         -> cancelled       cancel            tickets:delete    required
```

`cancelled` is the only status with no way out. `closed` is **not** terminal: `reopen_closed`
leaves it.

### Which roles may perform which transitions

Authority is never a list in `ticket-workflow.ts`. Each edge declares a `Permission` and
`canTransition()` asks `hasPermission()`, so `lib/rbac.ts` stays the single source and a role
added there flows through without touching this file. The resulting separation:

| Permission | Holders | Edges it unlocks |
| ---------- | ------- | ---------------- |
| `tickets:create` | admin, manager, staff, owner, tenant | submit, discard_draft |
| `tickets:assign` | admin, manager | assign |
| `tickets:update` | admin, manager, staff, service_provider | start, hold, resume, resolve, reopen |
| `tickets:approve` | admin, manager, **owner** | reject, verify_and_close, reopen_closed |
| `tickets:delete` | admin, manager | cancel (×4) |

Two consequences worth stating because they are the brief's approval steps, and they fall out of
the matrix rather than being coded:

- **A contractor cannot sign off their own work.** `service_provider` holds `tickets:update` and
  not `tickets:approve`, so it can start, hold, resume and resolve, and cannot close, reject or
  assign.
- **An owner can sign off.** `owner` holds `tickets:approve`, so `resolved → closed` and the
  triage rejection are exactly the two moves an owner has. A `tenant` has neither.

`guest` and `child_guest` can perform no transition from any status.

---

## 3. How the UI derives its buttons

`components/operations/ticket-transitions.tsx` contains no button list, no `if (status === …)`
and no knowledge of the lifecycle. It renders `allowedTransitions(status, role)`.

A move the role lacks is **absent**, never present-and-disabled.

**The derivation runs on the server**, and that is not a stylistic choice. A value import of
`lib/ticket-workflow.ts` from a `"use client"` file pulls
`ticket-workflow → operations-data → repository-base → supabase/server → next/headers` into the
browser bundle, and `next build` refuses it:

```
./lib/supabase/server.ts
Error: You're importing a module that depends on "next/headers"...
Import trace: lib/supabase/server.ts -> lib/repository-base.ts -> lib/operations-data.ts
           -> lib/ticket-workflow.ts -> components/operations/ticket-transitions.tsx
```

The page calls `allowedTransitions()` and passes the result as a prop; the client file imports
the workflow **type-only**. The workflow never reaches the browser at all. Anyone who converts
that back to a value import gets the build failure above.

### Evidence: 63 cells, all 8 statuses × 7 roles, rendered in a browser

Read off `next dev --webpack` at `127.0.0.1:3262` with W1-B's QA access-profile cookie. Every
label below was produced by `allowedTransitions()`; seed data covers all eight statuses.

```
ticket       status         role               HTTP  action bar
AZW-T-0001   Offen          admin              200   Zuweisen · Ablehnen · Vorgang abbrechen
                            manager            200   Zuweisen · Ablehnen · Vorgang abbrechen
                            staff              200   (no step available to this role)
                            service_provider   404   not in this role's scope
                            owner              404   not in this role's scope
                            tenant             404   not in this role's scope
                            guest              200   403 panel, URL preserved
AZW-T-0002   Zugewiesen     admin/manager      200   Arbeit beginnen · Vorgang abbrechen
                            staff              200   Arbeit beginnen
AZW-T-0003   In Arbeit      admin/manager      200   Anhalten · Als erledigt melden · Vorgang abbrechen
                            staff              200   Anhalten · Als erledigt melden
AZW-T-0004   Wartet         admin/manager      200   Fortsetzen · Vorgang abbrechen
                            staff              200   Fortsetzen
AZW-T-0005   Erledigt       admin/manager      200   Prüfen und schließen · Wieder öffnen
                            staff              200   Wieder öffnen
AZW-T-0006   Abgeschlossen  admin/manager      200   Wieder öffnen
                            staff              200   (no step available to this role)
AZW-T-0007   Entwurf        admin/manager/staff 200  Einreichen · Entwurf verwerfen
AZW-T-0008   Abgebrochen    admin/manager/staff 200  (no step available to this role)
AZW-T-0009   Offen          admin/manager      200   Zuweisen · Ablehnen · Vorgang abbrechen
```

"(no step available to this role)" is the section rendering
*"Für diesen Vorgang gibt es keinen nächsten Schritt, den Sie ausführen dürfen."* — verified
present in the HTML for `staff`/`AZW-T-0001` and `admin`/`AZW-T-0008`. It is not an absent
section, and an earlier version of this document said it was; the probe's label was wrong, not
the page.

The `guest` refusal comes from **W3-B's shell route guard**, not from my page's own check:
*"Kein Zugriff auf diesen Bereich. Ihre Rolle (guest) hat keine Berechtigung für diese Seite. Die
Adresse bleibt…"* — no ticket table in the document. Defence in depth working in the expected
order.

**This also closes W3-B's one reported gap.** `HANDOFF/W3-B.md` records that end-to-end 403 was
unprovable because no module had a `page.tsx`, and that adding a dynamic segment under
`app/[locale]/dashboard/` turned two `<a href="/de/">` links in W0-A's `not-found.tsx` and
`global-error.tsx` into lint errors. `tickets/[id]` and `communications/[threadId]` are dynamic
segments and **lint is clean** (0 errors, 0 warnings, whole tree). The shipped links are
`href="/de"` without the trailing slash and the rule does not fire. W0-A's two-line request can
be closed.

---

## 4. Capacity — the mechanism, and why it is not running

**Enforcement is at the database. It is written and it is not deployed.**

There is no `activity_bookings` table. `public.activities` carries a `capacity` column and
nothing in the schema references it, so nothing in this product knows how many places are taken.

`supabase/migrations/*` is W1-A's exclusive path (ORCHESTRATION §4), so the migration is filed
rather than applied: **`HANDOFF/W3-E-activity-capacity.sql`**, in the form it should land, as
`00000000000015_activity_bookings.sql`. RLS ships in it, with the tables.

### The mechanism, exactly

Two controls, and both are needed:

1. **A partial unique index — this is the enforcement.**
   ```sql
   create unique index activity_bookings_seat_unique
     on public.activity_bookings (activity_id, seat_no)
     where state = 'booked';
   ```
   Not cooperative. Anyone who inserts directly, bypassing every function, still cannot
   double-issue a seat. Partial on `state = 'booked'` so a cancellation releases the seat
   immediately without deleting the record of who held it.

2. **`pg_advisory_xact_lock` keyed on the activity, inside `book_activity()` — this makes the
   failure clean.** It serialises seat allocation for one activity and nothing else, so the loser
   of a race for the last seat receives `activity_full`, a true statement about the world, rather
   than `unique_violation`, a true statement about an index. Two people booking different
   activities never wait on each other.

Seat numbers fill gaps (`min(s) over generate_series(1, capacity) where not exists …`), not
`count(*) + 1`: after a cancellation, counting hands out a number that is already taken and the
index then rejects a booking that should have succeeded.

`cancel_activity_booking()` promotes the head of the waitlist into the freed seat and writes a
`promoted` row to an append-only audit table.

### NOT RUN, and why

**`HANDOFF/W3-E-activity-capacity-probe.mjs` was never executed.** It drives 8 separate
connections at the last seat in one tick, samples `pg_stat_activity` from an observer connection
to measure that they actually overlapped in the server, and asserts one success and seven clean
`activity_full` rejections, plus gap reuse, waitlist promotion, uncapped behaviour and the
one-live-booking-per-person index.

The blocker is infrastructure, not the code: **the Docker daemon never became reachable in this
session.** `docker --version` answers (CLI 29.6.1) but `docker info`, `docker ps` and
`docker version` all return nothing and hang; Docker Desktop was launched and did not come up.
`supabase start` has the same dependency. The linked cloud project was deliberately not used: it
is shared, and unattended DDL against it is not a trade this window will make.

The probe applies its own stub of the four objects migration 15 depends on, so it needs only a
bare PostgreSQL:

```bash
docker run -d --name azura-n3-capacity -e POSTGRES_PASSWORD="$PGPASSWORD" -e POSTGRES_DB=probe -p 55433:5432 postgres:17-alpine
PGPASSWORD=... node HANDOFF/W3-E-activity-capacity-probe.mjs
```

### What the UI does in the meantime

`/dashboard/activities` shows how many places an activity **has** and states plainly that it
cannot know how many are **taken**:

> **Buchung ist noch nicht möglich.** In der Datenbank gibt es noch keine Tabelle für Buchungen.
> Deshalb steht hier, wie viele Plätze es gibt, aber nicht, wie viele belegt sind. Eine Zahl zu
> zeigen, die niemand gezählt hat, wäre erfunden.

`<CapacityMeter booked={null}>` renders `Belegung nicht bekannt` as a `gap` badge — the same
treatment an unsourced price gets. Verified in the browser: `Plätze insgesamt` and
`Belegung nicht bekannt` both present, and **no** `"X von Y Plätzen belegt"` string anywhere.
`capacity === null` renders `Ohne Begrenzung`, never `0`.

---

## 5. Is any outbound channel wired? **No. Nothing. Stated plainly, as the brief asks.**

There is no email, SMS, WhatsApp or push provider configured in this repository. Messages persist
and are readable in the product; **nothing leaves the building.**

`OUTBOUND_PROVIDER_CONFIGURED` is a `const false` in
`components/operations/delivery-notice.tsx`, deliberately not an environment lookup: inventing a
variable to read (`OUTBOUND_EMAIL_URL ?? …`) is how a false green appears the first time somebody
exports an unrelated key.

Every message therefore renders **`Nicht versendet, Anbieter nicht konfiguriert`** as a `gap`
badge, and the page states it once above the thread. `sent` and `delivered` exist in the union
because a provider will one day set them; they are unreachable today, from one function.

**There is no compose box.** A box to type into with nothing behind it teaches people to write
messages that go nowhere; the page explains its own absence instead.

Verified in the browser, visible text only with `<script>` stripped:

```
'Zugestellt'                                     -> 0 occurrences
'Versendet'                                      -> 0 occurrences
'In der Warteschlange'                           -> 0 occurrences
'Nicht versendet, Anbieter nicht konfiguriert'   -> 1 occurrence
```

(The word `Zugestellt` does appear inside the next-intl message dictionary shipped in the RSC
payload. It is a dictionary entry, not rendered UI, and the count above is against visible text.)

W4-C and W5: the claim to check is that no surface says a message was sent. It does not.

---

## 6. ICS: the token scheme, revocation, and what is proven

### The scheme, as shipped — and it is not what the brief describes

`app/api/calendar/ics/[token]/route.ts` is **W2-B's file**, not mine. As shipped:

- The token is `HMAC-SHA256(CALENDAR_FEED_TOKEN_SECRET, "calendar-feed:activities")`, hex.
- It is compared in constant time, over hashed fixed-length buffers.
- A wrong token, an absent secret and an empty token all return **404**, never 403.
- The feed returns `getActivities({ role: "manager" })`.

**It is one token for the whole site, not one per user.** The brief asks for "ICS feed per user,
token-scoped". It is not. It does satisfy "never contains the user id in plaintext" — trivially,
since it contains no identity at all — and it is revocable, by rotating the secret, after which
every previously issued link 404s.

The calendar page says this rather than letting a reader assume otherwise:

> Wichtig: Es gibt derzeit einen einzigen Zugang für die ganze Anlage, nicht einen je Person. Wer
> den Link hat, sieht dieselbe Terminliste wie die Verwaltung.

Because the token grants the manager-scoped view, the URL is shown **only to roles holding
`calendar:approve`** (manager, admin). A resident is told to ask management. When no secret is
configured the page says the subscription is not set up and prints no URL, verified in the
browser.

### The serialiser is mine, and it is proven

`lib/ics-calendar.ts`. `HANDOFF/W3-E-workflow-ics-probe.mts` — **59 pass · 0 fail**:

```
=== 6. iCalendar: escaping ===
in : "Yoga, Sauna; Handtuch\\Badetuch mitbringen\nTreffpunkt: Pool"
out: "Yoga\\, Sauna\\; Handtuch\\\\Badetuch mitbringen\\nTreffpunkt: Pool"
PASS  a comma is escaped
PASS  a semicolon is escaped
PASS  a backslash is escaped first, not doubled by a later rule
PASS  a newline becomes the literal two-character escape
PASS  a colon is NOT escaped — it is legal inside a TEXT value
PASS  CR, LF and CRLF all collapse to one escape

=== 7. iCalendar: folding at 75 OCTETS ===
chars=128 octets=248 -> 4 segments [74, 74, 74, 26]
PASS  the first segment fits in 75 octets  74 octets
PASS  every continuation fits in 74 octets, leaving room for its leading space
PASS  folding is lossless — the segments rejoin to the original
PASS  no segment splits a multi-byte character
PASS  a 4-octet astral character is never split across a fold  2 segments [75, 31]
PASS  an escape pair is never split across a fold  2 segments

=== 9. Türkiye has no DST, Germany does ===
month     emitted           Istanbul  Berlin
January   20260115T060000Z  09:00     07:00
July      20260715T060000Z  09:00     08:00
PASS  the site sees 09:00 in both halves of the year — Türkiye has no DST
PASS  a Berlin viewer sees 07:00 in January and 08:00 in July
PASS  no X-WR-TIMEZONE is emitted — it would pin the display to the site's zone
PASS  no floating times: every DTSTART and DTEND carries the Z suffix
```

Folding is measured in **UTF-8 octets** on strings that actually contain Turkish and German
characters. A fold counted in `String.length` passes a Latin-only test and ships broken; the
128-character line above is 248 octets.

`X-WR-TIMEZONE` is deliberately absent. It tells a client to display the calendar in a fixed
zone, which is precisely wrong for the Berlin subscriber the brief cares about.

**The route does not use this module.** W2-B's route has its own inline escaper, no folding, and
no `DESCRIPTION`/`LOCATION`/`CATEGORIES`. Wiring it is a request below.

---

## 7. Verification actually run

Exit codes captured directly, never through a pipe.

| Command | Result | Evidence |
| ------- | ------ | -------- |
| `pnpm --dir apps/web typecheck` | **PASS** exit 0 | `tsc --noEmit`, whole tree, no output |
| `pnpm --dir apps/web lint` | **PASS** exit 0 | `eslint`, whole tree, 0 errors 0 warnings |
| `pnpm --dir apps/web build` | **PASS** exit 0 | `next build --webpack`; all six routes emit **ƒ (Dynamic)** |
| `prettier --check` (my paths) | **PASS** exit 0 | "All matched files use Prettier code style!" |
| `node scripts/check-i18n.mjs` | **PASS** exit 0 | 0 errors, 0 warnings, **1034 keys identical across de/en/tr/ru** |
| `pnpm qa:dashboard` | **PASS** exit 0 | **647 pass · 0 fail**, 231 cells (11 roles × 21 routes) |
| `pnpm qa:csp --port 3261` | **PASS** exit 0 | **30 pass · 0 fail**, production build + `next start` + Chromium |
| `HANDOFF/W3-E-workflow-ics-probe.mts` | **PASS** exit 0 | **59 pass · 0 fail** |
| `HANDOFF/W3-E-activity-capacity-probe.mjs` | **NOT RUN** | Docker daemon unreachable — §4 |

### Under `next start` (production build, port 3260)

```
307 -> /de/login?next=%2Fdashboard%2Ftickets     (all four routes)
content-security-policy: default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; …
```

The guard fires and **the intended path survives in `next=`**, which is the property W3-B's
no-redirect rule exists to protect.

### Under `next dev --webpack` with the QA access profile (port 3262)

All four routes 200 as manager. No raw message key leaks on any of the four.

**`next dev` had to be `--webpack`.** Turbopack panics on this worktree:
`Symlink [project]/apps/web/node_modules is invalid, it points out of the filesystem root`. The
worktree has no `node_modules` of its own (git worktrees do not carry gitignored directories, and
`pnpm install` concurrently with another window is forbidden), so both `node_modules` trees are
NTFS junctions to `D:\Azura World`. Webpack follows them; Turbopack refuses. `next build` and
`next start` are webpack and were unaffected.

### The exhaustive transition test

704 decisions — 11 roles × 8 statuses × 8 statuses:

```
704 decisions: 47 permitted · 385 no such transition · 107 role not permitted
             · 88 same status · 77 terminal
PASS  every triple was decided
PASS  no decision contradicts the table or allowedTransitions()  0 contradictions
PASS  the permitted set is non-vacuous  47 permitted of 704
PASS  every invalid pair is refused for all 11 roles, admin included
      42 invalid pairs checked, 0 leaked
```

---

## 8. The brief's ten evidence items, honestly graded

| # | Item | Status |
| - | ---- | ------ |
| 1 | Transition table + every invalid transition rejected **by the API** | **PARTIAL.** Table published; rejection proven exhaustively at the **decision layer** (704 triples). The API does **not** consult it — see request to W2-B |
| 2 | Concurrent transition → one success, one 409 | **NOT RUN.** `updateTicketStatus()` carries `.eq("version", expectedVersion)` and the client handles 409 by refreshing; needs a configured Supabase and two concurrent clients |
| 3 | Capacity race with true concurrency | **NOT RUN.** Mechanism written and committed; Docker unreachable — §4 |
| 4 | `service_provider` list, count and calendar show only assigned items | **PARTIAL.** Negative direction verified: 0 rows, counter 0, detail 404, calendar empty. The positive case is unproven because the QA access profile supplies a role but no `profileId`, so the repository correctly fails closed and there is nothing assigned to see |
| 5 | ICS opened in a real calendar client | **PARTIAL.** Escaping, CRLF, 75-octet folding and the Berlin January/July times are proven against the serialiser. No file was opened in Outlook or Apple Calendar |
| 6 | Revoked token → 404 | **PARTIAL.** Verified that an unconfigured secret yields no URL and the route 404s; an actual rotation was not performed |
| 7 | Communications with no provider → "not sent", no false green | **VERIFIED** in a browser — §5 |
| 8 | Live update: transition in session A, observe in session B | **NOT DONE.** No surface here uses `useLiveSnapshot`. See the gap below |
| 9 | Permission matrix across all 11 roles | **VERIFIED.** `qa:dashboard` 647/0 plus the 63-cell action-bar matrix in §3 |
| 10 | Attachment rejection, oversize and wrong MIME | **NOT APPLICABLE / NOT DONE.** These modules have no upload path: there is no compose box (§5) and field evidence is read-only. Nothing to reject |

---

## 9. Known gaps

- **`[GAP]` No live updates.** The four surfaces are server-rendered and never call
  `useLiveSnapshot`, so a ticket moved in another session does not appear here until the page is
  reloaded. This was left undone rather than half-done: the seam is a client component fetching
  `GET /api/site-management/tickets` (which exists) and rendering W2-D's `<SyncBadge>`, and a
  badge that reaches `realtime` while nothing arrives is the exact silent stall W2-D built the
  badge to prevent. **No surface currently claims to be live**, which is the safe state.
- **`[GAP]` The API does not enforce the state machine.** `PATCH /api/site-management/tickets`
  (W2-B's) accepts any `toStatus` the enum allows. The UI cannot offer an invalid move, and a
  hand-written request still can. Request filed.
- **`[GAP]` `verified` has no state.** §2.
- **`[GAP]` The feed-token derivation is duplicated.** `dashboard/calendar/page.tsx` re-derives
  the HMAC because the route keeps it private. If the two diverge the symptom is a subscription
  URL that 404s — visible, not silent. Request filed.
- **`[GAP]` Reservations and handovers are absent from the calendar.** The brief lists them as
  sources; there is no reservation table and no handover table in the schema. An empty legend
  entry would imply a source that does not exist.
- **`[GAP]` SLA targets are ours.** `slaHoursByPriority` (urgent 4 h, high 24 h, normal 3 d, low
  7 d) is `[I]`, an assumption by this window. No Azura World or Cebeci Group source publishes a
  service-level target. The tickets page says so above the column that uses them.
- **`[GAP]` Routing routes to a team, not a person.** No staffing roster is published and
  `seed.sql` seeds no staff against teams. `selectAssignee()` takes its candidate list as an
  argument for exactly that reason; inventing a duty roster would be inventing data.
- **`[GAP]` No screen-reader pass.** Semantics are correct by construction (`role="alert"` on the
  refusal, `role="status"` on the seed banner, `aria-current` on filter chips, `<time datetime>`,
  an `aria-label` on the capacity bar), but nothing was driven with NVDA or VoiceOver.
- **`[I]` The three `Promise.all` fan-outs are not `allSettled`.** One failing repository call
  takes the page to the error boundary rather than degrading one panel. W3-B's KPI home uses
  `allSettled` inside `getDashboardSnapshot`; these surfaces have no per-panel fallback to
  degrade into, so failing loudly is the honest behaviour, but it is a difference worth knowing.

---

## 10. Two defects found in other windows' work

**1. `common.notAvailable` and `common.dataSource.localSeedHint` do not exist.**

Both keys are used by **W3-C's `dashboard/units/page.tsx`** (shipped) and were used by my pages
until I found this. `messages/de.json` `common` has exactly:
`actions states errors units pagination table filters time boolean required optional`.

next-intl renders the literal key path rather than throwing, so the user sees the string
`common.notAvailable` on the page. Measured on my tickets page before the fix: **3 occurrences**.
The units page does not currently show it only because its seed rows happen to have no null
prices; the branch is live and will fire the moment one does.

Fixed in my four modules by moving the strings into my own sub-namespaces as `noValue` and
`seedNotice`, which also lets `noValue` be **`Keine Angabe`** rather than an em dash, per
OVERNIGHT-2 rule 3 and `azura-ui-ux` §6. Verified after: 0 raw keys across all four routes,
`Keine Angabe` rendered 5 times on the tickets page.

**2. Three em dashes reach the screen from other windows' strings.** My four namespaces contain
zero (checked programmatically across all four locales). The ones rendering on
`/dashboard/tickets` come from the locale switcher (`DE — Deutsch`, W1-C), the global search hint
(W3-B) and a seed ticket title (`Fassadenriss Block B03 — Gutachten ausstehend`, W2-A's
`operations-data.ts`).

---

## 11. Requests for other windows

| File | Owner | What is needed |
| ---- | ----- | -------------- |
| `supabase/migrations/` | **W1-A** | Land `HANDOFF/W3-E-activity-capacity.sql` as migration 15. It carries its own RLS. Run `HANDOFF/W3-E-activity-capacity-probe.mjs` against it first; this window could not, for want of a Docker daemon. Without it, activities can display capacity and can never be booked |
| `supabase/migrations/` | **W1-A** | Optional, to restore the brief's `verified` state: `alter type public.ticket_status add value 'verified' after 'resolved'`. I will add the two edges once it exists |
| `app/api/site-management/tickets/route.ts` | **W2-B** | **PATCH must consult `canTransition(from, to, role)` before calling the repository, and answer 409 listing `decision.allowedTo` when it refuses.** The decision object is built for this. Today any enum value is accepted and the state machine is advisory at the boundary the brief calls "the boundary" |
| `app/api/calendar/ics/[token]/route.ts` | **W2-B** | Use `lib/ics-calendar.ts`. The route's inline escaper is correct but it **does not fold at 75 octets**, so a long Turkish or German activity title produces an over-length line that Outlook truncates silently. Also please `export` the token derivation so the calendar page can stop duplicating it |
| `app/api/calendar/ics/[token]/route.ts` | **W2-B** | Per-user feed tokens, if the brief's "token-scoped per user" is still wanted. Today one token returns the manager view to whoever holds it |
| `messages/*.json` | **W1-C** | Add `common.notAvailable` and `common.dataSource.localSeedHint`. Both are referenced by shipped code and neither exists — §10. `notAvailable` should be `Keine Angabe`, not an em dash |
| `app/[locale]/dashboard/units/page.tsx` | **W3-C** | Same two keys; the page will print `common.notAvailable` to a user as soon as a unit with a null price is in view |
| `lib/operations-data.ts` | **W2-A** | The seed ticket title `Fassadenriss Block B03 — Gutachten ausstehend` contains an em dash and is user-visible |
| dashboard surfaces | **whoever takes live updates** | §9, first bullet. The API route exists; the seam is a client component plus `<SyncBadge>` |

---

## 12. Files written

```
apps/web/lib/ticket-workflow.ts          the transition table, canTransition, SLA
apps/web/lib/ticket-routing.ts           team routing, assignee selection
apps/web/lib/ics-calendar.ts             RFC 5545 escaping, 75-octet folding, UTC stamps
apps/web/components/operations/          8 files: badges, SLA, transitions, timeline,
                                         capacity meter, delivery notice, calendar views, labels
apps/web/app/[locale]/dashboard/tickets/{page,[id]/page}.tsx
apps/web/app/[locale]/dashboard/activities/page.tsx
apps/web/app/[locale]/dashboard/calendar/page.tsx
apps/web/app/[locale]/dashboard/communications/{page,[threadId]/page}.tsx
HANDOFF/W3-E.md · W3-E-activity-capacity.sql · W3-E-activity-capacity-probe.mjs
         · W3-E-workflow-ics-probe.mts
```

Modified, both explicitly sanctioned:

```
apps/web/lib/dashboard-routing.ts   four `pending: true` flags deleted (W3-B contract §2)
apps/web/messages/{de,en,tr,ru}.json  dashboard.{tickets,activities,calendar,communications}
                                      only, as one contiguous block at the same position in all
                                      four files (OVERNIGHT-2 §2)
```

`git status` shows nothing outside this list. `next build` did not rewrite `tsconfig.json` this
time; it was already normalised by an earlier build.
