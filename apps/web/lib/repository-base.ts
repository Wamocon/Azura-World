/**
 * # Repository base — the two rules that define the whole data layer
 *
 * Owned by **W2-A**. Every repository in `lib/*-repository.ts` goes through
 * `withRepository()`; nothing calls Supabase directly.
 *
 * ## 1. Every function returns `RepositoryResult<T>` with a `source`
 *
 * CONTRACTS §4. It is how the app demos without a database, and it is the first
 * thing to check when debugging a data problem — `source` before Postgres.
 *
 * ## 2. Unconfigured falls back and labels itself. Configured-but-failing THROWS.
 *
 * Collapsing those two cases is the bug this file exists to prevent: a
 * production outage disguised as plausible seed data. CONVENTIONS §2 states it
 * directly, and the distinction is load-bearing rather than stylistic.
 *
 * ## 3. Empty is not failure
 *
 * A configured Supabase returning zero rows is `source: "supabase"` with empty
 * data. Substituting seed data there is how a demo lies about what is in the
 * database. `withRepository` cannot make that mistake because it never inspects
 * the shape of a successful result.
 */

import type { PostgrestError } from "@supabase/supabase-js"

import type { ApiError, RepositoryResult } from "@/lib/contracts"
import { isSupabaseConfigured } from "@/lib/env"
import type { ServerSupabaseClient } from "@/lib/supabase/server"

/**
 * The Supabase server client is imported LAZILY, and that is deliberate.
 *
 * `@/lib/supabase/server` imports `next/headers`, which only exists inside a
 * Next request context. A static import here would put `next/headers` in the
 * module graph of every repository, and therefore of every unit test that
 * imports one — making the whole layer untestable outside a running server.
 *
 * Deferring it to the moment a configured Supabase is actually needed keeps the
 * production path byte-for-byte identical (the import is cached after the first
 * call) while leaving the module importable on its own.
 */
