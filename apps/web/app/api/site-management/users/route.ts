import { createManifestHandler, type HandlerResult } from "@/lib/api-handler"
import type {
  AccessEventRecord,
  AuditEventRecord,
  GuardianshipRecord,
  ProfileRecord,
} from "@/lib/governance-data"
import {
  getAccessEvents,
  getAuditEvents,
  getGuardianships,
  getProfiles,
} from "@/lib/governance-repository"
// `createProfile` and `deleteProfile` are no longer imported — see the
// withdrawal note below. They remain in `lib/admin-capability.ts` so the
// reasoning and the guards stay reviewable, and nothing calls them.
import { updateProfileAuthority } from "@/lib/admin-capability"
import { updateProfileRoleSchema } from "@/lib/validation/schemas"
import { readBoolean, readEnum, readText } from "@/lib/validation/query"
import { isValidRole } from "@/lib/rbac"

export const dynamic = "force-dynamic"

const VIEWS = ["profiles", "guardianships", "audit", "access"] as const

export const GET = createManifestHandler("getProfiles", {
  handler: async ({
    profile,
    limit,
    offset,
    query,
  }): Promise<
    HandlerResult<
      | GuardianshipRecord[]
      | AuditEventRecord[]
      | AccessEventRecord[]
      | ProfileRecord[]
    >
  > => {
    const scope = {
      // The CALLER's role, which is what governance scope derives from. The
      // filter on the rows' own role is `subjectRole`, named apart from this
      // deliberately — W2-A's handoff calls that naming out, and conflating the
      // two is how a staff member ends up listing admins.
      role: profile.role,
      ...(profile.id === null ? {} : { profileId: profile.id }),
      limit,
      offset,
    }
    const view = readEnum(query, "view", VIEWS) ?? "profiles"

    if (view === "guardianships") {
      const result = await getGuardianships(scope)
      return { data: result.data, source: result.source }
    }
    if (view === "audit") {
      const result = await getAuditEvents(scope)
      return { data: result.data, source: result.source }
    }
    if (view === "access") {
      const decision = readEnum(query, "decision", ["allow", "deny"] as const)
      const result = await getAccessEvents({
        ...scope,
        ...(decision === undefined ? {} : { decision }),
      })
      return { data: result.data, source: result.source }
    }

    const candidate = readText(query, "subjectRole", 24)
    const isActive = readBoolean(query, "isActive")
    const result = await getProfiles({
      ...scope,
      ...(candidate !== undefined && isValidRole(candidate)
        ? { subjectRole: candidate }
        : {}),
      ...(isActive === undefined ? {} : { isActive }),
    })
    return { data: result.data, source: result.source }
  },
})

/**
 * The three write paths.                                    Owner: W3-H / N5
 *
 * These carried `writeGap` until tonight and answered 503 to everything, which
 * meant an administrator could read the people directory and change nothing in
 * it. W-UX §5 requires the opposite: "an administrator can do anything, without
 * a developer."
 *
 * All three are thin. Validation is the schema's, authorisation is
 * `createHandler`'s, the guards are Postgres's, and the plain-language mapping
 * of a Postgres outcome is `lib/admin-capability.ts`'s. What is left here is
 * naming the operation and handing over the caller's identity.
 *
 * `source: "supabase"` is returned literally rather than from a repository
 * result because these functions have no seed fallback — by design. Step 7b of
 * `createHandler` turns any other value into a 503, and a seeded "success" for
 * a role change would be the fake success the whole project is built to avoid.
 */

/**
 * Creating and deleting a person's record: withdrawn 2026-08-04.
 *
 * Both were declared operations — permissioned, rate-limited, audited, and
 * published in `docs/api/openapi.yaml` — and neither could ever return 200.
 * `authenticated` holds no INSERT and no DELETE on `profiles`; `createProfile`
 * supplied no `id` for a NOT NULL primary key that is a foreign key to
 * `auth.users(id)`, so it could only have written a row nobody could sign in
 * as; and deletion contradicts the product's own governance rule, "Accounts are
 * blocked, never deleted. The history has to survive."
 *
 * Migration 26 §4 argues the grants stay revoked, so the operations are gone
 * from the manifest and from the specification. These handlers stay, answering
 * 405 with the reason, rather than being deleted outright: a consumer that
 * built against the published document deserves an answer that explains itself
 * rather than Next's bare "method not allowed".
 */
/*
 * There is no `POST` and no `DELETE` here, and that absence is the point.
 *
 * They were briefly replaced with hand-rolled 405 handlers that named the
 * reason, which read well and was wrong twice over — `validate-openapi.mjs`
 * caught both. A route file exporting a method the manifest does not declare is
 * a **shadow endpoint**: reachable, undocumented, and outside the gate that
 * checks every route goes through the auth, rate-limit and audit sequence. The
 * courtesy of an explanatory message is not worth standing outside that.
 *
 * Next answers 405 by itself for a method this file does not export, which is
 * the correct status with no bespoke code to review. The reasoning lives above,
 * in `docs/api/openapi.yaml`'s absence of those operations, and in migration
 * 26 §4 — all three places a person would actually look.
 */

export const PATCH = createManifestHandler("updateProfileRole", {
  schema: updateProfileRoleSchema,
  handler: async ({ body, profile }) => {
    const updated = await updateProfileAuthority({
      profileId: body.profileId,
      actorId: profile.id,
      role: body.role,
      isActive: body.isActive,
      expectedVersion: body.expectedVersion,
    })
    return { data: updated, source: "supabase" as const }
  },
})
