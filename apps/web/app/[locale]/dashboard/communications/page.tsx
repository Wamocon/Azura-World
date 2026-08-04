import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"

import { Link } from "@/app/navigation"
import { LiveRefresh } from "@/components/dashboard/live-refresh"
import { NotificationList } from "@/components/communications/notification-list"
import { DeliveryNotice } from "@/components/operations/delivery-notice"
import { Badge } from "@/components/ui/badge"
import { getUserProfile } from "@/lib/auth"
import { cn } from "@/lib/cn"
import {
  getNotifications,
  getThreads,
  getUnreadNotificationCount,
  type ThreadRecord,
} from "@/lib/communications-repository"
import {
  notificationCategories,
  notificationSeverities,
  threadStatuses,
  type ThreadStatus,
} from "@/lib/communications-data"
import type { Locale } from "@/lib/contracts"
import { formatDateTime } from "@/lib/format"
import { encodePublicId } from "@/lib/public-id"
import { hasPermission } from "@/lib/rbac"

/**
 * /[locale]/dashboard/communications — threads.               Owner: W3-E
 *
 * ## Nothing here sends anything, and the page says so before it says anything else
 *
 * No outbound email, SMS, WhatsApp or push provider is configured in this
 * repository. Messages persist and are readable in the product; nothing leaves
 * the building. `<DeliveryNotice>` states that once, at the top, and every
 * message row repeats it as a badge.
 *
 * The brief is explicit about why this matters more than it looks: 1Çatı's own
 * status document records that its Communications v2 has no verified
 * send path, and a green "Sent" against an unwired provider is worse than no
 * send at all, because the manager stops chasing.
 *
 * ## `degradedReason` is not decoration here
 *
 * `getThreads()` returns an EMPTY list with a reason when a resident-level
 * caller supplies no identifier, rather than guessing which threads are theirs.
 * An empty list rendered as "no messages" would be a lie in that case, so the
 * page distinguishes the two.
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
  const t = await getTranslations({ locale, namespace: "dashboard.communications" })
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  }
}

const PAGE_SIZE = 50

/**
 * How many unread notifications to render at once. A badge, not a bulk tool —
 * and "mark all read" clears every unread row regardless of what is listed, so
 * this cap never traps anyone behind a page control that does not exist.
 */
const NOTIFICATION_LIMIT = 20

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function isThreadStatus(value: string | undefined): value is ThreadStatus {
  return (
    value !== undefined && (threadStatuses as readonly string[]).includes(value)
  )
}

