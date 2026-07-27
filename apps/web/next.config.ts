import type { NextConfig } from "next"

// ---------------------------------------------------------------------------
// W1-C SEAM — next-intl plugin.
//
// next-intl's request config (`getRequestConfig`) is wired through this plugin.
// W1-C owns `apps/web/i18n.ts` / `apps/web/i18n/request.ts`; until that file
// exists the plugin has nothing to point at and the build would fail on a
// missing module. W1-C must uncomment the two lines below and change the export
// at the bottom of this file to `export default withNextIntl(nextConfig)`.
//
//   import createNextIntlPlugin from "next-intl/plugin"
//   const withNextIntl = createNextIntlPlugin("./i18n/request.ts")
//
// Locale ROUTING (prefix, redirects) does not need the plugin and is already
// live in `proxy.ts`, which reads the locale list from `lib/contracts.ts`.
// ---------------------------------------------------------------------------

/**
 * Supabase project origin, used in the CSP and in the image allowlist.
 *
 * `next.config.ts` is the bootstrap: it is evaluated by the Next CLI before any
 * application module (including `lib/env.ts`) is loaded, so this is the one
 * place a direct `process.env` read is correct. Everywhere else, use
 * `lib/env.ts`.
 */
function resolveSupabaseOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:") return null
    return url.origin
  } catch {
    return null
  }
}

const supabaseOrigin = resolveSupabaseOrigin()

/**
 * Static security headers.
 *
 * `Content-Security-Policy` is deliberately NOT here: it is emitted per-request
 * by `proxy.ts` so that script-src can carry a fresh nonce instead of
 * `'unsafe-inline'` (CONVENTIONS §4). A static header here would override it.
 */
const securityHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Origin-Agent-Cluster", value: "?1" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
]

/** Never cache authenticated or API surfaces, and keep them out of indexes. */
const privateNoStoreHeaders = [
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
]

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: privateNoStoreHeaders },
      { source: "/:locale/dashboard/:path*", headers: privateNoStoreHeaders },
      { source: "/:locale/login/:path*", headers: privateNoStoreHeaders },
    ]
  },
  images: {
    // Media is harvested and self-hosted under public/media by W0-D. The only
    // remote origin we expect is Supabase Storage (signed document URLs).
    remotePatterns: supabaseOrigin
      ? [{ protocol: "https", hostname: new URL(supabaseOrigin).hostname }]
      : [],
  },
}

export default nextConfig
