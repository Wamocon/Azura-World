import { getTranslations } from "next-intl/server"

import { Skeleton } from "@/components/ui/skeleton"

/**
 * What the dashboard looks like while it is being read.       Owner: W-NIGHT
 *
 * ## The gap this closes
 *
 * There was no `loading.tsx` anywhere in this application — not one, for
 * twenty-four routes. Every dashboard route is dynamic by construction (the
 * root layout reads `headers()`, so nothing prerenders) and each does several
 * scoped database round trips before it can render a single character. Without
 * a Suspense fallback, Next holds the OLD page on screen for the whole of that
 * and then swaps it. Clicking a navigation item produced no visible response
 * whatsoever until the next page arrived complete.
 *
 * That is the difference between an application that feels considered and one
 * that feels dead, and it is not a matter of speed: the same request with a
 * skeleton in front of it reads as fast, and without one reads as broken. It is
 * also the most common reason a user clicks a nav item twice.
 *
 * ## Why one file and not twenty-four
 *
 * Placed on the `dashboard` segment, so it covers every route beneath it. A
 * per-route skeleton could match each page exactly, but twenty-four of them is
 * twenty-four things to keep in step with their pages, and the one that drifts
 * is worse than a generic shape — a skeleton that promises a table above a page
 * that renders cards is a layout shift with extra steps.
 *
 * So this is the shape every dashboard page actually shares: a title and a
 * lead, a row of figures, and a body. Anything more specific is a lie about a
 * page this file cannot see.
 *
 * ## It holds the shape rather than collapsing
 *
 * The heights come from `components/ui/skeleton.tsx`'s presets, which are sized
 * from the real primitives — `control` is a 44px control, `text` is the 1rem
 * body line box. Nothing here is a spinner: a spinner resolving into a
 * differently sized thing is exactly the cumulative-layout-shift defect the
 * skeleton exists to prevent, and this file would otherwise be the single
 * biggest source of it in the product.
 *
 * `.azura-shimmer` carries its own `prefers-reduced-motion` branch — it becomes
 * a static tinted block rather than losing its background, so the state is still
 * legible as "loading" with no movement at all.
 */
export default async function DashboardLoading() {
  const t = await getTranslations("common")

  return (
    <div
      // The one announcement for the whole surface. The skeletons below are
      // `aria-hidden` individually, so a screen reader hears "loading" once
      // instead of hearing nothing or hearing forty empty regions.
      aria-busy="true"
      aria-live="polite"
      className="flex min-w-0 flex-col gap-8"
    >
      <span className="sr-only">{t("states.loading")}</span>

      {/* The page header: title, then a lead line at prose width. */}
      <div className="flex min-w-0 flex-col gap-2">
        <Skeleton preset="heading" className="max-w-[18rem]" />
        <Skeleton preset="text" className="max-w-[32rem]" />
      </div>

      {/* The figures. Four is the count the KPI grid uses at desktop width, and
          the grid template is the same one, so the columns land where they will
          land rather than reflowing when the real numbers arrive. */}
      <div className="grid [grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-4"
          >
            <Skeleton preset="badge" />
            <Skeleton preset="heading" className="h-8 w-24" />
          </div>
        ))}
      </div>

      {/* The body. A section heading and six rows — the shape of a table and of
          a card list alike, which is why it is rows and not a single block. */}
      <div className="flex min-w-0 flex-col gap-3">
        <Skeleton preset="badge" className="w-32" />
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton
            key={index}
            preset="control"
            // A little lighter down the stack. Not decoration: it says the list
            // continues past the fold, which a flat block does not.
            style={{ opacity: 1 - index * 0.11 }}
          />
        ))}
      </div>
    </div>
  )
}
