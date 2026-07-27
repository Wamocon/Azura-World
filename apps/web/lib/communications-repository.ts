/**
 * Threads, messages and notifications.
 *
 * Every exported read goes through `withRepository()`: unconfigured Supabase
 * falls back to the local seed and labels itself, a **configured** Supabase that
 * fails throws, and an empty inbox is `source: "supabase"` with an empty array —
 * never a seed substitution.
 *
 * ## Thread visibility is decided once, in SQL
 *
 * `public.current_user_can_access_thread(uuid)` is the ONLY thread/message
 * visibility decision in the schema; `threads` and `messages` both route their
 * SELECT policies through it, which is what stops the two tables' policies from
 * referencing each other and raising 42P17. This module therefore does **not**
 * re-derive that predicate — a second copy would drift out of step with the
 * first. It queries, lets RLS scope, and narrows only by what the caller
 * explicitly asked for.
 *
 * ## The one gap this module does close: internal notes
 *
 * `messages.is_internal_note` is a staff-only annotation and the access helper
 * does **not** filter it — migration 09 records that in a column comment rather
 * than pretending it is handled. So `getMessages()` filters it here, for every
 * caller below staff (level 40), and fails closed when no role is supplied.
 *
 * That asymmetry is deliberate. Elsewhere an omitted `role` means "no
 * repository-side narrowing; RLS is the filter". Here RLS is *known* not to be
 * the filter, so the repository is the only thing standing between an internal
 * note and the resident it is written about.
 */

import type { Locale, RepositoryResult, Role } from "@/lib/contracts"
import { locales, roleLevel } from "@/lib/contracts"
import {
  communicationChannels,
  messageSenderKinds,
  notificationCategories,
  notificationSeverities,
  seedMessages,
  seedNotifications,
  seedThreads,
  threadPriorities,
  threadStatuses,
  type CommunicationChannel,
  type MessageRecord,
  type MessageSenderKind,
  type NotificationCategory,
  type NotificationRecord,
  type NotificationSeverity,
  type ThreadPriority,
  type ThreadRecord,
  type ThreadStatus,
} from "@/lib/communications-data"
import { hasPermission } from "@/lib/rbac"
import {
  asBoolean,
  asNullableNumber,
  asNullableString,
  asRecord,
  asString,
  clampLimit,
  clampOffset,
  degraded,
  nowIso,
  unwrap,
  withRepository,
  type RepositoryClient,
} from "@/lib/repository-base"

export type {
  CommunicationChannel,
  MessageRecord,
  MessageSenderKind,
  NotificationCategory,
  NotificationRecord,
  NotificationSeverity,
  ThreadPriority,
  ThreadRecord,
  ThreadStatus,
}

// ---------------------------------------------------------------------------
// Query surface
// ---------------------------------------------------------------------------

/**
 * Filters for `getThreads()`.
 *
 * `profileId`, `unitId` and `residentId` are the caller's own identifiers. For a
 * role below staff they are not optional in practice: RLS scopes the query in
 * Supabase mode, but in local-seed mode there is no RLS, and this module will
 * not guess which threads belong to an unidentified resident. It returns an
 * empty list and says why in `degradedReason`.
 */
export interface ThreadQueryOptions {
  role?: Role
  /** The caller's profile id — matches `created_by` or `assigned_to`. */
  profileId?: string
  /** `units.id`, e.g. "AZW-B03-0412". TEXT, not a uuid. */
  unitId?: string
  residentId?: string
  siteId?: string
  status?: ThreadStatus | readonly ThreadStatus[]
  priority?: ThreadPriority
  channel?: CommunicationChannel
  assignedTo?: string
  /** Default 50, hard ceiling 500. Never unbounded. */
  limit?: number
  offset?: number
}

/**
 * Options for `getMessages()`.
 *
 * There is deliberately no `includeInternalNotes` escape hatch: a flag that
 * re-opens the gap would eventually be passed by a route that should not.
 * Staff-level callers get notes because of their role, and for no other reason.
 */
