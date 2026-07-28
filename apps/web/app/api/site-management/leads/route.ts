import { createManifestHandler } from "@/lib/api-handler"
import { getLeads } from "@/lib/lead-repository"
import { createLeadSchema } from "@/lib/validation/schemas"
import { leadSources, leadStatuses } from "@/lib/lead-data"
import { readEnum, readId } from "@/lib/validation/query"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getLeads", {
  handler: async ({ profile, limit, offset, query }) => {
    const status = readEnum(query, "status", leadStatuses)
    const source = readEnum(query, "source", leadSources)
    const assignedTo = readId(query, "assignedTo")
    const unitId = readId(query, "unitId")

    const result = await getLeads({
      role: profile.role,
      limit,
      offset,
      ...(status === undefined ? {} : { status }),
      ...(source === undefined ? {} : { source }),
      ...(assignedTo === undefined ? {} : { assignedTo }),
      ...(unitId === undefined ? {} : { unitId }),
    })
    return { data: result.data, source: result.source }
  },
})

export const POST = createManifestHandler("createLead", {
  schema: createLeadSchema,
  handler: () => {
    throw new Error("unreachable: createLead declares a write gap")
  },
})
