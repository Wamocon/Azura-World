/**
 * Conversation memory.
 *
 * Every read and write goes through the **request-scoped** Supabase client,
 * which carries the caller's own JWT, so RLS decides what a thread contains. The
 * service-role client is deliberately not used here: memory is personal data,
 * and a helper that bypassed RLS to fetch "the user's own" rows would be one
 * predicate typo away from fetching somebody else's.
 *
 * ## A role change starts a new thread
 *
 * Every query filters on `role_at_time`. Context gathered as `manager` must
 * never be replayed into a `tenant` session — the earlier turns could contain
 * finance figures the tenant may not see, and re-feeding them through the
 * prompt would launder a permission the RBAC guard already refused. W1-A's
 * schema comment on that column says the same thing from the SQL side.
 *
 * ## Neither function throws
 *
 * `load` returns an empty context and `append` returns the id it was given.
 * Memory is an enhancement; losing it degrades continuity, and there is no
 * version of "the concierge is down because the transcript would not save" that
 * is better than answering without history.
 *
 * ## Retention
 *
 * Rows carry `expires_at` (90 days, W1-A's default) and every read filters on
 * it. An expired thread is invisible rather than resumed, so a stale transcript
 * cannot reappear months later in a context window.
 */

import { createClient } from "./supabase/server"
import { isSupabaseConfigured } from "./env"
import type { AiResponse, Locale, Role } from "./contracts"

/** Turns handed back verbatim. Older ones are folded into `summary`. */
const RECENT_TURNS = 6

/** Past this many stored turns, the older ones are summarised. */
const SUMMARY_TRIGGER = 16

/** Hard cap on any stored message body. `ai_messages` also caps at 8000. */
const MAX_CONTENT_CHARS = 4000

/** Hard cap on the running summary, so the prompt cannot grow without bound. */
const MAX_SUMMARY_CHARS = 1400

/** Per-line cap while condensing. */
const SUMMARY_LINE_CHARS = 160

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value)
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

export interface RecentTurn {
  sender: "user" | "assistant"
  content: string
}

export interface ConversationContext {
  conversationId: string | null
  summary: string
  recentTurns: RecentTurn[]
}

const EMPTY_CONTEXT: ConversationContext = Object.freeze({
  conversationId: null,
  summary: "",
  recentTurns: [],
})

export type AiMemorySurface = "dashboard" | "public"

/**
 * Resumes a thread, or reports that there is none.
 *
 * A `conversationId` that fails **any** of the four predicates — owner, role,
 * surface, not expired — is silently discarded rather than reported as an
 * error. Telling a caller "that conversation exists but is not yours" is an
 * enumeration oracle; behaving as though it does not exist is not.
 */
