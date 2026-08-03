"use client"

import { useCallback, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Link } from "@/app/navigation"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/cn"
import type { ApiResponse } from "@/lib/contracts"

/**
 * The notification inbox, and the button that clears it.        Owner: W-NIGHT
 *
 * ## What was here before
 *
 * One line: "3 unread notifications". No list, so there was no way to find out
 * what they were, and no control, so the number could only ever go up. Migration
 * 09 had shipped both halves of the write a year of commits ago —
 * `grant update (is_read, read_at) on public.notifications to authenticated` and
 * the `notifications_update_own` policy — and nothing ever called either.
 *
 * ## Marking read is per-recipient, and that is visible here
 *
 * The UPDATE policy is `profile_id = auth.uid()`, which is strictly narrower
 * than the SELECT policy (`auth.uid()` OR the guardian's profile). A `child_*`
 * account can therefore SEE a guardian's notification and cannot clear it. The
 * repository reports how many rows actually changed rather than how many were
 * asked for, and when those differ this component says so instead of fading the
 * row out and letting it return on the next load.
 *
 * ## Severity is a border, never a colour alone
 *
 * `critical` and `warning` carry a text label as well as a tint. Colour-only
 * severity fails for the ~8% of men with a colour vision deficiency, and this is
 * the surface that carries "your payment failed".
 */

const ACTIONS_ENDPOINT = "/api/site-management/actions"

export interface NotificationItem {
  id: string
  title: string
  body: string | null
  category: string
  severity: "info" | "success" | "warning" | "critical"
  link: string | null
  createdAt: string
  /** Pre-formatted server-side, so this component never formats a date. */
  createdAtLabel: string
  /**
   * False when the row belongs to the caller's guardian. Rendered, never
   * clearable — see the note on the two policies above.
   */
  clearable: boolean
}

export interface NotificationListLabels {
  heading: string
  lead: string
  empty: string
  markRead: string
  markAllRead: string
  busy: string
  genericError: string
  unavailable: string
  /** Shown when fewer rows changed than were asked for. */
  partial: string
  guardianOnly: string
  /** Text of the "take me to it" link on a notification that carries one. */
  open: string
  severity: Readonly<Record<string, string>>
  category: Readonly<Record<string, string>>
}

const SEVERITY_STYLE: Readonly<Record<string, string>> = {
  info: "border-border bg-card",
  success: "border-confidence-confirmed/40 bg-confidence-confirmed/5",
  warning: "border-quality-stale/50 bg-quality-stale/5",
  critical: "border-confidence-conflicted/50 bg-confidence-conflicted/5",
}

export function NotificationList({
  notifications,
  labels,
  className,
}: {
  notifications: readonly NotificationItem[]
  labels: NotificationListLabels
  className?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const mark = useCallback(
    async (ids?: readonly string[]) => {
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        const response = await fetch(ACTIONS_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            command: "notification.markRead",
            ...(ids === undefined ? {} : { notificationIds: [...ids] }),
          }),
        })
        const payload = (await response.json()) as ApiResponse<{
          marked: number
          partial: boolean
        }>

        if (response.ok && payload.ok) {
          // `partial` means the database changed fewer rows than were asked
          // for. Saying nothing here would look like success and the row would
          // come back on the next load.
          if (payload.data.partial) setNotice(labels.partial)
          startTransition(() => router.refresh())
          return
        }
        const code = payload.ok ? null : payload.error.code
        if (code === "persistence_unavailable") {
          setError(labels.unavailable)
          return
        }
        setError(payload.ok ? labels.genericError : payload.error.message)
      } catch {
        setError(labels.genericError)
      } finally {
        setBusy(false)
      }
    },
    [labels, router]
  )

  const working = busy || pending
  const clearable = notifications.filter((item) => item.clearable)

  return (
    <section
      aria-labelledby="notification-list"
      data-slot="notification-list"
      className={cn("flex flex-col gap-3", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            id="notification-list"
            className="font-display text-lg font-semibold tracking-[-0.012em] text-foreground"
          >
            {labels.heading}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {labels.lead}
          </p>
        </div>
        {clearable.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={working}
            onClick={() => void mark()}
          >
            {working ? labels.busy : labels.markAllRead}
          </Button>
        ) : null}
      </div>

      {error === null ? null : (
        <p role="alert" className="text-sm text-confidence-conflicted">
          {error}
        </p>
      )}
      {notice === null ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      {notifications.length === 0 ? (
        <p className="rounded-lg border border-border bg-background/50 p-6 text-sm text-muted-foreground">
          {labels.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notifications.map((item) => (
            <li
              key={item.id}
              className={cn(
                "flex flex-col gap-2 rounded-lg border p-4",
                SEVERITY_STYLE[item.severity] ?? SEVERITY_STYLE["info"]
              )}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-foreground">
                  {item.title}
                </span>
                {/* Severity in words as well as in the border colour. */}
                <span className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                  {labels.severity[item.severity] ?? item.severity}
                </span>
                <span className="text-xs text-muted-foreground">
                  {labels.category[item.category] ?? item.category}
                </span>
                <time
                  dateTime={item.createdAt}
                  className="text-xs text-muted-foreground tabular-nums"
                >
                  {item.createdAtLabel}
                </time>
              </div>

              {item.body === null ? null : (
                <p className="max-w-prose text-sm whitespace-pre-wrap text-muted-foreground">
                  {item.body}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                {item.link === null ? null : (
                  <Link
                    href={item.link}
                    className="rounded text-sm text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {labels.open}
                  </Link>
                )}
                {item.clearable ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={working}
                    onClick={() => void mark([item.id])}
                  >
                    {labels.markRead}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {labels.guardianOnly}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
