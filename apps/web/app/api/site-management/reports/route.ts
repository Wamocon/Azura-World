import { createManifestHandler } from "@/lib/api-handler"
import { getMediaReports } from "@/lib/operations-repository"
import { createReportSchema } from "@/lib/validation/schemas"
import { mediaReportStatuses } from "@/lib/operations-data"
import { readBoolean, readEnum } from "@/lib/validation/query"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getMediaReports", {
  handler: async ({ profile, limit, offset, query }) => {
    const status = readEnum(query, "status", mediaReportStatuses)
    const untriagedOnly = readBoolean(query, "untriagedOnly")
    const isPublicIntake = readBoolean(query, "isPublicIntake")

    const result = await getMediaReports({
      role: profile.role,
      profileId: profile.id,
      limit,
      offset,
      ...(status === undefined ? {} : { status }),
      ...(untriagedOnly === undefined ? {} : { untriagedOnly }),
      ...(isPublicIntake === undefined ? {} : { isPublicIntake }),
    })
    return { data: result.data, source: result.source }
  },
})

export const POST = createManifestHandler("createMediaReport", {
  schema: createReportSchema,
  handler: () => {
    throw new Error("unreachable: createMediaReport declares a write gap")
  },
})
