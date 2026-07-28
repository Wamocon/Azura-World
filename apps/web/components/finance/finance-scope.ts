import "server-only"

import { getUserProfile } from "@/lib/auth"
import type { Permission, Role } from "@/lib/contracts"
import { canViewInternalFinance, hasPermission } from "@/lib/rbac"
import type { FinanceAccess } from "@/lib/finance-repository"
import { seedUnitIdsForProfile } from "@/lib/finance-repository"
import { isSupabaseConfigured } from "@/lib/env"

/**
 * Who is asking, and what they may see.                        Owner: W3-D
 *
 * `server-only` at the top is not decoration. This module reaches
 * `lib/auth.ts`, which reaches `lib/supabase/server.ts`, which can construct a
 * service-role client. An accidental import from a `"use client"` component
 * would be a build error here rather than a service key in the browser bundle
 * (SYSTEM-PROMPT §2.7).
 *
 * ## Two boundaries, and neither is the sidebar
 *
 * The nav hides what a role cannot use. That is a courtesy. The boundaries are
 * RLS in the database and this module in the request path, and W3-C measured
 * exactly why the second one is needed: a client guard decides *after* the
 * Server Component has already rendered, so a `tenant` received real evidence
 * data in the RSC flight payload while the visible page showed a correct 403.
 *
 * So every finance page calls `resolveFinanceScope()` **before its first
 * repository call**, and returns the refusal without fetching. Nothing is read
 * for a caller who may not see it.
 *
 * ## `finance:view` is not the internal ledger
 *
 * `owner` holds `finance:view` for its own statement. `canViewInternalFinance()`
 * (admin · manager · accountant) is the separate gate on the company books,
 * and `lib/rbac.ts` says so in as many words. Conflating the two is how an
 * owner ends up reading the whole site's ledger, so the distinction is carried
 * in the returned scope rather than re-derived per page.
 */

export type FinanceSurface = "finance" | "wallet" | "vendor_invoices"

const VIEW_PERMISSION: Readonly<Record<FinanceSurface, Permission>> = {
  finance: "finance:view",
  wallet: "wallet:view",
  vendor_invoices: "vendor_invoices:view",
}

const ROUTE_PATH: Readonly<Record<FinanceSurface, string>> = {
  finance: "/dashboard/finance",
  wallet: "/dashboard/wallet",
  vendor_invoices: "/dashboard/vendor-invoices",
}

export interface FinanceScopeDenied {
  allowed: false
  /** `unauthenticated` needs a sign-in prompt; `forbidden` needs a 403 panel. */
  reason: "unauthenticated" | "forbidden"
  role: Role
}

export interface FinanceScopeAllowed {
  allowed: true
  role: Role
  profileId: string | null
  /** admin · manager · accountant. The company books, not one statement. */
  internal: boolean
  /** What to pass to every `lib/finance-repository.ts` call. Never widened. */
  access: FinanceAccess
  /** Unit ids this caller holds. Empty for a company-wide reader by design. */
  scopedUnitIds: readonly string[]
  can: (permission: Permission) => boolean
  /** Reads may serve seed; writes may not. Drives the demo badge. */
  supabaseConfigured: boolean
}

export type FinanceScope = FinanceScopeAllowed | FinanceScopeDenied

/**
 * Resolves the caller against one finance surface.
 *
 * **Fails closed twice over.** An unauthenticated visitor resolves to `guest`
 * in `lib/auth.ts`, and `guest` holds none of the three view permissions, so
 * the permission check alone would already refuse. The explicit
 * `profile.authenticated` test is kept anyway because "signed out" and "signed
 * in with a role that cannot see this" are different answers that need
 * different pages, and collapsing them loses the one the user can act on.
 */
export async function resolveFinanceScope(
  surface: FinanceSurface
): Promise<FinanceScope> {
  const profile = await getUserProfile()

  if (!profile.authenticated) {
    return { allowed: false, reason: "unauthenticated", role: profile.role }
  }
  if (!hasPermission(profile.role, VIEW_PERMISSION[surface])) {
    return { allowed: false, reason: "forbidden", role: profile.role }
  }

  const profileId = profile.id ?? null
  const internal = canViewInternalFinance(profile.role)

  // The repository resolves units itself in Supabase mode (one query through
  // `unit_residents`), so `unitIds` is deliberately NOT pre-filled there:
  // passing a caller-supplied list is trusted input, and the repository's own
  // header warns that it widens the seed path. The seed list is resolved here
  // only so the page can render a scope explanation before it fetches.
  const scopedUnitIds = internal ? [] : seedUnitIdsForProfile(profileId)

  return {
    allowed: true,
    role: profile.role,
    profileId,
    internal,
    access: {
      role: profile.role,
      ...(profileId === null ? {} : { profileId }),
    },
    scopedUnitIds,
    can: (permission) => hasPermission(profile.role, permission),
    supabaseConfigured: isSupabaseConfigured(),
  }
}

/** The locale-less path of a surface, for links and for the denial log. */
export function financeRoutePath(surface: FinanceSurface): string {
  return ROUTE_PATH[surface]
}

// ---------------------------------------------------------------------------
// Denial logging
// ---------------------------------------------------------------------------

export interface DeniedFinanceAccess {
  surface: FinanceSurface
  role: Role
  profileId: string | null
  /** What was asked for: a unit id, an invoice id, a profile id. */
  target: string
  reason: "out_of_scope" | "forbidden_role" | "unauthenticated"
}

/**
 * Records an attempt to reach a finance record outside the caller's scope.
 *
 * The brief calls the case out by name: *"`owner` deep-links to another owner's
 * statement → 403, and it is logged as an access event."*
 *
 * **What this actually does today, stated plainly rather than implied.** There
 * is an `access_events` table (migration 08) and `getAccessEvents()` reads it,
 * but there is **no write path**: migration 07 and 13 revoke INSERT from
 * `authenticated` on the append-only ledgers, the table is expected to be
 * written by a service-role RPC, and that RPC does not exist
 * (`HANDOFF/W2-A.md`, "Requests for other windows"). Writing one from a request
 * path would need a service-role client, which would bypass RLS from inside a
 * user request. That is not a trade worth making for a log line.
 *
 * So the event goes to the server log, structured and greppable, and the gap is
 * declared in `HANDOFF/W3-D.md` rather than papered over with an in-memory array
 * that a reviewer would mistake for persistence. **The refusal itself is real
 * either way** — the 403 does not depend on the logging succeeding, which is
 * the property that actually protects owner B.
 */
export function logDeniedFinanceAccess(event: DeniedFinanceAccess): void {
  // One line, one JSON object, no interpolated user text outside the payload —
  // so a `target` carrying a newline cannot forge a second log record.
  console.warn(
    "[azura.finance.access_denied]",
    JSON.stringify({
      surface: event.surface,
      route: ROUTE_PATH[event.surface],
      role: event.role,
      profileId: event.profileId,
      target: event.target,
      reason: event.reason,
      persisted: false,
      persistedReason:
        "access_events has no write path yet (W1-A service-role RPC); see HANDOFF/W3-D.md",
    })
  )
}
