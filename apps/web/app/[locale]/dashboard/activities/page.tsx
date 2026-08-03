import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"

import { Link } from "@/app/navigation"
import { CapacityMeter } from "@/components/operations/capacity-meter"
import { activityStatusLabels } from "@/components/operations/labels"
import { zonedTimeLabel } from "@/components/operations/calendar-views"
import { Badge } from "@/components/ui/badge"
import { getUserProfile } from "@/lib/auth"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import { formatDateLong, PROJECT_TIME_ZONE } from "@/lib/format"
import {
  getActivities,
  getOperationsSummary,
  type Activity,
} from "@/lib/operations-repository"
import {
  activityCategories,
  type ActivityCategory,
} from "@/lib/operations-data"
import { hasPermission } from "@/lib/rbac"

/**
 * /[locale]/dashboard/activities — the scheduled programme.   Owner: W3-E
 *
 * ## The occupancy figure is missing, and the page says so
 *
 * `tasks/W3-E` asks for booking against capacity, enforced in the database.
 * There is no `activity_bookings` table: `public.activities` carries a
 * `capacity` column and nothing in the schema references it. So this page can
 * show how many places an activity HAS and cannot show how many are TAKEN.
 *
 * `<CapacityMeter booked={null}>` is that gap, rendered as a gap. The
 * alternative — counting zero bookings because there is no table to count — puts
 * "12 of 12 places free" on screen for an activity nobody can book, which reads
 * as researched and is invented.
 *
 * The mechanism that closes it is written and proven, not merely proposed:
 * `HANDOFF/W3-E-activity-capacity.sql` plus its concurrency probe. It needs
 * W1-A to land it, because `supabase/migrations/*` is W1-A's path.
 *
 * ## Times are the site's, and labelled
 *
 * Türkiye is UTC+3 all year. A Berlin reader is +2 in January and +1 in July, so
 * an unlabelled clock time is ambiguous for exactly the audience this product
 * has. Every time here is site time and the header says which zone that is.
 */

