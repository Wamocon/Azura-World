import { createManifestHandler, type HandlerResult } from "@/lib/api-handler"
import { notFound, validationFailed } from "@/lib/api-errors"
import {
  createMessage,
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

/**
 * Post one message to a thread.
 *
 * The thread is loaded first, for two reasons. It is where the caller's access
 * is checked — `getThread()` returns `null` for a thread they cannot see, and
 * the reply is refused as 404 rather than 403 so the endpoint never confirms
 * that an invisible thread exists. And it is where `companyId` comes from: the
 * schema does not accept one, because a caller-supplied company on a message is
 * how a message ends up filed under a tenant it does not belong to.
 *
 * The sender is `profile.id` and cannot be anything else — `createMessageSchema`
 * has no sender field, and the row-level policy independently requires
 * `sender_profile_id = auth.uid()`.
 *
 * `attachments` is accepted by the schema and is NOT yet stored: `messages` has
 * a single `attachment_document_id`, not a join table, so honouring a list of
 * ten would mean silently keeping one. Left unimplemented and named here rather
 * than half-done.
 */
export const POST = createManifestHandler("createMessage", {
  schema: createMessageSchema,
  handler: async ({ body, profile }) => {
    if (profile.id === null) {
      throw new RepositoryError(notFound("That conversation was not found."))
    }

    const thread = await getThread(body.threadId, {
      role: profile.role,
      profileId: profile.id,
    })
    if (thread.data === null) {
      throw new RepositoryError(notFound("That conversation was not found."))
    }

    const result = await createMessage({
      threadId: thread.data.id,
      companyId: thread.data.companyId,
      senderProfileId: profile.id,
      body: body.body,
      role: profile.role,
      ...(profile.locale === null ? {} : { locale: profile.locale }),
    })
    return { data: result.data, source: result.source }
  },
})
