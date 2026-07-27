import "./globals.css"

import type { Metadata } from "next"
import type { ReactNode } from "react"

// ---------------------------------------------------------------------------
// W1-D SEAM — global stylesheet. ENABLED 2026-07-27 by W1-D.
//
// `apps/web/app/globals.css` now exists (Tailwind v4, `@theme inline` tokens)
// and the import above is the single line W1-D was permitted to add to this
// W0-A-owned file, in the position W0-A specified: before any component
// import, so the token layer is first in the cascade.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// W1-D SEAM — providers.
//
// Theme, motion (`prefers-reduced-motion`) and any client provider belong to
// W1-D and wrap `{children}` inside <body>. This layout is a shell on purpose:
// a provider added here before W1-D's design tokens exist would render an
// unthemed flash on every route.
// ---------------------------------------------------------------------------

/**
 * Azura World Residence & Hotel — Türkler, Alanya, Antalya, Türkiye.
 *
 * `lang` is the default locale (CONTRACTS §7: `de`). Localised routes live
 * under `app/[locale]/` and W1-C overrides `lang` per locale from its own
 * layout. `dir` is always `ltr` — CONVENTIONS §5 states RTL is explicitly not
 * required, since no Arabic or Hebrew locale is in scope.
 */
export const metadata: Metadata = {
  title: {
    default: "Azura World Residence & Hotel",
    template: "%s | Azura World",
  },
  description:
    "Azura World Residence & Hotel, Türkler · Alanya · Antalya. Wohnanlage und Hotel am Mittelmeer — Wohnungen, Ausstattung, Standort und Verwaltung.",
  applicationName: "Azura World",
  // Set by W1-C once locale routing is live; alternates need the full locale map.
  robots: { index: true, follow: true },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    // `suppressHydrationWarning` is here for W1-D's theme provider, which sets
    // a `class`/`data-theme` attribute on <html> before React hydrates.
    <html lang="de" dir="ltr" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
