import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

/**
 * Section, and the page header.                            Owner: W3-B
 *
 * The layout primitives every module uses so six windows produce one product
 * rather than six pages that happen to share a sidebar.
 *
 * Server Components — they render props and hold no state, and a client
 * component that only renders props is a bundle-size bug (CONVENTIONS §2).
 *
 * Quiet on purpose. A dashboard shell earns trust by being legible, not by
 * being memorable: the visual interest in this product belongs to the landing
 * page and to the provenance treatments, and a section header competing with a
 * conflict badge for attention makes the conflict badge worth less.
 */

/**
 * The page header. Exactly one per module route, and it owns the single `<h1>`.
 *
 * `actions` is where a module puts its refresh control and its primary action;
 * `meta` is where the sync badge goes, so freshness sits beside the title
 * rather than in the topbar, which spans surfaces that may disagree about it.
 */
export function DashboardPageHeader({
  title,
  description,
  actions,
  meta,
  className,
}: {
  title: string
  description?: string
  actions?: ReactNode
  meta?: ReactNode
  className?: string
}): ReactNode {
  return (
    <header
      data-slot="dashboard-page-header"
      className={cn("flex min-w-0 flex-col gap-3 pb-6", className)}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">
            {title}
          </h1>
          {description === undefined ? null : (
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        {/* `flex-wrap` is not optional: two German action labels do not fit
            beside a title at 320px, and without it they overflow the page. */}
        {actions === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>

      {meta === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2">{meta}</div>
      )}
    </header>
  )
}

/**
 * A titled block within a page.
 *
 * `<h2>` by default — a module page has one `<h1>` in its header and sections
 * beneath it, which is the heading order a screen reader navigates by.
 */
export function DashboardSection({
  title,
  description,
  actions,
  children,
  className,
  headingLevel = "h2",
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  headingLevel?: "h2" | "h3"
}): ReactNode {
  const Heading = headingLevel

  return (
    <section
      data-slot="dashboard-section"
      className={cn("flex min-w-0 flex-col gap-4", className)}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Heading className="font-display text-lg font-semibold tracking-[-0.015em]">
            {title}
          </Heading>
          {description === undefined ? null : (
            <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions === undefined ? null : (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>

      {children}
    </section>
  )
}

/**
 * The KPI grid.
 *
 * `auto-fit` + `minmax` rather than fixed breakpoints: the number of cards
 * varies per role — an `admin` sees eleven, a `tenant` three — and a
 * `sm:grid-cols-2 lg:grid-cols-4` would leave a lone card stranded in a
 * four-column row for exactly the roles with the least to show.
 */
export function DashboardKpiGrid({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <div
      data-slot="dashboard-kpi-grid"
      className={cn(
        "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))]",
        className,
      )}
    >
      {children}
    </div>
  )
}
