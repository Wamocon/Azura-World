/**
 * The anonymous concierge, JSON.
 *
 * Unauthenticated by design — this is what the landing page's widget talks to.
 * The whole authorisation story is "run the pipeline as `guest`", which is why
 * this handler is short: it does transport, and `lib/public-ai-chat.ts` does the
 * rest.
 *
 * Order, per CONVENTIONS §4: content-type → rate limit → concurrency → bounded
 * body → parse → run → trace → return. Rate limiting comes before the body read
 * so a throttled caller's payload is never buffered.
 */

import type { NextResponse } from "next/server"
import {
  acquireConcurrencySlot,
  consumeRequestRateLimit,
  trustedClientAddress,
} from "@/lib/ai-rate-limit"
import {
  apiFail,
  apiOk,
  readBoundedJson,
  requiresJsonContentType,
} from "@/lib/ai-http"
import { recordAiTrace } from "@/lib/ai-observability"
import {
  MAX_PUBLIC_MESSAGE_CHARS,
  PUBLIC_MAX_BODY_BYTES,
  PUBLIC_RATE_LIMIT,
  PUBLIC_RATE_WINDOW_SECONDS,
  parsePublicChatBody,
  runPublicConcierge,
} from "@/lib/public-ai-chat"

export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function POST(request: Request): Promise<NextResponse> {
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

    const payload = await runPublicConcierge(parsed.value, startedAt)

    await recordAiTrace({
      surface: "public",
      // No identity is recorded for an anonymous caller — not the IP, not a
      // fingerprint. The rate limiter holds a salted hash of the address and
      // nothing else does.
      profileId: null,
      companyId: null,
      role: "guest",
      language: payload.language,
      source: payload.source,
      model: payload.model,
      refused: payload.refused,
      refusalReason: payload.refusalReason ?? null,
      refusalKind: null,
      intent: payload.topic ?? "evidence-pipeline",
      grounded: payload.citations.length > 0,
      injectionSignal: false,
      gatewayAttempted: payload.source === "gateway",
      gatewayOutcome: payload.source,
      latencyMs: payload.responseMs,
      messageChars: parsed.value.message.length,
      citationCount: payload.citations.length,
      promptTokens: null,
      completionTokens: null,
    })

    return apiOk(payload, requestId)
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
    slot.release()
  }
}