async function defaultGetClient(): Promise<ServerSupabaseClient | null> {
  const { createClient } = await import("@/lib/supabase/server")
  return createClient()
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * The single clock. Repositories never call `new Date()` inline: seed builders
 * must be deterministic (W2-A brief), and one funnel makes that checkable.
 */
export function nowIso(): string {
  return new Date().toISOString()
}

/**
 * The fixed instant every seed timestamp is derived from. Seeds must render
 * identically on every run or Playwright snapshots become useless, so no seed
 * value may depend on the wall clock.
 */
export const SEED_ANCHOR_ISO = "2026-07-27T09:00:00.000Z"

/** Deterministic seed timestamp: `SEED_ANCHOR_ISO` shifted by whole days. */
export function seedIso(dayOffset: number, hour = 9): string {
  const anchor = new Date(SEED_ANCHOR_ISO)
  anchor.setUTCDate(anchor.getUTCDate() + dayOffset)
  anchor.setUTCHours(hour, 0, 0, 0)
  return anchor.toISOString()
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A repository failure carrying the `ApiError` a route handler should return.
 *
 * The raw Postgres detail stays on `cause` and is logged server-side only —
 * CONVENTIONS §4.7: an exception message that reaches the client leaks schema
 * internals, and a Postgres error text names tables, columns and constraints.
 */
export class RepositoryError extends Error {
  readonly apiError: ApiError

  constructor(apiError: ApiError, cause?: unknown) {
    super(apiError.message)
    this.name = "RepositoryError"
    this.apiError = apiError
    if (cause !== undefined) this.cause = cause
  }
}

function isPostgrestError(value: unknown): value is PostgrestError {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    "code" in value
  )
}

/**
 * Map a Postgres/PostgREST failure onto the frozen `ApiError` union.
 *
 * Every message here is written for a user. None of them interpolates the
 * database's own text.
 */
export function toApiError(error: unknown, label: string): ApiError {
  const code = isPostgrestError(error) ? String(error.code ?? "") : ""

  switch (code) {
    // insufficient_privilege — RLS refused the row. "Forbidden" is honest and
    // says nothing about whether the row exists.
    case "42501":
      return {
        code: "forbidden",
        message: "You do not have access to this data.",
        retryable: false,
      }
    // unique_violation
    case "23505":
      return {
        code: "conflict",
        message: "That record already exists.",
        retryable: false,
      }
    // foreign_key_violation / check_violation / not_null_violation — the request
    // asked for something the schema forbids, which is a validation failure and
    // never a 500.
    case "23503":
    case "23502":
    case "23514":
      return {
        code: "validation_failed",
        message: "The request did not satisfy a data rule.",
        retryable: false,
      }
    // invalid_parameter_value. `search_operational_records()` raises it for a query over
    // its 120-character ceiling, and a plpgsql RPC that validates its own input is the
    // normal way to hit it. Without this case it fell through to persistence_unavailable
    // (503) — telling the caller the service is broken and the request is worth retrying,
    // when in fact the input was too long and retrying it unchanged will fail forever.
    case "22023":
      return {
        code: "validation_failed",
        message: "The request did not satisfy a data rule.",
        retryable: false,
      }
    // PGRST116 — .single() matched no rows.
    case "PGRST116":
      return {
        code: "not_found",
        message: "That record was not found.",
        retryable: false,
      }
    // serialization_failure / deadlock_detected — genuinely worth retrying.
    case "40001":
    case "40P01":
      return {
        code: "conflict",
        message:
          "The record changed while you were editing it. Reload and try again.",
        retryable: true,
      }
    // undefined_table / undefined_column: the schema is behind the code. This is
    // an outage of the persistence layer, not a client mistake.
    case "42P01":
    case "42703":
      return {
        code: "persistence_unavailable",
        message: "The data service is temporarily unavailable.",
        retryable: true,
      }
    default:
      return {
        code: "persistence_unavailable",
        message: "The data service is temporarily unavailable.",
        details: { source: label },
        retryable: true,
      }
  }
}

/**
 * Server-side logging of the real failure. Logs the shape and a request label —
 * never a full row, a request body or any PII (CONVENTIONS §4).
 */
function logRepositoryFailure(label: string, error: unknown): void {
  const detail = isPostgrestError(error)
    ? { code: error.code, message: error.message, hint: error.hint }
    : { message: error instanceof Error ? error.message : "unknown" }
  console.error(`[repository:${label}]`, detail)
}

// ---------------------------------------------------------------------------
// The wrapper
// ---------------------------------------------------------------------------

export type RepositoryClient = ServerSupabaseClient

/**
 * Run `fn` against Supabase, or fall back to `fallback()` when Supabase is not
 * configured at all.
 *
 * - unconfigured → `{ data: fallback(), source: "local-seed", degradedReason }`
 * - configured + succeeds → `{ data, source: "supabase" }`
 * - configured + fails → **throws** `RepositoryError`. It does NOT fall back.
 * - configured + empty → `source: "supabase"` with whatever `fn` returned.
 *   An empty table is a fact about the database, not a failure.
 */
export async function withRepository<T>(
  fn: (client: RepositoryClient) => Promise<T>,
  fallback: () => T,
  label: string
): Promise<RepositoryResult<T>> {
  return runRepository(fn, fallback, label, {
    isConfigured: isSupabaseConfigured,
    getClient: defaultGetClient,
  })
}

/**
 * The body of `withRepository` with its two environment dependencies injected.
 *
 * This exists so the four behaviours above can be tested without mocking a module
 * or standing up a database — in particular "configured but failing THROWS" and
 * "configured but empty does NOT fall back", which the W2-A brief calls the two
 * that catch real bugs. `withRepository` is the production entry point and the
 * only one repositories use; nothing outside the test suite should call this.
 */
export interface RepositoryDeps {
  isConfigured: () => boolean
  getClient: () => Promise<RepositoryClient | null>
}

export async function runRepository<T>(
  fn: (client: RepositoryClient) => Promise<T>,
  fallback: () => T,
  label: string,
  deps: RepositoryDeps
): Promise<RepositoryResult<T>> {
  if (!deps.isConfigured()) {
    return {
      data: fallback(),
      source: "local-seed",
      degradedReason: "Supabase is not configured; serving local seed data.",
      fetchedAt: nowIso(),
    }
  }

  const client = await deps.getClient()
  if (client === null) {
    // Configured by env but the client could not be constructed. Treated as a
    // real outage, not a fallback: the operator asked for Supabase and did not
    // get it, and hiding that behind seed data is the failure mode this whole
    // module is built to avoid.
    const apiError: ApiError = {
      code: "persistence_unavailable",
      message: "The data service is temporarily unavailable.",
      details: { source: label },
      retryable: true,
    }
    logRepositoryFailure(
      label,
      new Error("Supabase client could not be created")
    )
    throw new RepositoryError(apiError)
  }

  try {
    const data = await fn(client)
    return { data, source: "supabase", fetchedAt: nowIso() }
  } catch (error) {
    if (error instanceof RepositoryError) throw error
    logRepositoryFailure(label, error)
    throw new RepositoryError(toApiError(error, label), error)
  }
}

/**
 * Unwrap a PostgREST response, throwing on error so `withRepository` can map it.
 * `data` is `T | null` on the wire; a null payload with no error is an empty
 * result, so callers pass the empty value they want in that case.
 */
export function unwrap<T>(
  response: { data: T | null; error: PostgrestError | null },
  whenNull: T
): T {
  if (response.error) throw response.error
  return response.data ?? whenNull
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 500

/**
 * Clamp a caller-supplied limit. W2-A brief: never `select()` unbounded —
 * default 50, hard ceiling 500. 656 units in one response is a payload bug even
 * when the query is fast.
 */
export function clampLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE)
}

