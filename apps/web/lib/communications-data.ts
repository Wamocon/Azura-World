/**
 * Seed threads, messages and notifications — the `local-seed` half of
 * `lib/communications-repository.ts`.
 *
 * Structurally identical to `public.threads` / `public.messages` /
 * `public.notifications` (migration `00000000000009_communications.sql`) after
 * mapping, and deterministic: every timestamp is `seedIso(dayOffset)` off the
 * fixed anchor, and the exports are builder functions returning fresh arrays.
 *
 * ## Why one message is an internal note
 *
 * `messages.is_internal_note` is a staff-only annotation and the thread access
 * helper `public.current_user_can_access_thread()` does **not** filter it — the
 * migration says so in a column comment. Closing that gap is the repository's
 * job, so the seed has to contain a note for the filter to be testable at all.
 * A seed without one would let the filter rot undetected.
 *
 * ## Thread activity is derived, not asserted
 *
 * `messageCount` and `lastMessageAt` are maintained in Postgres by the
 * `sync_thread_message_stats` trigger. Here they are computed from the seeded
 * messages for the same reason: a hand-written count drifts the moment a message
 * is added, and an inbox sorted on a stale timestamp looks like data loss.
 */

import type { Locale } from "@/lib/contracts"
import {
  SEED_COMPANY_ID,
  SEED_DOCUMENT_IDS,
  SEED_PROFILE_ID_MANAGER,
  SEED_PROFILE_ID_RESIDENT,
  SEED_PROFILE_ID_STAFF,
  SEED_PROFILE_ID_TENANT,
  SEED_RESIDENT_ID,
  SEED_SITE_ID,
  SEED_UNIT_ID_OWNER,
  SEED_UNIT_ID_TENANT,
} from "@/lib/document-data"
import { seedIso } from "@/lib/repository-base"
import { seedServiceTickets } from "@/lib/operations-data"
import {
  at,
  DEMO_MARK,
  DEMO_PROFILE_IDS,
  demoId,
  stream,
} from "@/lib/demo-operations"

export {
  SEED_COMPANY_ID,
  SEED_PROFILE_ID_MANAGER,
  SEED_PROFILE_ID_RESIDENT,
  SEED_PROFILE_ID_STAFF,
  SEED_PROFILE_ID_TENANT,
}

// ---------------------------------------------------------------------------
// Column domains
// ---------------------------------------------------------------------------

/** `threads.status` CHECK. */
export const threadStatuses = [
  "open",
  "pending",
  "resolved",
  "closed",
  "archived",
] as const

export type ThreadStatus = (typeof threadStatuses)[number]

/** `threads.priority` CHECK. */
export const threadPriorities = ["low", "normal", "high", "urgent"] as const

export type ThreadPriority = (typeof threadPriorities)[number]

/** `threads.channel` / `messages.channel` CHECK — one list, both columns. */
export const communicationChannels = [
  "portal",
  "email",
  "whatsapp",
  "phone",
  "walk_in",
  "system",
] as const

export type CommunicationChannel = (typeof communicationChannels)[number]

/** `messages.sender_kind` CHECK. */
export const messageSenderKinds = ["user", "system", "automation"] as const

export type MessageSenderKind = (typeof messageSenderKinds)[number]

/** `notifications.category` CHECK. */
export const notificationCategories = [
  "system",
  "finance",
  "service",
  "compliance",
  "document",
  "message",
  "announcement",
] as const

export type NotificationCategory = (typeof notificationCategories)[number]

/** `notifications.severity` CHECK. */
export const notificationSeverities = [
  "info",
  "success",
  "warning",
  "critical",
] as const

export type NotificationSeverity = (typeof notificationSeverities)[number]

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** One row of `public.threads`. `unitId` is TEXT — `units.id` is a business code. */
export interface ThreadRecord {
  id: string
  companyId: string
  siteId: string | null
  unitId: string | null
  residentId: string | null
  subject: string
  status: ThreadStatus
  priority: ThreadPriority
  locale: Locale
  channel: CommunicationChannel
  createdBy: string | null
  assignedTo: string | null
  lastMessageAt: string | null
  messageCount: number
  version: number
  createdAt: string
  updatedAt: string
}

