/**
 * The concierge pipeline. **The order of the steps is the security property.**
 *
 * ```
 *   1. length ceiling            2000 chars, before anything else
 *   2. (rate limit)              the route's job — needs a Request identity
 *   3. intent classification
 *   4. RBAC decision             denied ⟹ rbac-guard, NO outbound request
 *   5. retrieval from the dataset
 *   6. no grounding ⟹ refuse     do NOT call the model to "try anyway"
 *   7. gateway call
 *   8. validateGrounding         an ungrounded reply is DISCARDED, not warned about
 *   9. redact, trace, return
 * ```
 *
 * Steps 4 and 6 are the two that people move when they are optimising, and both
 * moves are bugs:
 *
 *  - **4 before 7.** A denied user must not cause an outbound request. The
 *    message would land in a model provider's logs, and the reason we denied it
 *    is precisely that this user should not be putting that subject in front of
 *    a third party. `scripts/ai-probe.mjs` asserts this with a spy in the
 *    gateway position and a call count of zero.
 *  - **6 before 7.** "Ask the model anyway, it might know" is how a competitor
 *    intelligence system starts inventing a competitor's prices. The dataset is
 *    the only admissible source; if it is silent, so are we.
 *
 * ## Why the gateway is injected
 *
 * `ConciergeDeps.gateway` is a port, not an import. That is what makes step 4
 * testable at all: a spy in this position records whether an outbound call
 * happened, which no amount of reading the code can prove. It also lets the
 * probe run fully offline and deterministically, so a red suite at 03:00 means
 * a real regression rather than someone else's endpoint being down.
 *
 * ## Everything returns HTTP 200
 *
 * Except an over-length input (422, CONTRACTS §5). A refusal is a successful
 * response that happens to say no; a missing gateway is a successful response
 * built from the dataset. There is no path in this module that produces a 5xx,
 * and W4-C should treat any reachable 500 on `/api/ai/*` as a High finding.
 */

import {
  contractRefusalReason,
  detectLanguage,
  getAiAccessDecision,
  hasPromptInjectionSignal,
  redactSensitive,
  validateGrounding,
  type AiIntent,
  type RefusalKind,
} from "./ai-guardrails"
import { buildSystemPrompt, buildUserPrompt } from "./ai-prompt"
import {
  buildDeterministicAnswer,
  buildRefusal,
  buildUngroundedFallback,
} from "./ai-responses"
import { retrieve, type RetrievalResult } from "./ai-retrieval"
import type { GatewayCompleter, LocalAiPurpose } from "./local-ai"
import type { AiResponse, Locale, Role, SourceRef } from "./contracts"

/** CONTRACTS §6 rule 4. Validated before anything else touches the message. */
export const MAX_MESSAGE_CHARS = 2000

/** Prior turns are clipped, never dropped silently, and never before the prompt. */
const MAX_PRIOR_CONVERSATION_CHARS = 4000

export interface ConciergeInput {
  message: string
  role: Role
  /** The UI locale. The message's own language wins when they differ. */
  locale: Locale
  priorConversation?: string
  signal?: AbortSignal
}

export interface ConciergeDeps {
  /** `null` ⟹ no gateway; the deterministic answer is final. */
  gateway: GatewayCompleter | null
}

/** Everything observability needs, and nothing that could carry message text. */
export interface ConciergeTrace {
  intent: AiIntent
  language: Locale
  refusalKind: RefusalKind | null
  permission: string | null
  grounded: boolean
  gatewayAttempted: boolean
  gatewayOutcome:
    "ok" | "not_attempted" | "unconfigured" | "error" | "discarded_ungrounded"
  gatewayError: string | null
  injectionSignal: boolean
  latencyMs: number
  messageChars: number
  citationCount: number
  factKeys: string[]
  findingIds: string[]
  promptTokens: number | null
  completionTokens: number | null
  httpStatus: 200 | 422
}

export interface ConciergeOutput {
  response: AiResponse
  trace: ConciergeTrace
}

