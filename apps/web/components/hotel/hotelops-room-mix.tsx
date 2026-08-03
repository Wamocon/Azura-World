import { Check } from "lucide-react"
import type { ReactNode } from "react"

import { StackedBar, toneVar } from "@/components/charts"
import type { ChartPoint, ChartTone } from "@/components/charts"
import { Explain, type ExplainLabels } from "@/components/ui/explain"
import { cn } from "@/lib/cn"

/**
 * The room mix — the 188 rooms as a shape, then as six readable cards.
 *
 * ## Why the reconciliation line reads the way it does
 *
 * The page used to print "ROOMS IN TOTAL 188" beside "SUM OF PUBLISHED ROWS
 * 188" and leave the reader to do the subtraction. That is an internal check
 * leaking onto a customer surface: it asks a property manager to audit our data
 * pipeline. The check still runs — it is the one thing that would reveal a
 * broken import — but it is stated as its own conclusion. When the two agree,
 * one quiet sentence says so. When they disagree, that is a finding and it gets
 * the conflict treatment, with both figures named and neither adjusted.
 *
 * ## Why a stacked bar and not a table
 *
 * The mix is a composition of a fixed whole, which is the one thing a stacked
 * bar does better than any number. It matters here for a reason particular to
 * this dataset: the King Suite is 2 rooms out of 188, roughly one percent, and
 * a naive bar would render it at zero width. `StackedBar` widens any non-zero
 * segment to a visible minimum and borrows the space from the segments that
 * have it, so the smallest room type cannot silently vanish. It also ships the
 * `sr-only` table that is the actual record for a screen reader.
 *
 * The cards below the bar are not the same information twice. The bar and its
 * key answer "how do the rooms divide"; the cards answer "what is a room of
 * this type" — area, how many guests, sea view — which no bar can carry. Each
 * card repeats its segment colour as a swatch so the two layers link, and every
 * card is readable with the colours removed.
 *
 * A Server Component: no state, no client bundle beyond `<Explain>`.
 */

/**
 * One detail figure on a room-type card, and whether anyone published it.
 *
 * `gap` travels *with* the text rather than beside it because the two must never
 * disagree: a gap rendered in the colour of a measured value is the single
 * failure this page cannot afford, and a parallel `xIsGap` boolean is exactly
 * the shape that drifts. See the `<dd>` below for the two treatments.
 */
export interface HotelOpsRoomFigure {
  /** Already formatted, or the "not stated" wording when `gap` is true. */
  text: string
  gap: boolean
}

export interface HotelOpsRoomTypeCard {
  key: string
  /** The published code, e.g. "STD-SV". Shown small, as a label. */
  code: string
  /** The published name of the room type. Source text, rendered verbatim. */
  name: string
  /** Formatted room count, or the "not stated" wording when the row has none. */
  countText: string
  countIsGap: boolean
  /** Share of the published rooms, already formatted. `null` when unknowable. */
  shareText: string | null
  area: HotelOpsRoomFigure
  guests: HotelOpsRoomFigure
  seaView: HotelOpsRoomFigure
  /** Must match the tone given to this type's bar segment. */
  tone: ChartTone
}

export interface HotelOpsRoomMixLabels {
  heading: string
  detailHeading: string
  /**
   * The unit word printed after a room count, e.g. "rooms".
   *
   * One word for the whole grid, which is wrong in Russian for counts ending in
   * 2–4 ("2 номера", not "2 номеров"). Inflecting it needs an ICU plural whose
   * branches are single words, and `scripts/check-i18n.mjs` rule 4 reads such a
   * branch body as an argument name and fails the catalogue. Recorded in the
   * review handoff for the catalogue owner rather than worked around here.
   */
  rooms: string
  area: string
  guests: string
  seaView: string
  chartAriaLabel: string
  chartBasis: string
  chartEmpty: string
  tableCategory: string
  tableValue: string
  noBreakdownHeading: string
  noBreakdown: string
}