export interface MessageQueryOptions {
  role?: Role
  /** Default 50, hard ceiling 500. */
  limit?: number
  offset?: number
}

/** Filters for `getNotifications()`. */
export interface NotificationQueryOptions {
  role?: Role
  /**
   * A guardian's profile id. A `child_*` profile reads its own notifications
   * and its guardian's; nothing here widens beyond those two.
   */
  guardianProfileId?: string
  unreadOnly?: boolean
  category?: NotificationCategory | readonly NotificationCategory[]
  severity?: NotificationSeverity
  /** Expired notifications are excluded by default. */
  includeExpired?: boolean
  /** The instant expiry is measured against. Defaults to `nowIso()`. */
  asOf?: string
  limit?: number
  offset?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THREAD_COLUMNS =
  "id, company_id, site_id, unit_id, resident_id, subject, status, priority, locale, channel, created_by, assigned_to, last_message_at, message_count, version, created_at, updated_at"

const MESSAGE_COLUMNS =
  "id, thread_id, company_id, sender_profile_id, sender_kind, body, channel, locale, is_internal_note, idempotency_key, attachment_document_id, delivered_at, read_at, created_at"

const NOTIFICATION_COLUMNS =
  "id, company_id, profile_id, category, severity, title, body, payload, link, locale, is_read, read_at, expires_at, created_at"

const NO_SCOPE_REASON =
  "A caller below staff level was not identified. Pass profileId, unitId or residentId so the thread list can be scoped; in local-seed mode there is no RLS to do it for you."

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

/**
 * Narrow an unknown column value to one of the CHECK constraint's literals,
 * returning the literal from `allowed` so no cast is needed. Fallbacks are
 * fail-closed where the column carries security weight.
 */
function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  if (typeof value === "string") {
    for (const candidate of allowed) {
      if (candidate === value) return candidate
    }
  }
  return fallback
}

function oneOfOrNull<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | null {
  if (typeof value === "string") {
    for (const candidate of allowed) {
      if (candidate === value) return candidate
    }
  }
  return null
}

function mapThread(row: unknown): ThreadRecord {
  const record = asRecord(row)
  return {
    id: asString(record["id"]),
    companyId: asString(record["company_id"]),
    siteId: asNullableString(record["site_id"]),
    unitId: asNullableString(record["unit_id"]),
    residentId: asNullableString(record["resident_id"]),
    subject: asString(record["subject"]),
    status: oneOf(record["status"], threadStatuses, "open"),
    priority: oneOf(record["priority"], threadPriorities, "normal"),
    locale: oneOf<Locale>(record["locale"], locales, "de"),
    channel: oneOf(record["channel"], communicationChannels, "portal"),
    createdBy: asNullableString(record["created_by"]),
    assignedTo: asNullableString(record["assigned_to"]),
    lastMessageAt: asNullableString(record["last_message_at"]),
    messageCount: asNullableNumber(record["message_count"]) ?? 0,
    // 0 is not a legal version — the column defaults to 1 and only increases —
    // so a row without one fails an optimistic-concurrency check rather than
    // silently winning it.
    version: asNullableNumber(record["version"]) ?? 0,
    createdAt: asString(record["created_at"]),
    updatedAt: asString(record["updated_at"]),
  }
}

function mapMessage(row: unknown): MessageRecord {
  const record = asRecord(row)
  return {
    id: asString(record["id"]),
    threadId: asString(record["thread_id"]),
    companyId: asString(record["company_id"]),
    senderProfileId: asNullableString(record["sender_profile_id"]),
    senderKind: oneOf<MessageSenderKind>(
      record["sender_kind"],
      messageSenderKinds,
      "system"
    ),
    body: asString(record["body"]),
    channel: oneOf(record["channel"], communicationChannels, "portal"),
    locale: oneOfOrNull<Locale>(record["locale"], locales),
    // Fail-closed: a value that does not parse as `false` is treated as an
    // internal note, so drift hides a note rather than leaking one.
    isInternalNote: asBoolean(record["is_internal_note"], true),
    idempotencyKey: asNullableString(record["idempotency_key"]),
    attachmentDocumentId: asNullableString(record["attachment_document_id"]),
    deliveredAt: asNullableString(record["delivered_at"]),
    readAt: asNullableString(record["read_at"]),
    createdAt: asString(record["created_at"]),
  }
}