export function clampOffset(offset?: number): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0
  return Math.max(Math.trunc(offset), 0)
}

// ---------------------------------------------------------------------------
// Coercion
//
// PostgREST returns `numeric` as a STRING: `numeric(14,2)` arrives as
// "112000.00". Assuming it is already a number produces NaN downstream, and
// `Number(null)` is 0 — which would turn an honest gap into a price of zero.
// CONVENTIONS §5: "a price of 0 is a bug; a price of null is an honest gap.
// Never coerce."
// ---------------------------------------------------------------------------

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

export function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback
}

/**
 * Parse a numeric column. Returns `null` for NULL, for a non-numeric string and
 * for a missing key — never 0. A caller that wants a default must say so.
 */
export function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function asNumber(value: unknown, fallback = 0): number {
  return asNullableNumber(value) ?? fallback
}

/**
 * Build a `Money` from an amount/currency column pair, or `null` when either
 * side is absent. Never invents a currency: an amount without one is exactly
 * the Housearch-quotes-USD bug CONVENTIONS §5 warns about, and defaulting to
 * EUR would bury it.
 */
export function asMoney(
  amount: unknown,
  currency: unknown
): { amount: number; currency: "EUR" | "USD" | "TRY" | "GBP" } | null {
  const parsed = asNullableNumber(amount)
  const code = asNullableString(currency)
  if (parsed === null || code === null) return null
  if (code !== "EUR" && code !== "USD" && code !== "TRY" && code !== "GBP")
    return null
  return { amount: parsed, currency: code }
}

/**
 * Unwrap a PostgREST embedded relation, which arrives as an object for a
 * to-one join and as a one-element array for a to-many.
 */
export function relatedRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return asRecord(value[0])
  return asRecord(value)
}

/**
 * Per-currency totals. CONVENTIONS §5 forbids aggregating across currencies —
 * `sum(EUR) + sum(USD)` is meaningless, so the UI gets one total per currency
 * and decides how to present them.
 */
export function totalsByCurrency(
  rows: ReadonlyArray<{ amount: number; currency: string }>
): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const row of rows) {
    totals[row.currency] = (totals[row.currency] ?? 0) + row.amount
  }
  return totals
}

// ---------------------------------------------------------------------------
// Degraded results
// ---------------------------------------------------------------------------

/**
 * Attach a `degradedReason` to an otherwise successful result.
 *
 * The partial-failure case from the W2-A brief: four of five dashboard panels
 * loaded, so return what succeeded and NAME what did not, rather than failing
 * the whole dashboard for one panel.
 *
 * `exactOptionalPropertyTypes` is on, so the key is spread in conditionally —
 * `degradedReason: undefined` is not assignable to `degradedReason?: string`.
 */
export function degraded<T>(
  result: RepositoryResult<T>,
  reason: string
): RepositoryResult<T> {
  const existing = result.degradedReason
  return {
    ...result,
    degradedReason: existing ? `${existing} ${reason}` : reason,
  }
}

/** A `local-seed` result built without touching Supabase. */
export function seedResult<T>(
  data: T,
  degradedReason?: string
): RepositoryResult<T> {
  return {
    data,
    source: "local-seed",
    fetchedAt: nowIso(),
    ...(degradedReason === undefined ? {} : { degradedReason }),
  }
}
