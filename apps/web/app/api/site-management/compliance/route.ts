import { createManifestHandler, type HandlerResult } from "@/lib/api-handler"
import {
  getComplianceDocuments,
  type ComplianceDocument,
} from "@/lib/document-repository"
import type { ComplianceCheckRecord } from "@/lib/governance-data"
import { getComplianceChecks } from "@/lib/governance-repository"
import { readBoolean, readEnum, readInt } from "@/lib/validation/query"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getComplianceDocuments", {
  handler: async ({
    profile,
    limit,
    offset,
    query,
  }): Promise<
    HandlerResult<ComplianceCheckRecord[] | ComplianceDocument[]>
  > => {
    if (
      readEnum(query, "view", ["documents", "checks"] as const) === "checks"
    ) {
      const humanDecisionRequired = readBoolean(query, "humanDecisionRequired")
      const checks = await getComplianceChecks({
        role: profile.role,
        ...(profile.id === null ? {} : { profileId: profile.id }),
        limit,
        offset,
        ...(humanDecisionRequired === undefined
          ? {}
          : { humanDecisionRequired }),
      })
      return { data: checks.data, source: checks.source }
    }

    const expiringWithinDays = readInt(query, "expiringWithinDays", 0, 3650)
    const result = await getComplianceDocuments({
      role: profile.role,
      limit,
      offset,
      ...(expiringWithinDays === undefined ? {} : { expiringWithinDays }),
    })
    return { data: result.data, source: result.source }
  },
})
