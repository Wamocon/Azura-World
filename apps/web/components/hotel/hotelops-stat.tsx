import type { ReactNode } from "react"

import { Explain, type ExplainLabels } from "@/components/ui/explain"
import { cn } from "@/lib/cn"

/**
 * One figure on the hotel operations page, and whether anyone published it.
 *
 * The page it serves used to render every fact as `label: value` with a bare
 * `—` wherever a source said nothing. That dash is exactly what the honesty
 * rules forbid: it reads as a typographic shrug, not as "no source states
 * this". So a stat has two shapes and they do not look alike — a stated figure
 * is large display type, an unstated one is small, in the gap colour, and
 * carries the glossary explanation beside it so the reader can find out what
 * "not stated" means without leaving the page.
 *
 * `title` holds the finer stored value where one exists (the beach distance is
 * stored in metres and read in km). It is never the only carrier of anything:
 * the visible text is already the same fact, just rounded to the unit the
 * sources use in prose.
 *
 * A Server Component. It renders props and holds no state, so it costs nothing
 * in the bundle — only `<Explain>` beneath it crosses to the client.
 */

export interface HotelOpsStatItem {
  /** React key, and the `data-stat` marker used by the verification script. */
  key: string
  label: string
  /** Already formatted and localised by the caller. Never a raw number. */
  value: string
  /** True when no source states this. `value` must then be the gap wording. */
  gap: boolean
  /** The finer stored figure, one hover away. `null` when there is none. */
  title: string | null
  /**
   * The sources disagree, and by how much.
   *
   * `null` for every figure with one settled value. When present, the figure is
   * rendered with the conflict marker and the competing reading beside it.
   *
   * This existed on the public `/hotel` page and not here, so `/dashboard/hotel`
   * showed "ROOMS 188" and "AQUAPARK SLIDES 13" as flat numbers while an
   * anonymous visitor got the honest version — 188 against 112 from Wyndham
   * Alanya, 13 against 16. The signed-in manager, who is the person who would
   * act on the figure, was the one getting the version with the argument
   * deleted. A 40% difference on the page's headline number.
   */
  conflict?: { label: string; alternatives: string } | null
}

export function HotelOpsStat({
  item,
  size = "lg",
  explainGap,
  className,
}: {
  item: HotelOpsStatItem
  /** `lg` for the headline band, `sm` for the supporting grid. */
  size?: "lg" | "sm"
  explainGap: ExplainLabels
  className?: string
}): ReactNode {
  return (
    <div
      data-slot="hotelops-stat"
      data-stat={item.key}
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
    >
      <dt className="font-mono text-[0.6875rem] leading-tight tracking-[0.18em] text-muted-foreground uppercase">
        {item.label}
      </dt>
      <dd className="min-w-0">
        {item.gap ? (
          <span className="inline-flex items-center gap-1.5 text-sm leading-tight text-confidence-gap">
            {item.value}
            <Explain iconOnly labels={explainGap} />
          </span>
        ) : (
          <span
            data-numeric
            className={cn(
              "block font-display leading-tight break-words text-foreground hyphens-auto",
              size === "lg" ? "text-2xl sm:text-3xl" : "text-lg"
            )}
            {...(item.title === null ? {} : { title: item.title })}
          >
            {item.value}
          </span>
        )}
        {/* The disagreement, under the figure rather than behind a hover.

            A conflict a reader has to discover is a conflict most readers do
            not discover, and this is the number they will quote. Text, not
            colour alone — `text-confidence-conflicted` carries the same signal
            for anyone who cannot see it. */}
        {item.conflict != null && !item.gap ? (
          <span className="mt-1 block text-xs leading-snug text-confidence-conflicted">
            {item.conflict.label} {item.conflict.alternatives}
          </span>
        ) : null}
      </dd>
    </div>
  )
}