/** One row of `public.messages`. */
export interface MessageRecord {
  id: string
  threadId: string
  companyId: string
  senderProfileId: string | null
  senderKind: MessageSenderKind
  body: string
  channel: CommunicationChannel
  locale: Locale | null
  /**
   * Staff-only annotation. RLS does **not** filter this column; the repository
   * does, for every caller below staff level 40.
   */
  isInternalNote: boolean
  idempotencyKey: string | null
  attachmentDocumentId: string | null
  deliveredAt: string | null
  readAt: string | null
  createdAt: string
}

/** One row of `public.notifications`. Addressed to exactly one profile. */
export interface NotificationRecord {
  id: string
  companyId: string | null
  profileId: string
  category: NotificationCategory
  severity: NotificationSeverity
  title: string
  body: string | null
  payload: Record<string, unknown>
  /** Site-relative path only — `^/` and never `//` (open-redirect CHECK). */
  link: string | null
  locale: Locale
  isRead: boolean
  readAt: string | null
  expiresAt: string | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export const SEED_THREAD_IDS = {
  waterDamage: "0a1b2c3d-0004-4000-8000-000000000001",
  purchaseEnquiry: "0a1b2c3d-0004-4000-8000-000000000002",
  keyHandover: "0a1b2c3d-0004-4000-8000-000000000003",
} as const

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Nine messages across three threads, in transcript order (oldest first) —
 * the order `getMessages()` returns them in.
 *
 * Two of them are internal notes, one in a thread a resident participates in
 * and one in a staff-only thread, so the internal-note filter is exercised in
 * both shapes.
 */
function anchorMessages(): MessageRecord[] {
  return [
    {
      id: "0a1b2c3d-0005-4000-8000-000000000001",
      threadId: SEED_THREAD_IDS.waterDamage,
      companyId: SEED_COMPANY_ID,
      senderProfileId: SEED_PROFILE_ID_RESIDENT,
      senderKind: "user",
      body: "Guten Tag, im Bad der Wohnung B03-0412 tritt seit gestern Wasser unter der Duschwanne aus. Bitte um Rückmeldung.",
      channel: "portal",
      locale: "de",
      isInternalNote: false,
      idempotencyKey: "seed-msg-waterdamage-0001",
      attachmentDocumentId: null,
      deliveredAt: seedIso(-6, 8),
      readAt: seedIso(-6, 9),
      createdAt: seedIso(-6, 8),
    },
    {
      id: "0a1b2c3d-0005-4000-8000-000000000002",
      threadId: SEED_THREAD_IDS.waterDamage,
      companyId: SEED_COMPANY_ID,
      senderProfileId: SEED_PROFILE_ID_STAFF,
      senderKind: "user",
      body: "Vielen Dank für die Meldung. Ein Techniker kommt morgen zwischen 09:00 und 11:00 Uhr vorbei.",
      channel: "portal",
      locale: "de",
      isInternalNote: false,
      idempotencyKey: "seed-msg-waterdamage-0002",
      attachmentDocumentId: null,
      deliveredAt: seedIso(-6, 10),
      readAt: seedIso(-6, 12),
      createdAt: seedIso(-6, 10),
    },
    {
      // The internal note in a resident-visible thread. getMessages() must drop
      // this one for anybody below staff level 40.
      id: "0a1b2c3d-0005-4000-8000-000000000003",
      threadId: SEED_THREAD_IDS.waterDamage,
      companyId: SEED_COMPANY_ID,
      senderProfileId: SEED_PROFILE_ID_STAFF,
      senderKind: "user",
      body: "Interne Notiz: Gleiche Steigleitung wie B03-0312 im Mai. Sanitär Yılmaz zuerst prüfen lassen, bevor wir dem Eigentümer eine Kostenschätzung nennen.",
      channel: "portal",
      locale: "de",
      isInternalNote: true,
      idempotencyKey: "seed-msg-waterdamage-0003",
      attachmentDocumentId: null,
      deliveredAt: null,
      readAt: null,
      createdAt: seedIso(-6, 11),
    },
    {
      id: "0a1b2c3d-0005-4000-8000-000000000004",
      threadId: SEED_THREAD_IDS.waterDamage,
      companyId: SEED_COMPANY_ID,
      senderProfileId: null,
      senderKind: "automation",
      body: "Serviceauftrag SRV-2026-0418 wurde angelegt und dem Sanitärdienst zugewiesen.",
      channel: "system",
      locale: "de",
      isInternalNote: false,
      idempotencyKey: null,
      attachmentDocumentId: null,
      deliveredAt: seedIso(-5, 9),
      readAt: null,
      createdAt: seedIso(-5, 9),
    },
    {
      id: "0a1b2c3d-0005-4000-8000-000000000005",
      threadId: SEED_THREAD_IDS.purchaseEnquiry,
      companyId: SEED_COMPANY_ID,
      senderProfileId: SEED_PROFILE_ID_STAFF,
      senderKind: "user",
      body: "Hello, thank you for your interest in a 2+1 sea-view apartment. The current brochure is attached.",
      channel: "email",
      locale: "en",
      isInternalNote: false,
      idempotencyKey: "seed-msg-enquiry-0001",
      attachmentDocumentId: SEED_DOCUMENT_IDS.brochure,
      deliveredAt: seedIso(-3, 11),
      readAt: seedIso(-3, 13),
      createdAt: seedIso(-3, 11),
    },
    {
      // Internal note in a staff-only thread.
      id: "0a1b2c3d-0005-4000-8000-000000000006",
      threadId: SEED_THREAD_IDS.purchaseEnquiry,
      companyId: SEED_COMPANY_ID,
      senderProfileId: SEED_PROFILE_ID_MANAGER,
      senderKind: "user",
      body: "Internal: budget stated as 180k EUR but the portal listing for the same layout quotes USD. Do not quote a converted figure back to the client.",
      channel: "email",
      locale: "en",
      isInternalNote: true,
      idempotencyKey: "seed-msg-enquiry-0002",
      attachmentDocumentId: null,
      deliveredAt: null,
      readAt: null,
      createdAt: seedIso(-3, 12),
    },
    {
      id: "0a1b2c3d-0005-4000-8000-000000000007",
      threadId: SEED_THREAD_IDS.purchaseEnquiry,
      companyId: SEED_COMPANY_ID,
      senderProfileId: SEED_PROFILE_ID_MANAGER,
      senderKind: "user",
      body: "A viewing slot on 14 August at 10:00 local time is available. Please confirm and we will arrange the airport transfer.",
      channel: "email",
      locale: "en",
      isInternalNote: false,
      idempotencyKey: "seed-msg-enquiry-0003",
      attachmentDocumentId: null,
      deliveredAt: seedIso(-2, 9),
      readAt: null,
      createdAt: seedIso(-2, 9),
    },
    {
      id: "0a1b2c3d-0005-4000-8000-000000000008",
      threadId: SEED_THREAD_IDS.keyHandover,
      companyId: SEED_COMPANY_ID,
      senderProfileId: SEED_PROFILE_ID_TENANT,
      senderKind: "user",
      body: "Merhaba, B07-0118 için anahtar teslimini cuma günü öğleden sonra yapabilir miyiz?",
      channel: "walk_in",
      locale: "tr",
      isInternalNote: false,
      idempotencyKey: "seed-msg-handover-0001",
      attachmentDocumentId: null,
      deliveredAt: seedIso(-12, 14),
      readAt: seedIso(-12, 15),
      createdAt: seedIso(-12, 14),
    },
    {
      id: "0a1b2c3d-0005-4000-8000-000000000009",
      threadId: SEED_THREAD_IDS.keyHandover,
      companyId: SEED_COMPANY_ID,
      senderProfileId: SEED_PROFILE_ID_STAFF,
      senderKind: "user",
      body: "Tabii, cuma 15:00 uygun. Teslim tutanağı imzaya hazır olacak.",
      channel: "walk_in",
      locale: "tr",
      isInternalNote: false,
      idempotencyKey: "seed-msg-handover-0002",
      attachmentDocumentId: null,
      deliveredAt: seedIso(-12, 16),
      readAt: seedIso(-11, 9),
      createdAt: seedIso(-12, 16),
    },
  ]
}

/**
 * `message_count` and `last_message_at` for one thread, derived from the seeded
 * messages exactly as the `sync_thread_message_stats` trigger derives them in
 * Postgres. Internal notes count: the trigger does not know about them either.
 */
function threadActivity(
  messages: readonly MessageRecord[],
  threadId: string
): { lastMessageAt: string | null; messageCount: number } {
  let lastMessageAt: string | null = null
  let messageCount = 0
  for (const message of messages) {
    if (message.threadId !== threadId) continue
    messageCount += 1
    if (lastMessageAt === null || message.createdAt > lastMessageAt) {
      lastMessageAt = message.createdAt
    }
  }
  return { lastMessageAt, messageCount }
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/**
 * Three threads, ordered newest-activity-first — the order `getThreads()`
 * returns them in, matching `idx_threads_company_activity`.
 */
function anchorThreads(): ThreadRecord[] {
  const messages = seedMessages()

  return [
    {
      id: SEED_THREAD_IDS.waterDamage,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: SEED_UNIT_ID_OWNER,
      residentId: SEED_RESIDENT_ID,
      subject: "Wasserschaden Bad — B03-0412",
      status: "open",
      priority: "high",
      locale: "de",
      channel: "portal",
      createdBy: SEED_PROFILE_ID_RESIDENT,
      assignedTo: SEED_PROFILE_ID_STAFF,
      version: 5,
      createdAt: seedIso(-6, 8),
      updatedAt: seedIso(-5, 9),
      ...threadActivity(messages, SEED_THREAD_IDS.waterDamage),
    },
    {
      id: SEED_THREAD_IDS.purchaseEnquiry,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: null,
      residentId: null,
      subject: "Purchase enquiry — 2+1 sea view",
      status: "pending",
      priority: "normal",
      locale: "en",
      channel: "email",
      createdBy: SEED_PROFILE_ID_STAFF,
      assignedTo: SEED_PROFILE_ID_MANAGER,
      version: 4,
      createdAt: seedIso(-3, 11),
      updatedAt: seedIso(-2, 9),
      ...threadActivity(messages, SEED_THREAD_IDS.purchaseEnquiry),
    },
    {
      id: SEED_THREAD_IDS.keyHandover,
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: SEED_UNIT_ID_TENANT,
      residentId: null,
      subject: "Anahtar teslimi — B07-0118",
      status: "resolved",
      priority: "low",
      locale: "tr",
      channel: "walk_in",
      createdBy: SEED_PROFILE_ID_TENANT,
      assignedTo: SEED_PROFILE_ID_STAFF,
      version: 3,
      createdAt: seedIso(-12, 14),
      updatedAt: seedIso(-11, 9),
      ...threadActivity(messages, SEED_THREAD_IDS.keyHandover),
    },
  ]
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * Seven notifications across four profiles, newest first — the order
 * `getNotifications()` returns them in.
 *
 * Read and unread are both represented, and `read_at` is set exactly when
 * `is_read` is true (the `notifications_read_at_consistent` CHECK). One row has
 * already expired at the anchor so the default expiry filter is exercised.
 */
function anchorNotifications(): NotificationRecord[] {
  return [
    {
      id: "0a1b2c3d-0006-4000-8000-000000000001",
      companyId: SEED_COMPANY_ID,
      profileId: SEED_PROFILE_ID_RESIDENT,
      category: "message",
      severity: "info",
      title: "Neue Nachricht zu Ihrem Serviceticket",
      body: "Der Sanitärdienst wurde beauftragt. Termin: morgen 09:00–11:00 Uhr.",
      payload: { threadId: SEED_THREAD_IDS.waterDamage },
      link: "/de/dashboard/communications",
      locale: "de",
      isRead: false,
      readAt: null,
      expiresAt: null,
      createdAt: seedIso(-5, 9),
    },
    {
      id: "0a1b2c3d-0006-4000-8000-000000000002",
      companyId: SEED_COMPANY_ID,
      profileId: SEED_PROFILE_ID_MANAGER,
      category: "compliance",
      severity: "critical",
      title: "İskan-Dokument abgelaufen — Blok B03",
      body: "Die Occupancy-Genehmigung für Blok B03 ist seit 30 Tagen abgelaufen.",
      payload: { documentId: SEED_DOCUMENT_IDS.occupancyPermit },
      link: "/de/dashboard/compliance",
      locale: "de",
      isRead: false,
      readAt: null,
      expiresAt: null,
      createdAt: seedIso(-4, 7),
    },
    {
      id: "0a1b2c3d-0006-4000-8000-000000000003",
      companyId: SEED_COMPANY_ID,
      profileId: SEED_PROFILE_ID_MANAGER,
      category: "document",
      severity: "warning",
      title: "DASK-Police läuft in 14 Tagen ab",
      body: "Die Gebäudeversicherung muss vor Ablauf verlängert werden.",
      payload: { documentId: SEED_DOCUMENT_IDS.buildingInsurance },
      link: "/de/dashboard/documents",
      locale: "de",
      isRead: false,
      readAt: null,
      expiresAt: seedIso(14, 12),
      createdAt: seedIso(-4, 8),
    },
    {
      id: "0a1b2c3d-0006-4000-8000-000000000004",
      companyId: SEED_COMPANY_ID,
      profileId: SEED_PROFILE_ID_STAFF,
      category: "service",
      severity: "info",
      title: "Ticket SRV-2026-0418 zugewiesen",
      body: null,
      payload: { ticketReference: "SRV-2026-0418" },
      link: "/de/dashboard/tickets",
      locale: "de",
      isRead: true,
      readAt: seedIso(-5, 10),
      expiresAt: null,
      createdAt: seedIso(-5, 9),
    },
    {
      id: "0a1b2c3d-0006-4000-8000-000000000005",
      companyId: SEED_COMPANY_ID,
      profileId: SEED_PROFILE_ID_RESIDENT,
      category: "finance",
      severity: "success",
      title: "Zahlung eingegangen",
      body: "Ihre Betriebskostenzahlung für Q2 2026 wurde verbucht.",
      payload: { period: "2026-Q2" },
      link: "/de/dashboard/finance",
      locale: "de",
      isRead: true,
      readAt: seedIso(-20, 12),
      expiresAt: null,
      createdAt: seedIso(-20, 11),
    },
    {
      // Already expired at the anchor: excluded unless includeExpired is set.
      id: "0a1b2c3d-0006-4000-8000-000000000006",
      companyId: SEED_COMPANY_ID,
      profileId: SEED_PROFILE_ID_RESIDENT,
      category: "announcement",
      severity: "info",
      title: "Poolwartung 12.–14. Juli",
      body: "Der Hauptpool bleibt während der Wartung geschlossen.",
      payload: {},
      link: "/de/dashboard",
      locale: "de",
      isRead: false,
      readAt: null,
      expiresAt: seedIso(-13, 12),
      createdAt: seedIso(-25, 9),
    },
    {
      id: "0a1b2c3d-0006-4000-8000-000000000007",
      companyId: SEED_COMPANY_ID,
      profileId: SEED_PROFILE_ID_TENANT,
      category: "system",
      severity: "info",
      title: "Anahtar teslim randevusu onaylandı",
      body: "Cuma 15:00, resepsiyon.",
      payload: { threadId: SEED_THREAD_IDS.keyHandover },
      link: "/tr/dashboard/communications",
      locale: "tr",
      isRead: true,
      readAt: seedIso(-11, 10),
      expiresAt: null,
      createdAt: seedIso(-12, 16),
    },
  ]
}

// ---------------------------------------------------------------------------
// The generated operating year
//
// Threads hang off REAL tickets and REAL units. A communications module whose
// conversations reference nothing is a list of paragraphs; the value of the
// screen is that a manager can read a complaint and open the ticket it is about.
// ---------------------------------------------------------------------------

/** Opening messages, by what the resident is writing about. */
const THREAD_OPENERS: ReadonlyArray<readonly [string, string, string]> = [
  // subject, resident opener, management reply
  [
    "Klimaanlage in der Wohnung",
    "Guten Tag, die Klimaanlage kühlt seit gestern nicht mehr. Können Sie jemanden vorbeischicken?",
    "Guten Tag, vielen Dank für die Meldung. Wir haben einen Termin für morgen zwischen 9 und 12 Uhr eingeplant.",
  ],
  [
    "Nebenkostenabrechnung",
    "Ich habe eine Frage zur letzten Abrechnung. Die Position für Wasser weicht deutlich vom Vorjahr ab.",
    "Wir prüfen das gern. Die Ablesung liegt uns vor, wir senden Ihnen die Aufstellung bis Ende der Woche zu.",
  ],
  [
    "Paketannahme",
    "Können Sie ein Paket für mich annehmen? Ich bin bis Freitag nicht vor Ort.",
    "Ja, gern. Wir nehmen es an der Rezeption an und legen es in Ihr Fach.",
  ],
  [
    "Lärm am Pool",
    "Am Wochenende war es bis nach Mitternacht sehr laut am Pool. Gibt es feste Ruhezeiten?",
    "Die Ruhezeit beginnt um 23 Uhr. Wir haben den Sicherheitsdienst gebeten, das abends zu kontrollieren.",
  ],
  [
    "Zweitschlüssel",
    "Wir benötigen einen zweiten Schlüssel für die Wohnung. Wie gehen wir vor?",
    "Bitte kommen Sie mit einem Ausweis zur Verwaltung, dann geben wir den Auftrag noch am selben Tag heraus.",
  ],
  [
    "Wasserdruck im Bad",
    "Der Wasserdruck im Bad ist seit einigen Tagen sehr niedrig.",
    "Danke für den Hinweis. Die Technik prüft den Strang, wir melden uns mit einem Termin.",
  ],
  [
    "Parkplatz",
    "Auf meinem Stellplatz parkt regelmäßig ein fremdes Fahrzeug.",
    "Wir sprechen den Halter an. Falls es sich wiederholt, lassen wir das Fahrzeug abschleppen.",
  ],
]

function generatedThreads(): ThreadRecord[] {
  const rng = stream("threads")
  const out: ThreadRecord[] = []
  let index = 0

  // Only tickets that a resident raised on their own unit produce a thread:
  // nobody writes to the management about a lobby light.
  const conversational = seedServiceTickets().filter(
    (ticket) => ticket.unitId !== null
  )

  for (const ticket of conversational) {
    if (!rng.chance(0.28)) continue
    index += 1
    const opener = rng.pick(THREAD_OPENERS)
    const messageCount = rng.int(2, 5)
    const lastOffset = rng.int(-350, -1)

    out.push({
      id: demoId("thr", index),
      companyId: SEED_COMPANY_ID,
      siteId: SEED_SITE_ID,
      unitId: ticket.unitId,
      residentId: null,
      subject: opener[0],
      // A closed ticket has a closed conversation. Deriving the status from the
      // ticket is what stops the two screens contradicting each other.
      status:
        ticket.status === "closed"
          ? "closed"
          : ticket.status === "resolved"
            ? "resolved"
            : "open",
      priority:
        ticket.priority === "urgent"
          ? "urgent"
          : ticket.priority === "high"
            ? "high"
            : "normal",
      locale: rng.weighted<Locale>([
        ["de", 46],
        ["tr", 30],
        ["ru", 14],
        ["en", 10],
      ]),
      channel: rng.weighted<CommunicationChannel>([
        ["portal", 52],
        ["email", 24],
        ["whatsapp", 14],
        ["walk_in", 10],
      ]),
      createdBy: null,
      assignedTo: ticket.assigneeProfileId,
      lastMessageAt: at(lastOffset, 14),
      messageCount,
      version: 1,
      createdAt: at(lastOffset - messageCount, 9),
      updatedAt: at(lastOffset, 14),
    })
  }
  return out
}

/**
 * The messages inside those threads.
 *
 * Alternating resident and management, and `messageCount` on the thread is the
 * number actually emitted here rather than a number chosen beside it. A counter
 * that disagrees with the list it counts is the sort of thing that survives
 * every test and gets spotted in the room.
 */
function generatedMessages(): MessageRecord[] {
  const rng = stream("messages")
  const out: MessageRecord[] = []
  let index = 0

  for (const thread of generatedThreads()) {
    const opener =
      THREAD_OPENERS.find((row) => row[0] === thread.subject) ??
      THREAD_OPENERS[0]
    if (opener === undefined) continue

    const created = new Date(thread.createdAt).getTime()
    for (let n = 0; n < thread.messageCount; n += 1) {
      index += 1
      const fromResident = n % 2 === 0
      out.push({
        id: demoId("msg", index),
        threadId: thread.id,
        companyId: SEED_COMPANY_ID,
        senderProfileId: fromResident ? null : thread.assignedTo,
        senderKind: fromResident ? "user" : "user",
        body: fromResident ? opener[1] : opener[2],
        channel: thread.channel,
        locale: thread.locale,
        // An internal note is staff-only and RLS does NOT filter that column;
        // `getMessages()` drops it below staff in the repository. Kept false
        // here so the demo never depends on that single application-side guard.
        isInternalNote: false,
        idempotencyKey: null,
        attachmentDocumentId: null,
        deliveredAt: new Date(created + n * 86_400_000).toISOString(),
        readAt: rng.chance(0.8)
          ? new Date(created + n * 86_400_000 + 3_600_000).toISOString()
          : null,
        createdAt: new Date(created + n * 86_400_000).toISOString(),
      })
    }
  }
  return out
}

/** Notifications for the eleven accounts that can actually sign in. */
function generatedNotifications(): NotificationRecord[] {
  const rng = stream("notifications")
  const out: NotificationRecord[] = []

  const TEMPLATES: ReadonlyArray<
    readonly [NotificationCategory, NotificationSeverity, string]
  > = [
    ["service", "warning", "Ticket überschreitet die Reaktionszeit"],
    ["service", "info", "Neues Ticket in Ihrem Bereich"],
    ["finance", "warning", "Offener Posten seit über 30 Tagen"],
    ["finance", "info", "Zahlungseingang verbucht"],
    ["document", "info", "Dokument wartet auf Freigabe"],
    ["compliance", "critical", "Prüfung überfällig"],
    ["announcement", "info", "Wartungsfenster angekündigt"],
  ]

  const recipients = [
    DEMO_PROFILE_IDS.admin,
    DEMO_PROFILE_IDS.manager,
    DEMO_PROFILE_IDS.accountant,
    DEMO_PROFILE_IDS.staff,
    DEMO_PROFILE_IDS.owner,
    DEMO_PROFILE_IDS.tenant,
  ]

  let index = 0
  for (const profileId of recipients) {
    for (let n = 0; n < 14; n += 1) {
      index += 1
      const template = rng.pick(TEMPLATES)
      const offset = rng.int(-120, -1)
      const read = rng.chance(0.55)
      out.push({
        id: demoId("ntf", index),
        companyId: SEED_COMPANY_ID,
        profileId,
        category: template[0],
        severity: template[1],
        title: template[2],
        body: null,
        payload: { ...DEMO_MARK },
        link: null,
        locale: "de",
        isRead: read,
        readAt: read ? at(offset, 16) : null,
        expiresAt: null,
        createdAt: at(offset, 8),
      })
    }
  }
  return out
}

export function seedThreads(): ThreadRecord[] {
  return [...anchorThreads(), ...generatedThreads()]
}

export function seedMessages(): MessageRecord[] {
  return [...anchorMessages(), ...generatedMessages()]
}

export function seedNotifications(): NotificationRecord[] {
  return [...anchorNotifications(), ...generatedNotifications()]
}
