import { getTranslations } from "next-intl/server"
import { notFound } from "next/navigation"
import type { Metadata } from "next"

import { Link } from "@/app/navigation"
import { LiveRefresh } from "@/components/dashboard/live-refresh"
import { MessageComposer } from "@/components/communications/message-composer"
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
import { getProfiles } from "@/lib/governance-repository"
import { decodePublicId } from "@/lib/public-id"
import { hasPermission } from "@/lib/rbac"

/**
 * /[locale]/dashboard/communications/[ref] — one thread.      Owner: W3-E
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

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number.parseInt(raw ?? "1", 10)
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
}

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale; ref: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale, ref } = await params

  // Opaque token, not the thread's primary key. A token that does not decode
  // and a thread that does not exist give the same answer, so this page never
  // confirms which tokens are well-formed. See `lib/public-id.ts`.
  const threadId = decodePublicId("thread", ref)
  if (threadId === null) notFound()
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

  // Who wrote each line. This used to render `message.senderProfileId` — a raw
  // uuid — as the author of every message, which is unreadable and, on a
  // complaint thread, faintly insulting.
  //
  // `getProfiles` refuses a caller who cannot read the directory, so a resident
  // resolves nobody: their own messages are still labelled "You" from the
  // session, and a co-participant they cannot look up is named as such rather
  // than guessed at. Calling them "the Azura World team" would read better and
  // would be a claim this page cannot support — a thread can hold two residents
  // of the same home.
  const directory = hasPermission(profile.role, "users:view")
    ? await getProfiles({ role: profile.role, isActive: true, limit: 200 })
    : null
  const senderNames = new Map(
    (directory?.data ?? []).map((entry) => [
      entry.id,
      entry.fullName ?? entry.email ?? entry.id,
    ])
  )

  const canReply = hasPermission(profile.role, "communications:create")

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

      <LiveRefresh
        name={`thread-${ref}`}
        channels={[{ table: "messages", filter: `thread_id=eq.${threadId}` }]}
        enabled={threadResult.source === "supabase"}
        labels={{ updated: tLive("updated"), offline: tLive("offline") }}
      />

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
              senderName={senderNameFor(message, {
                selfProfileId: profile.id,
                selfLabel: t("selfSender"),
                names: senderNames,
                systemLabel: t("systemSender"),
                unknownLabel: t("otherSender"),
              })}
              isOwn={
                message.senderProfileId !== null &&
                message.senderProfileId === profile.id
              }
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
              href={`/dashboard/communications/${ref}?page=${page - 1}`}
            >
              {tCommon("pagination.first")}
            </PageLink>
          ) : null}
          <span className="text-sm text-muted-foreground tabular-nums">
            {tCommon("pagination.pageOf", { page, total: pageCount })}
          </span>
          {page < pageCount ? (
            <PageLink
              href={`/dashboard/communications/${ref}?page=${page + 1}`}
            >
              {tCommon("pagination.last")}
            </PageLink>
          ) : null}
        </nav>
      ) : null}

      {/* The box exists now. What it cannot do — reach anyone by email or
          WhatsApp — is stated by `DeliveryNotice` above and by `scopeNote`
          under the button, rather than by refusing to render a composer. */}
      {canReply ? (
        <MessageComposer
          threadId={thread.id}
          labels={{
            heading: t("composer.heading"),
            placeholder: t("composer.placeholder"),
            submit: t("composer.submit"),
            busy: t("composer.busy"),
            empty: t("composer.empty"),
            genericError: t("composer.genericError"),
            unavailable: t("composer.unavailable"),
            scopeNote: t("composer.scopeNote"),
          }}
        />
      ) : (
        <p className="max-w-prose text-sm text-muted-foreground">
          {t("composer.readOnly")}
        </p>
      )}
    </div>
  )
}

/**
 * The author of one message, in the reader's terms.
 *
 * Order matters: your own name first, so a resident always recognises their own
 * line; then the directory, which only staff can read; then the neutral
 * fallback. A uuid is never a possible outcome.
 */
function senderNameFor(
  message: MessageRecord,
  labels: {
    selfProfileId: string | null
    selfLabel: string
    names: ReadonlyMap<string, string>
    systemLabel: string
    unknownLabel: string
  }
): string {
  if (message.senderKind !== "user") return labels.systemLabel
  const senderId = message.senderProfileId
  if (senderId === null) return labels.systemLabel
  if (senderId === labels.selfProfileId) return labels.selfLabel
  return labels.names.get(senderId) ?? labels.unknownLabel
}

function MessageBubble({
  message,
  locale,
  deliveryLabelSet,
  internalNoteLabel,
  senderName,
  isOwn,
  attachmentLabel,
}: {
  message: MessageRecord
  locale: Locale
  deliveryLabelSet: Parameters<typeof DeliveryBadge>[0]["labels"]
  internalNoteLabel: string
  senderName: string
  isOwn: boolean
  attachmentLabel: string
}) {
  const state = deliveryStateFor({
    isInternalNote: message.isInternalNote,
    channel: message.channel,
  })
  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-4",
        message.isInternalNote
          ? "border-quality-stale/40 bg-quality-stale/5"
          : isOwn
            ? // Your own lines sit apart from the ones addressed to you. Tint
              // only — never left/right alignment, which inverts under `dir`
              // and would put a Turkish reader's own messages where a German
              // reader's counterpart's messages are.
              "border-primary/30 bg-primary/5"
            : "border-border"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-foreground">
          {senderName}
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
