import "server-only"

import type { ApiError } from "@/lib/contracts"

import { logDeniedFinanceAccess, type FinanceSurface } from "./finance-scope"

/** The frozen union from CONTRACTS §5, via the interface rather than a copy. */
type ApiErrorCode = ApiError["code"]

/**
 * Repository reads that cannot 500 the page.                    Owner: F5
 *
 * ## The defect this exists to close
 *
 * Every finance surface gates the caller with `resolveFinanceScope()` and then
 * calls a repository. The gate is correct — `scripts/finance-gate-parity.mts`
 * asserts all 50 cells of it against `HANDOFF/W1-B.md` — but the call after it
 * was unguarded, and `withRepository()` **throws** when Supabase is configured
 * and the query fails. A thrown `RepositoryError` in a Server Component reaches
 * the error boundary, and the reader gets an application error where the product
 * should be saying "you may not read this".
 *
 * Reproduced on this branch before the fix, admin, `/de/dashboard/wallet`:
 *
 * ```
 * [repository:finance.getPaymentTransactions] {
 *   code: '42501',
 *   message: 'permission denied for table payment_transactions',
 *   hint: 'Grant the required privileges … TO anon;'
 * }
 * ⨯ Error [RepositoryError]: You do not have access to this data.
 *     at async o (.next/server/app/[locale]/dashboard/wallet/page.js)
 * -> HTTP 500
 * ```
 *
 * **CONTRACTS §5: never 500 for a handled condition.** A refusal is the most
 * handled condition there is — the page already imports the panel that renders
 * it. W4-C rates a reachable 500 a High finding, and it is reachable.
 *
 * ## What this does NOT do
 *
 * It does not widen anything. `hasPermission()` still decides who reaches a
 * repository at all, and RLS still decides which rows come back. This only
 * changes what the page does with a refusal it has already received: render it,
 * instead of throwing it at the framework.
 *
 * It also does not swallow the signal. **A refusal that arrives here is a
 * disagreement between RBAC and the database** — the page admitted a caller the
 * data plane then refused — and that is worth knowing about, so it is logged
 * through the same structured channel as a deep-link denial rather than
 * disappearing into a rendered panel.
 *
 * ## Why `forbidden` and `unavailable` are kept apart
 *
 * They need different pages. `forbidden` is an answer: this caller may not read
 * this, and no retry helps. `unavailable` is an outage: the data exists, the
 * caller may see it, and coming back later is the correct advice. Collapsing
 * them into one "something went wrong" is how an outage gets reported as a
 * permissions bug for three days.
 */

export type FinanceRead<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "forbidden" | "unavailable"; code: ApiErrorCode | null }

/**
 * The `ApiError.code` values that mean "this caller may not read this",
 * as opposed to "this is broken".
 *
 * `forbidden` is PostgREST `42501` after `lib/repository-base.ts` maps it.
 * `unauthorized` arrives when a session expired between the gate and the query,
 * which is a refusal from the reader's point of view even though the cause
 * differs.
 */
const REFUSAL_CODES = ["forbidden", "unauthorized"] as const

/**
 * Every member of the frozen union, so a code added to CONTRACTS §5 without a
 * decision here is a compile error rather than a silent "unavailable".
 */
const API_ERROR_CODES: Readonly<Record<ApiErrorCode, true>> = {
  unauthorized: true,
  forbidden: true,
  not_found: true,
  validation_failed: true,
  rate_limited: true,
  conflict: true,
  persistence_unavailable: true,
  upstream_failed: true,
}

function errorCodeOf(error: unknown): ApiErrorCode | null {
  if (typeof error !== "object" || error === null) return null
  const apiError = (error as { apiError?: unknown }).apiError
  if (typeof apiError !== "object" || apiError === null) return null
  const code = (apiError as { code?: unknown }).code
  if (typeof code !== "string") return null
  return Object.prototype.hasOwnProperty.call(API_ERROR_CODES, code)
    ? (code as ApiErrorCode)
    : null
}

function isRefusal(code: ApiErrorCode | null): boolean {
  return code !== null && (REFUSAL_CODES as readonly string[]).includes(code)
}

/**
 * Runs one repository read and classifies its failure instead of propagating it.
 *
 * `surface`, `role` and `profileId` are required rather than optional because
 * the log line is the whole point of catching here: a refusal with no idea which
 * screen or which role produced it is not actionable.
 */
export async function readFinance<T>(
  run: () => Promise<T>,
  context: {
    surface: FinanceSurface
    role: Parameters<typeof logDeniedFinanceAccess>[0]["role"]
    profileId: string | null
    /** What was being read, e.g. "wallets" — becomes the log's `target`. */
    target: string
  }
): Promise<FinanceRead<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    const code = errorCodeOf(error)

    if (isRefusal(code)) {
      // The page's RBAC gate said yes and the data plane said no. That is a real
      // divergence and it is logged as one, not silently rendered away.
      logDeniedFinanceAccess({
        surface: context.surface,
        role: context.role,
        profileId: context.profileId,
        target: context.target,
        reason: "forbidden_role",
      })
      return { ok: false, kind: "forbidden", code }
    }

    // Not a refusal: an outage, a timeout, a schema drift. Still not a 500 for
    // the reader, but it must reach the server log intact — swallowing the
    // cause here would make the next one undiagnosable.
    console.error("[azura.finance.read_failed]", {
      surface: context.surface,
      role: context.role,
      target: context.target,
      code,
      error,
    })
    return { ok: false, kind: "unavailable", code }
  }
}

/**
 * True when any read in the set was refused.
 *
 * A page fetches several things at once. If one of them is refused the page
 * cannot honestly render a partial screen labelled as complete — a wallet page
 * showing balances but silently dropping the movements it was refused is a
 * screen that lies by omission. So the surface refuses as a whole, and the log
 * records which read caused it.
 */
export function anyRefused(
  reads: ReadonlyArray<FinanceRead<unknown>>
): boolean {
  return reads.some((read) => !read.ok && read.kind === "forbidden")
}

/** True when any read failed for a reason that is not a refusal. */
export function anyUnavailable(
  reads: ReadonlyArray<FinanceRead<unknown>>
): boolean {
  return reads.some((read) => !read.ok && read.kind === "unavailable")
}

/** The value, or a caller-supplied empty stand-in. Never a fabricated row. */
export function valueOr<T>(read: FinanceRead<T>, fallback: T): T {
  return read.ok ? read.value : fallback
}
