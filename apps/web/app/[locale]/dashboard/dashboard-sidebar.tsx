"use client"

import {
  Activity,
  Building2,
  CalendarDays,
  ClipboardCheck,
  FileBarChart,
  FolderOpen,
  Handshake,
  Hotel,
  Landmark,
  LayoutDashboard,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  ReceiptText,
  Settings,
  ShieldCheck,
  Star,
  Tags,
  TicketCheck,
  UserPlus,
  Users,
  Wallet,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import { Link, usePathname } from "@/app/navigation"
import { useUser } from "@/components/user-provider"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/cn"
import { shellCopy } from "@/lib/dashboard-home-copy"
import {
  navGroupsForRole,
  SIDEBAR_COOKIE,
  type DashboardRoute,
} from "@/lib/dashboard-routing"

/**
 * The sidebar.                                             Owner: W3-B
 *
 * DIVERGENCE FROM THE REFERENCE, DELIBERATE AND CHECKED: 1Çatı's sidebar is
 * **not collapsible and persists no UI state at all** — there is no house
 * pattern here to mirror. W3-B's brief requires collapse, persistence, and no
 * layout shift on load, so all three are designed here rather than copied.
 *
 * THE PERSISTENCE IS A COOKIE, AND THAT IS WHAT MAKES THE CLS REQUIREMENT
 * ACHIEVABLE. `localStorage` is invisible to the server: the first paint would
 * always guess a width, and correcting it after hydration shifts the entire
 * content column — exactly the layout shift the brief forbids. The layout reads
 * the cookie and passes `initialCollapsed`, so the server renders the right
 * width in the first byte and this component never has to correct anything.
 * Writing stays client-side, because a collapse is not worth a round trip.
 *
 * Two tabs with different collapse states is last-write-wins, per the brief. A
 * cookie makes that the natural behaviour rather than something to implement.
 */

/**
 * `Record<string, LucideIcon>` rather than a `Record<Resource, …>`: the routing
 * config names icons as strings so it stays importable from Server Components
 * and from the probe, and this is the one place that resolves them.
 * `UNKNOWN_ICON` means a typo degrades to a visible placeholder instead of
 * crashing the whole nav.
 */
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  ShieldCheck,
  FileBarChart,
  Building2,
  Tags,
  Hotel,
  Star,
  UserPlus,
  Workflow,
  Handshake,
  Landmark,
  Wallet,
  ReceiptText,
  TicketCheck,
  Activity,
  CalendarDays,
  MessagesSquare,
  FolderOpen,
  ClipboardCheck,
  Users,
  Settings,
}

const UNKNOWN_ICON = LayoutDashboard

const COLLAPSED_WIDTH = "w-16"
const EXPANDED_WIDTH = "w-64"

