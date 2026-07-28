import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"

import { Link } from "@/app/navigation"
import { DeliveryNotice } from "@/components/operations/delivery-notice"
import { Badge } from "@/components/ui/badge"
import { getUserProfile } from "@/lib/auth"
import { cn } from "@/lib/cn"
import {
  getThreads,
  getUnreadNotificationCount,
  type ThreadRecord,
} from "@/lib/communications-repository"
import { threadStatuses, type ThreadStatus } from "@/lib/communications-data"
import type { Locale } from "@/lib/contracts"
import { formatDateTime } from "@/lib/format"
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

export const metadata: Metadata = {
  title: "Nachrichten",
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 50

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

  const [threadsResult, unreadCount] = await Promise.all([
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
  ])

  const threads = threadsResult.data
  const degraded = threadsResult.source === "local-seed"
  // The repository sets this when it declined to guess a resident's scope. An
  // empty list with a reason is a different thing from an empty inbox.
  const scopeUnknown =
    threads.length === 0 && threadsResult.degradedReason !== undefined

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

      {unreadCount > 0 ? (
        <p className="text-sm text-foreground">
          {t("unread", { count: unreadCount })}
        </p>
      ) : null}

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
        href={`/dashboard/communications/${thread.id}`}
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
