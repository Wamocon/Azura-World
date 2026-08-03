import { ChevronRight, ExternalLink, ThumbsDown, ThumbsUp } from "lucide-react"
import type { ReactNode } from "react"

import { Explain, type ExplainLabels } from "@/components/ui/explain"
import { cn } from "@/lib/cn"
import { intlLocaleTag } from "@/lib/format"

/**
 * One verbatim guest review, opened by the reader.        Owner: dashboard/reviews
 *
 * ## What was wrong
 *
 * Both extremes were rendered as the full review body, unbroken. One of them
 * runs to fifteen paragraphs, so the page became that review with a score table
 * above it: the evidence buried the analysis it was evidence for.
 *
 * ## What this does instead
 *
 * The opening of the review is always on screen. The remainder sits behind a
 * native `<details>` disclosure. **The text is not duplicated and it is not
 * summarised** — `splitQuoteText()` cuts once at a paragraph or sentence
 * boundary, the part above the cut is the lead, the part below is the rest, and
 * opening the disclosure puts the two back together with nothing added and
 * nothing removed. There is no "AI summary" of a guest's words anywhere here.
 *
 * `<details>` and not a client toggle: the whole review is in the server HTML
 * either way, so it stays readable with no JavaScript, it is in the page for the
 * evidence gate, and Ctrl+F finds it.
 *
 * ## What stays exactly as it was
 *
 * The original-language note, the two recorded gaps (review language and review
 * title were never harvested) and the permalink out to the platform. None of the
 * three is behind the disclosure, because a reader who never opens it must still
 * see that the text is untranslated and that two fields are missing.
 */

// ---------------------------------------------------------------------------
// The cut
// ---------------------------------------------------------------------------

/** Below this, the whole review is short enough to show unbroken. */
const WHOLE_TEXT_MAX = 420
/** The lead may not run past this. */
const LEAD_MAX = 380
/** Nor stop before this, or the "lead" is a fragment. */
const LEAD_MIN = 120

/**
 * Split a review into the part shown and the part behind the disclosure.
 *
 * Cuts at the first paragraph break inside the window, else at the last
 * sentence end inside it, else at the last word break. The two halves always
 * reassemble to the original text — no ellipsis is inserted into the quotation
 * itself, and nothing is rewritten.
 */