function mapNotification(row: unknown): NotificationRecord {
  const record = asRecord(row)
  return {
    id: asString(record["id"]),
    companyId: asNullableString(record["company_id"]),
    profileId: asString(record["profile_id"]),
    category: oneOf(record["category"], notificationCategories, "system"),
    severity: oneOf(record["severity"], notificationSeverities, "info"),
    title: asString(record["title"]),
    body: asNullableString(record["body"]),
    payload: asRecord(record["payload"]),
    link: asNullableString(record["link"]),
    locale: oneOf<Locale>(record["locale"], locales, "de"),
    isRead: asBoolean(record["is_read"], false),
    readAt: asNullableString(record["read_at"]),
    expiresAt: asNullableString(record["expires_at"]),
    createdAt: asString(record["created_at"]),
  }
}

// ---------------------------------------------------------------------------
// Scoping
// ---------------------------------------------------------------------------

type ThreadScope =
  /** Company-wide: `is_admin()` or `has_role_level(40)`. */
  | { kind: "company" }
  /** Narrowed to the identifiers the caller supplied. */
  | { kind: "participant" }
  /** No read path, or a participant who did not identify themselves. */
  | { kind: "none" }

function threadScopeFor(
  role: Role | undefined,
  opts: ThreadQueryOptions
): ThreadScope {
  // No role: no repository-side narrowing. RLS is still the boundary in
  // Supabase mode, and in seed mode there is no real conversation to leak.
  if (role === undefined) return { kind: "company" }
  if (!hasPermission(role, "communications:view")) return { kind: "none" }
  if (roleLevel[role] >= roleLevel.staff) return { kind: "company" }

  const identified =
    opts.profileId !== undefined ||
    opts.unitId !== undefined ||
    opts.residentId !== undefined
  return identified ? { kind: "participant" } : { kind: "none" }
}

/**
 * A `child_*` role is level 15 or below and, for messages, is treated exactly
 * like its guardian's non-staff role: no internal notes.
 *
 * Fails closed on an omitted role. Everywhere else in this repository layer an
 * omitted role means "RLS decides"; here RLS is documented **not** to decide,
 * so the absence of a role has to mean "assume the least privilege".
 */
function mayReadInternalNotes(role: Role | undefined): boolean {
  if (role === undefined) return false
  return roleLevel[role] >= roleLevel.staff
}

/**
 * PostgREST filter strings are a grammar and `,` `(` `)` `.` are its operators,
 * so anything interpolated into `.or()` is validated first — the same rule as
 * "no user input concatenated into SQL" (CONVENTIONS §4). `.eq()` and `.in()`
 * need no guard; the client encodes those.
 */
function isSafeFilterToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

/** ISO-8601 instants only. Used for the quoted timestamp inside `.or()`. */
function isSafeTimestampToken(value: string): boolean {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9:.+-]{1,20}Z?$/.test(value)
}

/** The participant `.or()` clauses, or `null` when an identifier is unusable. */
function participantOrClauses(opts: ThreadQueryOptions): string[] | null {
  const clauses: string[] = []

  const unitId = opts.unitId
  if (unitId !== undefined) {
    if (!isSafeFilterToken(unitId)) return null
    clauses.push(`unit_id.eq.${unitId}`)
  }

  const residentId = opts.residentId
  if (residentId !== undefined) {
    if (!isSafeFilterToken(residentId)) return null
    clauses.push(`resident_id.eq.${residentId}`)
  }

  const profileId = opts.profileId
  if (profileId !== undefined) {
    if (!isSafeFilterToken(profileId)) return null
    clauses.push(`created_by.eq.${profileId}`, `assigned_to.eq.${profileId}`)
  }

  return clauses.length === 0 ? null : clauses
}

