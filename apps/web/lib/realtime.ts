/**
 * Realtime — the decidable parts, as pure functions.
 *
 * The hooks in `apps/web/hooks/` are thin React wrappers around this module.
 * Everything that can be decided without a DOM lives here: mode resolution,
 * reconnect backoff, update coalescing, and the table list. That split is what
 * makes `scripts/realtime-probe.mts` able to prove the brief's numbered
 * requirements in plain Node — a hook tested only by reading it is not tested.
 *
 * ## The honesty requirement outranks the liveness requirement
 *
 * A dashboard that silently stopped updating is worse than one that says
 * "polling, last updated 30 s ago". So `resolveLiveMode` is total, has no
 * "probably fine" branch, and degrades in one direction only: towards saying
 * less about how live the data is, never more.
 *
 * ## A realtime payload is an invalidation signal, never data
 *
 * Nothing in this module or its hooks reads a payload's contents into state. A
 * change event means "refetch"; the refetch goes through the repository, which
 * goes through RLS. Rendering a pushed row directly would bypass the one place
 * that decides whether this user may see it, and would also replay a buffered
 * queue into the UI after a reconnect — showing a sequence of intermediate
 * states that never existed as a whole.
 */

import { publicEnv } from "./env"

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

/** What the user is actually getting. The badge renders this verbatim. */
export type LiveMode = "realtime" | "polling" | "static" | "offline"

/** The channel's own view of itself, mapped from Supabase's subscribe status. */
export type RealtimeStatus =
  | "idle"
  | "subscribing"
  | "subscribed"
  | "error"
  | "closed"

export interface LiveModeInput {
  online: boolean
  supabaseConfigured: boolean
  realtimeStatus: RealtimeStatus
  /** The last `RepositoryResult.source`. `null` before the first fetch. */
  source: "supabase" | "local-seed" | null
}

/**
 * Resolves the mode. Total, and ordered so the most degraded truth wins.
 *
 * 1. **offline** — the browser says there is no network. Nothing else can be
 *    true at the same time, so this is checked first.
 * 2. **static** — Supabase is unconfigured, *or* the last fetch came back
 *    `local-seed`. Seed data does not change, so polling it is pointless churn;
 *    the badge says "Demo-Daten" and no timer runs.
 * 3. **realtime** — a healthy subscription.
 * 4. **polling** — everything else, including `subscribing`. A channel that has
 *    not finished subscribing is not delivering updates, and claiming "Live"
 *    while nothing arrives is exactly the silent-stall failure this exists to
 *    prevent.
 */
export function resolveLiveMode(input: LiveModeInput): LiveMode {
  if (!input.online) return "offline"
  if (!input.supabaseConfigured || input.source === "local-seed") return "static"
  if (input.realtimeStatus === "subscribed") return "realtime"
  return "polling"
}

