"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { SourceChip, type SourceChipLabels } from "@/components/evidence/source-chip"
import { Button } from "@/components/ui/button"
import type { AiResponse, Locale, SourceRef } from "@/lib/contracts"

/**
 * The public AI concierge.                                    Owner: W3-H
 *
 * W2-C built a guarded AI layer with 152 probe assertions, of which 17 of 31
 * probes refuse, and shipped it with **no UI at all**. This is that UI.
 *
 * ## The design problem, and it is not a chat problem
 *
 * A chat widget's default visual language is wrong for this product. Chat UIs
 * are built to make an assistant feel fluent and confident, and W2-C's assistant
 * is deliberately neither: it refuses roughly half of what it is asked, and the
 * refusals are the feature. `azura-ui-ux` §8 is the rule that settles every
 * layout question here — *"a page that looks extraordinary and misrepresents its
 * certainty has failed."*
 *
 * So three inversions of the usual pattern:
 *
 * 1. **A refusal renders as an answer.** Same background, same typography, same
 *    weight as a substantive reply, with a quiet note explaining that no source
 *    was found. Not red, not an alert, no warning triangle. `tasks/W3-H` §4 is
 *    explicit: *"'Nicht belegt' is a good answer and should look like one."* A
 *    refusal styled as an error trains the reader to treat honesty as
 *    malfunction, and then to prefer whichever system refuses less.
 * 2. **Citations are always visible.** Never behind a hover, never in a
 *    disclosure. `azura-ui-ux` §5.3: a hover-only provenance affordance is
 *    invisible to touch and to screen readers, and the sourcing is the product.
 * 3. **The assistant's fluency is not amplified.** No typing dots, no avatar, no
 *    "thinking" personality. The stream renders because streaming is genuinely
 *    faster to first token, not to perform effort.
 *
 * ## Streaming, and stopping
 *
 * `/api/ai/public-chat/stream` emits NDJSON: one `meta` frame, then `delta`
 * frames, then a `done` frame carrying the whole payload. The `done` frame is
 * what this component commits to state, never the concatenated deltas — W2-C
 * wrote it that way so a client that dropped a delta still ends with the
 * complete, cited answer rather than a subtly truncated one. The deltas drive
 * the visible text only.
 *
 * Stop aborts the fetch. The server notices on its next `enqueue`, closes the
 * stream and stops work; that is why the abort is a real cancellation rather
 * than the UI merely looking away. A stopped answer is discarded and never
 * committed, so `tasks/W3-H`'s "chat aborted mid-stream, no truncated message
 * persisted as complete" holds by construction.
 */

/** One exchange. Both halves are kept so the transcript reads as a conversation. */
interface Exchange {
  id: string
  question: string
  /** `null` while the answer is still arriving. */
  answer: AiResponse | null
  /** Partial text during streaming; replaced by `answer.reply` on completion. */
  streamed: string
  error: string | null
  feedback: "positive" | "negative" | null
}

export interface ConciergeLabels {
  title: string
  subtitle: string
  placeholder: string
  send: string
  thinking: string
  stop: string
  clear: string
  empty: string
  disclaimer: string
  refusalNote: string
  notConfigured: string
  you: string
  assistant: string
  sourcesLabel: string
  errors: {
    unavailable: string
    rateLimited: string
    tooLong: string
    refused: string
  }
  feedback: {
    question: string
    helpful: string
    notHelpful: string
    thanks: string
  }
  source: SourceChipLabels
}

const MAX_MESSAGE_CHARS = 600