export function DashboardSidebar({
  initialCollapsed,
}: {
  initialCollapsed: boolean
}): ReactNode {
  const user = useUser()
  const locale = useLocale()
  const copy = shellCopy(locale)
  const t = useTranslations()
  const tShell = useTranslations("dashboard.shell")
  const pathname = usePathname()

  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const groups = navGroupsForRole(user.role)

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current
      // `SameSite=Lax` and no `Secure` flag: this is a UI preference, not a
      // credential, and it must survive a plain-HTTP local dev origin.
      // `max-age` is a year — a preference that silently expires reads as a bug.
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`
      return next
    })
  }, [])

  // Native <dialog> + showModal() gives focus trapping and Escape for free,
  // which is why it is used instead of a hand-rolled overlay. The reference
  // hand-writes a focus trap; the platform has done it correctly since 2022.
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return

    if (mobileOpen && !dialog.open) dialog.showModal()
    if (!mobileOpen && dialog.open) dialog.close()
  }, [mobileOpen])

  const label = useCallback(
    (route: DashboardRoute): string => {
      // `t.has` rather than a try/catch: next-intl throws on a missing key, and
      // one unwritten label must not take down the entire navigation.
      // `dashboard.deals.title` is the known gap — see HANDOFF/W3-B.md.
      return t.has(route.labelKey)
        ? t(route.labelKey)
        : (route.href.split("/").pop() ?? route.href)
    },
    [t]
  )

  /**
   * The nav, rendered at a given width.
   *
   * A function of `isCollapsed` rather than closing over `collapsed`, because
   * the mobile sheet must always render expanded: a phone has room for the
   * labels, and inheriting a collapsed desktop rail would show a drawer full
   * of unlabelled icons to the one user who cannot hover for a tooltip.
   */
  const renderNav = (isCollapsed: boolean) => (
    <nav
      aria-label={tShell("title")}
      className="azura-scrollbar-slim flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2 py-4"
    >
      {groups.map((group) => (
        <div key={group.group} className="flex flex-col gap-1">
          {/* The heading is hidden when collapsed rather than removed, so the
              nav keeps its accessible structure at every width. */}
          <h2
            className={cn(
              "px-2 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase",
              isCollapsed && "sr-only"
            )}
          >
            {copy.groups[group.group]}
          </h2>

          <ul className="flex flex-col gap-0.5">
            {group.routes.map((route) => {
              const Icon = ICONS[route.icon] ?? UNKNOWN_ICON
              const text = label(route)
              // Exact match for the index route, prefix for the rest —
              // otherwise `/dashboard` is "active" on every page.
              const active =
                route.href === "/dashboard"
                  ? pathname === route.href
                  : pathname === route.href ||
                    pathname.startsWith(`${route.href}/`)

              return (
                <li key={route.href}>
                  <Link
                    href={route.href}
                    locale={locale}
                    aria-current={active ? "page" : undefined}
                    // Closing on the click rather than on a pathname effect:
                    // the click IS the intent, and a `setState` in an effect
                    // keyed on the path is a cascading render on every
                    // navigation. Without it the sheet stays open over the page
                    // the user just chose, which on a phone reads as a dead tap.
                    onClick={() => setMobileOpen(false)}
                    // The title is the tooltip that makes a collapsed rail
                    // usable, and it is also what saves a long German label
                    // that has been truncated at full width.
                    title={isCollapsed ? text : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-lg px-2.5 text-sm",
                      "transition-colors duration-150 ease-[var(--ease-out)]",
                      "outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-secondary font-semibold text-secondary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      isCollapsed && "justify-center px-0"
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {isCollapsed ? (
                      <span className="sr-only">{text}</span>
                    ) : (
                      <>
                        {/* `truncate` + `min-w-0` is what stops
                            "Lieferantenrechnungen" pushing the rail wider.
                            German runs ~30% longer than English. */}
                        <span className="min-w-0 flex-1 truncate">{text}</span>
                        {route.pending === true ? (
                          <Badge
                            variant="muted"
                            className="shrink-0 px-1 text-[0.625rem]"
                            title={copy.pendingHint}
                          >
                            {copy.pending}
                          </Badge>
                        ) : null}
                      </>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      {/* No role in the current matrix reaches zero resources — `child_guest`
          holds seven — but a future matrix edit could, and a blank rail reads
          as a crash. */}
      {groups.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">
          {copy.noAccessTitle}
        </p>
      ) : null}
    </nav>
  )

  return (
    <>
      {/* Mobile trigger. `md:hidden` on the button and `hidden md:flex` on the
          rail means the correct one is visible before hydration, so there is
          no flash of the wrong chrome. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-expanded={mobileOpen}
        aria-controls="dashboard-mobile-nav"
        data-testid="dashboard-menu-toggle"
        className={cn(
          "fixed top-3 left-4 z-50 inline-flex size-11 items-center justify-center rounded-lg",
          "border border-border bg-card text-foreground shadow-sm md:hidden",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <PanelLeftOpen className="size-5" aria-hidden="true" />
        <span className="sr-only">{tShell("expandNav")}</span>
      </button>

      {/* Desktop rail */}
      <aside
        data-testid="dashboard-sidebar"
        data-collapsed={collapsed ? "" : undefined}
        className={cn(
          "sticky top-0 hidden h-svh shrink-0 flex-col border-r border-border bg-sidebar md:flex",
          "transition-[width] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none",
          collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH
        )}
      >
        <div
          className={cn(
            "flex min-h-16 items-center gap-2 border-b border-border px-3",
            collapsed && "justify-center px-0"
          )}
        >
          {collapsed ? null : (
            <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold">
              {t("nav.brandShort")}
            </span>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            data-testid="dashboard-sidebar-toggle"
            title={collapsed ? tShell("expandNav") : tShell("collapseNav")}
            className={cn(
              "inline-flex size-9 shrink-0 items-center justify-center rounded-md",
              "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-4" aria-hidden="true" />
            )}
            <span className="sr-only">
              {collapsed ? tShell("expandNav") : tShell("collapseNav")}
            </span>
          </button>
        </div>

        {renderNav(collapsed)}
      </aside>

      {/* Mobile sheet. A native <dialog>: focus trap, Escape and inertness are
          the platform's, not ours to re-implement and get subtly wrong. */}
      <dialog
        ref={dialogRef}
        id="dashboard-mobile-nav"
        data-testid="dashboard-mobile-nav"
        onClose={() => {
          setMobileOpen(false)
          triggerRef.current?.focus()
        }}
        onClick={(event) => {
          // The <dialog> element is its own backdrop hit target, so a click
          // landing on it rather than on a child is a backdrop click.
          if (event.target === event.currentTarget) setMobileOpen(false)
        }}
        className={cn(
          "m-0 h-dvh max-h-none w-72 max-w-[calc(100vw-3rem)] border-0 bg-sidebar p-0 text-foreground",
          "backdrop:bg-[color-mix(in_srgb,var(--sea-deep)_55%,transparent)] md:hidden"
        )}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex min-h-16 items-center gap-2 border-b border-border px-3">
            <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold">
              {t("nav.brandShort")}
            </span>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className={cn(
                "inline-flex size-11 items-center justify-center rounded-md text-muted-foreground",
                "hover:bg-muted hover:text-foreground",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              <X className="size-5" aria-hidden="true" />
              <span className="sr-only">{copy.searchClose}</span>
            </button>
          </div>
          {renderNav(false)}
        </div>
      </dialog>
    </>
  )
}
