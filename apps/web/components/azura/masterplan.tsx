"use client"

/**
 * The masterplan, drawn as a site plan on the chart.                 Owner: W3-A
 *
 * Seven residence blocks, the hotel, and the sea. Every block is a real
 * `<button>` carrying its own designation and unit count, and selecting one
 * writes `?block=B03` into the URL so a finding can be cited at a block.
 *
 * **The plan is schematic and says so.** No source publishes the site geometry,
 * so the arrangement here is a diagram of the *composition* — seven blocks, an
 * even split of 656 units, the hotel on the seaward side — and not a survey of
 * where the buildings stand. `DataQualityMark` renders on every block because
 * every block record is `modelled`; that mark is the honesty control and it is
 * visible in the plan, not only in the detail panel (azura-ui-ux §6).
 *
 * Not WebGL. A canvas cannot be read by a screen reader, indexed, or counted by
 * the evidence gate, and this content is a list of seven labelled records —
 * which is a job for DOM. The hero carries the 3D.
 */

import { useCallback, useState } from "react"
import type { ReactNode } from "react"

import { DataQualityMark } from "@/components/evidence/provenance-value"
import { cn } from "@/lib/cn"

export interface MasterplanBlock {
  code: string
  unitCount: number
  dataQuality: "portal_listing" | "official" | "modelled" | "source_missing"
  note: string
}

export interface MasterplanLabels {
  /** e.g. "Block" — prefixes each plan shape's accessible name. */
  blockLabel: string
  unitsLabel: string
  hotelLabel: string
  seaLabel: string
  /** Shown under the plan when a block is selected. */
  selectedLabel: string
  schematicNote: string
  quality: Record<
    "portal_listing" | "official" | "modelled" | "source_missing",
    string
  >
}

export function Masterplan({
  blocks,
  hotelRooms,
  labels,
  locale,
  initialBlock = null,
  className,
}: {
  blocks: readonly MasterplanBlock[]
  /** Rendered as text by the caller so this component formats no number. */
  hotelRooms: ReactNode
  labels: MasterplanLabels
  locale: string
  /**
   * The `?block=` deep link, **resolved on the server**.
   *
   * Not read from `window` in an effect and not through `useSearchParams`. The
   * route is dynamically rendered, so the server already has the search params
   * and can render the selected state into the HTML — which means a cited deep
   * link resolves correctly with JavaScript disabled, and there is no
   * setState-in-effect cascade for the React compiler to reject.
   */
  initialBlock?: string | null
  className?: string
}): ReactNode {
  const [selected, setSelected] = useState<string | null>(
    initialBlock !== null && blocks.some((b) => b.code === initialBlock)
      ? initialBlock
      : null
  )

  const select = useCallback((code: string) => {
    setSelected((current) => {
      const next = current === code ? null : code
      const url = new URL(window.location.href)
      if (next === null) url.searchParams.delete("block")
      else url.searchParams.set("block", next)
      // `replaceState`, not `pushState`: selecting a block is a view change, not
      // a navigation, and filling the back stack with seven entries makes the
      // browser Back button useless for leaving the page.
      window.history.replaceState(null, "", url)
      return next
    })
  }, [])

  const active = blocks.find((b) => b.code === selected) ?? null

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div
        className="relative w-full overflow-hidden rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--sea-mid)_30%,transparent)]"
        style={{
          // Land at the top, shoal, then open water at the foot of the plan —
          // the same bathymetric order as the hero plate, so the two read as
          // sheets from one survey.
          backgroundImage: `linear-gradient(
            180deg,
            color-mix(in srgb, var(--sand) 26%, var(--card)) 0%,
            color-mix(in srgb, var(--sand) 14%, var(--card)) 52%,
            color-mix(in srgb, var(--sea-shallow) 16%, var(--card)) 74%,
            color-mix(in srgb, var(--sea-mid) 26%, var(--card)) 100%
          )`,
        }}
      >
        <div className="relative flex flex-col gap-4 p-4 sm:p-6">
          {/* Residence blocks. A 4/3 split rather than a 7-wide row: seven
              equal shapes in a line reads as a chart axis, and this is a plan. */}
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {blocks.map((block) => {
              const isActive = block.code === selected
              return (
                <li key={block.code} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => select(block.code)}
                    aria-pressed={isActive}
                    className={cn(
                      "azura-tap group flex w-full min-w-0 flex-col items-start gap-1 rounded-[var(--radius-sm)]",
                      "border px-3 py-3 text-left",
                      "transition-[background-color,border-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
                      "active:scale-[0.98]",
                      isActive
                        ? "border-primary bg-primary/12"
                        : "border-[color-mix(in_srgb,var(--foreground)_18%,transparent)] bg-card/70 hover:border-primary/60"
                    )}
                  >
                    <span className="flex w-full min-w-0 items-center justify-between gap-2">
                      <span className="font-display text-base leading-none tracking-[-0.01em]">
                        {block.code}
                      </span>
                      <DataQualityMark
                        dataQuality={block.dataQuality}
                        labels={labels.quality}
                      />
                    </span>
                    <span
                      data-numeric
                      className="text-[0.75rem] tracking-[0.01em] text-muted-foreground"
                    >
                      {new Intl.NumberFormat(locale).format(block.unitCount)}{" "}
                      {labels.unitsLabel}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {/* The hotel sits between the blocks and the water, which is the one
              spatial relationship every source agrees on. */}
          <div
            className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[var(--radius-sm)] border border-dashed border-[color-mix(in_srgb,var(--foreground)_22%,transparent)] bg-card/60 px-3 py-3"
          >
            <span className="font-display text-base leading-none tracking-[-0.01em]">
              {labels.hotelLabel}
            </span>
            <span data-numeric className="text-[0.8125rem] text-muted-foreground">
              {hotelRooms}
            </span>
          </div>

          <p
            aria-hidden="true"
            className="text-center text-[0.6875rem] uppercase tracking-[0.06em] text-muted-foreground"
          >
            {labels.seaLabel}
          </p>
        </div>
      </div>

      {/* Selection detail lives in the DOM below the plan rather than inside it:
          a panel that overlays the plan hides the thing the reader just chose. */}
      <div aria-live="polite" className="min-h-[3.5rem]">
        {active !== null ? (
          <div className="rounded-[var(--radius-sm)] border border-border bg-card px-4 py-3">
            <p className="text-[0.8125rem] font-medium">
              {labels.selectedLabel} {active.code} ·{" "}
              <span data-numeric>
                {new Intl.NumberFormat(locale).format(active.unitCount)}
              </span>{" "}
              {labels.unitsLabel}
            </p>
            <p className="mt-1 text-[0.75rem] leading-[1.5] text-muted-foreground">
              {active.note}
            </p>
          </div>
        ) : (
          <p className="text-[0.75rem] leading-[1.5] text-muted-foreground">
            {labels.schematicNote}
          </p>
        )}
      </div>
    </div>
  )
}
