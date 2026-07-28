/**
 * Orchestration for the anonymous concierge.
 *
 * Shared by the JSON route, the streaming route and (for its identity handling)
 * the feedback route, so the three cannot drift apart on the parts that matter:
 * the role, the ceilings and the ordering.
 *
 * ## The visitor is a `guest`, and that is the whole authorisation model
 *
 * There is no second permission system for the public surface. The pipeline runs
 * with role `guest`, which `lib/rbac.ts` proves at compile time holds no write
 * permission on any resource, and which CONTRACTS §3 keeps below `manager` — so
 * `evidence:view` is out of reach and the conflict cockpit stays gated, while
 * `units:view` / `hotel:view` / `reviews:view` let a visitor get real sourced
 * answers. One matrix, one decision path, no "public mode" flag to get wrong.
 *
 * ## No memory, no persistence of the question
 *
 * An anonymous visitor gets no conversation thread. There is nobody to scope it
 * to, `ai_conversations.profile_id` would be null, and a transcript keyed on an
 * IP address is personal data we have no reason to hold. Each question is
 * answered on its own.
 *
 * ## Tighter ceilings than the dashboard
 *
 * 600 characters instead of 2000, 15 requests per 5 minutes instead of 40. The
 * dashboard caller is authenticated and accountable; this one is not.
 */

import { runConcierge } from "./ai-concierge"
import { detectLanguage } from "./ai-guardrails"
import { answerPublicTopic, classifyPublicTopic } from "./public-ai-knowledge"
import { defaultGateway } from "./local-ai"
import { locales, type AiResponse, type Locale } from "./contracts"

/** Shorter than the dashboard's 2000: an anonymous caller has less credit. */
export const MAX_PUBLIC_MESSAGE_CHARS = 600

export const PUBLIC_RATE_LIMIT = 15
export const PUBLIC_RATE_WINDOW_SECONDS = 300
export const PUBLIC_MAX_BODY_BYTES = 4_096

export interface PublicChatInput {
  message: string
  locale: Locale
  /** Which page the widget was opened on. Clipped; used only for analytics. */
  page: string | null
}

export interface PublicChatPayload extends AiResponse {
  language: Locale
  /** Set when the question was about the deliverable rather than the project. */
  topic: string | null
  responseMs: number
}

function asLocale(value: unknown): Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value)
    ? (value as Locale)
    : "de"
}

export type PublicParseResult =
  | { ok: true; value: PublicChatInput }
  | { ok: false; reason: "missing" | "too_long" }

/**
 * Hand-rolled rather than Zod, so the two failure modes stay distinguishable —
 * a missing message and an over-length one are different answers to the caller,
 * and flattening both into one `ZodError` loses that.
 */
export function parsePublicChatBody(body: unknown): PublicParseResult {
  const record =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {}

  const raw = record["message"]
  const message = typeof raw === "string" ? raw.trim() : ""
  if (message.length === 0) return { ok: false, reason: "missing" }
  if (message.length > MAX_PUBLIC_MESSAGE_CHARS) {
    return { ok: false, reason: "too_long" }
  }

  const page = record["page"]
  return {
    ok: true,
    value: {
      message,
      locale: asLocale(record["locale"]),
      page: typeof page === "string" ? page.slice(0, 120) : null,
    },
  }
}

/**
 * Answers one anonymous question.
 *
 * Questions about the deliverable itself — "what is this", "where do the numbers
 * come from", "do you hold personal data" — are answered from
 * `public-ai-knowledge.ts` **before** the pipeline runs. They have no dataset
 * behind them, so retrieval would find nothing and the concierge would correctly
 * but unhelpfully refuse a question it can answer perfectly well.
 *
 * Everything else goes through the identical pipeline the dashboard uses.
 */
export async function runPublicConcierge(
  input: PublicChatInput,
  startedAt: number = Date.now()
): Promise<PublicChatPayload> {
  const language = detectLanguage(input.message, input.locale)

  const topic = classifyPublicTopic(input.message)
  if (topic !== null) {
    return {
      reply: answerPublicTopic(topic, language),
      source: "deterministic-fallback",
      // Meta-answers about the deliverable assert no facts about the project,
      // so they carry no citations — which is exactly what CONTRACTS §6 reads
      // an empty array as.
      citations: [],
      model: null,
      refused: false,
      language,
      topic,
      responseMs: Date.now() - startedAt,
    }
  }

  const output = await runConcierge(
    { message: input.message, role: "guest", locale: language },
    { gateway: defaultGateway() }
  )

  return {
    ...output.response,
    language: output.trace.language,
    topic: null,
    responseMs: Date.now() - startedAt,
  }
}

/**
 * Splits a reply into stream frames.
 *
 * Fixed 96-character slices, matching the 1Çatı reference. The answer is fully
 * computed before the stream opens, so this is presentation, not generation —
 * which is worth knowing when reading the streaming route: there is no
 * partially-formed answer that an abort could leave behind.
 */
export function chunkReply(reply: string): string[] {
  const size = 96
  const chunks: string[] = []
  for (let index = 0; index < reply.length; index += size) {
    chunks.push(reply.slice(index, index + size))
  }
  return chunks.length > 0 ? chunks : [reply]
}
