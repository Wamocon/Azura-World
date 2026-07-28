"use client"

import { ShieldAlert } from "lucide-react"
import { useLocale } from "next-intl"
import type { ReactNode } from "react"

import { Link, usePathname } from "@/app/navigation"
import { useUser } from "@/components/user-provider"
import { fill, shellCopy } from "@/lib/dashboard-home-copy"
import { decideDashboardAccess } from "@/lib/dashboard-resource-access"
import { firstAccessibleRoute } from "@/lib/dashboard-routing"
import { Button } from "@/components/ui/button"

/**
 * Client-side route guard.                                 Owner: W3-B
 *
 * **This is defence in depth, not the boundary.** `proxy.ts` (W1-B)
 * authenticates; each module re-checks its own permission server-side. If this
 * component is the only thing between a `tenant` and the finance ledger, the
 * ledger is public — the user can disable JavaScript, or read the RSC payload.
 * What it buys is that a forbidden link never renders a half-loaded module
 * before the server says no.
 *
 * IT RENDERS A 403 AND DOES NOT REDIRECT. The 1Çatı reference does both — it
 * shows a panel *and* schedules `router.replace("/dashboard")` — and W3-B's
 * brief rules that out by name: "403 page. Not a redirect to /dashboard
 * (confusing) and not a redirect loop." Three concrete reasons to diverge:
 *
 *   1. The redirect destroys the URL the user was trying to reach, so they
 *      cannot copy it to whoever does have access.
 *   2. It is a loop waiting to happen. A role that lacks `dashboard:view`
 *      bounces to `/dashboard`, which bounces again.
 *   3. It races the panel it renders alongside — the user sees an explanation
 *      for a few hundred milliseconds and then loses it, which reads as a bug.
 *
 * So: a terminal, readable answer, with a way forward for the roles that have
 * one.
 */
export function DashboardRouteGuard({
  children,
  mayViewDashboard,
}: {
  children: ReactNode
  /** Resolved on the server. `false` ⟹ 403 regardless of the path. */
  mayViewDashboard: boolean
}): ReactNode {
  const user = useUser()
  const locale = useLocale()
  const pathname = usePathname()
  const copy = shellCopy(locale)

  // `usePathname` from `@/app/navigation` is next-intl's, so it is already
  // locale-stripped — `/de/dashboard/units` arrives as `/dashboard/units`.
  const decision = decideDashboardAccess(
    pathname,
    user.role,
    user.authenticated
  )

  if (mayViewDashboard && decision.allowed) {
    return <>{children}</>
  }

  // An unregistered path is not this component's business — the module's own
  // `not-found` handles it, and swallowing it here would turn every typo into
  // a 403 and hide real routing bugs.
  if (decision.allowed === false && decision.reason === "unknown_route") {
    return <>{children}</>
  }

  const fallback = firstAccessibleRoute(user.role)

  return (
    <section
      role="alert"
      data-testid="dashboard-403"
      data-denial={
        mayViewDashboard
          ? decision.allowed === false
            ? decision.reason
            : ""
          : "forbidden"
      }
      className="mx-auto flex max-w-prose flex-col items-start gap-3 rounded-xl border border-confidence-conflicted/40 bg-surface-conflict p-5"
    >
      <ShieldAlert
        className="size-5 shrink-0 text-confidence-conflicted"
        aria-hidden="true"
      />
      <h1 className="font-display text-lg font-semibold text-foreground">
        {copy.forbiddenTitle}
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {fill(copy.forbiddenBody, { role: user.role })}
      </p>

      {/* A role with nothing to offer gets no button. A dead-end link that
          leads to another 403 is worse than no link. */}
      {fallback === null ? (
        <p className="text-sm text-muted-foreground">{copy.noAccessBody}</p>
      ) : (
        <Button
          render={<Link href={fallback.href} locale={locale} />}
          size="sm"
        >
          {copy.forbiddenAction}
        </Button>
      )}
    </section>
  )
}
