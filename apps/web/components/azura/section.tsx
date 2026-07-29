/**
 * Section shell, the label/value row, and the night panel.      Owner: W3-A
 *
 * One spacing rhythm for the whole page lives here, so a section cannot quietly
 * invent its own. More space above a heading than below it — the rule that most
 * reliably separates a paced page from a stack of blocks.
 *
 * ## What changed on the night surface
 *
 * The heading used to be a designation, a hairline, and an `h2` at
 * `clamp(1.6rem, 4vw, 2.5rem)`. On cream that read as a working paper. On the
 * night ground it read as small, because a dark surface swallows type that a
 * light one carries: the same size that looked deliberate at 90% lightness
 * looks timid at 5%.
 *
 * So the display step went up, the designation moved onto the accent, and the
 * heading arrives through a clip mask (`data-rise`) instead of a fade. The rule
 * became `azura-rule`, which starts and ends in nothing — a hard 1px line all
 * the way across a dark page reads as a table border.
 *
 * The mask matters for a reason beyond taste: `[data-rise]` is only ever
 * animated by the choreography island, and only for elements BELOW the fold at
 * setup. Anything already on screen is left exactly as the server rendered it,
 * so there is no state in which a heading is invisible.
 */

import type { ReactNode } from "react"

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
  /** Right-hand column of the heading block: a figure, a link, a note. */
  aside,
}: {
  id: string
  /** Short, uppercase, real: the stage this section serves. */
  designation?: string
  title?: string
  lead?: ReactNode
  children: ReactNode
  className?: string
  bare?: boolean
  aside?: ReactNode
}): ReactNode {
  return (
    <section
      id={id}
      // `scroll-mt` so a `#amenities` deep link does not park the heading under
      // the sticky top bar. Lenis honours native anchor offsets.
      className={cn(
        "scroll-mt-28",
        bare ? "" : "pt-20 pb-16 sm:pt-28 sm:pb-24",
        className
      )}
    >
      {title !== undefined ? (
        <header className="mb-10 sm:mb-14">
          {designation !== undefined ? (
            <div className="mb-6 flex items-center gap-4">
              <span className="azura-label shrink-0 text-primary">
                {designation}
              </span>
              <span aria-hidden="true" className="azura-rule flex-1" />
            </div>
          ) : null}

          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
            <div className="min-w-0 flex-1">
              <h2 className="azura-mask font-display text-[clamp(1.9rem,4.6vw,3.25rem)] leading-[1.06] tracking-[-0.03em] text-balance">
                <span data-rise className="block">
                  {title}
                </span>
              </h2>
              {lead !== undefined ? (
                <p className="mt-5 max-w-[62ch] text-[1.0625rem] leading-[1.65] text-muted-foreground">
                  {lead}
                </p>
              ) : null}
            </div>
            {aside !== undefined ? (
              <div className="shrink-0 lg:pb-2">{aside}</div>
            ) : null}
          </div>
        </header>
      ) : null}
      {children}
    </section>
  )
}

/**
 * One fact, as a tile. The page's workhorse.
 *
 * This was a dot-leader row — `LABEL ......... value`, the shape a restaurant
 * menu and a table of contents share. It was defended here on the grounds that
 * the leader lets the eye track from label to value without drawing a table,
 * which is true, and beside the point: the register it carries is *printed
 * document*. A stack of them reads as a specification sheet, and the product is
 * a system somebody runs a building with.
 *
 * The tile inverts the reading order. The value is the largest thing in the
 * cell and the label sits above it small, because a person scanning this is
 * looking for the number and then checking what it is — not reading a label and
 * following a line to find out. It also gives each fact its own edge, so an
 * eight-fact group becomes eight objects rather than one undifferentiated
 * column, which is what makes the grid work at any width without a leader to
 * hold the rows together.
 *
 * `data-numeric` stays on the value. The tabular-figures rule keys off it and a
 * column of prices still has to align.
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
        "group relative flex min-w-0 flex-col gap-1.5 rounded-[var(--radius)]",
        "border border-[color-mix(in_srgb,var(--foreground)_10%,transparent)]",
        "bg-[color-mix(in_srgb,var(--foreground)_3%,transparent)] p-5",
        "transition-colors duration-[var(--duration-base)] ease-[var(--ease-out)]",
        "hover:border-[color-mix(in_srgb,var(--primary)_45%,transparent)]",
        className
      )}
    >
      <span className="azura-label text-muted-foreground">{label}</span>
      <span
        data-numeric
        className="font-display text-[1.25rem] leading-[1.25] tracking-[-0.02em] text-balance text-foreground"
      >
        {value}
      </span>
      {note !== undefined ? (
        <span className="text-[0.8125rem] leading-[1.5] text-muted-foreground">
          {note}
        </span>
      ) : null}
    </div>
  )
}

/**
 * The night panel: the page's one container for grouped content.
 *
 * Two effects rather than a `backdrop-filter`. A blurred backdrop over a
 * full-bleed photograph costs a compositor layer per panel and this page
 * carries a dozen of them, which is a measurable scroll cost for a look that
 * `azura-pane`'s inset highlight already produces on a surface this dark.
 *
 * `data-sheen` opts the panel into the pointer-tracked highlight. It is a
 * `::before` on a `radial-gradient` at `--mx`/`--my`, both of which default to
 * the top centre — so a panel on a touch device, or before the choreography
 * island has run, is lit rather than looking unstyled.
 */
export function Panel({
  children,
  className,
  sheen = true,
}: {
  children: ReactNode
  className?: string
  sheen?: boolean
}): ReactNode {
  return (
    <div
      {...(sheen ? { "data-sheen": "" } : {})}
      className={cn(
        "azura-pane relative overflow-hidden",
        sheen && "azura-sheen",
        className
      )}
    >
      {/* The sheen paints on a `::before` at the panel's own stacking level, so
          content needs a layer above it or the highlight washes over the type. */}
      <div className="relative z-[1]">{children}</div>
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
