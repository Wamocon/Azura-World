/**
 * Section shell and the label/value row.                             Owner: W3-A
 *
 * One spacing rhythm for the whole page lives here, so a section cannot quietly
 * invent its own. More space above a heading than below it — the rule that most
 * reliably separates a paced page from a stack of blocks.
 *
 * The heading treatment is the chart's, not a hero's: a hairline rule that runs
 * the full measure with the section's own designation set into it, the way a
 * sheet in a drawing set carries its title in the rule above the drawing. The
 * designation is real information — it is the funnel stage this section serves,
 * which is the document's own structure — and not a decorative `01 / 02 / 03`.
 */

import type { ReactNode } from "react"

import { Reveal } from "@/components/anim/reveal"
import { cn } from "@/lib/cn"

export function Section({
  id,
  designation,
  title,
  lead,
  children,
  className,
  /** Set on the one section that must not carry the standard rhythm. */
  bare = false,
}: {
  id: string
  /** Short, uppercase, real: the stage this section serves. */
  designation?: string
  title?: string
  lead?: ReactNode
  children: ReactNode
  className?: string
  bare?: boolean
}): ReactNode {
  return (
    <section
      id={id}
      // `scroll-mt` so a `#amenities` deep link does not park the heading under
      // the sticky top bar. Lenis honours native anchor offsets.
      className={cn(
        "scroll-mt-24",
        bare ? "" : "border-t border-border/60 pt-16 pb-14 sm:pt-24 sm:pb-20",
        className
      )}
    >
      {title !== undefined ? (
        <Reveal as="header" className="mb-8 sm:mb-10">
          {designation !== undefined ? (
            <div className="mb-4 flex items-center gap-3">
              <span className="text-[0.6875rem] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                {designation}
              </span>
              <span
                aria-hidden="true"
                className="h-px flex-1 bg-[color-mix(in_srgb,var(--foreground)_16%,transparent)]"
              />
            </div>
          ) : null}
          <h2 className="font-display text-[clamp(1.6rem,4vw,2.5rem)] leading-[1.1] tracking-[-0.02em] text-balance">
            {title}
          </h2>
          {lead !== undefined ? (
            <p className="mt-4 max-w-[68ch] text-[1.0625rem] leading-[1.6] text-muted-foreground">
              {lead}
            </p>
          ) : null}
        </Reveal>
      ) : null}
      {children}
    </section>
  )
}

/**
 * A label, a leader, and a value. The page's workhorse row.
 *
 * `value` is always a provenance component. `note` carries the source count or
 * a qualifier — it is the part that turns a fact sheet into a working paper.
 */
export function FactRow({
  label,
  value,
  note,
  className,
}: {
  label: string
  value: ReactNode
  note?: ReactNode
  className?: string
}): ReactNode {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 border-b border-border/50 py-3.5 last:border-b-0",
        "sm:flex-row sm:items-baseline sm:gap-0",
        className
      )}
    >
      <span className="shrink-0 text-[0.8125rem] tracking-[0.02em] text-muted-foreground uppercase sm:text-[0.875rem]">
        {label}
      </span>
      <span
        aria-hidden="true"
        className="mx-2 hidden min-w-4 flex-1 translate-y-[-0.28em] self-center border-b border-dotted border-[color-mix(in_srgb,var(--foreground)_22%,transparent)] sm:block"
      />
      <span className="flex min-w-0 flex-col items-start gap-0.5 sm:items-end">
        <span
          data-numeric
          className="text-[1rem] leading-[1.5] text-foreground"
        >
          {value}
        </span>
        {note !== undefined ? (
          <span className="text-[0.75rem] leading-[1.4] text-muted-foreground">
            {note}
          </span>
        ) : null}
      </span>
    </div>
  )
}

/**
 * The page's one container width. Declared once so no section can drift.
 * 72rem holds a 65–75ch measure for the body copy inside a two-column split
 * without the copy running to the full width, which is the actual failure the
 * measure rule is guarding against.
 */
export function Container({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <div className={cn("mx-auto w-full max-w-[72rem] px-5 sm:px-8", className)}>
      {children}
    </div>
  )
}
