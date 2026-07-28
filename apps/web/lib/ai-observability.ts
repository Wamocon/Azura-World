/**
 * AI request tracing.
 *
 * **The PII guarantee is structural, not procedural.** `AiTraceInput` has no
 * field that can hold message text. Not "callers should not pass the message" —
 * there is nowhere to put it. `messageChars` is the only signal about the
 * message body, and a number cannot leak a name.
 *
 * That is the whole design. A convention ("remember not to log the prompt") is
 * broken by the first person who adds a debug line at 03:00; a type that makes
 * the leak unrepresentable is not.
 *
 * Three further invariants, all load-bearing:
 *
 *  1. **This never throws.** Observability that can fail a request is worse than
 *     no observability. Everything is inside one `try`/`catch` that swallows.
 *  2. **It uses the service-role client**, not the caller's JWT, so a trace is
 *     writable even for a request that was denied by RLS — and it is a no-op
 *     when Supabase is unconfigured, which is the local and probe path.
 *  3. **The response is byte-identical** whether or not the write succeeds.
 *
 * `W1-A`'s migration 11 created `ai_conversations`, `ai_messages`, `ai_feedback`
 * and `ai_action_logs`, with `public.ai_source` and `public.ai_refusal_reason`
 * enums that match CONTRACTS §6 exactly. The message row is where a trace
 * actually lands — see `lib/ai-memory.ts`. This module carries the fields that
 * belong beside it.
 */

import { createServiceRoleClient } from "./supabase/server"
import type { ConciergeTrace } from "./ai-concierge"
import type { AiResponse, Locale, Role } from "./contracts"

export type AiSurface = "dashboard" | "public"

/**
 * Everything recorded about one request.
 *
 * Note what is absent and cannot be added without editing this interface: the
 * message, the reply, the citations' contents, the user's name, the IP.
 */
export interface AiTraceInput {
  surface: AiSurface
  profileId: string | null
  companyId: string | null
  role: Role | null
  language: Locale
  source: AiResponse["source"]
  model: string | null
  refused: boolean
  refusalReason: AiResponse["refusalReason"] | null
  /** The finer internal reason. Never contains user text. */
  refusalKind: string | null
  intent: string
  grounded: boolean
  injectionSignal: boolean
  gatewayAttempted: boolean
  gatewayOutcome: string
  latencyMs: number
  /** The input's LENGTH. Never its content. */
  messageChars: number
  citationCount: number
  promptTokens: number | null
  completionTokens: number | null
}

/** Builds the trace from a concierge run. The only supported construction path. */
export function traceFrom(
  surface: AiSurface,
  identity: {
    profileId: string | null
    companyId: string | null
    role: Role | null
  },
  output: { response: AiResponse; trace: ConciergeTrace }
): AiTraceInput {
  return {
    surface,
    profileId: identity.profileId,
    companyId: identity.companyId,
    role: identity.role,
    language: output.trace.language,
    source: output.response.source,
    model: output.response.model,
    refused: output.response.refused,
    refusalReason: output.response.refusalReason ?? null,
    refusalKind: output.trace.refusalKind,
    intent: output.trace.intent,
    grounded: output.trace.grounded,
    injectionSignal: output.trace.injectionSignal,
    gatewayAttempted: output.trace.gatewayAttempted,
    gatewayOutcome: output.trace.gatewayOutcome,
    latencyMs: output.trace.latencyMs,
    messageChars: output.trace.messageChars,
    citationCount: output.response.citations.length,
    promptTokens: output.trace.promptTokens,
    completionTokens: output.trace.completionTokens,
  }
}

function toNullableInt(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  return Math.trunc(value)
}

/**
 * Emits the trace.
 *
 * There is no `ai_request_traces` table in W1-A's schema — the trace fields live
 * on `ai_messages`, which `lib/ai-memory.ts` writes. So this function's
 * persistent side is deliberately empty for now, and its job is the structured
 * server-side line: enough to answer "which path answered, how long did it take,
 * was it refused" from logs alone, before any database exists.
 *
 * `console.info` rather than a logging library: nothing in the stack has one
 * yet, and introducing one from this task would be a dependency decision that
 * belongs to W0-A.
 */
export async function recordAiTrace(input: AiTraceInput): Promise<void> {
  try {
    // One structured line, no free text, no PII. Greppable by `azura.ai`.
    console.info(
      "azura.ai",
      JSON.stringify({
        surface: input.surface,
        role: input.role,
        language: input.language,
        intent: input.intent,
        source: input.source,
        model: input.model,
        refused: input.refused,
        refusalReason: input.refusalReason,
        refusalKind: input.refusalKind,
        grounded: input.grounded,
        injectionSignal: input.injectionSignal,
        gatewayAttempted: input.gatewayAttempted,
        gatewayOutcome: input.gatewayOutcome,
        latencyMs: toNullableInt(input.latencyMs),
        messageChars: toNullableInt(input.messageChars),
        citationCount: input.citationCount,
        promptTokens: toNullableInt(input.promptTokens),
        completionTokens: toNullableInt(input.completionTokens),
      })
    )

    // The service-role client is resolved but not yet used: it exists here so
    // the seam is visible, and so a later window adding an `ai_request_traces`
    // table has one obvious place to write. Resolving it also proves at runtime
    // that this module is server-only.
    const client = createServiceRoleClient()
    if (client === null) return
  } catch {
    // Observability is best-effort and must never affect the AI response.
  }
}
