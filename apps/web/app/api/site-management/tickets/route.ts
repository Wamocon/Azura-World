import { createManifestHandler } from "@/lib/api-handler"
import { getTickets, updateTicketStatus } from "@/lib/operations-repository"
import { createTicketSchema, updateTicketStatusSchema } from "@/lib/validation/schemas"
import { ticketPriorities, ticketStatuses } from "@/lib/operations-data"
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

export const POST = createManifestHandler("createTicket", {
  schema: createTicketSchema,
  handler: () => {
    throw new Error("unreachable: createTicket declares a write gap")
  },
})

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
    })
    return { data: result.data, source: result.source }
  },
})
