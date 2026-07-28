/**
 * The anonymous concierge, streamed.
 *
 * **NDJSON, not SSE.** One JSON object per newline-terminated line, three frame
 * types: `meta` → N × `delta` → `done`. The client reader is about fifteen lines
 * and needs no `EventSource`, no reconnection semantics and no `data:` prefix
 * parsing. `X-Accel-Buffering: no` defeats proxy buffering, which is what
 * otherwise makes a "stream" arrive all at once.
 *
 * ## The answer is complete before the stream opens
 *
 * `runPublicConcierge` resolves fully, then the frames are emitted. That is
 * deliberate rather than a limitation: every guarantee in `lib/ai-concierge.ts`
 * — the RBAC decision before the gateway call, the grounding refusal, the
 * post-check that discards an ungrounded reply — operates on a *whole* answer.
 * Streaming tokens straight from the model would mean shipping the first half of
 * a reply that the grounding check is about to reject, and there is no way to
 * un-send it. So the streaming here is presentation, and the safety properties
 * are unaffected.
 *
 * ## Abort is handled
 *
 * The 1Çatı reference reads neither `request.signal` nor implements `cancel()`,
 * so a visitor closing the widget mid-stream leaves `enqueue` throwing on a
 * detached controller. Both are wired here: the signal short-circuits the frame
 * loop and `cancel()` marks the stream closed, so nothing is enqueued after the
 * consumer has gone.
 */

import {
  acquireConcurrencySlot,
  consumeRequestRateLimit,
  trustedClientAddress,
} from "@/lib/ai-rate-limit"
import {
  apiFail,
  readBoundedJson,
  requiresJsonContentType,
} from "@/lib/ai-http"
import {
  MAX_PUBLIC_MESSAGE_CHARS,
  PUBLIC_MAX_BODY_BYTES,
  PUBLIC_RATE_LIMIT,
  PUBLIC_RATE_WINDOW_SECONDS,
  chunkReply,
  parsePublicChatBody,
  runPublicConcierge,
} from "@/lib/public-ai-chat"

export const dynamic = "force-dynamic"
export const maxDuration = 30

const streamHeaders = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform, no-store",
  // Without this, nginx and most CDNs buffer the whole body and the stream
  // arrives in one piece — which looks exactly like the feature not working.
  "X-Accel-Buffering": "no",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID()
  const startedAt = Date.now()

  const contentTypeError = requiresJsonContentType(request)
  if (contentTypeError !== null) return apiFail(contentTypeError, requestId)

  const limit = consumeRequestRateLimit(request, {
    scope: "ai-public-chat",
    limit: PUBLIC_RATE_LIMIT,
    windowSeconds: PUBLIC_RATE_WINDOW_SECONDS,
  })
  if (!limit.available) {
    return apiFail(
      {
        code: "persistence_unavailable",
        message: "The assistant is temporarily unavailable.",
        retryable: true,
      },
      requestId
    )
  }
  if (!limit.allowed) {
    return apiFail(
      {
        code: "rate_limited",
        message: "Too many requests. Please try again shortly.",
        retryable: true,
      },
      requestId,
      { "Retry-After": String(limit.retryAfterSeconds) }
    )
  }

  const slot = acquireConcurrencySlot(trustedClientAddress(request))
  if (!slot.acquired) {
    return apiFail(
      {
        code: "rate_limited",
        message: "Please wait for the current answer.",
        retryable: true,
      },
      requestId,
      { "Retry-After": "5" }
    )
  }

  let payload
  try {
    const body = await readBoundedJson(request, PUBLIC_MAX_BODY_BYTES)
    if (!body.ok) return apiFail(body.error, requestId)

    const parsed = parsePublicChatBody(body.value)
    if (!parsed.ok) {
      return apiFail(
        {
          code: "validation_failed",
          message:
            parsed.reason === "missing"
              ? "message is required."
              : `message must be at most ${MAX_PUBLIC_MESSAGE_CHARS} characters.`,
          retryable: false,
        },
        requestId
      )
    }

    payload = await runPublicConcierge(parsed.value, startedAt)
  } catch {
    return apiFail(
      {
        code: "upstream_failed",
        message: "The assistant could not complete this request.",
        retryable: true,
      },
      requestId
    )
  } finally {
    // Released here rather than after the stream drains: the expensive work —
    // retrieval and the gateway call — is already done, and holding the slot
    // for the duration of a slow client's download would let one stalled reader
    // block that visitor's next question.
    slot.release()
  }

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const line = (value: Record<string, unknown>): boolean => {
        if (closed || request.signal.aborted) return false
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
          return true
        } catch {
          // The consumer went away between the check and the enqueue.
          closed = true
          return false
        }
      }

      if (
        !line({
          type: "meta",
          requestId,
          language: payload.language,
          source: payload.source,
          refused: payload.refused,
          refusalReason: payload.refusalReason ?? null,
          citations: payload.citations.length,
        })
      ) {
        controller.close()
        return
      }

      for (const text of chunkReply(payload.reply)) {
        if (!line({ type: "delta", text })) {
          controller.close()
          return
        }
      }

      // The `done` frame carries the whole payload, so a client that missed a
      // delta still ends up with the complete, cited answer rather than a
      // truncated one.
      line({ type: "done", payload })
      if (!closed) controller.close()
    },
    cancel() {
      // The visitor closed the widget or navigated away. Nothing further is
      // enqueued, and no partial answer is persisted anywhere — the anonymous
      // surface keeps no transcript at all.
      closed = true
    },
  })

  return new Response(stream, { status: 200, headers: streamHeaders })
}
