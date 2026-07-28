"use server"

import { getTranslations } from "next-intl/server"
import { z } from "zod"

import { getUserProfile } from "@/lib/auth"
import { locales } from "@/lib/contracts"
import { writeAuditEvent } from "@/lib/governance-audit"
import { hasPermission } from "@/lib/rbac"

import { probeSupabase, type ReachabilityObservation } from "./integrations"

/**
 * The one action on the admin surface: contact a provider and report back.
 *                                                              Owner: W3-F
 *
 * There is deliberately **no** action here that edits or deletes an audit
 * event, and there is no UI path to one either. `tasks/W3-F` requires both, and
 * the database backs it up three ways: `revoke insert, update, delete, truncate
 * … from authenticated, anon`, a `BEFORE UPDATE OR DELETE` trigger raising
 * `42501`, and `on delete restrict` from `audit_events.actor_profile_id` so a
 * profile that has acted cannot be removed to take its trail with it.
 *
 * Reading the log is `manager`+ (RLS `audit_events_select_manager`). Writing it
 * is nobody's, from a session. Editing it is nobody's, from anywhere short of a
 * `SECURITY DEFINER` retention RPC that has to set a session GUC to get past the
 * trigger.
 */

export type ProbeState =
  | { status: "idle" }
  | { status: "forbidden" }
  | { status: "invalid" }
  | {
      status: "observed"
      observation: ReachabilityObservation
      message: string
    }

const probeSchema = z.strictObject({
  locale: z.enum(locales),
  // One provider today. An enum rather than a free string, so a caller cannot
  // turn this into a general-purpose outbound request from our server.
  provider: z.literal("supabase"),
})

export async function checkIntegration(
  _previous: ProbeState,
  formData: FormData
): Promise<ProbeState> {
  const profile = await getUserProfile()

  // Authorise BEFORE validating, and long before any outbound request. An
  // unauthorised caller must not be able to make this server contact anything.
  if (
    !profile.authenticated ||
    !hasPermission(profile.role, "settings:manage")
  ) {
    return { status: "forbidden" }
  }

  const parsed = probeSchema.safeParse({
    locale: formData.get("locale"),
    provider: formData.get("provider"),
  })
  if (!parsed.success) return { status: "invalid" }

  const observation = await probeSupabase()
  const t = await getTranslations({
    locale: parsed.data.locale,
    namespace: "dashboard.admin",
  })

  // An operator contacting a provider is an administrative act, so it is
  // recorded. The outcome of the audit write is not folded into the caller's
  // result here, because nothing changed: this action only observes.
  await writeAuditEvent({
    action: `admin.integration_probe.${observation.state}`,
    entityTable: "integrations",
    entityId: observation.id,
    actorProfileId: profile.id,
    afterData: { state: observation.state, latency_ms: observation.latencyMs },
  })

  return {
    status: "observed",
    observation,
    message: t(`integrationState.${observation.state}`),
  }
}
