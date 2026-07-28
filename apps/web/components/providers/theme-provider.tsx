"use client"

/**
 * Theme.                                                    Owner: W1-D
 *
 * `next-themes` with `attribute="class"`, which is what `globals.css`'s
 * `@custom-variant dark (&:where(.dark, .dark *))` matches on.
 *
 * ## LIGHT ONLY — product decision, 2026-07-28
 *
 * `forcedTheme="light"` was set by W3-C on the repository owner's explicit
 * instruction: the product ships **one** theme. This is a one-prop change and
 * it is reversible by deleting that prop.
 *
 * What it does NOT do, deliberately: it does not delete `globals.css`'s `.dark`
 * block, the `dark:` utilities already written, or `DESIGN.md`'s dark contrast
 * table. Those are W1-D's and ripping them out mid-wave would touch every
 * surface three other windows are building right now, for no product gain —
 * `forcedTheme` already makes them unreachable at runtime, which is the outcome
 * that was asked for. Removing the dead tokens is a tidy-up for whoever owns
 * `globals.css` next, not an integration risk worth taking today.
 *
 * **Known consequence:** W1-D's Playwright design suite asserts
 * `<html class="dark">` after toggling, and the kitchen-sink route ships a
 * theme toggle. Both now describe a state the app cannot enter. That suite is
 * not wired into any gate, so nothing goes red — but it is stale, and
 * HANDOFF/W3-C.md records it as a request rather than leaving W1-D to discover
 * it.
 *
 * `disableTransitionOnChange` is kept even though there is no longer a swap to
 * suppress: it costs nothing and it stops a flash if the prop is ever removed.
 */

import { ThemeProvider as NextThemesProvider } from "next-themes"
import type { ComponentProps, ReactNode } from "react"

type NextThemesProps = ComponentProps<typeof NextThemesProvider>

export function ThemeProvider({
  children,
  ...props
}: NextThemesProps): ReactNode {
  return (
    <NextThemesProvider
      attribute="class"
      // One theme. `forcedTheme` wins over `defaultTheme` and over any stored
      // preference, so a machine that already chose dark still renders light.
      forcedTheme="light"
      defaultTheme="light"
      disableTransitionOnChange
      // `storageKey` is namespaced so a 1Çatı tab on the same machine cannot
      // reach into Azura's preference — both run on 127.0.0.1 (3100 / 3200)
      // and localStorage is keyed by origin, which for localhost ignores port.
      storageKey="azura-theme"
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