function refusal(
  kind: RefusalKind,
  locale: Locale,
  base: Omit<
    ConciergeTrace,
    "refusalKind" | "latencyMs" | "httpStatus" | "gatewayOutcome"
  >,
  startedAt: number,
  options: { source?: AiResponse["source"]; httpStatus?: 200 | 422 } = {}
): ConciergeOutput {
  return {
    response: {
      reply: buildRefusal(kind, locale),
      source: options.source ?? "deterministic-fallback",
      // A refusal asserts no facts, so it carries no citations — CONTRACTS §6
      // reads an empty array as exactly that.
      citations: [],
      model: null,
      refused: true,
      refusalReason: contractRefusalReason(kind),
    },
    trace: {
      ...base,
      refusalKind: kind,
      gatewayOutcome: "not_attempted",
      latencyMs: Date.now() - startedAt,
      httpStatus: options.httpStatus ?? 200,
    },
  }
}

/**
 * Which model tier a question deserves. Only two are reachable from here:
 * `german-copy` when the answer is German prose, `reasoning` when the answer has
 * to hold several conflicting values in view at once, `fast` otherwise. `pro` is
 * reserved for W3-* report generation, which is a different caller.
 */
function choosePurpose(
  intent: AiIntent,
  locale: Locale,
  retrieval: RetrievalResult
): LocalAiPurpose {
  const conflicted =
    retrieval.findings.length > 0 ||
    retrieval.prices.length > 2 ||
    retrieval.facts.some((f) => f.confidence === "conflicted")
  if (conflicted) return "reasoning"
  if (locale === "de" && intent !== "evidence") return "german-copy"
  return "fast"
}

/**
 * Runs one question end to end.
 *
 * Pure with respect to I/O apart from the injected gateway: no cookies, no
 * database, no `next/headers`. That is what lets `scripts/ai-probe.mjs` drive
 * the real pipeline rather than a re-implementation of it — a probe suite that
 * tests a parallel copy of the logic proves nothing about the code that ships.
 */
