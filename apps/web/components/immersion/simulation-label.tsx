import { FlaskConical } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

/**
 * The loudest label in the build.                          Owner: W3-I
 *
 * W3-I's brief: *"This is the one component in the build most able to mislead,
 * so it carries the loudest label."* The simulation layer renders plausible
 * operational activity for a 656-unit complex we do not operate, using a
 * competitor's data. Someone will screenshot it for a deck. The label has to
 * survive that screenshot.
 *
 * Four properties, each of which is a defence against a specific failure:
 *
 *   ALWAYS VISIBLE   never hover-only, never a tooltip — a screenshot keeps it
 *   IN THE FLOW      not absolutely positioned, so it cannot be cropped off or
 *                    covered by a sticky header
 *   TEXT             not an image or a background, so it survives a print, a
 *                    greyscale copy and a screen reader
 *   ITS OWN COLOUR   `--simulation`, distinct from every live-data treatment,
 *                    and never reused for real data
 *
 * The 1Çatı reference does this well in `live-erp-simulation.tsx` (banner +
 * header badge + inline chip, three layers) and then forgets entirely in
 * `site-command-simulation.tsx`, which renders seed data with no disclosure at
 * all. This component exists so the discipline is structural rather than
 * remembered: an immersion surface cannot render without one.
 */

export interface SimulationLabelStrings {
  /** Short, uppercase. e.g. "SIMULATION" */
  short: string
  /** One line saying what this is. */
  title: string
  /** What the data actually is, and what it is not. */
  body: string
}

/**
 * Full disclosure banner. Every immersion surface opens with one.
 */
export function SimulationBanner({
  strings,
  className,
}: {
  strings: SimulationLabelStrings
  className?: string
}): ReactNode {
  return (
    <div
      // `role="note"` rather than `role="alert"`: this is standing context, not
      // an event. An alert would be announced over whatever the reader is
      // doing, every time the region re-renders.
      role="note"
      data-slot="simulation-banner"
      className={cn(
        "flex items-start gap-3 rounded-xl border-2 border-simulation/50 bg-surface-simulation p-3 text-simulation",
        className
      )}
    >
      <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-xs font-bold tracking-[0.08em] uppercase">
          {strings.title}
        </p>
        <p className="text-xs leading-relaxed text-foreground/80">
          {strings.body}
        </p>
      </div>
    </div>
  )
}

/**
 * Inline chip, for a card header inside an already-labelled surface.
 * Never a substitute for the banner — an addition to it.
 */
export function SimulationChip({
  strings,
  className,
}: {
  strings: SimulationLabelStrings
  className?: string
}): ReactNode {
  return (
    <span
      data-slot="simulation-chip"
      className={cn(
        "inline-flex min-h-6 shrink-0 items-center gap-1 rounded-md border border-simulation/50 bg-surface-simulation px-2",
        "text-[0.6875rem] font-bold tracking-[0.08em] text-simulation uppercase",
        className
      )}
    >
      <FlaskConical className="size-3" aria-hidden="true" />
      {strings.short}
    </span>
  )
}
