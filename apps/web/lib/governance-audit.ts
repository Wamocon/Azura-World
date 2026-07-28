/**
 * The **write** side of the append-only ledger.                Owner: W3-F
 *
 * ## Why this is not in `governance-repository.ts`
 *
 * W2-A's repository is read-only and says so in its own header: *"No write
 * helper is exported here, so nothing can reach for the wrong client by
 * accident."* That is a good property and adding a writer to that file would
 * destroy it. So the write side is a separate module, named so that an import
 * of it is visible in review, and it is the **only** place in this codebase that
 * inserts into `audit_events`.
 *
 * (New file, not in ORCHESTRATION §4's matrix. Same situation and same reasoning
 * as W1-B's `lib/auth-resolution.ts`: it is a split of this task's own scope, no
 * other window claims it, and putting it in a file another window owns would be
 * worse. Recorded in HANDOFF/W3-F.md.)
 *
 * ## Why the service-role client
 *
 * `…0008_documents_compliance.sql` revokes `insert, update, delete, truncate` on
 * `audit_events` from `authenticated`, and `…0013_hardening.sql` repeats it for
 * `anon`. That is not an oversight to work around — a session that can write the
 * audit table can forge the record of its own actions. So the insert runs with
 * the service-role client, **after** the RBAC decision has already been taken by
 * the caller (CONVENTIONS §4 step 8). Nothing here decides anything; it records
 * a decision somebody else made.
 *
 * ## Append-only is enforced three deep, and none of it is here
 *
 * 1. `revoke insert, update, delete, truncate … from authenticated, anon`
 * 2. `reject_append_only_mutation()`, a `BEFORE UPDATE OR DELETE` trigger that
 *    raises `42501` unless the session GUC `app.allow_append_only_mutation` is
 *    `'on'` — which only a `SECURITY DEFINER` retention RPC sets
 * 3. this module exports **no** update and **no** delete, so there is no
 *    application path to call even if the grants were loosened
 *
 * The database refusing is the control. This module's contribution is not being
 * a hole in it.
 *
 * ## An audit write that fails is not a detail
 *
 * `writeAuditEvent` never throws and never silently succeeds. It returns a
 * discriminated union, and the two failure arms are distinct on purpose:
 * `unavailable` means there is no data plane at all (nothing was written and
 * nothing was going to be), `failed` means there is one and it refused. A
 * caller that has already changed something and then gets `failed` is in the
 * incomplete state `tasks/W3-F` requires to be modelled rather than assumed
 * away — see `lib/document-storage.ts`.
 */

import { isSupabaseConfigured } from "@/lib/env"
import { createServiceRoleClient } from "@/lib/supabase/server"

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * One ledger row.
 *
 * There is deliberately no `ipAddress` / `userAgent` field. The columns exist,
 * and CONVENTIONS §4 forbids logging full request bodies or PII; a request-scoped
 * address recorded against a named person on every settings save is exactly the
 * retention question W4-C answered "do not persist" for anonymous AI transcripts.
 * When a window has a reason to record them, it adds them here deliberately
 * rather than finding them already populated.
 */
export interface AuditEventInput {
  /** Dotted, stable, and readable in a filter box: `users.role_change.elevated`. */
  action: string
  /** The table the event is about. `"profiles"`, `"documents"`, `"compliance_checks"`. */
  entityTable: string
  /** TEXT. A uuid, or a business code like `AZW-B03-0412`, or `null`. */
  entityId: string | null
  actorProfileId: string | null
  companyId?: string | null
  /** Changed columns only. Never a whole row, never a request body. */
  beforeData?: Record<string, unknown> | null
  afterData?: Record<string, unknown> | null
  requestId?: string | null
}

/**
 * Why a ledger write did not happen.
 *
 * A **key**, not a sentence. These reach a user through
 * `dashboard.admin.auditReason.*`, so the prose lives in `messages/*` like every
 * other user-visible string, and the raw Postgres text — which names tables,
 * constraints and sometimes values — never reaches a UI at all.
 */
export type AuditFailureReason =
  /** No Supabase configuration in this build. */
  | "no_database"
  /** Configured, but no service-role key, and `authenticated` cannot insert. */
  | "no_server_key"
  /** The database was reached and refused the insert. */
  | "insert_failed"

