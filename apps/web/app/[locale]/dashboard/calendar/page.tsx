import { createHmac } from "node:crypto"

import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"

import { Link } from "@/app/navigation"
import {
  CalendarAgenda,
  CalendarMonth,
  startOfMonth,
  startOfWeek,
  weekKeys,
  zonedDayKey,
  type CalendarEntry,
  type CalendarLabels,
  type CalendarView,
} from "@/components/operations/calendar-views"
import { getUserProfile } from "@/lib/auth"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import { serverEnv } from "@/lib/env"
import { formatDateLong, intlLocale, PROJECT_TIME_ZONE } from "@/lib/format"
import { getActivities, getTickets } from "@/lib/operations-repository"
import { hasPermission } from "@/lib/rbac"

/**
 * /[locale]/dashboard/calendar — activities and ticket deadlines.  Owner: W3-E
 *
 * ## Sources
 *
 * Activities and ticket SLA due-dates. Reservations and handovers are named in
 * the brief and are **not** here: there is no reservation table in the schema
 * and no handover table, so there is nothing to read. An empty "Reservierungen"
 * legend entry would imply a source that does not exist.
 *
 * Both reads carry the caller's scope. A `service_provider` therefore sees only
 * the deadlines of tickets reachable from their own assignments; the brief calls
 * that out because a calendar is the easiest place to leak the existence of work
 * somebody cannot open.
 *
 * ## The zone is stated, never assumed
 *
 * The grid is drawn in `Europe/Istanbul`, because it describes what happens at
 * the site. Türkiye has no DST; Germany does. A Berlin reader who wants these in
 * their own zone subscribes to the feed, where every stamp is an absolute UTC
 * instant and their client does the conversion — correctly in both halves of the
 * year. That is the whole reason the feed emits `Z` times and no `X-WR-TIMEZONE`.
 */

export const metadata: Metadata = {
  title: "Kalender",
  robots: { index: false, follow: false },
}

const VIEWS: readonly CalendarView[] = ["month", "week", "day"]

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function isView(value: string | undefined): value is CalendarView {
  return value !== undefined && (VIEWS as readonly string[]).includes(value)
}

/** `YYYY-MM-DD`, and a real date. `2026-02-31` is rejected, not clamped. */
function parseDayKey(value: string | undefined): string | null {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10) === value ? value : null
}

/**
 * The feed token, derived from the secret exactly as
 * `app/api/calendar/ics/[token]/route.ts` derives it.
 *
 * **This is a duplicated derivation and it should not stay one.** The route is
 * W2-B's file and keeps the function private, so this window cannot import it;
 * copying three lines of HMAC is the smaller evil against inventing a second
 * token scheme. A request to export it is filed in HANDOFF/W3-E.md. If the two
 * ever disagree the symptom is a subscription URL that 404s, which is visible
 * rather than silent.
 */
