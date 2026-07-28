import { createManifestHandler } from "@/lib/api-handler"
import { getActivities } from "@/lib/operations-repository"
import { createActivitySchema } from "@/lib/validation/schemas"
import { activityCategories, activityStatuses } from "@/lib/operations-data"
import { readBoolean, readEnum } from "@/lib/validation/query"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getActivities", {
  handler: async ({ profile, limit, offset, query }) => {
    const status = readEnum(query, "status", activityStatuses)
    const category = readEnum(query, "category", activityCategories)
    const upcomingOnly = readBoolean(query, "upcomingOnly")

    const result = await getActivities({
      role: profile.role,
      profileId: profile.id,
      limit,
      offset,
      ...(status === undefined ? {} : { status }),
      ...(category === undefined ? {} : { category }),
      ...(upcomingOnly === undefined ? {} : { upcomingOnly }),
    })
    return { data: result.data, source: result.source }
  },
})

export const POST = createManifestHandler("createActivity", {
  schema: createActivitySchema,
  handler: () => {
    throw new Error("unreachable: createActivity declares a write gap")
  },
})
