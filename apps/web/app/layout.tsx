import "./globals.css"

import type { Metadata } from "next"
import { headers } from "next/headers"
import { getLocale } from "next-intl/server"
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
//
// It was two. `TooltipProvider` was removed on 2026-07-29 — see the comment at
// the call site below for the measurement and the reasoning.
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


/**
 * Azura World Residence & Hotel — Türkler, Alanya, Antalya, Türkiye.
 *
 * `dir` is always `ltr` — CONVENTIONS §5 states RTL is explicitly not required,
 * since no Arabic or Hebrew locale is in scope. `lang` is resolved per request;
 * see `RootLayout` below.
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

/**
 * M-007 — `<html lang>` tracks the requested locale.
 *
 * It was hard-coded `"de"`, so `/en`, `/tr` and `/ru` all served `lang="de"`
 * and a screen reader pronounced Russian and Turkish with a German voice.
 * Hyphenation, spell-check and translation prompts read the same attribute.
 *
 * **Why the fix lives here and not in `app/[locale]/layout.tsx`.** That layout
 * cannot own it: `<html>` belongs to the root layout, and a second nested
 * `<html>` is invalid. W1-C's header says exactly this and filed the request
 * rather than reaching across (SYSTEM-PROMPT §4.1). This is that request, done.
 *
 * `getLocale()` resolves through `i18n/request.ts`, which reads the
 * `X-NEXT-INTL-LOCALE` request header that `proxy.ts` deliberately folds into
 * the forwarded headers (see `absorbIntlRequestHeaders` there). So the value is
 * the same one the page's own messages were loaded with, by construction —
 * parsing the pathname here would be a second, independent derivation of the
 * locale and the two would eventually disagree.
 *
 * **Non-locale routes.** This layout also wraps `app/not-found.tsx`,
 * `app/global-error.tsx` and the API tree. For those the request config falls
 * back to `defaultLocale`, which is what their German copy is written in, so
 * `de` is correct rather than merely a default.
 *
 * **Bare subtag, not `de-DE`.** `lib/format.ts` maps to regional tags because
 * `Intl` needs them to pick separators. `lang` does not: WCAG 3.1.1 wants the
 * language of the content, and claiming `en-US` would be wrong for a British
 * reader while `en` is right for both. The four values are exactly the four
 * routing segments, which is also what makes the assertion below checkable.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  // `x-nonce` is set by `proxy.ts` on the same request whose CSP carries it.
  // It is absent only where the proxy did not run — an unmatched path, or a
  // build-time render, which the gate exists to make impossible.
  const nonce = (await headers()).get("x-nonce")
  const locale = await getLocale()

  return (
    // `suppressHydrationWarning` is here for W1-D's theme provider, which sets
    // a `class`/`data-theme` attribute on <html> before React hydrates.
    <html lang={locale} dir="ltr" suppressHydrationWarning>
      <body>
        {/* Conditional spread rather than `nonce={nonce ?? undefined}`:
            `exactOptionalPropertyTypes` is on, so `nonce?: string` does not
            accept an explicit `undefined`. */}
        {/* `TooltipProvider` used to wrap `children` here, and it cost every
            route in the app 26 KB gzipped of `@base-ui/react` — more than GSAP
            and Lenis together on the landing page, which renders no tooltip at
            all.

            It bought one thing: a shared delay timer, so the second tooltip in
            a toolbar opens instantly. Base UI's `Tooltip.Root` works without
            the provider; the provider is a grouping optimisation, not a
            requirement. And the only file in the tree that renders a `Tooltip`
            is `kitchen-sink-client.tsx`, the component showcase, which now
            provides it locally.

            Measured on the landing route under `next start`: 250.8 -> 214.8 KB
            gzipped of JavaScript. If a production surface ever adds a tooltip
            it works immediately, and it can add the provider at its own layout
            if it wants grouped delays. */}
        <ThemeProvider {...(nonce === null ? {} : { nonce })}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
