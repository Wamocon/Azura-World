"use client"

import { useState, type ReactNode } from "react"

import {
  LoginForm,
  type LoginLabels,
} from "@/app/[locale]/login/login-form"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Link } from "@/app/navigation"
import { cn } from "@/lib/cn"

/**
 * AuthDialog — signing in without leaving the page.            Owner: W-NIGHT
 *
 * The landing's "Access" control used to navigate to `/login`, a full-page
 * split-screen. That is the pattern of a product you have already decided to
 * buy; a visitor still reading the landing loses their place in it to type an
 * email. Modern products open a dialog, and the client asked for exactly that.
 *
 * ## The route is kept, deliberately
 *
 * `/login` still exists and still works. It is what a bookmark, a password
 * manager, an email link and a session-expiry redirect all point at, and it is
 * the fallback when JavaScript is unavailable — the trigger below is a real
 * `<a href>` until hydration replaces it, so a no-JS visitor navigates rather
 * than pressing a dead button.
 *
 * ## It reuses the real form, not a copy
 *
 * `LoginForm` is the same component the route renders: same server action, same
 * validation, same Google and phone panels, same honest disabled states. A
 * second sign-in form would be a second place for auth to drift.
 */

export interface AuthDialogLabels {
  /** The control on the navbar, e.g. "Access". */
  trigger: string
  title: string
  lead: string
  close: string
  noAccount: string
  requestAccess: string
  login: LoginLabels
}

export function AuthDialog({
  locale,
  labels,
  googleLive,
  phoneLive,
  className,
}: {
  locale: string
  labels: AuthDialogLabels
  googleLive: boolean
  phoneLive: boolean
  className?: string
}): ReactNode {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* A real link, so it works before hydration and on a middle-click. The
          click handler upgrades it to a dialog; `preventDefault` only runs once
          the JavaScript that can actually open one is present. */}
      <Link
        href="/login"
        onClick={(event) => {
          // Let the browser handle modified clicks (new tab, download, etc.).
          if (
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            event.button !== 0
          ) {
            return
          }
          event.preventDefault()
          setOpen(true)
        }}
        className={cn(
          "azura-tap-compact inline-flex items-center rounded-full border border-[color-mix(in_srgb,var(--primary)_55%,transparent)] px-4 text-[0.875rem] font-medium text-primary transition-colors duration-[var(--duration-fast)] hover:border-primary hover:bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
          className
        )}
      >
        {labels.trigger}
      </Link>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          closeLabel={labels.close}
          // The auth surfaces run on the light token set, like `/login` does,
          // so the dialog does not arrive as a cream card on a night landing.
          data-surface="day"
          className="max-w-[27rem]"
        >
          <div className="flex flex-col gap-1.5">
            <DialogTitle>{labels.title}</DialogTitle>
            <p className="text-[0.9375rem] leading-[1.5] text-muted-foreground">
              {labels.lead}
            </p>
          </div>

          <LoginForm
            locale={locale}
            next="/dashboard"
            labels={labels.login}
            googleLive={googleLive}
            phoneLive={phoneLive}
          />

          <p className="text-[0.875rem] text-muted-foreground">
            {labels.noAccount}{" "}
            <Link
              href="/signup"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {labels.requestAccess}
            </Link>
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}