export default async function CommunicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  const query = await searchParams

  const t = await getTranslations({
    locale,
    namespace: "dashboard.communications",
  })
  const tCommon = await getTranslations({ locale, namespace: "common" })
  const tLive = await getTranslations({ locale, namespace: "dashboard.live" })
  const profile = await getUserProfile()

  if (!hasPermission(profile.role, "communications:view")) {
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

  const statusFilter = first(query["status"])
  const activeStatus = isThreadStatus(statusFilter) ? statusFilter : undefined

  const scope = {
    role: profile.role,
    ...(profile.id === null ? {} : { profileId: profile.id }),
  }

  const [threadsResult, unreadCount, notificationsResult] = await Promise.all([
    getThreads({
      ...scope,
      limit: PAGE_SIZE,
      ...(activeStatus === undefined ? {} : { status: activeStatus }),
    }),
    // Notifications are addressed to exactly one profile, so without an
    // identified caller there is nobody to count them for. Skipped rather than
    // called with a placeholder id, which would silently count somebody else's.
    profile.id === null
      ? Promise.resolve(0)
      : getUnreadNotificationCount(profile.id, { role: profile.role }).then(
          (result) => result.data
        ),
    // The list itself, which did not exist: the page reported a number and gave
    // no way to see what it counted or to clear it.
    profile.id === null
      ? Promise.resolve(null)
      : getNotifications(profile.id, {
          role: profile.role,
          unreadOnly: true,
          limit: NOTIFICATION_LIMIT,
        }),
  ])

  const threads = threadsResult.data
  const degraded = threadsResult.source === "local-seed"
  // The repository sets this when it declined to guess a resident's scope. An
  // empty list with a reason is a different thing from an empty inbox.
  const scopeUnknown =
    threads.length === 0 && threadsResult.degradedReason !== undefined

  // Enum -> label, built once. `fromEnum` in components/operations/labels.ts
  // does this for the operations enums; notifications had no label set at all
  // because nothing had ever rendered one.
  const notificationSeverityLabels = Object.fromEntries(
    notificationSeverities.map((severity) => [
      severity,
      t(`notifications.severity.${severity}` as "notifications.severity.info"),
    ])
  )
  const notificationCategoryLabels = Object.fromEntries(
    notificationCategories.map((category) => [
      category,
      t(`notifications.category.${category}` as "notifications.category.system"),
    ])
  )

  const hrefFor = (status: ThreadStatus | null) => {
    const sp = new URLSearchParams()
    if (status !== null) sp.set("status", status)
    const search = sp.toString()
    return `/dashboard/communications${search ? `?${search}` : ""}`
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t("lead")}</p>
      </header>

      <LiveRefresh
        name="communications-inbox"
        channels={[
          { table: "threads" },
          { table: "messages" },
          ...(profile.id === null
            ? []
            : [{ table: "notifications" as const, filter: `profile_id=eq.${profile.id}` }]),
        ]}
        enabled={!degraded}
        labels={{ updated: tLive("updated"), offline: tLive("offline") }}
      />

      <DeliveryNotice
        title={t("deliveryNotice.title")}
        body={t("deliveryNotice.body")}
      />

      {degraded ? (
        <p
          role="status"
          className="rounded-lg border border-confidence-gap/30 bg-confidence-gap/10 px-3 py-2 text-sm text-foreground"
        >
          {t("seedNotice")}
        </p>
      ) : null}

      {/* The inbox. Rendered whenever the caller is identified, including when
          it is empty — "nothing needs your attention" is information, and a
          section that vanishes when clear makes people wonder where it went. */}
      {notificationsResult === null ? null : (
        <NotificationList
          notifications={notificationsResult.data.map((notification) => ({
            id: notification.id,
            title: notification.title,
            body: notification.body,
            category: notification.category,
            severity: notification.severity,
            link: notification.link,
            createdAt: notification.createdAt,
            createdAtLabel: formatDateTime(notification.createdAt, locale),
            // `notifications_update_own` is narrower than the SELECT policy: a
            // child_* profile sees its guardian's notifications and may not
            // clear them. Decided here rather than discovered as a write that
            // silently changes nothing.
            clearable: notification.profileId === profile.id,
          }))}
          labels={{
            heading: t("notifications.heading"),
            lead: t("notifications.lead", { count: unreadCount }),
            empty: t("notifications.empty"),
            markRead: t("notifications.markRead"),
            markAllRead: t("notifications.markAllRead"),
            busy: t("notifications.busy"),
            genericError: t("notifications.genericError"),
            unavailable: t("notifications.unavailable"),
            partial: t("notifications.partial"),
            guardianOnly: t("notifications.guardianOnly"),
            open: t("notifications.open"),
            severity: notificationSeverityLabels,
            category: notificationCategoryLabels,
          }}
        />
      )}

      <nav
        aria-label={t("filterLabel")}
        className="flex flex-wrap items-center gap-2"
      >
        <FilterChip href={hrefFor(null)} active={activeStatus === undefined}>
          {t("filterAll")}
        </FilterChip>
        {threadStatuses.map((status) => (
          <FilterChip
            key={status}
            href={hrefFor(status)}
            active={activeStatus === status}
          >
            {t(`status.${status}`)}
          </FilterChip>
        ))}
      </nav>

      {scopeUnknown ? (
        <div className="rounded-lg border border-confidence-gap/30 bg-confidence-gap/10 px-4 py-3">
          <p className="text-sm font-medium text-foreground">
            {t("scopeUnknown.title")}
          </p>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            {t("scopeUnknown.body")}
          </p>
        </div>
      ) : threads.length === 0 ? (
        <p className="rounded-lg border border-border bg-background/50 p-6 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              locale={locale}
              statusLabel={t(`status.${thread.status}`)}
              channelLabel={t(`channels.${thread.channel}`)}
              messageCountLabel={t("messageCount", {
                count: thread.messageCount,
              })}
              noValue={t("noValue")}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ThreadRow({
  thread,
  locale,
  statusLabel,
  channelLabel,
  messageCountLabel,
  noValue,
}: {
  thread: ThreadRecord
  locale: Locale
  statusLabel: string
  channelLabel: string
  messageCountLabel: string
  noValue: string
}) {
  return (
    <li>
      <Link
        href={`/dashboard/communications/${encodePublicId("thread", thread.id)}`}
        className={cn(
          "flex flex-col gap-1 rounded-lg border border-border p-4 transition-colors",
          "hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {thread.subject}
          </span>
          <Badge variant="muted">{statusLabel}</Badge>
          <Badge variant="outline">{channelLabel}</Badge>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {messageCountLabel}
          {" · "}
          {/* A thread with no messages yet has no last-message time. That is a
              gap, printed as one, never as the epoch or a blank. */}
          {thread.lastMessageAt === null
            ? noValue
            : formatDateTime(thread.lastMessageAt, locale)}
          {thread.unitId === null ? "" : ` · ${thread.unitId}`}
        </p>
      </Link>
    </li>
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
