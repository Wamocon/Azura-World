import { createManifestHandler, type HandlerResult } from "@/lib/api-handler"
import { notFound, validationFailed } from "@/lib/api-errors"
import {
  getMessages,
  getNotifications,
  getThread,
  getThreads,
  type MessageRecord,
  type NotificationRecord,
  type ThreadRecord,
} from "@/lib/communications-repository"
import { RepositoryError } from "@/lib/repository-base"
import { createMessageSchema } from "@/lib/validation/schemas"
import { threadStatuses } from "@/lib/communications-data"
import { readBoolean, readEnum, readId } from "@/lib/validation/query"

export const dynamic = "force-dynamic"

const VIEWS = ["threads", "messages", "notifications"] as const

export const GET = createManifestHandler("getCommunications", {
  handler: async ({
    profile,
    limit,
    offset,
    query,
  }): Promise<
    HandlerResult<NotificationRecord[] | MessageRecord[] | ThreadRecord[]>
  > => {
    const view = readEnum(query, "view", VIEWS) ?? "threads"

    if (view === "notifications") {
      // A notification list needs a profile to belong to. Anonymous callers
      // never reach here — `communications:view` is not a guest permission —
      // but the check is explicit rather than assumed.
      if (profile.id === null) {
        throw new RepositoryError(notFound("No notifications are available."))
      }
      const unreadOnly = readBoolean(query, "unreadOnly")
      const result = await getNotifications(profile.id, {
        role: profile.role,
        limit,
        offset,
        ...(unreadOnly === undefined ? {} : { unreadOnly }),
      })
      return { data: result.data, source: result.source }
    }

    if (view === "messages") {
      const threadId = readId(query, "threadId")
      if (threadId === undefined) {
        throw new RepositoryError(
          validationFailed("A thread id is required to read messages.", {
            threadId: "Supply the thread id.",
          })
        )
      }
      // Check access to the THREAD before reading its messages. `getMessages`
      // takes a thread id and does not re-derive the caller's scope, so without
      // this the endpoint would read any thread's messages for anyone holding
      // `communications:view`.
      const thread = await getThread(threadId, {
        role: profile.role,
        profileId: profile.id ?? "",
      })
      if (thread.data === null) {
        throw new RepositoryError(notFound("That conversation was not found."))
      }
      const result = await getMessages(threadId, {
        role: profile.role,
        limit,
        offset,
      })
      return { data: result.data, source: result.source }
    }

    const status = readEnum(query, "status", threadStatuses)
    const result = await getThreads({
      role: profile.role,
      ...(profile.id === null ? {} : { profileId: profile.id }),
      limit,
      offset,
      ...(status === undefined ? {} : { status }),
    })
    return { data: result.data, source: result.source }
  },
})

export const POST = createManifestHandler("createMessage", {
  schema: createMessageSchema,
  handler: () => {
    throw new Error("unreachable: createMessage declares a write gap")
  },
})