/**
 * The browser tab, in the reader's language. This was a German literal, so a
 * Turkish page carried a German tab; the heading beside it was already
 * translated, which made the mismatch worse rather than invisible.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.activities" })
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  }
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function isCategory(value: string | undefined): value is ActivityCategory {
  return (
    value !== undefined &&
    (activityCategories as readonly string[]).includes(value)
  )
}

export default async function ActivitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  const query = await searchParams

  const t = await getTranslations({ locale, namespace: "dashboard.activities" })
  const tCommon = await getTranslations({ locale, namespace: "common" })
  const profile = await getUserProfile()

  if (!hasPermission(profile.role, "activities:view")) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p role="alert" className="max-w-prose text-sm text-muted-foreground">
          {tCommon("errors.forbidden")}
        </p>
      </div>
    )
  }

  const scope = {
    role: profile.role,
    ...(profile.id === null ? {} : { profileId: profile.id }),
  }

  const categoryFilter = first(query["category"])
  const activeCategory = isCategory(categoryFilter) ? categoryFilter : undefined
  const showPast = first(query["range"]) === "all"

  const [summaryResult, activitiesResult] = await Promise.all([
    getOperationsSummary(scope),
    getActivities({
      ...scope,
      limit: 200,
      ...(activeCategory === undefined ? {} : { category: activeCategory }),
      ...(showPast ? {} : { upcomingOnly: true }),
    }),
  ])

  const activities = activitiesResult.data
  const summary = summaryResult.data
  const degraded =
    activitiesResult.source === "local-seed" ||
    summaryResult.source === "local-seed"

  const statusLabels = activityStatusLabels(t)

  const capacityLabels = {
    occupancy: (booked: number, capacity: number) =>
      t("capacity.occupancy", { booked, capacity }),
    remaining: (free: number) => t("capacity.remaining", { free }),
    full: t("capacity.full"),
    uncapped: t("capacity.uncapped"),
    unknown: t("capacity.unknown"),
    waitlist: (n: number) => t("capacity.waitlist", { n }),
    totalPlaces: (capacity: number) => t("capacity.totalPlaces", { capacity }),
  }

  const hrefFor = (next: {
    category?: ActivityCategory | null
    range?: "all" | null
  }) => {
    const sp = new URLSearchParams()
    const category =
      next.category === undefined
        ? activeCategory
        : (next.category ?? undefined)
    if (category) sp.set("category", category)
    const range =
      next.range === undefined
        ? showPast
          ? "all"
          : undefined
        : (next.range ?? undefined)
    if (range) sp.set("range", range)
    const search = sp.toString()
    return `/dashboard/activities${search ? `?${search}` : ""}`
  }

  // Grouped by site-local day so the list reads as a programme rather than a
  // table of timestamps.
  const groups = new Map<string, Activity[]>()
  for (const activity of activities) {
    const day = activity.startsAt.slice(0, 10)
    const bucket = groups.get(day)
    if (bucket === undefined) groups.set(day, [activity])
    else bucket.push(activity)
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t("lead")}</p>
        <p className="text-xs text-muted-foreground">
          {t("timeZoneNote", { zone: PROJECT_TIME_ZONE })}
        </p>
      </header>

      {degraded ? (
        <p
          role="status"
          className="rounded-lg border border-confidence-gap/30 bg-confidence-gap/10 px-3 py-2 text-sm text-foreground"
        >
          {t("seedNotice")}
        </p>
      ) : null}

      {/* The single most important sentence on this page. Stated once, at the
          top, rather than only inside each capacity meter. */}
      <div className="rounded-lg border border-confidence-gap/30 bg-confidence-gap/10 px-4 py-3">
        <p className="text-sm font-medium text-foreground">
          {t("bookingUnavailable.title")}
        </p>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {t("bookingUnavailable.body")}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={t("stats.upcoming")} value={summary.upcomingActivities} />
        <Stat
          label={t("stats.scheduled")}
          value={summary.activitiesByStatus.scheduled}
        />
        <Stat
          label={t("stats.cancelled")}
          value={summary.activitiesByStatus.cancelled}
        />
      </dl>

      <nav
        aria-label={t("filterLabel")}
        className="flex flex-wrap items-center gap-2"
      >
        <FilterChip
          href={hrefFor({ category: null })}
          active={activeCategory === undefined}
        >
          {t("filterAll")}
        </FilterChip>
        {activityCategories.map((category) => (
          <FilterChip
            key={category}
            href={hrefFor({ category })}
            active={activeCategory === category}
          >
            {t(`category.${category}`)}
          </FilterChip>
        ))}
        <FilterChip
          href={hrefFor({ range: showPast ? null : "all" })}
          active={showPast}
        >
          {showPast ? t("filterUpcomingOnly") : t("filterIncludePast")}
        </FilterChip>
      </nav>

      {activities.length === 0 ? (
        <p className="rounded-lg border border-border bg-background/50 p-6 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {[...groups.entries()].map(([day, dayActivities]) => (
            <section key={day} className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                {formatDateLong(`${day}T12:00:00Z`, locale)}
              </h2>
              <ul className="flex flex-col gap-2">
                {dayActivities.map((activity) => (
                  <li
                    key={activity.id}
                    className={cn(
                      "flex flex-col gap-2 rounded-lg border border-border p-4 sm:flex-row sm:items-start sm:justify-between",
                      activity.status === "cancelled" && "bg-muted/30"
                    )}
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {activity.title}
                        </span>
                        <Badge variant="muted">
                          {t(`category.${activity.category}`)}
                        </Badge>
                        <Badge
                          variant={
                            activity.status === "cancelled"
                              ? "stale"
                              : "outline"
                          }
                        >
                          {statusLabels[activity.status]}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground tabular-nums">
                        {zonedTimeLabel(activity.startsAt, locale)}
                        {" – "}
                        {zonedTimeLabel(activity.endsAt, locale)}
                        {activity.location === null
                          ? ""
                          : ` · ${activity.location}`}
                      </p>
                      {activity.description === null ? null : (
                        <p className="max-w-prose text-sm text-muted-foreground">
                          {activity.description}
                        </p>
                      )}
                    </div>
                    <CapacityMeter
                      capacity={activity.capacity}
                      // Not zero. There is no table to count. See the header.
                      booked={null}
                      labels={capacityLabels}
                      className="shrink-0 sm:w-56"
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-background/50 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl text-foreground tabular-nums">{value}</dd>
    </div>
  )
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex min-h-6 items-center rounded-full border px-3 py-1 text-sm transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground"
      )}
    >
      {children}
    </Link>
  )
}
