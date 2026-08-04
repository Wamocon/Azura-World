import "server-only"

import { getUnreadNotificationCount, getThreads } from "@/lib/communications-repository"
import type { Role } from "@/lib/contracts"
import {
  getActivities,
  getTickets,
  type ServiceTicket,
} from "@/lib/operations-repository"
import { hasPermission } from "@/lib/rbac"
import { assessSla, closedOutStatuses } from "@/lib/ticket-workflow"

/**
 * What needs this person now.                                   Owner: W-NIGHT
 *
 * ## The gap this closes
 *
 * The dashboard home is the first page all eleven roles land on and it was the
 * THINNEST page in the product for seven of them. Measured across 130 pages:
 * tenant 616 characters, owner 666, service_provider 706, accountant 795, staff
 * 813, manager 948, admin 1077 — against a median elsewhere of about 1 800.
 *
 * The reason is that it answered the wrong question. `getDashboardSnapshot()`
 * returns counts — 43 tickets, 6 overdue, 656 units — and counts are what you
 * want once you already know something is wrong. Nobody opens their home page to
 * learn a total. They open it to find out **what happened since they last
 * looked and what they have to do about it**, and then they navigated away to go
 * looking, which is the work the page was supposed to save them.
 *
 * So this module returns ROWS, not figures, and every row is a thing you can
 * act on.
 *
 * ## It reads, and never counts differently
 *
 * Nothing here queries the database in a new way. Every list is an existing
 * repository read under the caller's own scope, which matters twice over:
 * RLS decides what comes back, exactly as it does on the page the item links
 * to — so an item can never appear here that its own page would refuse — and
 * the numbers cannot drift from the module they came from, because they ARE
 * that module's numbers.
 *
 * ## What it deliberately does not do
 *
 * - **It invents no urgency.** An item is here because a stored field says so:
 *   an SLA date in the past, a status of `open`, an unread flag. There is no
 *   scoring, no "likely to need attention", no heuristic. A product whose whole
 *   claim is that every figure has a source cannot put a guess on the front page.
 * - **It never shows an empty list as zero.** A role with nothing waiting gets a
 *   stated "nothing needs you" rather than a card reading 0, because those are
 *   different sentences: one is reassurance, the other looks like a broken
 *   query.
 * - **It does not aggregate across roles.** A tenant's list is their own
 *   requests; a manager's is the queue. The same function, different scope, no
 *   branch that widens.
 */

/** Where the reader is sent, and how loudly the item asks. */
export type AttentionTone = "urgent" | "action" | "info"

export interface AttentionItem {
  /** Stable across renders for the list key; not a database id. */
  key: string
  tone: AttentionTone
  /** i18n key under `dashboard.attention.items`, resolved by the page. */
  messageKey: string
  /** Values the message interpolates. Numbers and short references only. */
  values: Record<string, string | number>
  /** Locale-less route. The page adds the locale and any opaque token. */
  href: string
  /** ISO instant the item is about, for ordering. */
  at: string
}

export interface AttentionResult {
  items: AttentionItem[]
  /** True when every read behind the list fell back to seed data. */
  degraded: boolean
}

/** The most a front page may ever show. Past this it is a list page, not a home. */
const MAX_ITEMS = 8

/**
 * Assemble the caller's attention list.
 *
 * Every branch is gated on a permission the caller actually holds, so a role
 * never receives an item pointing at a page it cannot open. The permission
 * check is not a substitute for RLS — the reads are scoped too — it is what
 * stops the list offering a link that would answer 403.
 */
