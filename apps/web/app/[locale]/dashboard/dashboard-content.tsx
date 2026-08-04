"use client"

import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

/**
 * The arrival animation, replayed once per navigation.        Owner: W-NIGHT
 *
 * ## Why this is a component and not a `className` in the layout
 *
 * A CSS animation runs when its element mounts. The layout's wrapper does not
 * unmount between dashboard routes — that is the point of a layout — so putting
 * `.azura-content-in` there would play it once, on the first page of the
 * session, and never again. The wait it exists to resolve happens on every
 * navigation after that one.
 *
 * `key={pathname}` is the whole mechanism: React tears down the subtree and
 * builds a new one when the key changes, so the animation restarts. Nothing
 * else here is doing any work, which is why it is a client component of eleven
 * lines and the page beneath it stays a Server Component.
 *
 * ## Why the key is the pathname and not the search string
 *
 * Filtering a ticket queue by status is a change of view, not a change of page,
 * and replaying an entrance on it would make every filter click flicker.
 * `usePathname` excludes the query deliberately; `/dashboard/tickets?status=open`
 * and `/dashboard/tickets` are one destination as far as this is concerned.
 *
 * The motion itself, its duration, its curve and its reduced-motion branch are
 * all in `.azura-content-in` in `globals.css`.
 */
export function DashboardContent({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return (
    <div key={pathname} className="azura-content-in min-w-0">
      {children}
    </div>
  )
}