export function HotelOpsRoomMix({
  labels,
  segments,
  cards,
  reconciliation,
  explainGap,
  className,
}: {
  labels: HotelOpsRoomMixLabels
  /** Only the types that state a count. May be shorter than `cards`. */
  segments: readonly ChartPoint[]
  cards: readonly HotelOpsRoomTypeCard[]
  /** The already-worded result of the total check. `null` when it cannot run. */
  reconciliation: { kind: "match" | "mismatch"; text: string } | null
  explainGap: ExplainLabels
  className?: string
}): ReactNode {
  return (
    <section
      data-slot="hotelops-room-mix"
      className={cn("flex min-w-0 flex-col gap-5", className)}
    >
      <h2 className="font-display text-lg font-semibold tracking-[-0.015em] text-foreground">
        {labels.heading}
      </h2>

      {cards.length === 0 ? (
        // The designed absence. Kept as its own slot because the verification
        // script asserts that this page renders a stated absence rather than an
        // empty table when nothing is published.
        <div
          data-slot="room-breakdown-gap"
          className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-6"
        >
          <h3 className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase">
            {labels.noBreakdownHeading}
          </h3>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {labels.noBreakdown}
            <span className="ml-1.5 inline-block align-middle">
              <Explain iconOnly labels={explainGap} />
            </span>
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
            <StackedBar
              segments={segments}
              ariaLabel={labels.chartAriaLabel}
              basis={labels.chartBasis}
              emptyLabel={labels.chartEmpty}
              tableLabels={{
                category: labels.tableCategory,
                value: labels.tableValue,
              }}
              height={20}
            />

            {reconciliation === null ? null : reconciliation.kind === "match" ? (
              <p
                data-slot="room-total-check"
                className="flex items-start gap-2 border-t border-border/70 pt-4 text-xs leading-relaxed text-muted-foreground"
              >
                <Check
                  aria-hidden="true"
                  className="mt-px size-3.5 shrink-0 text-confidence-confirmed"
                />
                {reconciliation.text}
              </p>
            ) : (
              <p
                role="status"
                data-slot="room-total-check"
                className="rounded-lg border border-confidence-conflicted/40 bg-surface-conflict px-3 py-2 text-xs leading-relaxed text-confidence-conflicted"
              >
                {reconciliation.text}
              </p>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <h3 className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase">
              {labels.detailHeading}
            </h3>

            <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
              {cards.map((card) => (
                <li
                  key={card.key}
                  data-slot="hotelops-room-type"
                  className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-[var(--ease-out)] hover:border-primary/40"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-sm"
                        style={{ backgroundColor: toneVar(card.tone) }}
                      />
                      <span className="truncate font-mono text-[0.6875rem] tracking-[0.14em] text-muted-foreground uppercase">
                        {card.code}
                      </span>
                    </span>
                    {card.shareText === null ? null : (
                      <span
                        data-numeric
                        className="shrink-0 text-xs font-semibold text-muted-foreground"
                      >
                        {card.shareText}
                      </span>
                    )}
                  </div>

                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-sm font-medium break-words text-foreground hyphens-auto">
                      {card.name}
                    </p>
                    {card.countIsGap ? (
                      <span className="inline-flex items-center gap-1.5 text-sm text-confidence-gap">
                        {card.countText}
                        <Explain iconOnly labels={explainGap} />
                      </span>
                    ) : (
                      <p className="flex items-baseline gap-1.5">
                        <span
                          data-numeric
                          className="font-display text-2xl leading-none text-foreground"
                        >
                          {card.countText}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {labels.rooms}
                        </span>
                      </p>
                    )}
                  </div>

                  <dl className="flex flex-col gap-1 border-t border-border/70 pt-3 text-xs">
                    {[
                      {
                        key: "area",
                        label: labels.area,
                        figure: card.area,
                        numeric: true,
                      },
                      {
                        key: "guests",
                        label: labels.guests,
                        figure: card.guests,
                        numeric: true,
                      },
                      {
                        key: "seaView",
                        label: labels.seaView,
                        figure: card.seaView,
                        numeric: false,
                      },
                    ].map((row) => (
                      <div
                        key={row.key}
                        className="flex min-w-0 items-baseline justify-between gap-3"
                      >
                        <dt className="min-w-0 break-words text-muted-foreground hyphens-auto">
                          {row.label}
                        </dt>
                        {/* A gap is the gap colour and never `font-medium`, so
                            "not stated" cannot be read as a measured figure —
                            the same treatment `data-table.tsx` gives a missing
                            cell. `data-numeric` is tabular figures, so it goes
                            on stated numbers only, not on words. */}
                        <dd
                          {...(row.numeric && !row.figure.gap
                            ? { "data-numeric": true }
                            : {})}
                          className={cn(
                            "shrink-0 text-right",
                            row.figure.gap
                              ? "text-confidence-gap"
                              : "font-medium text-foreground"
                          )}
                        >
                          {row.figure.text}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  )
}