export function splitQuoteText(text: string): { lead: string; rest: string } {
  const full = text.trim()
  if (full.length <= WHOLE_TEXT_MAX) return { lead: full, rest: "" }

  const paragraph = full.indexOf("\n\n")
  if (paragraph >= LEAD_MIN && paragraph <= LEAD_MAX) {
    return {
      lead: full.slice(0, paragraph).trim(),
      rest: full.slice(paragraph).trim(),
    }
  }

  const line = full.indexOf("\n")
  if (line >= LEAD_MIN && line <= LEAD_MAX) {
    return { lead: full.slice(0, line).trim(), rest: full.slice(line).trim() }
  }

  const head = full.slice(0, LEAD_MAX)
  let cut = -1
  for (const match of Array.from(head.matchAll(/[.!?…]["')\]]?\s/g))) {
    const index = match.index
    const token = match[0]
    if (index === undefined || token === undefined) continue
    if (index >= LEAD_MIN) cut = index + token.length
  }
  if (cut < 0) {
    const space = head.lastIndexOf(" ")
    if (space >= LEAD_MIN) cut = space
  }
  if (cut < 0) return { lead: full, rest: "" }

  return { lead: full.slice(0, cut).trim(), rest: full.slice(cut).trim() }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export interface ReviewsQuoteCardLabels {
  lowest: string
  highest: string
  /** Carries {platform}; substituted here. */
  onPlatform: string
  /** Carries {label}; substituted here. The platform's own date wording. */
  publishedLabel: string
  scaleUnknown: string
  readFull: string
  collapse: string
  notTranslated: string
  missingHeading: string
  languageGap: string
  titleGap: string
  open: string
  explain: { gap: ExplainLabels }
}

export interface ReviewsQuote {
  url: string
  quoteText: string
  rating: number | null
  /** The platform's own wording, verbatim: "Jul 21", "May 2026". */
  quotedAtLabel: string | null
  /** The scale the rating was given on, from the review's own source row. */
  scale: 5 | 10 | null
  /** Display name of the platform that published it. */
  platformName: string | null
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export function ReviewsQuoteCard({
  quote,
  tone,
  labels,
  locale,
  className,
}: {
  quote: ReviewsQuote
  tone: "negative" | "positive"
  labels: ReviewsQuoteCardLabels
  locale: string
  className?: string
}): ReactNode {
  const { lead, rest } = splitQuoteText(quote.quoteText)
  // A rating is only rendered as a figure when its scale is known — the same
  // rule the score card applies. "4" beside "scale unusable" is still a "4" a
  // reader will read as four out of five.
  const ratingText =
    quote.rating === null || quote.scale === null
      ? null
      : new Intl.NumberFormat(intlLocaleTag(locale), {
          maximumFractionDigits: 2,
        }).format(quote.rating)

  const ToneIcon = tone === "negative" ? ThumbsDown : ThumbsUp

  return (
    <article
      data-slot="verdict-card"
      data-tone={tone}
      className={cn(
        "azura-edge-light flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:p-6",
        className
      )}
    >
      <header className="flex flex-col gap-3">
        <p className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-xs font-medium text-foreground">
          {/* The icon differs by shape, not only by colour, so the two ends of
              the scale survive greyscale and a colour vision deficiency. */}
          <ToneIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0",
              tone === "negative"
                ? "text-confidence-conflicted"
                : "text-confidence-confirmed"
            )}
          />
          {tone === "negative" ? labels.lowest : labels.highest}
        </p>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {ratingText === null ? (
            quote.rating === null ? null : (
              // The rating exists but its scale does not, so the figure is not
              // shown at all rather than shown beside a caveat.
              <p className="text-xs text-muted-foreground">
                {labels.scaleUnknown}
              </p>
            )
          ) : (
            <p className="flex items-baseline gap-1">
              <span
                data-numeric
                className="font-display text-3xl leading-none text-foreground tabular-nums"
              >
                {ratingText}
              </span>
              <span className="font-display text-lg leading-none text-muted-foreground">
                / {quote.scale}
              </span>
            </p>
          )}
          {quote.platformName === null ? null : (
            <p className="text-xs text-muted-foreground">
              {labels.onPlatform.replace("{platform}", quote.platformName)}
            </p>
          )}
        </div>

        {quote.quotedAtLabel === null ? null : (
          <p className="text-xs text-muted-foreground">
            {labels.publishedLabel.replace("{label}", quote.quotedAtLabel)}
          </p>
        )}
      </header>

      {/*
        Text child of a blockquote: React escapes it, and nothing here uses
        dangerouslySetInnerHTML. `pre-line` keeps the author's paragraph breaks
        and nothing else of their markup.
      */}
      <blockquote className="flex min-w-0 flex-col border-l-2 border-primary/30 pl-4">
        {/* `break-words`: guest text is not ours to control and a pasted URL
            would otherwise push the card past a 320px viewport. */}
        <p className="text-sm leading-relaxed break-words whitespace-pre-line text-foreground">
          {lead}
        </p>

        {rest === "" ? null : (
          <details className="group mt-3" data-slot="quote-disclosure">
            <summary
              className={cn(
                "azura-tap-compact inline-flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md",
                "text-xs font-medium text-primary underline underline-offset-4",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                "[&::-webkit-details-marker]:hidden"
              )}
            >
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  "size-3.5 shrink-0 transition-transform duration-[var(--duration-fast)]",
                  "ease-[var(--ease-out)] group-open:rotate-90 motion-reduce:transition-none"
                )}
              />
              <span className="group-open:hidden">{labels.readFull}</span>
              <span className="hidden group-open:inline">
                {labels.collapse}
              </span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed break-words whitespace-pre-line text-foreground">
              {rest}
            </p>
          </details>
        )}
      </blockquote>

      <footer className="mt-auto flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{labels.notTranslated}</p>

        {/* The two recorded gaps, stated per card rather than once at the
            bottom, so a reader cannot take a card out of context and assume the
            fields were simply blank. */}
        <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-border bg-muted/30 p-3">
          <p className="flex items-center gap-1.5 font-mono text-[0.625rem] tracking-[0.16em] text-muted-foreground uppercase">
            {labels.missingHeading}
            <Explain labels={labels.explain.gap} iconOnly />
          </p>
          <p
            data-testid="quote-language-gap"
            className="text-xs leading-relaxed text-muted-foreground"
          >
            {labels.languageGap}
          </p>
          <p
            data-testid="quote-title-gap"
            className="text-xs leading-relaxed text-muted-foreground"
          >
            {labels.titleGap}
          </p>
        </div>

        <a
          href={quote.url}
          target="_blank"
          rel="noreferrer noopener nofollow"
          className={cn(
            "azura-tap-compact inline-flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium",
            "text-primary underline underline-offset-4",
            "transition-transform duration-[var(--duration-instant)] ease-[var(--ease-out)] active:scale-[0.98]",
            "motion-reduce:transition-none",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          )}
        >
          <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
          {labels.open}
        </a>
      </footer>
    </article>
  )
}
