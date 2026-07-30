import type { ReactNode } from "react"

import { cn } from "@/lib/cn"
import {
  classifyDataNote,
  dataNoteSourceUrl,
  type DataNoteKind,
} from "@/lib/data-note"

/**
 * A caveat about one figure, in language the reader actually speaks.
 *                                                          Owner: W-NIGHT
 *
 * ## What this replaces
 *
 * Two surfaces rendered the raw `note` field out of the generated dataset
 * straight to the user. `/dashboard/listings` and `/dashboard/evidence` showed a
 * German-speaking property manager sentences like "page states the layout as
 * '5+ rooms', which is outside the frozen UnitLayout union" — a TypeScript type
 * name, in English, on a client-facing page.
 *
 * `lib/data-note.ts` classifies the note; this renders the translated sentence
 * for that class. All 43 distinct notes across 1,364 rows classify, verified.
 *
 * ## The original is kept, not deleted
 *
 * Behind a `<details>` disclosure, labelled as the internal wording. Two reasons,
 * and the second is the important one:
 *
 * 1. An analyst checking a figure needs the exact note, and this product's whole
 *    argument is that it does not hide its working.
 * 2. If the classifier ever meets a note it does not recognise it returns `null`,
 *    and this component then shows the original INSTEAD of a summary. A wrong
 *    plain-language gloss on a caveat is worse than an unpolished true one, so
 *    the fallback is the truth rather than a guess.
 *
 * `<details>` rather than a popover or a tooltip, deliberately. It needs no
 * JavaScript, it is keyboard-operable for free, it is reachable on touch (a
 * tooltip is not), it prints expanded, and a screen reader announces it as a
 * disclosure. A caveat behind a mouse hover is a caveat that does not exist for
 * a large share of readers.
 *
 * ## Nineteen of the notes carry a URL
 *
 * Lifted out and rendered as a real link, because "check the source" is the one
 * action a reader might actually want from a note, and it should not require
 * selecting a URL out of a paragraph.
 */

/** The resolved `dataNote.*` strings. Built once per request by `dataNoteLabels`. */
export interface DataNoteLabels {
  label: string
  originalLabel: string
  originalHint: string
  kinds: Record<DataNoteKind, string>
}

/**
 * Build the label set from a translator.
 *
 * A plain object rather than passing `t` down: these components are rendered
 * inside Client Components in places, and a translator function does not cross
 * the server/client boundary. Resolving eagerly costs 21 lookups per request and
 * removes the whole class of problem.
 */
export function dataNoteLabels(
  t: (key: string) => string
): DataNoteLabels {
  return {
    label: t("dataNote.label"),
    originalLabel: t("dataNote.originalLabel"),
    originalHint: t("dataNote.originalHint"),
    kinds: {
      modelled: t("dataNote.modelled"),
      noAvailability: t("dataNote.noAvailability"),
      liveListing: t("dataNote.liveListing"),
      conflicted: t("dataNote.conflicted"),
      blockSplit: t("dataNote.blockSplit"),
      groupEntryPrice: t("dataNote.groupEntryPrice"),
      cardFromPrice: t("dataNote.cardFromPrice"),
      portalPriceFrom: t("dataNote.portalPriceFrom"),
      asPublished: t("dataNote.asPublished"),
      wrongDistrict: t("dataNote.wrongDistrict"),
      rentNotSale: t("dataNote.rentNotSale"),
      monthlyRent: t("dataNote.monthlyRent"),
      implausibleArea: t("dataNote.implausibleArea"),
      layoutUnspecific: t("dataNote.layoutUnspecific"),
      noFloor: t("dataNote.noFloor"),
      villaFloor: t("dataNote.villaFloor"),
      noChain: t("dataNote.noChain"),
      noRanking: t("dataNote.noRanking"),
    },
  }
}

export function DataNote({
  note,
  labels,
  className,
  /** Hide the original-wording disclosure. For dense tables. */
  concise = false,
}: {
  note: string | null | undefined
  labels: DataNoteLabels
  className?: string
  concise?: boolean
}): ReactNode {
  if (note === null || note === undefined) return null
  const text = note.trim()
  if (text.length === 0) return null

  const kind = classifyDataNote(text)
  const url = dataNoteSourceUrl(text)

  // Unrecognised: show the original rather than a guess. See the header.
  if (kind === null) {
    return (
      <span
        className={cn(
          "mt-1 block max-w-[26rem] text-xs leading-relaxed text-muted-foreground",
          className
        )}
      >
        <span className="sr-only">{labels.label}: </span>
        {text}
      </span>
    )
  }

  return (
    <span
      className={cn(
        "mt-1 block max-w-[26rem] text-xs leading-relaxed text-muted-foreground",
        className
      )}
    >
      <span className="sr-only">{labels.label}: </span>
      {labels.kinds[kind]}

      {url !== null ? (
        <>
          {" "}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="azura-tap-compact inline-flex items-center underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            {new URL(url).hostname.replace(/^www\./, "")}
          </a>
        </>
      ) : null}

      {concise ? null : (
        <details className="group mt-1">
          <summary className="azura-tap-compact inline-flex cursor-pointer list-none items-center gap-1 text-[0.6875rem] tracking-[0.04em] text-muted-foreground/80 uppercase hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] [&::-webkit-details-marker]:hidden">
            {/* Rotates on open. `transform` only, and the disclosure works
                identically with the rotation suppressed. */}
            <span
              aria-hidden="true"
              className="inline-block transition-transform duration-[var(--duration-fast)] group-open:rotate-90 motion-reduce:transition-none"
            >
              ›
            </span>
            {labels.originalLabel}
          </summary>
          <span className="mt-1 block border-l-2 border-border pl-2 text-[0.6875rem] leading-relaxed text-muted-foreground/75">
            <span className="mb-0.5 block italic">{labels.originalHint}</span>
            {text}
          </span>
        </details>
      )}
    </span>
  )
}