export async function loadConversationContext(params: {
  profileId: string | null
  role: Role
  conversationId?: string | null
  surface?: AiMemorySurface
}): Promise<ConversationContext> {
  if (!isSupabaseConfigured()) return EMPTY_CONTEXT
  if (params.profileId === null) return EMPTY_CONTEXT

  const surface = params.surface ?? "dashboard"

  try {
    const supabase = await createClient()
    if (supabase === null) return EMPTY_CONTEXT

    let conversationId: string | null = null
    let summary = ""

    if (isUuid(params.conversationId)) {
      const { data } = await supabase
        .from("ai_conversations")
        .select("id, running_summary")
        .eq("id", params.conversationId)
        .eq("profile_id", params.profileId)
        .eq("role_at_time", params.role)
        .eq("surface", surface)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle()

      const row = data as { id?: unknown; running_summary?: unknown } | null
      if (row !== null && isUuid(row.id)) {
        conversationId = row.id
        summary =
          typeof row.running_summary === "string" ? row.running_summary : ""
      }
    }

    if (conversationId === null) return EMPTY_CONTEXT

    const { data: messages } = await supabase
      .from("ai_messages")
      .select("sender, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(RECENT_TURNS)

    const rows = Array.isArray(messages) ? messages : []
    const recentTurns: RecentTurn[] = rows
      .map((row) => {
        const record = row as { sender?: unknown; content?: unknown }
        return {
          sender:
            record.sender === "assistant"
              ? ("assistant" as const)
              : ("user" as const),
          content: typeof record.content === "string" ? record.content : "",
        }
      })
      .filter((turn) => turn.content.length > 0)
      .reverse()

    return { conversationId, summary, recentTurns }
  } catch {
    return EMPTY_CONTEXT
  }
}

/**
 * Persists one exchange and returns the thread id.
 *
 * **Refusals are not persisted.** A refused turn produced no answer worth
 * resuming, and storing "the user asked something out of scope" would put the
 * out-of-scope text into a transcript that RLS then has to protect. Callers
 * decide; `lib/ai-concierge.ts` marks refusals with `refused: true` and the
 * route skips the call.
 */
export async function appendTurns(params: {
  profileId: string | null
  companyId: string | null
  role: Role
  locale: Locale
  conversationId?: string | null
  surface?: AiMemorySurface
  userMessage: string
  response: AiResponse
  latencyMs: number
  tokens: number | null
}): Promise<{ conversationId: string | null }> {
  const passthrough = { conversationId: params.conversationId ?? null }
  if (!isSupabaseConfigured()) return passthrough

  const surface = params.surface ?? "dashboard"

  try {
    const supabase = await createClient()
    if (supabase === null) return passthrough

    let conversationId: string | null = isUuid(params.conversationId)
      ? params.conversationId
      : null

    if (conversationId === null) {
      const { data, error } = await supabase
        .from("ai_conversations")
        .insert({
          profile_id: params.profileId,
          company_id: params.companyId,
          role_at_time: params.role,
          surface,
          locale: params.locale,
        })
        .select("id")
        .maybeSingle()

      if (error !== null) return passthrough
      const row = data as { id?: unknown } | null
      if (row === null || !isUuid(row.id)) return passthrough
      conversationId = row.id
    }

    const { error: insertError } = await supabase.from("ai_messages").insert([
      {
        conversation_id: conversationId,
        sender: "user",
        content: clip(params.userMessage, 2000),
      },
      {
        conversation_id: conversationId,
        sender: "assistant",
        content: clip(params.response.reply, MAX_CONTENT_CHARS),
        source: params.response.source,
        model: params.response.model,
        refused: params.response.refused,
        refusal_reason: params.response.refusalReason ?? null,
        citations: params.response.citations,
        tokens: params.tokens,
        latency_ms: Math.max(0, Math.trunc(params.latencyMs)),
      },
    ])
    if (insertError !== null) return { conversationId }

    await supabase
      .from("ai_conversations")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", conversationId)

    await maybeSummarize(supabase, conversationId)

    return { conversationId }
  } catch {
    return passthrough
  }
}

/**
 * Folds older turns into the running summary once a thread gets long.
 *
 * Deterministic and **gateway-free**: no second model call. A summariser that
 * needed the gateway would make memory fail exactly when the gateway is down,
 * which is when continuity matters most. The tail is kept when the summary
 * overflows, because recent context is worth more than old context.
 */
async function maybeSummarize(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  conversationId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("ai_messages")
    .select("id, sender, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })

  if (error !== null || !Array.isArray(data)) return
  if (data.length <= SUMMARY_TRIGGER) return

  const older = data.slice(0, data.length - RECENT_TURNS)
  const lines: string[] = []
  for (const row of older) {
    const record = row as { sender?: unknown; content?: unknown }
    if (typeof record.content !== "string" || record.content.length === 0)
      continue
    const who = record.sender === "assistant" ? "assistant" : "user"
    lines.push(`${who}: ${clip(record.content, SUMMARY_LINE_CHARS)}`)
  }

  const joined = lines.join("\n")
  const summary =
    joined.length <= MAX_SUMMARY_CHARS
      ? joined
      : `…${joined.slice(joined.length - (MAX_SUMMARY_CHARS - 1))}`

  await supabase
    .from("ai_conversations")
    .update({ running_summary: summary })
    .eq("id", conversationId)
}

/**
 * Renders memory for the prompt, wrapped in its own "this is data" header.
 *
 * Returns `""` when there is nothing, which `buildUserPrompt` drops entirely —
 * so the no-memory path produces a byte-identical prompt to a system that has no
 * memory at all.
 */
export function formatPriorConversation(context: ConversationContext): string {
  const parts: string[] = []
  if (context.summary.trim().length > 0) {
    parts.push(`Summary of earlier turns: ${context.summary.trim()}`)
  }
  if (context.recentTurns.length > 0) {
    parts.push(
      context.recentTurns.map((t) => `${t.sender}: ${t.content}`).join("\n")
    )
  }
  return parts.join("\n")
}
