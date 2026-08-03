import {
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  Hotel,
  MessageSquare,
  Star,
  Store,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import { cn } from "@/lib/cn"

/**
 * The home page for someone who did not come here to read metrics. Owner: W-NIGHT
 *
 * ## Why these roles get a different page
 *
 * `guest`, `child_owner`, `child_tenant` and `child_guest` were given the same
 * KPI grid as everyone else, filled with the only panels they are allowed to
 * read: "Hotel rooms 64" and "Review sources 5". Both are true. Neither is
 * anything a hotel guest or a supervised family member came to the portal for,
 * and a page of two numbers measured 334 characters — it read as broken rather
 * than as scoped.
 *
 * The honest answer is that these roles have no metrics of their own, so this
 * does not invent any. It is a door, not a dashboard: here is who you are, here
 * is what you can do, one card per thing, in the reader's language.
 *
 * ## The cards are derived, never listed
 *
 * The caller passes the routes `routesForRole()` already resolved, so a card can
 * only ever point at a page that role genuinely holds the permission for. A
 * hand-written list here would be a second copy of the permission matrix, free
 * to drift, and its drift would show up as a welcome card leading to "you do not
 * have access to this data" — the worst possible first impression.
 */

export interface WelcomeCard {
  href: string
  title: string
  body: string
  /** Route slug, e.g. "hotel". Chooses the icon; unknown slugs fall back. */
  slug: string
}

const ICONS: Readonly<Record<string, LucideIcon>> = {
  units: Building2,
  listings: Store,
  hotel: Hotel,
  reviews: Star,
  activities: ClipboardList,
  calendar: CalendarDays,
  communications: MessageSquare,
  reports: FileText,
  wallet: Wallet,
}

export function WelcomePanel({
  greeting,
  lead,
  sectionTitle,
  cards,
  className,
}: {
  greeting: string
  lead: string
  sectionTitle: string
  cards: readonly WelcomeCard[]
  className?: string
}): ReactNode {
  return (
    <div className={cn("flex min-w-0 flex-col gap-8", className)}>
      <section
        aria-labelledby="welcome-hero"
        className={cn(
          "relative overflow-hidden rounded-2xl border border-border",
          "bg-gradient-to-br from-primary/10 via-card to-card px-6 py-8 sm:px-8 sm:py-10"
        )}
      >
        {/* Decorative only — the heading beside it carries the meaning. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex max-w-prose flex-col gap-2.5">
          <h2
            id="welcome-hero"
            className="font-display text-2xl font-semibold tracking-[-0.018em] text-foreground sm:text-3xl"
          >
            {greeting}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
            {lead}
          </p>
        </div>
      </section>

      <section aria-labelledby="welcome-actions" className="flex flex-col gap-4">
        <h2
          id="welcome-actions"
          className="font-display text-lg font-semibold tracking-[-0.012em] text-foreground"
        >
          {sectionTitle}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const Icon = ICONS[card.slug] ?? ClipboardList
            return (
              <li key={card.href} className="flex">
                <Link
                  href={card.href}
                  className={cn(
                    "group flex w-full min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4",
                    "transition-colors duration-150 ease-[var(--ease-out)]",
                    "hover:border-primary/50 hover:bg-primary/5",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                    >
                      <Icon className="size-4.5" />
                    </span>
                    <span className="min-w-0 font-medium text-foreground">
                      {card.title}
                    </span>
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    {card.body}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