/** The seed-mode twin of `participantOrClauses`. Same disjunction, no SQL. */
function matchesParticipantScope(
  thread: ThreadRecord,
  opts: ThreadQueryOptions
): boolean {
  if (opts.unitId !== undefined && thread.unitId === opts.unitId) return true
  if (opts.residentId !== undefined && thread.residentId === opts.residentId) {
    return true
  }
  if (opts.profileId !== undefined) {
    if (thread.createdBy === opts.profileId) return true
    if (thread.assignedTo === opts.profileId) return true
  }
  return false
}

function requestedStatuses(
  status: ThreadQueryOptions["status"]
): readonly ThreadStatus[] | null {
  if (status === undefined) return null
  return typeof status === "string" ? [status] : status
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

function filterSeedThreads(
  threads: readonly ThreadRecord[],
  opts: ThreadQueryOptions,
  scope: ThreadScope
): ThreadRecord[] {
  if (scope.kind === "none") return []

  const statuses = requestedStatuses(opts.status)
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)

  const matched = threads.filter((thread) => {
    if (scope.kind === "participant" && !matchesParticipantScope(thread, opts)) {
      return false
    }
    if (scope.kind === "company") {
      if (opts.unitId !== undefined && thread.unitId !== opts.unitId) return false
      if (opts.residentId !== undefined && thread.residentId !== opts.residentId) {
        return false
      }
    }
    if (opts.siteId !== undefined && thread.siteId !== opts.siteId) return false
    if (statuses !== null && !statuses.includes(thread.status)) return false
    if (opts.priority !== undefined && thread.priority !== opts.priority) return false
    if (opts.channel !== undefined && thread.channel !== opts.channel) return false
    if (opts.assignedTo !== undefined && thread.assignedTo !== opts.assignedTo) {
      return false
    }
    return true
  })

  // `last_message_at desc nulls last`, then `created_at desc` — the Supabase
  // ordering, so a seeded inbox and a live one read the same.
  matched.sort((a, b) => {
    if (a.lastMessageAt !== b.lastMessageAt) {
      if (a.lastMessageAt === null) return 1
      if (b.lastMessageAt === null) return -1
      return b.lastMessageAt.localeCompare(a.lastMessageAt)
    }
    return b.createdAt.localeCompare(a.createdAt)
  })

  return matched.slice(offset, offset + limit)
}

async function queryThreads(
  client: RepositoryClient,
  opts: ThreadQueryOptions,
  scope: ThreadScope
): Promise<ThreadRecord[]> {
  if (scope.kind === "none") return []

  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)

  let query = client.from("threads").select(THREAD_COLUMNS)

  if (scope.kind === "participant") {
    const clauses = participantOrClauses(opts)
    // An unusable identifier cannot match a real row, so it resolves to the
    // empty set rather than being interpolated into the filter grammar.
    if (clauses === null) return []
    query = query.or(clauses.join(","))
  } else {
    if (opts.unitId !== undefined) query = query.eq("unit_id", opts.unitId)
    if (opts.residentId !== undefined) {
      query = query.eq("resident_id", opts.residentId)
    }
  }

  if (opts.siteId !== undefined) query = query.eq("site_id", opts.siteId)
  if (opts.priority !== undefined) query = query.eq("priority", opts.priority)
  if (opts.channel !== undefined) query = query.eq("channel", opts.channel)
  if (opts.assignedTo !== undefined) query = query.eq("assigned_to", opts.assignedTo)

  const statuses = requestedStatuses(opts.status)
  if (statuses !== null) query = query.in("status", [...statuses])

  const rows = unwrap<unknown[]>(
    await query
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
    []
  )
  return rows.map(mapThread)
}

/**
 * Conversation threads, most recently active first. Bounded: default 50 rows,
 * ceiling 500.
 *
 * A caller below staff level that supplies none of `profileId` / `unitId` /
 * `residentId` gets an empty list plus a `degradedReason` naming the omission,
 * rather than a silently unscoped one.
 */
