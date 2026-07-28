import "./globals.css"

import type { Metadata } from "next"
import { headers } from "next/headers"
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
// W1-D SEAM — providers. FILLED 2026-07-27 by W1-D.
//
// Two providers wrap every route, and only two:
//
//   ThemeProvider    next-themes, `attribute="class"`, which is what
//                    globals.css's `@custom-variant dark` matches on. It must
//                    be outermost so the class lands on <html> before paint.
//   TooltipProvider  one shared delay timer for the whole app, which is what
//                    makes the second tooltip in a toolbar open instantly.
//
// NOT mounted here, deliberately:
//
//   LenisProvider    smooth scroll belongs to the marketing surfaces, not to
//                    the dashboard. Hijacking the wheel on a 656-row table
//                    fights the user; W3-A mounts it around the landing route.
//   MotionPreference no provider needed — `useReducedMotion` is backed by a
//                    module-level store, so it works anywhere without one.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// W-INT — S-009. THIS IS THE FILE THAT MAKES EVERY ROUTE RENDER DYNAMICALLY.
//
// `proxy.ts` emits a per-request CSP containing `'nonce-…' 'strict-dynamic'`.
// Next stamps that nonce onto its own <script> tags by reading it back out of
// the REQUEST header (`parseRequestHeaders` in
// next/dist/server/app-render/app-render.js — it reads `content-security-policy`
// and calls `getScriptNonceFromHeader`). A statically prerendered document is
// built without a request, so it has no nonce to stamp, and under
// `strict-dynamic` an unnonced script does not load. The page renders, looks
// correct, and runs ZERO JavaScript.
//
// A per-request nonce and a build-time-rendered document are mutually
// exclusive by construction: the nonce must differ per response, a prerendered
// document is byte-identical across responses. No amount of proxy cleverness
// closes that gap — the proxy runs BEFORE the response body exists and cannot
// transform it.
//
// So the rule is: **no route in this app may be statically prerendered.**
// Reading a request header here is what enforces it. `headers()` is a Dynamic
// API; using it in the root layout opts every route beneath it out of static
// generation, so the DEFAULT is correct and a wave-3 window that simply omits
// `export const dynamic` still ships a working page. `scripts/csp-probe.mjs`
// is the gate that proves it and fails the build if it ever stops being true.
//
// The nonce is not read only for its side effect — it is handed to
// next-themes, whose no-flash inline <script> is otherwise unnonced and
// blocked by this same CSP in production.
// ---------------------------------------------------------------------------

import { ThemeProvider } from "@/components/providers/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  // `x-nonce` is set by `proxy.ts` on the same request whose CSP carries it.
  // It is absent only where the proxy did not run — an unmatched path, or a
  // build-time render, which the gate exists to make impossible.
  const nonce = (await headers()).get("x-nonce")

  return (
    // `suppressHydrationWarning` is here for W1-D's theme provider, which sets
    // a `class`/`data-theme` attribute on <html> before React hydrates.
    <html lang="de" dir="ltr" suppressHydrationWarning>
      <body>
        {/* Conditional spread rather than `nonce={nonce ?? undefined}`:
            `exactOptionalPropertyTypes` is on, so `nonce?: string` does not
            accept an explicit `undefined`. */}
        <ThemeProvider {...(nonce === null ? {} : { nonce })}>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