export function SiteConcierge({
  locale,
  labels,
  suggestions,
}: {
  locale: Locale
  labels: ConciergeLabels
  suggestions: readonly string[]
}): React.JSX.Element {
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Aborting on unmount is not politeness. Without it, a user who navigates away
  // mid-answer leaves the gateway generating tokens nobody will read, and the
  // component's setState would fire against an unmounted tree.
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const ask = useCallback(
    async (question: string): Promise<void> => {
      const trimmed = question.trim()
      if (trimmed.length === 0 || pending) return
      if (trimmed.length > MAX_MESSAGE_CHARS) return

      const id = crypto.randomUUID()
      setExchanges((current) => [
        ...current,
        { id, question: trimmed, answer: null, streamed: "", error: null, feedback: null },
      ])
      setDraft("")
      setPending(true)

      const controller = new AbortController()
      abortRef.current = controller

      const settle = (patch: Partial<Exchange>): void => {
        setExchanges((current) =>
          current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
        )
      }

      try {
        const response = await fetch("/api/ai/public-chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            locale,
            page: window.location.pathname,
          }),
          signal: controller.signal,
        })

        if (!response.ok || response.body === null) {
          settle({ error: errorFor(response.status, labels) })
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let visible = ""

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // NDJSON: split on newlines and keep the trailing partial line. A
          // chunk boundary can fall mid-object, and parsing the fragment would
          // throw away a frame.
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            if (line.trim().length === 0) continue
            let frame: { type?: string; text?: string; payload?: AiResponse }
            try {
              frame = JSON.parse(line) as typeof frame
            } catch {
              continue
            }
            if (frame.type === "delta" && typeof frame.text === "string") {
              visible += frame.text
              settle({ streamed: visible })
            }
            if (frame.type === "done" && frame.payload !== undefined) {
              // The authoritative value. Committed instead of `visible`, so a
              // dropped delta cannot produce a confident-looking half-answer.
              settle({ answer: frame.payload, streamed: "" })
            }
          }
        }
      } catch (caught) {
        // An abort is the user's own decision, not a failure to report. The
        // exchange keeps whatever text arrived and is marked as incomplete by
        // having no `answer`, so nothing partial is ever presented as final.
        if (caught instanceof DOMException && caught.name === "AbortError") return
        settle({ error: labels.errors.unavailable })
      } finally {
        setPending(false)
        abortRef.current = null
      }
    },
    [locale, labels, pending]
  )

  const rate = useCallback(
    async (exchangeId: string, rating: "positive" | "negative"): Promise<void> => {
      setExchanges((current) =>
        current.map((entry) =>
          entry.id === exchangeId ? { ...entry, feedback: rating } : entry
        )
      )
      try {
        await fetch("/api/ai/public-chat/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating }),
        })
      } catch {
        // The rating is already reflected locally and is aggregate signal only.
        // Surfacing a failure here would ask the reader to care about telemetry.
      }
    },
    []
  )

  return (
    <section
      aria-labelledby="concierge-title"
      className="flex w-full flex-col gap-6 rounded-2xl border border-border bg-card p-6"
    >
      <header className="flex flex-col gap-1.5">
        <h2 id="concierge-title" className="font-display text-2xl text-foreground">
          {labels.title}
        </h2>
        <p className="text-sm text-muted-foreground">{labels.subtitle}</p>
      </header>

      {exchanges.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{labels.empty}</p>
          <ul className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  onClick={() => void ask(suggestion)}
                  disabled={pending}
                  className="min-h-11 rounded-full border border-input px-4 py-2 text-left text-sm text-foreground transition-colors duration-[160ms] ease-[var(--ease-out)] hover:border-ring hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
        `polite`, never `assertive`. An assertive region interrupts a screen
        reader on every delta, which during a streamed answer means interrupting
        continuously — the reader would hear nothing else.
      */}
      <ol aria-live="polite" aria-busy={pending} className="flex flex-col gap-6">
        {exchanges.map((exchange) => (
          <li key={exchange.id} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {labels.you}
              </p>
              {/* Rendered as text, never as markup. This string reached the page
                  from an input box, and the concierge is one of only two
                  unauthenticated write paths in the app. */}
              <p className="text-sm text-foreground">{exchange.question}</p>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {labels.assistant}
              </p>

              {exchange.error !== null ? (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {exchange.error}
                </p>
              ) : exchange.answer !== null ? (
                <AnswerBody
                  answer={exchange.answer}
                  locale={locale}
                  labels={labels}
                  onRate={(rating) => void rate(exchange.id, rating)}
                  feedback={exchange.feedback}
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {exchange.streamed.length > 0 ? exchange.streamed : labels.thinking}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void ask(draft)
        }}
        className="flex flex-col gap-3"
      >
        <label htmlFor="concierge-input" className="sr-only">
          {labels.placeholder}
        </label>
        <textarea
          id="concierge-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              void ask(draft)
            }
          }}
          placeholder={labels.placeholder}
          maxLength={MAX_MESSAGE_CHARS}
          rows={3}
          className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || draft.trim().length === 0}>
            {labels.send}
          </Button>
          {pending ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => abortRef.current?.abort()}
            >
              {labels.stop}
            </Button>
          ) : null}
          {exchanges.length > 0 && !pending ? (
            <Button type="button" variant="ghost" onClick={() => setExchanges([])}>
              {labels.clear}
            </Button>
          ) : null}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {draft.length}/{MAX_MESSAGE_CHARS}
          </span>
        </div>
      </form>

      <p className="text-xs leading-relaxed text-muted-foreground">{labels.disclaimer}</p>
    </section>
  )
}

/**
 * A completed answer, refusal or otherwise.
 *
 * The only visual difference a refusal gets is the explanatory note underneath.
 * Same surface, same type, same weight — see the component header for why that
 * is a decision rather than an oversight.
 */
function AnswerBody({
  answer,
  locale,
  labels,
  onRate,
  feedback,
}: {
  answer: AiResponse
  locale: Locale
  labels: ConciergeLabels
  onRate: (rating: "positive" | "negative") => void
  feedback: "positive" | "negative" | null
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
        {answer.reply}
      </p>

      {answer.refused ? (
        <p className="border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
          {labels.refusalNote}
        </p>
      ) : null}

      {answer.citations.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">{labels.sourcesLabel}</p>
          <ul className="flex flex-wrap gap-2">
            {dedupeByUrl(answer.citations).map((source) => (
              <li key={`${source.url}-${source.snapshotHash}`}>
                <SourceChip source={source} locale={locale} labels={labels.source} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {feedback === null ? (
          <>
            <span className="text-xs text-muted-foreground">{labels.feedback.question}</span>
            <button
              type="button"
              onClick={() => onRate("positive")}
              className="min-h-11 rounded-md px-2 text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {labels.feedback.helpful}
            </button>
            <button
              type="button"
              onClick={() => onRate("negative")}
              className="min-h-11 rounded-md px-2 text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {labels.feedback.notHelpful}
            </button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">{labels.feedback.thanks}</span>
        )}
      </div>
    </div>
  )
}

/**
 * One chip per distinct source URL.
 *
 * Retrieval can cite the same page for several claims in one answer, and four
 * identical chips read as four sources. Deduplicating by URL keeps the count
 * honest — which matters most on exactly the answer this widget exists to
 * demonstrate, where four *different* portals disagree about one price.
 */
function dedupeByUrl(citations: readonly SourceRef[]): SourceRef[] {
  const seen = new Set<string>()
  const unique: SourceRef[] = []
  for (const citation of citations) {
    if (seen.has(citation.url)) continue
    seen.add(citation.url)
    unique.push(citation)
  }
  return unique
}

function errorFor(status: number, labels: ConciergeLabels): string {
  if (status === 429) return labels.errors.rateLimited
  if (status === 422) return labels.errors.tooLong
  if (status === 403) return labels.errors.refused
  return labels.errors.unavailable
}
