/**
 * The authenticated concierge.
 *
 * A thin HTTP adapter. Every decision lives in `lib/ai-concierge.ts`; this file
 * does auth, transport limits, memory and the envelope, in the order CONVENTIONS
 * §4 fixes:
 *
 *   method → content-type → rate limit → concurrency → bounded body → Zod →
 *   authenticate → run the pipeline (which authorises) → persist → trace → map
 *
 * Rate limiting is **before** the body is read, so an oversized body from an
 * already-throttled caller is never buffered.
 *
 * ## Never 5xx
 *
 * CONTRACTS §6 rule 2 and §5's "never 500 for a handled condition". Every path
 * here returns a typed `ApiResponse`, and the pipeline itself has no throwing
 * branch — an absent, slow or broken gateway all resolve to the deterministic
 * answer. W4-C should treat any reachable 500 on this route as a High finding.
 */

import type { NextResponse } from "next/server"
import { z } from "zod"
import { getUserProfile } from "@/lib/auth"
import { runConcierge, MAX_MESSAGE_CHARS } from "@/lib/ai-concierge"
import {
  acquireConcurrencySlot,
  consumeRequestRateLimit,
  trustedClientAddress,
} from "@/lib/ai-rate-limit"
import {
  appendTurns,
  formatPriorConversation,
  loadConversationContext,
} from "@/lib/ai-memory"
import { recordAiTrace, traceFrom } from "@/lib/ai-observability"
import { defaultGateway } from "@/lib/local-ai"
import {
  apiFail,
  apiOk,
  readBoundedJson,
  requiresJsonContentType,
} from "@/lib/ai-http"
import { locales, type Locale } from "@/lib/contracts"

export const dynamic = "force-dynamic"
/** Must exceed the gateway's own 20s ceiling, or the platform kills it first. */
export const maxDuration = 30

/** 8 KiB of transport for a 2000-character message leaves ample headroom. */
const MAX_BODY_BYTES = 8_192
const RATE_LIMIT = 40
const RATE_WINDOW_SECONDS = 300

const bodySchema = z
  .object({
    message: z.string().min(1).max(MAX_MESSAGE_CHARS),
    conversationId: z.uuid().optional(),
    locale: z.enum(locales).optional(),
  })
  .strict()

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = crypto.randomUUID()

  const contentTypeError = requiresJsonContentType(request)
  if (contentTypeError !== null) return apiFail(contentTypeError, requestId)

  const limit = consumeRequestRateLimit(request, {
    scope: "ai-chat",
    limit: RATE_LIMIT,
    windowSeconds: RATE_WINDOW_SECONDS,
  })
  if (!limit.available) {
    // A limiter that cannot do its job must not pass traffic through: "the
    // limiter broke so everything is allowed" is the failure that shows up on
    // the bill rather than in the logs.
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
        message: "Too many requests in flight. Please wait for the current answer.",
        retryable: true,
      },
      requestId,
      { "Retry-After": "5" }
    )
  }

  try {
    const body = await readBoundedJson(request, MAX_BODY_BYTES)
    if (!body.ok) return apiFail(body.error, requestId)

    const parsed = bodySchema.safeParse(body.value)
    if (!parsed.success) {
      return apiFail(
        {
          code: "validation_failed",
          message: `message is required and must be at most ${MAX_MESSAGE_CHARS} characters.`,
          // Field names and rules only — never the offending value.
          details: { message: "missing, empty, or over the length ceiling" },
          retryable: false,
        },
        requestId
      )
    }

    const profile = await getUserProfile()
    if (!profile.authenticated) {
      return apiFail(
        {
          code: "unauthorized",
          message: "Sign in to use the assistant.",
          retryable: false,
        },
        requestId
      )
    }

    const locale: Locale = parsed.data.locale ?? profile.locale ?? "de"

    const memory = await loadConversationContext({
      profileId: profile.id,
      role: profile.role,
      conversationId: parsed.data.conversationId ?? null,
      surface: "dashboard",
    })
    const prior = formatPriorConversation(memory)

    const output = await runConcierge(
      {
        message: parsed.data.message,
        role: profile.role,
        locale,
        ...(prior.length > 0 ? { priorConversation: prior } : {}),
        signal: request.signal,
      },
      { gateway: defaultGateway() }
    )

    // Refusals are not persisted: they produced no answer worth resuming, and
    // storing the refused text would put out-of-scope content into a transcript
    // RLS then has to protect.
    let conversationId = memory.conversationId
    if (!output.response.refused) {
      const appended = await appendTurns({
        profileId: profile.id,
        companyId: profile.companyId,
        role: profile.role,
        locale: output.trace.language,
        conversationId,
        surface: "dashboard",
        userMessage: parsed.data.message,
        response: output.response,
        latencyMs: output.trace.latencyMs,
        tokens:
          output.trace.promptTokens === null &&
          output.trace.completionTokens === null
            ? null
            : (output.trace.promptTokens ?? 0) +
              (output.trace.completionTokens ?? 0),
      })
      conversationId = appended.conversationId
    }

    await recordAiTrace(
      traceFrom(
        "dashboard",
        {
          profileId: profile.id,
          companyId: profile.companyId,
          role: profile.role,
        },
        output
      )
    )

    if (output.trace.httpStatus === 422) {
      return apiFail(
        {
          code: "validation_failed",
          message: `message must be at most ${MAX_MESSAGE_CHARS} characters.`,
          retryable: false,
        },
        requestId
      )
    }

    return apiOk({ ...output.response, conversationId }, requestId)
  } catch {
    // The pipeline has no throwing branch; this catches a transport failure and
    // still returns a typed error rather than an unhandled 500, whose stack text
    // would leak internals (CONVENTIONS §4.7).
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
