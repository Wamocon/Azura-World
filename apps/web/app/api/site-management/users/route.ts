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
import { createProfileSchema, updateProfileRoleSchema } from "@/lib/validation/schemas"
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
      GuardianshipRecord[] | AuditEventRecord[] | AccessEventRecord[] | ProfileRecord[]
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

export const POST = createManifestHandler("createProfile", {
  schema: createProfileSchema,
  handler: () => {
    throw new Error("unreachable: createProfile declares a write gap")
  },
})

export const PATCH = createManifestHandler("updateProfileRole", {
  schema: updateProfileRoleSchema,
  handler: () => {
    throw new Error("unreachable: updateProfileRole declares a write gap")
  },
})
