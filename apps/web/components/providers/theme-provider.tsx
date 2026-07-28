"use client"

/**
 * Light / dark theme.                                      Owner: W1-D
 *
 * `next-themes` with `attribute="class"`, which is what `globals.css`'s
 * `@custom-variant dark (&:where(.dark, .dark *))` matches on.
 *
 * Deliberate divergence from 1Çatı: that repo sets `forcedTheme="light"`, so
 * its entire `.dark` block and every `dark:` utility is unreachable at
 * runtime — dark mode is written and then switched off. Azura ships a working
 * pair, and both themes are contrast-verified (DESIGN.md §4). A theme nobody
 * can reach is not a theme.
 *
 * `disableTransitionOnChange` suppresses colour transitions during the swap.
 * Without it every themed element cross-fades at once, which reads as a
 * flash rather than a switch — and it is a large, full-viewport brightness
 * change, exactly the kind that reduced-motion users are sensitive to.
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
      defaultTheme="system"
      enableSystem
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
