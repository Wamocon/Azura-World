import { getTranslations } from "next-intl/server"
import { notFound } from "next/navigation"
import type { Metadata } from "next"

import { Link } from "@/app/navigation"
import {
  DeliveryBadge,
  DeliveryNotice,
  deliveryStateFor,
} from "@/components/operations/delivery-notice"
import { deliveryLabels } from "@/components/operations/labels"
import { Badge } from "@/components/ui/badge"
import { getUserProfile } from "@/lib/auth"
import { cn } from "@/lib/cn"
import {
  getMessages,
  getThread,
  type MessageRecord,
} from "@/lib/communications-repository"
import type { Locale } from "@/lib/contracts"
import { formatDateTime } from "@/lib/format"
import { hasPermission } from "@/lib/rbac"

/**
 * /[locale]/dashboard/communications/[threadId] — one thread.  Owner: W3-E
 *
 * ## Paginated, because a thread can be long
 *
 * `getMessages()` clamps to 500 and defaults to 50; this page asks for 50 at a
 * time and pages on the server with links. The brief names "a thread with 500
 * messages" as an edge case, and the answer is not to render 500 rows faster,
 * it is not to render them.
 *
 * ## Message bodies are text, and stay text
 *
 * `{message.body}` in a JSX text node. **Never `dangerouslySetInnerHTML`.** A
 * message body can contain anything a resident typed or anything a scraper
 * pulled off a portal, and React's escaping is the only thing between that and
 * the page. `whitespace-pre-wrap` preserves the line breaks that would
 * otherwise be the reason somebody reached for HTML.
 *
 * ## Internal notes
 *
 * `getMessages()` strips `is_internal_note` rows for callers below staff level.
 * RLS does **not** filter that column — migration 09 documents the gap — so the
 * repository is the only boundary. This page does not re-request them and must
 * never gain a flag that does.
 */

export const metadata: Metadata = {
  title: "Nachricht",
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 50

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number.parseInt(raw ?? "1", 10)
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
}

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale; threadId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale, threadId } = await params
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

  const scope = {
    role: profile.role,
    ...(profile.id === null ? {} : { profileId: profile.id }),
  }

  const threadResult = await getThread(threadId, scope)
  const thread = threadResult.data
  // Absent and forbidden are the same answer, for the same reason as tickets.
  if (thread === null) notFound()

  const page = parsePage(query["page"])
  const offset = (page - 1) * PAGE_SIZE
  const messagesResult = await getMessages(threadId, {
    role: profile.role,
    limit: PAGE_SIZE,
    offset,
  })
  const messages = messagesResult.data

  const delivery = deliveryLabels(t)
  const pageCount = Math.max(1, Math.ceil(thread.messageCount / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-6">
      <nav className="text-sm">
        <Link
          href="/dashboard/communications"
          className="rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {tCommon("actions.back")}
        </Link>
      </nav>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {thread.subject}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="muted">{t(`status.${thread.status}`)}</Badge>
          <Badge variant="outline">{t(`channels.${thread.channel}`)}</Badge>
          {thread.unitId === null ? null : (
            <Badge variant="muted">{thread.unitId}</Badge>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("messageCount", { count: thread.messageCount })}
          </span>
        </div>
      </header>

      <DeliveryNotice
        title={t("deliveryNotice.title")}
        body={t("deliveryNotice.body")}
      />

      {messages.length === 0 ? (
        <p className="rounded-lg border border-border bg-background/50 p-6 text-sm text-muted-foreground">
          {t("noMessages")}
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              locale={locale}
              deliveryLabelSet={delivery}
              internalNoteLabel={t("internalNote")}
              senderFallback={t("systemSender")}
              attachmentLabel={t("hasAttachment")}
            />
          ))}
        </ol>
      )}

      {pageCount > 1 ? (
        <nav
          aria-label={tCommon("pagination.page")}
          className="flex items-center gap-3"
        >
          {page > 1 ? (
            <PageLink
              href={`/dashboard/communications/${threadId}?page=${page - 1}`}
            >
              {tCommon("pagination.first")}
            </PageLink>
          ) : null}
          <span className="text-sm text-muted-foreground tabular-nums">
            {tCommon("pagination.pageOf", { page, total: pageCount })}
          </span>
          {page < pageCount ? (
            <PageLink
              href={`/dashboard/communications/${threadId}?page=${page + 1}`}
            >
              {tCommon("pagination.last")}
            </PageLink>
          ) : null}
        </nav>
      ) : null}

      {/* Composition is deliberately absent rather than present and inert. A
          compose box with no provider behind it teaches people to type messages
          that go nowhere; the notice above explains why there is none. */}
      <p className="max-w-prose text-sm text-muted-foreground">
        {t("composeUnavailable")}
      </p>
    </div>
  )
}

function MessageBubble({
  message,
  locale,
  deliveryLabelSet,
  internalNoteLabel,
  senderFallback,
  attachmentLabel,
}: {
  message: MessageRecord
  locale: Locale
  deliveryLabelSet: Parameters<typeof DeliveryBadge>[0]["labels"]
  internalNoteLabel: string
  senderFallback: string
  attachmentLabel: string
}) {
  const state = deliveryStateFor({ isInternalNote: message.isInternalNote })
  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-4",
        message.isInternalNote
          ? "border-quality-stale/40 bg-quality-stale/5"
          : "border-border"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {message.senderProfileId ?? senderFallback}
        </span>
        <time
          dateTime={message.createdAt}
          className="text-xs text-muted-foreground tabular-nums"
        >
          {formatDateTime(message.createdAt, locale)}
        </time>
        {message.isInternalNote ? (
          <Badge variant="stale">{internalNoteLabel}</Badge>
        ) : null}
        <DeliveryBadge state={state} labels={deliveryLabelSet} />
      </div>
      {/* Text node. Escaped by React. See the file header. */}
      <p className="max-w-prose text-sm whitespace-pre-wrap text-foreground">
        {message.body}
      </p>
      {message.attachmentDocumentId === null ? null : (
        <p className="text-xs text-muted-foreground">{attachmentLabel}</p>
      )}
    </li>
  )
}

function PageLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </Link>
  )
}
