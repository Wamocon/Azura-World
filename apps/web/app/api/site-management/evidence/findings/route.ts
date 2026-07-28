import { createManifestHandler } from "@/lib/api-handler"
import { getFindings } from "@/lib/evidence-repository"
import { updateFindingSchema } from "@/lib/validation/schemas"
import { readBoolean, readEnum } from "@/lib/validation/query"
import { findingSeverities } from "@/lib/validation/vocab"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getEvidenceFindings", {
  handler: async ({ query }) => {
    const severity = readEnum(query, "severity", findingSeverities)
    const resolved = readBoolean(query, "resolved")
    const result = await getFindings({
      ...(severity === undefined ? {} : { severity }),
      ...(resolved === undefined ? {} : { resolved }),
    })
    return { data: result.data, source: result.source }
  },
})

/**
 * Declared, authorised, validated — and then honestly unavailable.
 *
 * The handler below never runs: `createHandler` returns the declared write gap
 * at step 6b, after the permission and schema checks. The body is here so the
 * route reads as what it is (a status change on a finding) and so the work to
 * finish it is a deletion from `lib/api-routes.ts`, not a rewrite.
 */
export const PATCH = createManifestHandler("updateEvidenceFinding", {
  schema: updateFindingSchema,
  handler: () => {
    throw new Error("unreachable: updateEvidenceFinding declares a write gap")
  },
})
