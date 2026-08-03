import { createManifestHandler } from "@/lib/api-handler"
import { forbidden } from "@/lib/api-errors"
import { createLead, getLeads } from "@/lib/lead-repository"
import { RepositoryError } from "@/lib/repository-base"
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

/**
 * Record an enquiry.
 *
 * The company is the session's company and is never read from the payload —
 * `createLeadSchema` has no field for it, and a caller who could name one could
 * file leads into somebody else's book. The same is true of the fields that
 * decide who profits from an enquiry: there is no `assignedTo`, no `status` and
 * no `score`, so a lead can only ever arrive `new` and unowned.
 *
 * Who may file at all is the database's decision. `leads_staff_write` admits an
 * administrator, or a manager inside their own company; anyone else is refused
 * with 42501, which the repository maps to `forbidden`. The RBAC check the
 * wrapper already ran (`leads:create`) admits exactly the same two roles, so the
 * UI and the policy agree here rather than merely overlapping.
 */
export const POST = createManifestHandler("createLead", {
  schema: createLeadSchema,
  handler: async ({ body, profile }) => {
    // A session with no company cannot own a lead, and inventing one would put
    // a real person's contact details in an arbitrary company's CRM.
    if (profile.companyId === null) {
      throw new RepositoryError(
        forbidden("You do not have access to this data.")
      )
    }

    const result = await createLead({
      role: profile.role,
      companyId: profile.companyId,
      fullName: body.fullName,
      email: body.email,
      source: body.source,
      ...(body.phone === undefined ? {} : { phone: body.phone }),
      ...(body.unitId === undefined ? {} : { unitId: body.unitId }),
      ...(body.message === undefined ? {} : { message: body.message }),
    })
    return { data: result.data, source: result.source }
  },
})
