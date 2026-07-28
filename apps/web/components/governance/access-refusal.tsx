import { ShieldAlert } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

/**
 * The 403 a governance route renders instead of its content.    Owner: W3-F
 *
 * ## This is server-rendered, and that is the whole point
 *
 * `SECURITY-REVIEW.md` SEC-003 is a High against exactly the mistake this
 * component exists to prevent: the evidence cockpit's Server Component read its
 * repositories and rendered, and only a **client** guard declined to mount the
 * result. The disputed pricing intelligence was in the RSC flight payload for
 * nine of eleven roles, reachable with one `curl` and no JavaScript.
 *
 * So every governance page checks its own permission at the top of its Server
 * Component and returns this **before any repository call**. Not after, and not
 * as an early return that still leaves the data in scope: a refused caller must
 * cause no read at all, so there is nothing to serialise even by accident.
 *
 * The client guard from W3-B is still in the tree above this. It is the belt.
 *
 * ## Why it names the permission
 *
 * A 403 that says only "no access" leaves the user with nowhere to go. Naming
 * the permission and the role turns it into something they can paste into a
 * message to whoever administers the system. The URL survives too — W3-B's
 * no-redirect rule — so the link they were sent still works for someone who
 * holds the permission.
 *
 * Nothing here is sensitive: the role is the caller's own, and the permission
 * name is in `CONTRACTS.md`, which every window compiles against.
 */
export function AccessRefusal({
  title,
  message,
  detailLabel,
  detail,
  className,
}: {
  title: string
  message: string
  /** e.g. "Erforderliche Berechtigung". Omitted, the detail row is not rendered. */
  detailLabel?: string
  detail?: string
  className?: string
}): ReactNode {
  return (
    <section
      // `alert` so a screen reader announces the refusal rather than leaving
      // the user to discover an empty page.
      role="alert"
      data-testid="governance-forbidden"
      className={cn(
        "flex max-w-prose min-w-0 flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-6 py-8",
        className
      )}
    >
      <ShieldAlert className="size-6 text-destructive" aria-hidden="true" />
      <h1 className="font-display text-xl font-semibold tracking-[-0.015em]">
        {title}
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">{message}</p>

      {detailLabel === undefined || detail === undefined ? null : (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold">{detailLabel}</span>{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
            {detail}
          </code>
        </p>
      )}
    </section>
  )
}