function feedToken(secret: string): string {
  return createHmac("sha256", secret)
    .update("calendar-feed:activities")
    .digest("hex")
}

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  const query = await searchParams

  const t = await getTranslations({ locale, namespace: "dashboard.calendar" })
  const tTickets = await getTranslations({
    locale,
    namespace: "dashboard.tickets",
  })
  const tCommon = await getTranslations({ locale, namespace: "common" })
  const profile = await getUserProfile()

  if (!hasPermission(profile.role, "calendar:view")) {
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

  const view: CalendarView = isView(first(query["view"]))
    ? (first(query["view"]) as CalendarView)
    : "month"

  const todayKey = zonedDayKey(new Date().toISOString()) ?? "1970-01-01"
  const anchor = parseDayKey(first(query["date"])) ?? todayKey

  // A generous window either side of the anchor so a month grid's leading and
  // trailing days are populated. Bounded, never unbounded.
  const rangeStart = `${startOfMonth(anchor).slice(0, 8)}01T00:00:00.000Z`
  const rangeEnd = new Date(
    new Date(`${startOfMonth(anchor)}T00:00:00Z`).getTime() + 70 * 86_400_000
  ).toISOString()

  const [activitiesResult, ticketsResult] = await Promise.all([
    getActivities({
      ...scope,
      limit: 500,
      startsAfter: new Date(
        new Date(rangeStart).getTime() - 10 * 86_400_000
      ).toISOString(),
      startsBefore: rangeEnd,
    }),
    getTickets({ ...scope, limit: 500, openOnly: true }),
  ])

  const degraded =
    activitiesResult.source === "local-seed" ||
    ticketsResult.source === "local-seed"

  const entries: CalendarEntry[] = [
    ...activitiesResult.data.map((activity): CalendarEntry => ({
      id: `activity:${activity.id}`,
      title: activity.title,
      startsAt: activity.startsAt,
      endsAt: activity.endsAt,
      kind: "activity",
      detail: activity.location,
    })),
    // Only tickets that actually carry a due-by appear. A ticket with no SLA is
    // absent from the calendar rather than pinned to its report date, which
    // would put a deadline on screen that nobody agreed to.
    ...ticketsResult.data
      .filter((ticket) => ticket.slaDueAt !== null)
      .map((ticket): CalendarEntry => ({
        id: `ticket:${ticket.id}`,
        title: ticket.title,
        startsAt: ticket.slaDueAt as string,
        kind: "ticket_due",
        href: `/dashboard/tickets/${ticket.id}`,
        detail: ticket.ticketNo,
      })),
  ]

  const weekdayFormatter = new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "short",
    timeZone: "UTC",
  })
  const labels: CalendarLabels = {
    // Built from a known Monday so the order is ISO-8601 regardless of locale.
    weekdays: Array.from({ length: 7 }, (_, index) =>
      weekdayFormatter.format(new Date(Date.UTC(2024, 0, 1 + index)))
    ),
    emptyDay: t("emptyDay"),
    moreEntries: (n: number) => t("moreEntries", { count: n }),
    kinds: {
      activity: t("kinds.activity"),
      ticket_due: t("kinds.ticket_due"),
    },
  }

  const hrefFor = (next: { view?: CalendarView; date?: string }) => {
    const sp = new URLSearchParams()
    sp.set("view", next.view ?? view)
    sp.set("date", next.date ?? anchor)
    return `/dashboard/calendar?${sp.toString()}`
  }

  const shift = (days: number): string =>
    new Date(new Date(`${anchor}T00:00:00Z`).getTime() + days * 86_400_000)
      .toISOString()
      .slice(0, 10)

  const step = view === "month" ? 30 : view === "week" ? 7 : 1
  const dayKeys =
    view === "week" ? weekKeys(anchor) : view === "day" ? [anchor] : []

  const secret = serverEnv.CALENDAR_FEED_TOKEN_SECRET
  const feedConfigured = secret !== undefined && secret.length > 0
  // The shipped feed is site-wide, not per-user, and always returns the
  // manager-scoped activity list. Showing its URL to a resident would hand them
  // a wider view than their own role has, so it is offered only to the roles
  // that already hold that view.
  const maySeeFeedUrl = hasPermission(profile.role, "calendar:approve")

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
          {tCommon("dataSource.localSeedHint")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t("viewLabel")} className="flex gap-2">
          {VIEWS.map((candidate) => (
            <NavChip
              key={candidate}
              href={hrefFor({ view: candidate })}
              active={view === candidate}
            >
              {t(`views.${candidate}`)}
            </NavChip>
          ))}
        </nav>
        <nav aria-label={t("periodLabel")} className="flex items-center gap-2">
          <NavChip href={hrefFor({ date: shift(-step) })} active={false}>
            {t("previous")}
          </NavChip>
          <NavChip
            href={hrefFor({ date: todayKey })}
            active={anchor === todayKey}
          >
            {t("today")}
          </NavChip>
          <NavChip href={hrefFor({ date: shift(step) })} active={false}>
            {t("next")}
          </NavChip>
        </nav>
      </div>

      <p className="text-sm font-medium text-foreground">
        {view === "week"
          ? t("weekOf", {
              date: formatDateLong(`${startOfWeek(anchor)}T12:00:00Z`, locale),
            })
          : formatDateLong(`${anchor}T12:00:00Z`, locale)}
      </p>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-primary/60"
          />
          {labels.kinds.activity}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-quality-stale"
          />
          {labels.kinds.ticket_due}
        </span>
      </div>

      {view === "month" ? (
        <CalendarMonth
          anchor={anchor}
          entries={entries}
          locale={locale}
          labels={labels}
          todayKey={todayKey}
        />
      ) : (
        <CalendarAgenda
          dayKeys={dayKeys}
          entries={entries}
          locale={locale}
          labels={labels}
          todayKey={todayKey}
          dayHeading={(key) => formatDateLong(`${key}T12:00:00Z`, locale)}
        />
      )}

      <section className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <h2 className="text-base font-semibold text-foreground">
          {t("feed.heading")}
        </h2>
        {!feedConfigured ? (
          // No secret means the route 404s for every token. Printing a URL that
          // cannot work would be worse than saying the feature is off.
          <p className="max-w-prose text-sm text-muted-foreground">
            {t("feed.notConfigured")}
          </p>
        ) : (
          <>
            <p className="max-w-prose text-sm text-muted-foreground">
              {t("feed.explanation")}
            </p>
            {/* Stated plainly because it diverges from what a reader would
                assume: this is one feed for the site, not one per person. */}
            <p className="max-w-prose text-sm text-foreground">
              {t("feed.siteWideWarning")}
            </p>
            {maySeeFeedUrl && secret !== undefined ? (
              <code className="overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 text-xs break-all text-foreground">
                {`/api/calendar/ics/${feedToken(secret)}`}
              </code>
            ) : (
              <p className="max-w-prose text-sm text-muted-foreground">
                {t("feed.askAdmin")}
              </p>
            )}
            <p className="max-w-prose text-xs text-muted-foreground">
              {t("feed.revocation")}
            </p>
          </>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        <Link
          href="/dashboard/tickets"
          className="rounded underline hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {tTickets("title")}
        </Link>
      </p>
    </div>
  )
}

function NavChip({
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
