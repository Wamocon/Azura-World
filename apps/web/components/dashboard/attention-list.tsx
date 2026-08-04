import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Inbox, Wrench } from "lucide-react"
import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import { cn } from "@/lib/cn"

/**
 * "What needs you now" — the top of every role's home page. Owner: W-NIGHT
 *
 * The dashboard home was the thinnest page in the product for seven of the
 * eleven roles, because it answered with counts. A count tells you the size of
 * a problem you have already found; this tells you there is one. See
 * `lib/attention-repository.ts` for what may and may not appear here.
 *
 * ## Every row is a link, and the link is the point
 *
 * There is no row that only informs. If something is worth putting at the top of
 * somebody's morning it is worth taking them to it in one click, so the whole
 * row is one anchor and the destination is named. A card that reports a number
 * and leaves the reader to find the page is the thing this replaces.
 *
 * ## Tone is a border and an icon, never colour alone
 *
 * `urgent` is the only loud treatment and only one thing earns it: a stored SLA
 * date that has passed. Two loud rows on one screen and neither is loud, so the
 * repository is strict about what qualifies rather than this component being
 * clever about how to draw it.
 *
 * ## Empty is a sentence
 *
 * An empty list renders "nothing needs you right now", not a zero and not a
 * vanished section. Those read completely differently: one is the answer to the
 * question the page exists to answer, the others look like the query broke.
 */

export type AttentionTone = "urgent" | "action" | "info"

export interface AttentionRow {
  key: string
  tone: AttentionTone
  /** Already resolved and interpolated by the page. */
  message: string
  href: string
  /** Accessible name for the row's link, naming the destination. */
  linkLabel: string
}

export interface AttentionListLabels {
  heading: string
  /** Shown when there is genuinely nothing. Not "0 items". */
  empty: string
  emptyHint: string
  degraded: string
}

const TONE: Record<
  AttentionTone,
  { row: string; icon: typeof AlertTriangle; iconClass: string }
> = {
  urgent: {
    row: "border-confidence-conflicted/45 bg-confidence-conflicted/5 hover:border-confidence-conflicted/70",
    icon: AlertTriangle,
    iconClass: "text-confidence-conflicted",
  },
  action: {
    row: "border-quality-stale/45 bg-quality-stale/5 hover:border-quality-stale/70",
    icon: Wrench,
    iconClass: "text-quality-stale",
  },
  info: {
    row: "border-border bg-card hover:border-primary/50",
    icon: Inbox,
    iconClass: "text-muted-foreground",
  },
}

export function AttentionList({
  rows,
  labels,
  degraded = false,
  className,
}: {
  rows: readonly AttentionRow[]
  labels: AttentionListLabels
  degraded?: boolean
  className?: string
}): ReactNode {
  return (
    <section
      aria-labelledby="attention-heading"
      data-slot="attention-list"
      className={cn("flex flex-col gap-3", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="attention-heading"
          className="font-display text-lg font-semibold tracking-[-0.012em] text-foreground"
        >
          {labels.heading}
        </h2>
        {degraded ? (
          <span className="text-xs text-confidence-gap">{labels.degraded}</span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-5">
          <CheckCircle2
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-confidence-confirmed"
          />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-medium text-foreground">{labels.empty}</p>
            <p className="max-w-prose text-sm text-muted-foreground">
              {labels.emptyHint}
            </p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const tone = TONE[row.tone]
            const Icon = row.tone === "info" ? pickInfoIcon(row.key) : tone.icon
            return (
              <li key={row.key} className="flex">
                <Link
                  href={row.href}
                  aria-label={row.linkLabel}
                  className={cn(
                    "group flex w-full min-w-0 items-center gap-3 rounded-xl border px-4 py-3",
                    "transition-colors duration-150 ease-[var(--ease-out)]",
                    "outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    tone.row
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn("size-4.5 shrink-0", tone.iconClass)}
                  />
                  <span className="min-w-0 flex-1 text-sm text-foreground">
                    {row.message}
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground",
                      "transition-transform duration-150 ease-[var(--ease-out)]",
                      "group-hover:translate-x-0.5 motion-reduce:transform-none"
                    )}
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** A calendar item should not wear the inbox icon. Cosmetic, and cheap. */
function pickInfoIcon(key: string): typeof AlertTriangle {
  return key === "upcoming-activities" ? CalendarClock : Inbox
}
