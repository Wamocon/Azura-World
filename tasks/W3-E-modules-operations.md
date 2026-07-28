# W3-E — Tickets, activities, calendar, communications

**Wave:** 3 · **Depends on:** W1-A, W2-A, W2-B, W2-D, W3-B · **Runs with:** all other W3-*

> Read `SYSTEM-PROMPT.md`, `HANDOFF/W3-B.md` (module contract), `HANDOFF/W2-A.md`
> (`operations-repository`, `communications-repository`), `HANDOFF/W2-D.md` (`useLiveSnapshot`).
> Then read `D:\Real Estate CRM\Cati\apps\web\lib\ticket-workflow.ts`, `ticket-routing.ts`,
> `ticket-history.ts` and `components\communications\`.

---

## Mission

The day-to-day operating surface: service tickets through their lifecycle, scheduled activities
with capacity, a calendar that exports, and threaded communications. This is the module group
where **state machines** matter — an invalid transition that the UI permits will corrupt data
that finance and compliance later depend on.

---

## Files you own

```
apps/web/app/[locale]/dashboard/{tickets,activities,calendar,communications}/**
apps/web/components/operations/*
apps/web/lib/ticket-workflow.ts · ticket-routing.ts · ics-calendar.ts
HANDOFF/W3-E.md
```

Messages: `dashboard.tickets.*`, `dashboard.activities.*`, `dashboard.calendar.*`,
`dashboard.communications.*` only.

---

## Deliverables

### 1. Tickets — `/dashboard/tickets`

Lifecycle as an explicit state machine, not scattered `if` statements:

```
new → triaged → assigned → in_progress → awaiting_parts ⇄ in_progress
    → resolved → verified → closed
                 ↘ reopened → assigned
    → rejected (from triaged, with a reason)
```

- `lib/ticket-workflow.ts` exports the transition table and `canTransition(from, to, role)`.
  **The UI derives its buttons from this table** — it never hardcodes which buttons to show.
- Every transition writes a `ticket_event` with actor, timestamp, from, to, note.
- Routing: auto-assign by category and site (`ticket-routing.ts`), with manual override.
- SLA: due-by per priority, breach highlighted, ageing visible.
- Evidence: photo/video attachments on field work (`media_reports`).
- Owner/tenant approval steps where the workflow requires them.
- Live updates via `useLiveSnapshot` — a ticket reassigned elsewhere updates here.

### 2. Activities — `/dashboard/activities`

Scheduled activities with **date, time and capacity**. Booking against capacity is the tricky part:

- Capacity is enforced **at the database**, not in the UI. Two users booking the last slot
  simultaneously must produce one success and one clean rejection.
- Waitlist when full. Cancellation promotes from the waitlist, audited.
- Recurring activities: generate occurrences, allow per-occurrence override.

### 3. Calendar — `/dashboard/calendar`

Month / week / day. Sources: activities, ticket SLAs, reservations, handovers.

- **ICS feed** per user, token-scoped (`/api/calendar/ics/[token]`), read-only.
- Token is revocable and never contains the user id in plaintext.
- Timezone: Türkiye is UTC+3, no DST. Store UTC, render local, and **label the timezone** — a
  German user subscribing to the feed must see correct local times.

### 4. Communications — `/dashboard/communications`

Threads scoped by role and entity (unit, ticket, resident). Composition, attachments, read state,
notifications.

**Be honest about delivery.** 1Çatı's status document states plainly that Communications v2 has
no verified send/retry/persistence in the isolated harness. If outbound email/SMS is not wired
here, the UI must say "nicht versendet — Anbieter nicht konfiguriert" rather than showing a
green "Sent". A false delivery confirmation is worse than no send at all.

---

## Edge cases

- **Invalid transition attempted via the API** → 409 with the allowed transitions listed. The UI
  should have prevented it, but the API is the boundary.
- **Concurrent transition** — two managers move the same ticket at once → optimistic concurrency,
  second gets 409 and re-renders.
- **Assignment to an inactive or deleted user** → rejected with a clear reason.
- **`service_provider` sees only assigned tickets** — including in search, counts, and calendar.
  A count that includes invisible items leaks information.
- **Capacity race**: last slot, two simultaneous bookings → exactly one wins. Test with real
  concurrency, not sequential calls.
- **Recurring activity across a DST boundary in a viewer's timezone** — Türkiye has no DST but
  Germany does. Store UTC; a Berlin viewer must see the right wall-clock time in both halves of
  the year.
- **ICS**: escape commas, semicolons and newlines in `SUMMARY`/`DESCRIPTION`, `CRLF` line endings,
  fold lines at 75 octets. Unescaped ICS silently breaks in Outlook.
- **Revoked ICS token** → 404, not 403 (do not confirm the token ever existed).
- **Thread with 500 messages** → paginate, do not render all.
- **Attachment too large / wrong type** → rejected before upload starts, with the limit named.
- **Message containing HTML or scraped content** → escaped. Never `dangerouslySetInnerHTML`.
- **Notification for a user who lost access** to the entity → suppressed.
- **Ticket on a unit that is `modelled`** → allowed, but badged, so nobody treats a synthetic
  unit's ticket as a real work order.

---

## Definition of done

```bash
pnpm --dir apps/web typecheck && pnpm --dir apps/web lint && pnpm --dir apps/web build
```

Plus, evidence pasted:

1. The full transition table, and a test that **every** invalid transition is rejected by the API
2. Concurrent transition → one success, one 409
3. Capacity race with true concurrency → exactly one booking, one clean rejection
4. `service_provider` ticket list, count and calendar all show **only** assigned items
5. ICS feed opened in a real calendar client; special characters survive; times correct for a
   Berlin viewer in both January and July
6. Revoked token → 404
7. Communications with no provider configured → UI states "not sent", no false green
8. Live update: transition a ticket in session A, observe session B update
9. Permission matrix across all 11 roles for every operations route
10. Attachment rejection for oversize and wrong MIME type

---

## Handoff must state

- The transition table as implemented, and which roles may perform which transitions
- How capacity is enforced (the exact database mechanism)
- Whether any outbound channel is actually wired — and if not, **say so plainly**; W4-C and W5
  will check that the UI does not overclaim
- The ICS token scheme and revocation path
