import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

// ---------------------------------------------------------------------------
// W1-C SEAM — next-intl plugin.  ENABLED by W1-C on 2026-07-27.
//
// next-intl's request config (`getRequestConfig`) is wired through this plugin.
// `apps/web/i18n/request.ts` now exists, so the plugin resolves and the export
// at the bottom of this file is `withNextIntl(nextConfig)`.
//
// Locale ROUTING (prefix, redirects) does not need the plugin and is already
// live in `proxy.ts`, which reads the locale list from `lib/contracts.ts`.
//
// Only the two lines W0-A's handoff named were touched: this import and the
// final export. Nothing else in this file is W1-C's.
// ---------------------------------------------------------------------------

const withNextIntl = createNextIntlPlugin("./i18n/request.ts")

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
 * `Content-Security-Policy` is deliberately NOT in this set, which applies to
 * every path: it is emitted per-request by `proxy.ts` so that script-src can
 * carry a fresh nonce instead of `'unsafe-inline'` (CONVENTIONS §4), and a
 * static header on the same response would override or intersect with it.
 *
 * There IS a static CSP below, on a source that is the exact complement of the
 * proxy's matcher — the paths the proxy never runs on and which had no policy at
 * all. See `PROXY_COMPLEMENT_SOURCE`.
 */
const securityHeaders = [
  /**
   * HSTS. There was none, which left the whole set below resting on the hope
   * that the first request happened to be over TLS.
   *
   * It matters more here than it usually would, because the Supabase session
   * cookies are written by `@supabase/ssr` and this application does not choose
   * their flags. Without HSTS, one plain-HTTP request to the origin — a typed
   * address, an old bookmark, a link in an email client that strips the scheme —
   * is enough for a network attacker to see the session cookie in clear text and
   * replay it. Two years, subdomains included, and `preload` so a browser that
   * has never visited still refuses plain HTTP.
   *
   * Browsers ignore this header over plain HTTP, so it is inert in local
   * development and does not need to be conditional.
   */
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
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

// ---------------------------------------------------------------------------
// Fallback CSP for the paths `proxy.ts` does not run on
// ---------------------------------------------------------------------------

/**
 * `proxy.ts` matches `["/", "/(de|en|tr|ru)/:path*"]` and nothing else, so every
 * other path was served with **no** Content-Security-Policy at all. That is not
 * a theoretical set: `/api/*`, `/robots.txt`, `/sitemap.xml`,
 * `/manifest.webmanifest`, `/media/*`, and — the one that matters — any URL
 * that resolves to no route, which Next answers with the prerendered
 * `/_not-found` HTML document. `/_global-error` is the same shape: it replaces
 * the root layout, cannot inherit its dynamic `headers()` read, and ships as a
 * static shell (`scripts/csp-probe.mjs` allowlists both facts). An HTML document
 * with no CSP is the exact gap the per-request policy exists to close.
 *
 * ## The conflict, and how it is resolved
 *
 * A static header here must NOT reach a path the proxy handles. The proxy's CSP
 * carries a fresh per-request nonce, Next stamps that nonce onto its own script
 * tags, and a second `Content-Security-Policy` on the same response would either
 * replace the nonce policy or be enforced alongside it — and browsers enforce
 * multiple CSP headers as an *intersection*, so a nonce-less `script-src 'self'`
 * arriving next to the nonce policy blocks every nonced script. Either outcome
 * is the S-009 failure described at length in `proxy.ts`: the page renders from
 * server HTML and runs zero JavaScript.
 *
 * Overlap is therefore prevented by construction rather than by precedence,
 * which is the part that has to be explicit: the `source` below excludes `/` and
 * excludes any path whose first segment is a locale — exactly the proxy's
 * matcher, written as its complement. `/design` is *not* excluded (its first
 * segment is `design`, not `de`), which is correct: the proxy does not match it
 * either. Change one of the two lists and you must change the other; they are
 * only correct as a pair.
 *
 * `_next/static` and `_next/image` are excluded as well. Nothing there is a
 * document, so a CSP would be inert, and these are the highest-volume responses
 * the app serves.
 */
const PROXY_COMPLEMENT_SOURCE =
  "/((?!(?:de|en|tr|ru)(?:/|$)|_next/static|_next/image).+)"

/**
 * The fallback policy is the proxy's, minus the nonce — there is no request to
 * mint one against, because these paths never reach the proxy.
 *
 * That makes `script-src 'self'` the honest ceiling in production: the static
 * error and 404 shells keep their stylesheets and their `<a href="/de">`
 * recovery link, and their inline bootstrap script is blocked. Those shells are
 * already documented as running without JavaScript under the nonce policy, so
 * this changes nothing about them except that they are now covered. Do not add
 * `'unsafe-inline'` to buy back their hydration; a policy that permits inline
 * script on the 404 page permits it on every reflected path that reaches it.
 *
 * Development mirrors `proxy.ts`: React Refresh compiles modules at runtime
 * (`'unsafe-eval'`) and the HMR client injects inline bootstrap
 * (`'unsafe-inline'`). Without them the dev 404 page loads blank and reports
 * only violations.
 */
const isDevelopment = process.env.NODE_ENV !== "production"

const fallbackContentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self'${isDevelopment ? " 'unsafe-eval' 'unsafe-inline'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${supabaseOrigin === null ? "" : ` ${supabaseOrigin}`}`,
  "font-src 'self' data:",
  `connect-src 'self'${isDevelopment ? " http://127.0.0.1:* ws://127.0.0.1:*" : ""}${
    supabaseOrigin === null
      ? ""
      : ` ${supabaseOrigin} ${supabaseOrigin.replace(/^https:/, "wss:")}`
  }`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ")

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Read `PROXY_COMPLEMENT_SOURCE` before touching this entry: it is the
        // complement of the proxy's matcher and must stay that way.
        source: PROXY_COMPLEMENT_SOURCE,
        headers: [
          {
            key: "Content-Security-Policy",
            value: fallbackContentSecurityPolicy,
          },
        ],
      },
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

export default withNextIntl(nextConfig)
