/**
 * Feedback on an anonymous answer.
 *
 * `ai_feedback` (W1-A migration 11) requires a `message_id` referencing
 * `ai_messages`, and the anonymous surface deliberately **persists no
 * messages** — there is no profile to scope a transcript to, and a transcript
 * keyed on an IP address is personal data with no reason to exist.
 *
 * So a rating from the public widget has nothing to attach to, and this route is
 * honest about that instead of inventing a row: it validates, records the
 * rating in the server log as an aggregate signal, and returns a reference the
 * widget can show. Nothing is written to the database.
 *
 * The alternative — persisting anonymous transcripts so a thumbs-down has
 * somewhere to live — is a data-retention decision, not an implementation
 * detail, and it is not one this task gets to make quietly at 02:00. Recorded in
 * HANDOFF/W2-C.md as an open question for W4-C and W5.
 *
 * The route exists now because W3-H's widget needs an endpoint that answers
 * predictably, and because a 404 there would be indistinguishable from a routing
 * bug.
 */

import type { NextResponse } from "next/server"
import { consumeRequestRateLimit } from "@/lib/ai-rate-limit"
import {
  apiFail,
  apiOk,
  readBoundedJson,
  requiresJsonContentType,
} from "@/lib/ai-http"
import { redactSensitive } from "@/lib/ai-guardrails"

export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 4_096
const RATE_LIMIT = 30
const RATE_WINDOW_SECONDS = 300
const MAX_REASON_CHARS = 500

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = crypto.randomUUID()

  const contentTypeError = requiresJsonContentType(request)
  if (contentTypeError !== null) return apiFail(contentTypeError, requestId)

  const limit = consumeRequestRateLimit(request, {
    scope: "ai-feedback",
    limit: RATE_LIMIT,
    windowSeconds: RATE_WINDOW_SECONDS,
  })
  if (!limit.available) {
    return apiFail(
      {
        code: "persistence_unavailable",
        message: "Feedback is temporarily unavailable.",
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

  try {
    const body = await readBoundedJson(request, MAX_BODY_BYTES)
    if (!body.ok) return apiFail(body.error, requestId)

    const record =
      typeof body.value === "object" && body.value !== null && !Array.isArray(body.value)
        ? (body.value as Record<string, unknown>)
        : {}

    // An exact literal, not a coerced truthy value: `rating: "yes"` is a client
    // bug and should be told so, not silently read as positive.
    const rating = record["rating"]
    if (rating !== "positive" && rating !== "negative") {
      return apiFail(
        {
          code: "validation_failed",
          message: 'rating must be exactly "positive" or "negative".',
          retryable: false,
        },
        requestId
      )
    }

    const rawReason = record["reason"]
    const reason =
      typeof rawReason === "string"
        ? redactSensitive(rawReason.slice(0, MAX_REASON_CHARS))
        : null

    // Aggregate signal only. The reason is redacted before it reaches the log,
    // and no identity is attached — see the module header for why nothing is
    // written to `ai_feedback`.
    console.info(
      "azura.ai.feedback",
      JSON.stringify({
        surface: "public",
        rating,
        reasonChars: reason === null ? 0 : reason.length,
        persisted: false,
      })
    )

    return apiOk({ status: "received", persisted: false, rating }, requestId)
  } catch {
    return apiFail(
      {
        code: "upstream_failed",
        message: "Feedback could not be recorded.",
        retryable: true,
      },
      requestId
    )
  }
}