/** What happened to the ledger write. */
export type AuditOutcome =
  | { status: "recorded"; action: string }
  | { status: "unavailable"; action: string; reason: AuditFailureReason }
  | { status: "failed"; action: string; reason: AuditFailureReason }

/**
 * The insert shape, in database column names.
 *
 * `created_at` and `id` are omitted deliberately — both default in the schema,
 * and a client-supplied `created_at` on an audit ledger is a way to write
 * history out of order.
 */
interface AuditEventRow {
  action: string
  entity_table: string
  entity_id: string | null
  actor_profile_id: string | null
  company_id: string | null
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  request_id: string | null
}

/** Ceiling on any single JSON payload, so a ledger row cannot be used as storage. */
const MAX_PAYLOAD_KEYS = 32
const MAX_PAYLOAD_CHARS = 4_000

/**
 * Bound a payload before it reaches the ledger.
 *
 * Truncation is **visible**: the surviving object gains a `_truncated` key
 * naming what was dropped. A silently shortened audit record is worse than a
 * long one, because it reads as complete.
 */
function boundPayload(
  payload: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (payload === null || payload === undefined) return null

  const entries = Object.entries(payload)
  const kept = entries.slice(0, MAX_PAYLOAD_KEYS)
  const bounded: Record<string, unknown> = Object.fromEntries(kept)

  if (entries.length > kept.length) {
    bounded["_truncated"] =
      `${entries.length - kept.length} further keys were not recorded.`
  }

  const serialised = JSON.stringify(bounded)
  if (serialised !== undefined && serialised.length > MAX_PAYLOAD_CHARS) {
    return {
      _truncated: `Payload of ${serialised.length} characters exceeded the ${MAX_PAYLOAD_CHARS} character ceiling and was not recorded.`,
      _keys: Object.keys(payload).slice(0, MAX_PAYLOAD_KEYS),
    }
  }

  return bounded
}

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

/**
 * Append one event. Never throws.
 *
 * A caller must treat the return value as part of its own result. Ignoring it
 * turns "the change happened but was not recorded" into "the change happened",
 * which is the failure mode this whole module exists to make impossible to reach
 * by accident.
 */
export async function writeAuditEvent(
  input: AuditEventInput
): Promise<AuditOutcome> {
  const { action } = input

  if (!isSupabaseConfigured()) {
    return {
      status: "unavailable",
      action,
      reason: "no_database",
    }
  }

  const client = createServiceRoleClient()
  if (client === null) {
    return {
      status: "unavailable",
      action,
      reason: "no_server_key",
    }
  }

  // Column-for-column against `…0008_documents_compliance.sql` §5. Declared as a
  // named type rather than written inline so the shape is checked by `tsc` on
  // this side of the boundary, which is the only side that can check it today.
  const row: AuditEventRow = {
    action,
    entity_table: input.entityTable,
    entity_id: input.entityId,
    actor_profile_id: input.actorProfileId,
    company_id: input.companyId ?? null,
    before_data: boundPayload(input.beforeData),
    after_data: boundPayload(input.afterData),
    request_id: input.requestId ?? null,
  }

  try {
    // The cast is forced by an open gap, not by convenience: there is no
    // `lib/database.types.ts` yet (requested by W1-B of W1-A, and recorded in
    // that handoff), so `createSupabaseClient` has no `Database` generic and
    // every `.insert()` argument infers as `never`. `row` above is fully typed;
    // this only crosses the untyped client boundary. Delete the cast the day the
    // generated types land — nothing else here changes.
    const { error } = await client
      .from("audit_events")
      .insert(row as unknown as never)

    if (error !== null) {
      // Mapped, never raw. `error.message` from PostgREST names the table, the
      // constraint and sometimes the failing value.
      return { status: "failed", action, reason: "insert_failed" }
    }

    return { status: "recorded", action }
  } catch {
    return { status: "failed", action, reason: "insert_failed" }
  }
}

/**
 * Whether an outcome means the caller may report plain success.
 *
 * Only `recorded` does. `unavailable` is honest but incomplete — the change and
 * its record did not both happen — and `failed` is worse. Both must reach the
 * user as something other than "Saved".
 */
export function auditIsComplete(outcome: AuditOutcome): boolean {
  return outcome.status === "recorded"
}