export async function getThreads(
  opts: ThreadQueryOptions = {}
): Promise<RepositoryResult<ThreadRecord[]>> {
  const scope = threadScopeFor(opts.role, opts)

  const result = await withRepository(
    (client) => queryThreads(client, opts, scope),
    () => filterSeedThreads(seedThreads(), opts, scope),
    "communications.threads"
  )

  const unidentifiedParticipant =
    scope.kind === "none" &&
    opts.role !== undefined &&
    hasPermission(opts.role, "communications:view") &&
    roleLevel[opts.role] < roleLevel.staff

  return unidentifiedParticipant ? degraded(result, NO_SCOPE_REASON) : result
}

/**
 * One thread by id, or `null` when it does not exist or the caller may not see
 * it. Visibility is `current_user_can_access_thread()`'s decision in Supabase
 * mode; in seed mode the participant predicate stands in, using whatever
 * identifiers the caller supplied.
 */
export async function getThread(
  id: string,
  opts: ThreadQueryOptions = {}
): Promise<RepositoryResult<ThreadRecord | null>> {
  const scope = threadScopeFor(opts.role, opts)

  return withRepository<ThreadRecord | null>(
    async (client) => {
      if (scope.kind === "none") return null
      const row = unwrap<unknown>(
        await client.from("threads").select(THREAD_COLUMNS).eq("id", id).maybeSingle(),
        null
      )
      return row === null ? null : mapThread(row)
    },
    () => {
      if (scope.kind === "none") return null
      const thread = seedThreads().find((candidate) => candidate.id === id)
      if (thread === undefined) return null
      if (scope.kind === "participant" && !matchesParticipantScope(thread, opts)) {
        return null
      }
      return thread
    },
    "communications.thread"
  )
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * A thread's messages in transcript order, oldest first.
 *
 * **Internal notes are dropped for every caller below staff level 40**, and for
 * a caller who supplies no role at all. RLS does not filter
 * `messages.is_internal_note` — migration 09 says so explicitly — so this filter
 * is not defence in depth, it is the only defence. Removing it exposes staff
 * annotations to the residents they are written about.
 *
 * Thread visibility itself is not re-derived here: `messages`' SELECT policy
 * already routes through `current_user_can_access_thread()`, and a second copy
 * of that predicate would drift out of step with the first.
 */
export async function getMessages(
  threadId: string,
  opts: MessageQueryOptions = {}
): Promise<RepositoryResult<MessageRecord[]>> {
  const withNotes = mayReadInternalNotes(opts.role)
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)

  return withRepository(
    async (client) => {
      let query = client
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("thread_id", threadId)

      if (!withNotes) query = query.eq("is_internal_note", false)

      const rows = unwrap<unknown[]>(
        await query
          .order("created_at", { ascending: true })
          .range(offset, offset + limit - 1),
        []
      )
      return rows.map(mapMessage)
    },
    () => {
      const matched = seedMessages().filter((message) => {
        if (message.threadId !== threadId) return false
        if (!withNotes && message.isInternalNote) return false
        return true
      })
      matched.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      return matched.slice(offset, offset + limit)
    },
    "communications.messages"
  )
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function notificationProfileIds(
  profileId: string,
  opts: NotificationQueryOptions
): string[] {
  const guardianProfileId = opts.guardianProfileId
  if (guardianProfileId === undefined || guardianProfileId === profileId) {
    return [profileId]
  }
  return [profileId, guardianProfileId]
}

function requestedCategories(
  category: NotificationQueryOptions["category"]
): readonly NotificationCategory[] | null {
  if (category === undefined) return null
  return typeof category === "string" ? [category] : category
}

function notificationIsLive(
  notification: NotificationRecord,
  asOf: string,
  includeExpired: boolean
): boolean {
  if (includeExpired) return true
  return notification.expiresAt === null || notification.expiresAt > asOf
}

/**
 * A profile's own notifications (plus its guardian's, when
 * `guardianProfileId` is supplied), newest first.
 *
 * There is no staff or manager read path through RLS: a notification is
 * addressed to one person. Support access goes through the service-role client,
 * where it is itself auditable — this repository never uses that client.
 *
 * Expired notifications are excluded unless `includeExpired` is set.
 *
 * Reads only. The only browser-writable columns on this table are `is_read` and
 * `read_at`; the mutation that sets them belongs to the write layer, not here.
 */
export async function getNotifications(
  profileId: string,
  opts: NotificationQueryOptions = {}
): Promise<RepositoryResult<NotificationRecord[]>> {
  const role = opts.role
  const permitted = role === undefined || hasPermission(role, "communications:view")
  const profileIds = notificationProfileIds(profileId, opts)
  const asOf = opts.asOf ?? nowIso()
  const includeExpired = opts.includeExpired === true
  const categories = requestedCategories(opts.category)
  const limit = clampLimit(opts.limit)
  const offset = clampOffset(opts.offset)

  return withRepository(
    async (client) => {
      if (!permitted) return []

      let query = client
        .from("notifications")
        .select(NOTIFICATION_COLUMNS)
        .in("profile_id", profileIds)

      if (opts.unreadOnly === true) query = query.eq("is_read", false)
      if (opts.severity !== undefined) query = query.eq("severity", opts.severity)
      if (categories !== null) query = query.in("category", [...categories])
      if (!includeExpired) {
        // The timestamp is quoted and validated: `.` is a PostgREST operator
        // separator, and an ISO instant is full of them. An `asOf` that does not
        // parse is dropped rather than interpolated, so the filter widens to
        // "all notifications" instead of becoming a filter-injection vector.
        if (isSafeTimestampToken(asOf)) {
          query = query.or(`expires_at.is.null,expires_at.gt."${asOf}"`)
        }
      }

      const rows = unwrap<unknown[]>(
        await query
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1),
        []
      )
      return rows.map(mapNotification)
    },
    () => {
      if (!permitted) return []

      const matched = seedNotifications().filter((notification) => {
        if (!profileIds.includes(notification.profileId)) return false
        if (opts.unreadOnly === true && notification.isRead) return false
        if (opts.severity !== undefined && notification.severity !== opts.severity) {
          return false
        }
        if (categories !== null && !categories.includes(notification.category)) {
          return false
        }
        return notificationIsLive(notification, asOf, includeExpired)
      })

      matched.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return matched.slice(offset, offset + limit)
    },
    "communications.notifications"
  )
}