export async function getAttentionItems(profile: {
  role: Role
  id: string | null
}): Promise<AttentionResult> {
  const items: AttentionItem[] = []
  let degraded = false
  const scope = {
    role: profile.role,
    ...(profile.id === null ? {} : { profileId: profile.id }),
  }

  // --- work that is late -----------------------------------------------
  //
  // First, always. A breached SLA is the only thing in this product that is
  // unambiguously somebody's problem right now.
  if (hasPermission(profile.role, "tickets:view")) {
    const breached = await getTickets({
      ...scope,
      slaBreachedOnly: true,
      openOnly: true,
      limit: MAX_ITEMS,
    })
    if (breached.source === "local-seed") degraded = true
    for (const ticket of breached.data) {
      const sla = assessSla(ticket, breached.fetchedAt)
      items.push({
        key: `sla-${ticket.id}`,
        tone: "urgent",
        messageKey: "slaBreached",
        values: {
          reference: ticket.ticketNo,
          title: ticket.title,
          // Whole days late, floored at 1: "0 days overdue" reads as not
          // overdue, and the row is only here because it is.
          days: Math.max(
            1,
            Math.floor(Math.abs(sla.msRemaining ?? 0) / 86_400_000)
          ),
        },
        href: "/dashboard/tickets?sla=breached",
        at: ticket.slaDueAt ?? ticket.reportedAt,
      })
    }

    // --- work nobody has picked up ------------------------------------
    //
    // Only for a role that can actually assign it. Showing an unassigned
    // ticket to somebody who cannot act on it is noise wearing a warning.
    if (hasPermission(profile.role, "tickets:assign")) {
      const open = await getTickets({ ...scope, status: "open", limit: MAX_ITEMS })
      if (open.source === "local-seed") degraded = true
      const unassigned = open.data.filter(
        (ticket) => ticket.assigneeProfileId === null
      )
      if (unassigned.length > 0) {
        items.push({
          key: "unassigned",
          tone: "action",
          messageKey: "unassigned",
          values: { count: unassigned.length },
          href: "/dashboard/tickets?status=open",
          at: newestReportedAt(unassigned),
        })
      }
    }

    // --- your own jobs -------------------------------------------------
    //
    // A contractor's whole day. `getTickets` already scopes a service_provider
    // to tickets reachable from their assigned tasks, so this needs no filter
    // of its own beyond excluding what is finished.
    if (profile.id !== null && !hasPermission(profile.role, "tickets:assign")) {
      const mine = await getTickets({ ...scope, openOnly: true, limit: MAX_ITEMS })
      if (mine.source === "local-seed") degraded = true
      const live = mine.data.filter(
        (ticket) => !closedOutStatuses.includes(ticket.status)
      )
      if (live.length > 0) {
        items.push({
          key: "own-tickets",
          tone: "action",
          messageKey: "ownTickets",
          values: { count: live.length },
          href: "/dashboard/tickets",
          at: newestReportedAt(live),
        })
      }
    }
  }

  // --- somebody is waiting for a reply ---------------------------------
  if (hasPermission(profile.role, "communications:view") && profile.id !== null) {
    const unread = await getUnreadNotificationCount(profile.id, {
      role: profile.role,
    })
    if (unread.source === "local-seed") degraded = true
    if (unread.data > 0) {
      items.push({
        key: "unread-notifications",
        tone: "info",
        messageKey: "unreadNotifications",
        values: { count: unread.data },
        href: "/dashboard/communications",
        at: unread.fetchedAt,
      })
    }

    const threads = await getThreads({ ...scope, status: "open", limit: MAX_ITEMS })
    if (threads.source === "local-seed") degraded = true
    if (threads.data.length > 0) {
      items.push({
        key: "open-threads",
        tone: "info",
        messageKey: "openThreads",
        values: { count: threads.data.length },
        href: "/dashboard/communications",
        at: threads.data[0]?.lastMessageAt ?? threads.fetchedAt,
      })
    }
  }

  // --- what is happening on the site today ------------------------------
  if (hasPermission(profile.role, "activities:view")) {
    const upcoming = await getActivities({
      ...scope,
      upcomingOnly: true,
      limit: MAX_ITEMS,
    })
    if (upcoming.source === "local-seed") degraded = true
    const soon = upcoming.data.filter((activity) =>
      withinDays(activity.startsAt, upcoming.fetchedAt, 7)
    )
    if (soon.length > 0) {
      const first = soon[0]
      items.push({
        key: "upcoming-activities",
        tone: "info",
        messageKey: "upcomingActivities",
        values: { count: soon.length, next: first?.title ?? "" },
        href: "/dashboard/calendar",
        at: first?.startsAt ?? upcoming.fetchedAt,
      })
    }
  }

  // Urgent first, then by how recent — a late ticket from this morning above a
  // late ticket from last week, because the first is still recoverable.
  const order: Record<AttentionTone, number> = { urgent: 0, action: 1, info: 2 }
  items.sort(
    (a, b) => order[a.tone] - order[b.tone] || b.at.localeCompare(a.at)
  )

  return { items: items.slice(0, MAX_ITEMS), degraded }
}

function newestReportedAt(tickets: readonly ServiceTicket[]): string {
  let newest = ""
  for (const ticket of tickets) {
    if (ticket.reportedAt > newest) newest = ticket.reportedAt
  }
  return newest
}

function withinDays(iso: string, from: string, days: number): boolean {
  const at = Date.parse(iso)
  const start = Date.parse(from)
  if (Number.isNaN(at) || Number.isNaN(start)) return false
  return at >= start && at - start <= days * 86_400_000
}