/** `static` has nothing to poll; `offline` has nowhere to poll. */
export function shouldPoll(mode: LiveMode): boolean {
  return mode === "polling"
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * The tables W1-A registered with the `supabase_realtime` publication
 * (migration 12), verbatim and in the same order.
 *
 * Deliberately short. Realtime does not bypass RLS — a subscriber receives only
 * rows its policies already allow it to SELECT — but publishing a table means a
 * policy bug leaks *continuously* rather than on request. Finance, documents,
 * audit and access events are **not** published, and nothing here should add
 * them: no live dashboard needs them pushed, and they are the tables where a
 * mistake costs the most.
 *
 * If this list and migration 12 ever disagree, migration 12 is right — a channel
 * subscribed to an unpublished table simply never fires, which looks exactly
 * like a broken feature.
 */
export const REALTIME_TABLES = [
  "units",
  "service_tickets",
  "ticket_events",
  "workforce_tasks",
  "media_reports",
  "activities",
  "threads",
  "messages",
  "notifications",
  "ai_action_logs",
] as const

export type RealtimeTable = (typeof REALTIME_TABLES)[number]

export interface RealtimeChannelConfig {
  table: RealtimeTable
  /** PostgREST filter, e.g. `"company_id=eq.<uuid>"`. Narrowing only. */
  filter?: string
}

export function isRealtimeTable(value: string): value is RealtimeTable {
  return (REALTIME_TABLES as readonly string[]).includes(value)
}

/**
 * Whether a realtime subscription is worth attempting at all.
 *
 * Public-only, so it is safe in the browser. A `false` here is not an error
 * state — it is the supported seed-fallback mode, and the badge says so.
 */
export function isRealtimeConfigured(): boolean {
  return (
    publicEnv.NEXT_PUBLIC_SUPABASE_URL !== undefined &&
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY !== undefined
  )
}

// ---------------------------------------------------------------------------
// Reconnect backoff
// ---------------------------------------------------------------------------

/** First retry waits this long. */
export const BACKOFF_BASE_MS = 1_000
/** No retry ever waits longer than this. */
export const BACKOFF_CAP_MS = 30_000
/** Jitter as a fraction of the computed delay. */
const BACKOFF_JITTER = 0.25

/**
 * Exponential backoff with jitter, capped.
 *
 * `random` is injected so the sequence is testable; production passes
 * `Math.random`. Jitter is not decoration: without it, every client that lost
 * the same socket reconnects at the same instant and the thundering herd is
 * what keeps the endpoint down.
 *
 * `attempt` is zero-based. Returns 1s, 2s, 4s, 8s, 16s, 30s, 30s, … before
 * jitter, so the cap is reached on the sixth attempt and never exceeded.
 */
export function nextBackoffDelay(attempt: number, random: () => number = Math.random): number {
  const exponential = BACKOFF_BASE_MS * 2 ** Math.max(0, attempt)
  const capped = Math.min(exponential, BACKOFF_CAP_MS)
  const jitter = capped * BACKOFF_JITTER * (random() * 2 - 1)
  // Never negative, and never above the cap even with maximum positive jitter.
  return Math.max(0, Math.min(BACKOFF_CAP_MS, Math.round(capped + jitter)))
}

/** The un-jittered sequence, for documentation and for the probe. */
export function backoffSequence(attempts: number): number[] {
  return Array.from({ length: attempts }, (_, index) =>
    Math.min(BACKOFF_BASE_MS * 2 ** index, BACKOFF_CAP_MS)
  )
}

// ---------------------------------------------------------------------------
// Coalescing
// ---------------------------------------------------------------------------

/** Bursts shorter than this collapse into a single refetch. */
export const COALESCE_WINDOW_MS = 400

export interface Coalescer {
  /** Signal that something changed. Cheap; call once per event. */
  signal: () => void
  /** Run now if anything is pending, and clear the timer. */
  flush: () => void
  /** Drop anything pending. Called on unmount. */
  cancel: () => void
  /** How many signals arrived since the last run. Diagnostics only. */
  pending: () => number
}

/**
 * Collapses a burst of change events into one call.
 *
 * A bulk import touching 40 units emits 40 postgres_changes events in a few
 * milliseconds. Refetching 40 times is 40 round trips to produce one visible
 * change, and on a slow connection the last response can arrive before an
 * earlier one and write stale data over fresh.
 *
 * Trailing-edge only: the run happens at the *end* of the quiet window, so the
 * single refetch sees the final state rather than the first event's state.
 * `timers` is injected so the probe can drive it deterministically.
 */
export function createCoalescer(
  run: () => void,
  waitMs: number = COALESCE_WINDOW_MS,
  timers: {
    set: (fn: () => void, ms: number) => number
    clear: (handle: number) => void
  } = {
    set: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clear: (handle) => clearTimeout(handle),
  }
): Coalescer {
  let handle: number | null = null
  let pending = 0

  const fire = (): void => {
    handle = null
    if (pending === 0) return
    pending = 0
    run()
  }

  return {
    signal: () => {
      pending += 1
      if (handle !== null) timers.clear(handle)
      handle = timers.set(fire, waitMs)
    },
    flush: () => {
      if (handle !== null) {
        timers.clear(handle)
        handle = null
      }
      if (pending === 0) return
      pending = 0
      run()
    },
    cancel: () => {
      if (handle !== null) timers.clear(handle)
      handle = null
      pending = 0
    },
    pending: () => pending,
  }
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

/** Data older than this many poll intervals is shown as stale. */
const STALE_INTERVALS = 2

/**
 * Whether the displayed data should be marked stale.
 *
 * `lastUpdated` is the server's `fetchedAt` from `RepositoryResult`, not a
 * client clock reading — CONVENTIONS §5 calls out clock skew, and a laptop whose
 * clock is eleven minutes fast would otherwise report every fresh response as
 * stale. The *comparison* still needs a local now, so skew is not eliminated,
 * only reduced to the size of the drift rather than being able to invert the
 * result.
 */
export function isStale(
  lastUpdated: string | null,
  pollIntervalMs: number,
  now: number = Date.now()
): boolean {
  if (lastUpdated === null) return false
  const at = Date.parse(lastUpdated)
  if (Number.isNaN(at)) return true
  return now - at > pollIntervalMs * STALE_INTERVALS
}

/**
 * "vor 12 s" / "12 s ago". Locale-agnostic units, so this needs no message
 * catalogue and cannot drift from W1-C's translations.
 */
export function relativeAge(
  lastUpdated: string | null,
  now: number = Date.now()
): string | null {
  if (lastUpdated === null) return null
  const at = Date.parse(lastUpdated)
  if (Number.isNaN(at)) return null
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.round(minutes / 60)} h`
}
