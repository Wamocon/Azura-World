/**
 * The model gateway — provider-agnostic, OpenAI chat-completions shape.
 *
 * There is no vendor SDK here and no vendor name in the code. The endpoint, the
 * key and the four model names all come from the environment, so swapping the
 * provider is a `.env` change rather than a code change. `HANDOFF/W0-ENV.md`
 * records the endpoint currently configured; this module does not care.
 *
 * ## Every failure here is a fallback, never a 5xx
 *
 * CONTRACTS §6 rule 2: unreachable or unconfigured ⟹
 * `source: "deterministic-fallback"`. So this module's contract with its caller
 * is simple — it either returns usable text, or it **throws**, and
 * `lib/ai-concierge.ts` treats any throw as "no gateway today". It never
 * returns a degraded string, because a caller cannot tell a degraded string from
 * a real answer and would ship it to a user.
 *
 * Five distinct throws, all caught by the same handler: unconfigured, aborted,
 * non-2xx, unparseable body, empty content. The last one matters more than it
 * looks — a gateway that returns `{"choices":[{"message":{"content":""}}]}` with
 * a 200 is a failure wearing a success, and treating it as an answer would ship
 * an empty reply to the user.
 *
 * ## Timeout
 *
 * 20 seconds, always, whether or not the caller passes a signal. The 1Çatı
 * reference has **no** timeout on this call (`lib/local-ai.ts` there) and a
 * hung gateway hangs the request; that gap is closed here rather than mirrored.
 */

import { serverEnv } from "./env"

/** The four purposes, each mapped to its own env-configured model. */
export type LocalAiPurpose = "fast" | "reasoning" | "german-copy" | "pro"

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface LocalAiCompletion {
  text: string
  model: string
  /** Token counts when the gateway reports them. Logged, never displayed. */
  promptTokens: number | null
  completionTokens: number | null
}

/** Hard ceiling. A gateway that has not answered in 20s is not going to. */
export const GATEWAY_TIMEOUT_MS = 20_000

/** Kept small: the concierge answers in a paragraph, not an essay. */
const MAX_TOKENS = 700

/** Low, not zero: this task is recitation with citations, not creativity. */
const TEMPERATURE = 0.15

/**
 * Purpose → env variable. Written as a switch rather than an index into
 * `serverEnv`, because indexing a `Record` whose values are a union of every
 * server setting yields `string | number | boolean | undefined` and would need a
 * cast to get back to a model name.
 */
function modelForPurpose(purpose: LocalAiPurpose): string | undefined {
  switch (purpose) {
    case "fast":
      return serverEnv.AI_MODEL_FAST
    case "reasoning":
      return serverEnv.AI_MODEL_REASONING
    case "german-copy":
      return serverEnv.AI_MODEL_GERMAN_COPY
    case "pro":
      return serverEnv.AI_MODEL_PRO
  }
}

/**
 * CONTRACTS §6 rule 2 keys the whole fallback path off this. Server-only:
 * `serverEnv` throws if read in a browser (lib/env.ts), which is the intended
 * failure — this module must never be bundled for the client.
 */
export function isLocalAiConfigured(): boolean {
  return (
    serverEnv.AI_API_URL !== undefined && serverEnv.AI_API_KEY !== undefined
  )
}

/**
 * The model for a purpose, falling back to `AI_MODEL_FAST`.
 *
 * Returns `null` rather than a made-up default when nothing is configured. A
 * literal like `"gpt-4o-mini"` here would be a vendor assumption in a
 * provider-agnostic module, and it would send a request that fails in a way that
 * looks like an outage rather than a misconfiguration.
 */
export function getLocalAiModel(purpose: LocalAiPurpose): string | null {
  return modelForPurpose(purpose) ?? serverEnv.AI_MODEL_FAST ?? null
}

/** Narrows the untyped gateway body without an `any` anywhere in the path. */
function extractContent(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return null
  const first: unknown = choices[0]
  if (typeof first !== "object" || first === null) return null
  const message = (first as { message?: unknown }).message
  if (typeof message !== "object" || message === null) return null
  const content = (message as { content?: unknown }).content
  return typeof content === "string" ? content : null
}

function extractUsage(payload: unknown): {
  promptTokens: number | null
  completionTokens: number | null
} {
  const empty = { promptTokens: null, completionTokens: null }
  if (typeof payload !== "object" || payload === null) return empty
  const usage = (payload as { usage?: unknown }).usage
  if (typeof usage !== "object" || usage === null) return empty
  const prompt = (usage as { prompt_tokens?: unknown }).prompt_tokens
  const completion = (usage as { completion_tokens?: unknown })
    .completion_tokens
  return {
    promptTokens: typeof prompt === "number" ? prompt : null,
    completionTokens: typeof completion === "number" ? completion : null,
  }
}

/**
 * One chat completion.
 *
 * Signature per the W2-C brief. `signal` is the caller's cancellation (a closed
 * browser tab on the streaming route); it is combined with the timeout rather
 * than replacing it, so a caller cannot accidentally disable the ceiling by
 * passing a signal that never fires.
 */
export async function completeWithLocalAi(
  messages: ChatMessage[],
  purpose: LocalAiPurpose,
  signal?: AbortSignal
): Promise<LocalAiCompletion> {
  const apiUrl = serverEnv.AI_API_URL
  const apiKey = serverEnv.AI_API_KEY
  if (apiUrl === undefined || apiKey === undefined) {
    throw new Error("AI gateway is not configured.")
  }

  const model = getLocalAiModel(purpose)
  if (model === null) {
    throw new Error("AI gateway has no model configured for this purpose.")
  }

  const base = apiUrl.replace(/\/$/, "")
  const path = serverEnv.AI_CHAT_COMPLETIONS_PATH
  const timeout = AbortSignal.timeout(GATEWAY_TIMEOUT_MS)
  const combined =
    signal === undefined ? timeout : AbortSignal.any([timeout, signal])

  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      stream: false,
    }),
    signal: combined,
    // The gateway response is never cached: two identical questions from two
    // roles may legitimately retrieve different context.
    cache: "no-store",
  })

  if (!response.ok) {
    // The body is deliberately not read into the error. A gateway's error body
    // can echo the request, and the request contains the user's message.
    throw new Error(`AI gateway returned status ${response.status}.`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error("AI gateway returned a body that is not JSON.")
  }

  const content = extractContent(payload)
  if (content === null || content.trim().length === 0) {
    throw new Error("AI gateway returned no assistant content.")
  }

  const usage = extractUsage(payload)
  const reportedModel = (payload as { model?: unknown }).model
  return {
    text: content.trim(),
    model: typeof reportedModel === "string" ? reportedModel : model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
  }
}

/**
 * The injectable port `lib/ai-concierge.ts` depends on.
 *
 * The orchestrator never imports `completeWithLocalAi` directly; it takes one of
 * these. That is what lets `scripts/ai-probe.mjs` prove the RBAC ordering — a
 * spy in this position records whether an outbound call happened at all, which
 * is the only way to assert "a denied user causes no outbound request" without
 * a network sandbox.
 */
export type GatewayCompleter = (
  messages: ChatMessage[],
  purpose: LocalAiPurpose,
  signal?: AbortSignal
) => Promise<LocalAiCompletion>

/** The real gateway, or `null` when unconfigured. */
export function defaultGateway(): GatewayCompleter | null {
  return isLocalAiConfigured() ? completeWithLocalAi : null
}
