import { createManifestHandler } from "@/lib/api-handler"
import { forbidden } from "@/lib/api-errors"
import {
  createTicket,
  getTickets,
  updateTicketStatus,
} from "@/lib/operations-repository"
import { RepositoryError } from "@/lib/repository-base"
import {
  createTicketSchema,
  updateTicketStatusSchema,
} from "@/lib/validation/schemas"
import {
  ticketCategories,
  ticketPriorities,
  ticketStatuses,
  type TicketCategory,
} from "@/lib/operations-data"
import { readBoolean, readEnum, readId } from "@/lib/validation/query"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getTickets", {
  handler: async ({ profile, limit, offset, query }) => {
    const status = readEnum(query, "status", ticketStatuses)
    const priority = readEnum(query, "priority", ticketPriorities)
    const unitId = readId(query, "unitId")
    const openOnly = readBoolean(query, "openOnly")
    const slaBreachedOnly = readBoolean(query, "slaBreachedOnly")

    const result = await getTickets({
      role: profile.role,
      profileId: profile.id,
      limit,
      offset,
      ...(status === undefined ? {} : { status }),
      ...(priority === undefined ? {} : { priority }),
      ...(unitId === undefined ? {} : { unitId }),
      ...(openOnly === undefined ? {} : { openOnly }),
      ...(slaBreachedOnly === undefined ? {} : { slaBreachedOnly }),
    })
    return { data: result.data, source: result.source }
  },
})

/**
 * Open a ticket.
 *
 * The requester is the session, and the company is the session's company —
 * neither is accepted from the payload. `createTicketSchema` has no status,
 * assignee or cost field either: those are triage, and triage is staff work
 * under a different policy. What arrives here can only ever describe a problem.
 *
 * Who may file against what is the database's decision, not this handler's:
 * `service_tickets_insert_requester` narrows a resident to their own unit or
 * the common areas, and staff go in under `service_tickets_staff_write`. A
 * caller outside both is refused as `forbidden`.
 */
export const POST = createManifestHandler("createTicket", {
  schema: createTicketSchema,
  handler: async ({ body, profile }) => {
    if (profile.id === null || profile.companyId === null) {
      throw new RepositoryError(
        forbidden("You do not have access to this data.")
      )
    }

    const result = await createTicket({
      role: profile.role,
      profileId: profile.id,
      companyId: profile.companyId,
      requesterProfileId: profile.id,
      title: body.title,
      description: body.description,
      category: readTicketCategory(body.category),
      priority: body.priority,
      ...(body.severity === undefined ? {} : { severity: body.severity }),
      ...(body.unitId === undefined ? {} : { unitId: body.unitId }),
      ...(body.siteId === undefined ? {} : { siteId: body.siteId }),
    })
    return { data: result.data, source: result.source }
  },
})

/**
 * `createTicketSchema` types `category` as free short text rather than the enum,
 * so it is narrowed here. An unrecognised value becomes `other` rather than a
 * 400: a report about a real problem should not be lost because the reporter
 * picked a category this build does not know about.
 */
function readTicketCategory(value: string): TicketCategory {
  return (ticketCategories as readonly string[]).includes(value)
    ? (value as TicketCategory)
    : "other"
}

/**
 * One of the two write paths in this API that reaches a real repository
 * mutation.
 *
 * `expectedVersion` is not optional. A status change without it is a
 * last-writer-wins overwrite of whatever the other person did between the read
 * and the write, and on a ticket queue that means two people close the same
 * ticket for different reasons and one reason vanishes.
 */
export const PATCH = createManifestHandler("updateTicketStatus", {
  schema: updateTicketStatusSchema,
  handler: async ({ body, profile }) => {
    const result = await updateTicketStatus({
      role: profile.role,
      profileId: profile.id,
      ticketId: body.ticketId,
      expectedVersion: body.expectedVersion,
      toStatus: body.toStatus,
      actorProfileId: profile.id,
      ...(body.note === undefined ? {} : { note: body.note }),
      ...(body.assigneeProfileId === undefined
        ? {}
        : { assigneeProfileId: body.assigneeProfileId }),
    })
    return { data: result.data, source: result.source }
  },
})