export async function runConcierge(
  input: ConciergeInput,
  deps: ConciergeDeps
): Promise<ConciergeOutput> {
  const startedAt = Date.now()
  const message = input.message.trim()
  const language = detectLanguage(message, input.locale)
  const injectionSignal = hasPromptInjectionSignal(message)

  const baseTrace: Omit<
    ConciergeTrace,
    "refusalKind" | "latencyMs" | "httpStatus" | "gatewayOutcome"
  > = {
    intent: "unknown",
    language,
    permission: null,
    grounded: false,
    gatewayAttempted: false,
    gatewayError: null,
    injectionSignal,
    messageChars: message.length,
    citationCount: 0,
    factKeys: [],
    findingIds: [],
    promptTokens: null,
    completionTokens: null,
  }

  // 1. Length ceiling. Before classification, before retrieval, before anything
  //    that would spend work on input we are going to reject anyway.
  if (message.length === 0 || message.length > MAX_MESSAGE_CHARS) {
    return refusal("input_too_long", language, baseTrace, startedAt, {
      httpStatus: 422,
    })
  }

  // 3. + 4. Classification and the RBAC decision, together, so the decision can
  //    never be made against a different intent than the one classified.
  const decision = getAiAccessDecision(input.role, message)
  const trace = {
    ...baseTrace,
    intent: decision.intent,
    permission: decision.permission,
  }

  if (!decision.allowed) {
    const kind = decision.refusalKind ?? "rbac_denied"
    // `rbac-guard` is reserved for a *permission* denial. An injection probe or
    // an out-of-scope question is refused by the guardrails, not by RBAC, and
    // labelling it `rbac-guard` would make the source field useless for
    // answering "did this user lack a permission?".
    return refusal(kind, language, trace, startedAt, {
      source: kind === "rbac_denied" ? "rbac-guard" : "deterministic-fallback",
    })
  }

  // 5. Retrieval.
  const retrieval = retrieve({
    intent: decision.intent,
    message,
    locale: language,
  })
  const citations: SourceRef[] = retrieval.citations
  const enriched = {
    ...trace,
    grounded: retrieval.grounded,
    citationCount: citations.length,
    factKeys: retrieval.facts.map((f) => f.key),
    findingIds: retrieval.findings.map((f) => f.id),
  }

  // 6. No grounding ⟹ refuse. The model is not consulted "just in case".
  if (!retrieval.grounded) {
    return refusal("no_grounding", language, enriched, startedAt)
  }

  const deterministic = buildDeterministicAnswer(retrieval, language)

  // 7. Gateway. Absent, slow or broken all land on the same deterministic answer
  //    that was already computed above.
  if (deps.gateway === null) {
    return {
      response: {
        reply: deterministic,
        source: "deterministic-fallback",
        citations,
        model: null,
        refused: false,
      },
      trace: {
        ...enriched,
        refusalKind: null,
        gatewayOutcome: "unconfigured",
        latencyMs: Date.now() - startedAt,
        httpStatus: 200,
      },
    }
  }

  const prior =
    input.priorConversation === undefined
      ? undefined
      : input.priorConversation.slice(-MAX_PRIOR_CONVERSATION_CHARS)

  const messages = [
    {
      role: "system" as const,
      content: buildSystemPrompt(language, input.role),
    },
    {
      role: "user" as const,
      content: buildUserPrompt({
        locale: language,
        message,
        // Already fenced and neutralised by `retrieve`.
        groundedContext: retrieval.groundedContext,
        ...(prior === undefined ? {} : { priorConversation: prior }),
      }),
    },
  ]

  let completion
  try {
    completion = await deps.gateway(
      messages,
      choosePurpose(decision.intent, language, retrieval),
      input.signal
    )
  } catch (error) {
    return {
      response: {
        reply: deterministic,
        source: "deterministic-fallback",
        citations,
        model: null,
        refused: false,
      },
      trace: {
        ...enriched,
        refusalKind: null,
        gatewayAttempted: true,
        gatewayOutcome: "error",
        // The message, never the stack, and never the request body: a gateway
        // error can echo the prompt back, and the prompt contains the question.
        gatewayError: redactSensitive(
          error instanceof Error ? error.message : "unknown gateway error"
        ).slice(0, 200),
        latencyMs: Date.now() - startedAt,
        httpStatus: 200,
      },
    }
  }

  // 8. Post-check. A reply asserting a figure the evidence does not carry is
  //    DISCARDED — not shown with a warning next to it. A warning beside a wrong
  //    competitor price is still a wrong competitor price on the screen.
  const verdict = validateGrounding(
    completion.text,
    citations,
    retrieval.groundedContext
  )

  if (!verdict.grounded) {
    return {
      response: {
        reply: buildUngroundedFallback(deterministic, language),
        source: "deterministic-fallback",
        citations,
        model: null,
        // Not `refused`: the user does get a complete, sourced answer. The
        // discard is recorded in the trace, where it belongs, rather than
        // dressed up as a refusal the user has to interpret.
        refused: false,
      },
      trace: {
        ...enriched,
        refusalKind: "ungrounded_output",
        gatewayAttempted: true,
        gatewayOutcome: "discarded_ungrounded",
        gatewayError: `ungrounded: ${verdict.ungrounded.slice(0, 5).join(", ")}`,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens,
        latencyMs: Date.now() - startedAt,
        httpStatus: 200,
      },
    }
  }

  // 9. Return. Redaction runs on the way to the trace, not on the reply — the
  //    reply's specifics have just been proved to come from the evidence, and
  //    redacting a sourced figure would be destroying the product.
  return {
    response: {
      reply: completion.text,
      source: "gateway",
      citations,
      model: completion.model,
      refused: false,
    },
    trace: {
      ...enriched,
      refusalKind: null,
      gatewayAttempted: true,
      gatewayOutcome: "ok",
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      latencyMs: Date.now() - startedAt,
      httpStatus: 200,
    },
  }
}
