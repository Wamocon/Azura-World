import { cookies } from "next/headers"
import { setRequestLocale } from "next-intl/server"
import type { ReactNode } from "react"

import { getUserProfile } from "@/lib/auth"
import type { Locale } from "@/lib/contracts"
import { hasPermission } from "@/lib/rbac"
import { DemonstrationDataNotice } from "@/components/dashboard/demonstration-data-notice"
import { UserProvider } from "@/components/user-provider"
import { SIDEBAR_COOKIE } from "@/lib/dashboard-routing"

import { DashboardRouteGuard } from "./dashboard-route-guard"
import { DashboardContent } from "./dashboard-content"
import { DashboardSidebar } from "./dashboard-sidebar"
import { DashboardTopbar } from "./dashboard-topbar"

/**
 * The dashboard shell.                                     Owner: W3-B
 *
 * A Server Component. It resolves the profile once, injects it into
 * `UserProvider` for the client tree, and composes sidebar + topbar + content.
 * Six module windows render inside `{children}`; the contract they build
 * against is in HANDOFF/W3-B.md.
 *
 * NO RENDERING-MODE EXPORT, DELIBERATELY. W-INT §4: the root layout reads
 * `headers()`, which opts every route beneath it out of static generation, so
 * dynamic is already the default and correct. Adding `export const dynamic`
 * here would be noise; adding `force-static` or `revalidate` would ship a page
 * with zero working JavaScript, because a prerendered document has no nonce and
 * `strict-dynamic` blocks every unnonced script. `pnpm qa:csp` is the gate.
 *
 * THE COLLAPSE STATE IS A COOKIE, NOT localStorage, AND THAT IS THE WHOLE CLS
 * FIX. The brief requires the sidebar's collapsed state to persist *and* to
 * cause no layout shift on load. localStorage cannot do both: it is unreadable
 * on the server, so the first paint always guesses, and the correction after
 * hydration is a visible jump of the entire content column. A cookie is on the
 * request, so this layout renders the correct width in the very first byte.
 * That option only exists because every route is dynamic — an unplanned upside
 * of the S-009 decision, and worth knowing before anyone tries to make a
 * dashboard route static again.
 *
 * The client guard below is defence in depth. `proxy.ts` (W1-B) is the real
 * boundary for authentication, and each module re-checks its own permission
 * server-side via `dashboard-resource-access.ts`. Never let the client guard be
 * the only thing between a user and data.
 */

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode
  // Next 16: `params` is a Promise (CONVENTIONS §1).
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const profile = await getUserProfile()
  const cookieStore = await cookies()
  const collapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === "1"

  /**
   * Whether this profile may see the dashboard at all.
   *
   * NOT a redirect to `/login`. `proxy.ts` already sends an unauthenticated
   * request there, so reaching this layout without `dashboard:view` means an
   * authenticated user whose role does not carry it — and the brief is explicit
   * that the answer to that is a 403, not a bounce. The route guard renders it.
   */
  const mayViewDashboard =
    profile.authenticated && hasPermission(profile.role, "dashboard:view")

  return (
    <UserProvider profile={profile}>
      <div className="flex min-h-svh min-w-0 bg-background">
        <DashboardSidebar initialCollapsed={collapsed} />

        <div className="flex min-w-0 flex-1 flex-col">
          <DashboardTopbar />

          {/* `min-w-0` on every flex ancestor of the content column is load-
              bearing: without it a 656-row table's intrinsic width wins over
              the flex basis and the whole page scrolls sideways. */}
          <main id="main" className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">
            {/* `loading.tsx` covers the wait; `DashboardContent` covers the
                arrival, so a navigation reads as the page settling rather than
                as a flash. It has to be a client component to replay per
                route — the reason is in that file. */}
            {/* Said once, in the shell, because the landing promises fixtures
                are marked "throughout the system" and eighteen independently
                wired per-page notices is exactly how that became true in
                eighteen places and false in the product. It counts the rows
                rather than asserting, so it removes itself. */}
            <DemonstrationDataNotice locale={locale as Locale} />
            <DashboardRouteGuard mayViewDashboard={mayViewDashboard}>
              <DashboardContent>{children}</DashboardContent>
            </DashboardRouteGuard>
          </main>
        </div>
      </div>
    </UserProvider>
  )
}
