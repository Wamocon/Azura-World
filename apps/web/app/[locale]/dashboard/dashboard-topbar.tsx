"use client"

import { LogOut, Search, ShieldCheck } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useState, type ReactNode } from "react"

import { signOut } from "@/app/[locale]/login/actions"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { GlobalSearch } from "@/components/dashboard/global-search"
import { useUser } from "@/components/user-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/cn"

/**
 * The topbar.                                              Owner: W3-B
 *
 * Left to right: mobile-trigger gutter · project name · (spacer) · global
 * search · locale switcher · theme toggle · role/user menu.
 *
 * The sync badge is deliberately NOT here. W2-D's badge describes the freshness
 * of one data surface, and the topbar spans a page that may hold several with
 * different modes — a single badge up here would have to pick one and would be
 * wrong about the rest. Each KPI card and each module table carries its own
 * (`components/dashboard/kpi-card.tsx`). The one place a global statement
 * belongs is `ConnectionBanner`, which is about the *connection*, not a
 * surface, and the module renders it once per page.
 *
 * `pl-16 md:pl-4` reserves the fixed mobile menu button's slot so the project
 * name never sits underneath it.
 */
export function DashboardTopbar(): ReactNode {
  const user = useUser()
  const locale = useLocale()
  const t = useTranslations()
  const tShell = useTranslations("dashboard.shell")
  const [searchOpen, setSearchOpen] = useState(false)

  /**
   * The role in the reader's language, never the database enum.
   *
   * The topbar printed the raw slug twice — "Manager" under the brand and
   * "manager" in the account chip — on a Turkish page whose own subtitle two
   * lines below said "Site müdürü olarak görünümünüz". The product disagreed
   * with itself inside one viewport, and the translated labels have always
   * existed at `dashboard.users.roles.*` in all four catalogues.
   */
  const roleLabel = t(`dashboard.users.roles.${user.role}` as "dashboard.users.roles.guest")

  // `fullName` then `email` then the role LABEL. Every arm is a real identifier
  // the person recognises; falling through to the role rather than to an empty
  // string keeps the second line from collapsing and shifting the bar.
  const displayName = user.profile.authenticated
    ? (user.profile.fullName ?? user.profile.email ?? roleLabel)
    : roleLabel

  return (
    <>
      <header
        data-testid="dashboard-topbar"
        className={cn(
          "sticky top-0 z-30 border-b border-border",
          // Translucent chrome with the content scrolling under it, rather than
          // an opaque strip that consumes a fixed band of the viewport.
          "azura-glass"
        )}
      >
        <div className="flex min-h-16 min-w-0 items-center gap-2 px-4 pl-16 md:px-6 md:pl-4">
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate text-sm font-semibold text-foreground">
              {t("nav.brandShort")}
            </p>
            {/* A very long email must truncate rather than wrap the bar onto a
                second line and push the content down. */}
            <p className="truncate text-xs text-muted-foreground">
              {displayName}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {/* The search control states its own shortcut. A shortcut nobody
                can discover is a shortcut for the person who wrote it. */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchOpen(true)}
              data-testid="dashboard-search-trigger"
              className="gap-2"
            >
              <Search aria-hidden="true" />
              <span className="hidden sm:inline">
                {tShell("searchPlaceholder")}
              </span>
              <kbd className="hidden rounded border border-border bg-muted px-1 text-[0.625rem] font-medium text-muted-foreground md:inline">
                {tShell("searchHint")}
              </kbd>
              <span className="sr-only sm:hidden">
                {tShell("searchPlaceholder")}
              </span>
            </Button>

            <LocaleSwitcher />

            <Badge variant="secondary" className="hidden md:inline-flex">
              <ShieldCheck aria-hidden="true" />
              <span className="max-w-28 truncate">{roleLabel}</span>
            </Badge>

            {/* W1-B's `signOut` server action, as a real form action rather
                than a fetch: it works with JavaScript disabled, and the action
                already clears the Supabase session and returns to the
                locale-correct login page. W1-B's handoff asks for exactly
                this wiring. */}
            <form action={signOut}>
              <input type="hidden" name="locale" value={locale} />
              <Button
                type="submit"
                variant="ghost"
                size="icon-sm"
                title={t("nav.logout")}
              >
                <LogOut aria-hidden="true" />
                <span className="sr-only">{t("nav.logout")}</span>
              </Button>
            </form>
          </div>
        </div>
      </header>

      <GlobalSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        locale={locale}
      />
    </>
  )
}