/**
 * The unread badge. Counted in Postgres with `head: true`, so no rows cross the
 * wire — a badge must never pull an inbox.
 *
 * Expired notifications do not count: a badge that survives its own notification
 * is a bug users report as "the number never goes down".
 */
export async function getUnreadNotificationCount(
  profileId: string,
  opts: NotificationQueryOptions = {}
): Promise<RepositoryResult<number>> {
  const role = opts.role
  const permitted = role === undefined || hasPermission(role, "communications:view")
  const profileIds = notificationProfileIds(profileId, opts)
  const asOf = opts.asOf ?? nowIso()
  const includeExpired = opts.includeExpired === true

  return withRepository(
    async (client) => {
      if (!permitted) return 0

      let query = client
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .in("profile_id", profileIds)
        .eq("is_read", false)

      if (!includeExpired && isSafeTimestampToken(asOf)) {
        query = query.or(`expires_at.is.null,expires_at.gt."${asOf}"`)
      }

      const response = await query
      if (response.error !== null) throw response.error
      // `count` is null only when the request did not ask for one, and this one
      // does. This is a row count, not a money value — the "never `?? 0`" rule
      // is about amounts, where 0 and null are different facts.
      return typeof response.count === "number" ? response.count : 0
    },
    () =>
      seedNotifications().filter((notification) => {
        if (!profileIds.includes(notification.profileId)) return false
        if (notification.isRead) return false
        return notificationIsLive(notification, asOf, includeExpired)
      }).length,
    "communications.unreadCount"
  )
}
