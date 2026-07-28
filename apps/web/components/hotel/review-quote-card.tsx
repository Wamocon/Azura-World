"use client"

import { useId, useState } from "react"

import { cn } from "@/lib/cn"
import type { AzuraReviewQuote } from "@/lib/azura-world-data"

/**
 * One guest review, verbatim.                                     Owner: W3-G
 *
 * ## This component renders untrusted third-party input
 *
 * `quote.text` is scraped from Tripadvisor. It is not ours, it is not
 * sanitised at the source, and it may contain HTML, emoji, RTL fragments or
 * anything else a stranger typed into a review box.
 *
 * It is rendered as a **text child of a JSX element**, which React escapes.
 * There is no `dangerouslySetInnerHTML` in this file or anywhere in
 * `components/hotel/` — CONVENTIONS §4 bans it outright for scraped competitor
 * HTML, and a review body is the single most obvious place someone would reach
 * for it to "make the formatting come through". The formatting does not come
 * through, and that is the correct outcome: `white-space: pre-line` preserves
 * the author's paragraph breaks, and nothing else about their markup survives.
 *
 * ## Never translated
 *
 * tasks/W3-G: "A mistranslated complaint is a fabricated allegation." There is
 * no translation path here, not even an opt-in one. Every card carries a
 * visible marker saying the text is the original.
 *
 * The dataset carries **no language field per quote**, so this component does
 * not assert which language a review is in. `lib/language-detection.ts` exists
 * but is a heuristic built for chat routing, and labelling a real person's
 * review with a guessed language is the same class of error as translating it.
 * Recorded as a gap in HANDOFF/W3-G.md rather than filled with a guess.
 *
 * ## The date is the platform's own string
 *
 * `AzuraReviewQuote.date` is "the page's literal published-date string, not
 * normalised to ISO" — "Jul 21", "May 2026". It is rendered as harvested. A
 * year cannot be inferred for "Jul 21" without inventing one, and a review
 * misdated by a year is exactly the staleness error CONVENTIONS §5 warns about.
 */

export interface ReviewQuoteLabels {
  /** e.g. "{rating} von {max}" */
  ratingOf: string
  /** e.g. "Bewertung nicht lesbar" */
  ratingUnknown: string
  /** e.g. "Originaltext, nicht übersetzt" */
  notTranslated: string
  /** e.g. "Vollständig anzeigen" */
  expand: string
  /** e.g. "Weniger anzeigen" */
  collapse: string
  /** e.g. "Auf Tripadvisor öffnen" */
  openReview: string
  /** e.g. "Veröffentlicht" */
  published: string
}

/** Above this, the body is clamped and gets an expand control. */
const CLAMP_CHARS = 320

export function ReviewQuoteCard({
  quote,
  scale,
  labels,
  tone,
  eyebrow,
  className,
}: {
  quote: AzuraReviewQuote
  scale: number
  labels: ReviewQuoteLabels
  /** Drives the accent only. Derived from the rating, never from the text. */
  tone?: "positive" | "negative" | "neutral"
  /** Optional heading above the quote, e.g. "Höchste Bewertung". */
  eyebrow?: string
  className?: string
}) {
  const bodyId = useId()
  const isLong = quote.text.length > CLAMP_CHARS
  const [expanded, setExpanded] = useState(false)
  const clamped = isLong && !expanded

  const resolvedTone =
    tone ??
    (quote.rating === null
      ? "neutral"
      : quote.rating >= Math.ceil(scale * 0.6)
        ? "positive"
        : "negative")

  return (
    <figure
      data-slot="review-quote"
      data-tone={resolvedTone}
      className={cn(
        "flex h-full flex-col gap-4 rounded-lg border border-border/70 bg-card p-5",
        "border-l-4",
        resolvedTone === "positive" && "border-l-confidence-confirmed",
        resolvedTone === "negative" && "border-l-confidence-conflicted",
        resolvedTone === "neutral" && "border-l-border",
        className
      )}
    >
      {eyebrow !== undefined ? (
        <p className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase">
          {eyebrow}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {quote.rating === null ? (
          <span className="text-sm text-muted-foreground">
            {labels.ratingUnknown}
          </span>
        ) : (
          <span
            className="font-display text-lg text-foreground"
            data-numeric
            aria-label={labels.ratingOf
              .replace("{rating}", String(quote.rating))
              .replace("{max}", String(scale))}
          >
            <span aria-hidden="true">
              {quote.rating}
              <span className="text-muted-foreground">/{scale}</span>
            </span>
          </span>
        )}
        <span className="text-sm text-muted-foreground">
          <span className="sr-only">{labels.published} </span>
          {quote.date}
        </span>
      </div>

      {/*
        The review body. `blockquote` is the correct element — this is a
        quotation from an external source, and `cite` carries its permalink.
        `pre-line` keeps the author's own paragraph breaks without letting any
        of their markup execute.
      */}
      <blockquote
        id={bodyId}
        cite={quote.url}
        className={cn(
          "grow text-sm leading-relaxed text-pretty whitespace-pre-line text-foreground/90",
          clamped && "line-clamp-6"
        )}
      >
        {quote.text}
      </blockquote>

      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {isLong ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls={bodyId}
            className={cn(
              "min-h-6 rounded-sm font-medium text-primary underline underline-offset-4",
              "transition-transform duration-150 ease-out active:scale-[0.97]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            )}
          >
            {expanded ? labels.collapse : labels.expand}
          </button>
        ) : null}

        <a
          href={quote.url}
          target="_blank"
          rel="noreferrer noopener nofollow"
          className={cn(
            "min-h-6 rounded-sm text-muted-foreground underline underline-offset-4",
            "transition-colors hover:text-foreground",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          )}
        >
          {labels.openReview}
        </a>

        {/*
          Always visible, never hover-only. A reader who cannot read this
          review needs to know we did not translate it — that is the point of
          the marker, and a marker behind a hover is invisible on touch.
        */}
        <span className="ml-auto font-mono text-[0.6875rem] tracking-[0.14em] text-muted-foreground uppercase">
          {labels.notTranslated}
        </span>
      </figcaption>
    </figure>
  )
}
