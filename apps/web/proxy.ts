/**
 * Next 16 proxy — the file that replaces `middleware.ts`.
 *
 * **`middleware.ts` must never exist alongside this file.** Having both is
 * undefined behaviour in Next 16 (CONVENTIONS §1).
 *
 * Composition order, fixed by the W0-A brief:
 *   1. intl routing             — implemented here (W0-A)
 *   2. Supabase session refresh — TODO seam, filled by W1-B
 *   3. route guard              — TODO seam, filled by W1-B
 *
 * This file also emits the per-request Content-Security-Policy. `next.config.ts`
 * deliberately does not set a static CSP header so that this one, which carries
 * a fresh nonce, wins. The other security headers (Referrer-Policy,
 * X-Frame-Options, Permissions-Policy, …) are static in `next.config.ts` and are
 * NOT repeated here.
 */

import createIntlMiddleware from "next-intl/middleware"
import { NextResponse, type NextRequest, type ProxyConfig } from "next/server"
import { defaultLocale, locales, type Locale } from "./lib/contracts"

// ---------------------------------------------------------------------------
// 1. Intl routing
// ---------------------------------------------------------------------------

/**
 * `locales` and `defaultLocale` come from `lib/contracts.ts` — the executable
 * form of CONTRACTS §7. They are deliberately NOT redeclared here, and are NOT
 * imported from `./i18n` (W1-C owns that file and it does not exist yet).
 */
const intlMiddleware = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix: "always",
})

function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (locales as readonly string[]).includes(value)
}

/**
 * Splits `/de/dashboard/units` into `{ locale: "de", pathWithoutLocale:
 * "/dashboard/units" }`. An unprefixed path keeps its pathname and reports the
 * default locale — `localePrefix: "always"` means intl will already be
 * redirecting it, so this is only used for guard context.
 */
function getLocaleAndPath(pathname: string): {
  locale: Locale
  pathWithoutLocale: string
} {
  const segments = pathname.split("/").filter(Boolean)
  const first = segments[0]
  if (!isLocale(first)) {
    return { locale: defaultLocale, pathWithoutLocale: pathname }
  }
  return { locale: first, pathWithoutLocale: `/${segments.slice(1).join("/")}` }
}

// ---------------------------------------------------------------------------
// Content-Security-Policy
// ---------------------------------------------------------------------------

/**
 * A fresh nonce per request. `crypto` is the Web Crypto global — available in
 * both the edge and Node proxy runtimes. `Buffer` is not, hence `btoa`.
 */
function createNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

/**
 * CONVENTIONS §4: no `unsafe-inline` for scripts. GSAP, Framer Motion and R3F
 * do not need it — they set inline *styles*, which `style-src 'unsafe-inline'`
 * covers, and that is a far weaker concession than executable inline script.
 *
 * `process.env.NODE_ENV` is a Next build-time constant, not configuration, so
 * reading it here is correct. It is the ONLY `process.env` read permitted in
 * this file — everything else goes through `lib/env.ts`.
 */
const isDevelopment = process.env.NODE_ENV !== "production"

function buildContentSecurityPolicy(nonce: string): string {
  // Dev needs 'unsafe-eval' (React Refresh compiles modules at runtime) and
  // 'unsafe-inline' (the HMR client injects inline bootstrap scripts). Without
  // them the dev server loads a blank page and reports only CSP violations.
  // Browsers ignore 'unsafe-inline' when a nonce is present, so it is listed
  // for older engines only; 'strict-dynamic' is omitted in dev because it would
  // suppress the HMR script tags Next injects without a nonce.
  const scriptSrc = isDevelopment
    ? `'self' 'nonce-${nonce}' 'unsafe-eval' 'unsafe-inline'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Tailwind v4 and GSAP write inline style attributes; scripts are what
    // actually matter for XSS.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co",
    "font-src 'self' data:",
    "media-src 'self' blob: https://*.supabase.co",
    // 127.0.0.1 covers the local dev server and the local AI gateway probe;
    // the Supabase entries cover PostgREST, Storage and Realtime (wss).
    "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* https://*.supabase.co wss://*.supabase.co",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ]

  return directives.join("; ")
}

function applySecurityHeaders(response: NextResponse, csp: string): void {
  response.headers.set("Content-Security-Policy", csp)
}

// ---------------------------------------------------------------------------
// 2. Supabase session refresh — TODO(W1-B)
// ---------------------------------------------------------------------------

/**
 * TODO(W1-B): implement Supabase session refresh.
 *
 * What must go in here, and nothing else:
 *
 *  - Read `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` through
 *    `publicEnv` from `lib/env.ts`. Do NOT read `process.env` in this file.
 *  - If `isSupabaseConfigured()` is false, return the response untouched with
 *    `isAuthenticated: false`. That is the supported seed-fallback state
 *    (CONVENTIONS §2) and must not redirect anyone.
 *  - Otherwise build a `createServerClient` from `@supabase/ssr` whose cookie
 *    adapter writes to BOTH `request.cookies` and `response.cookies`, then call
 *    `supabase.auth.getClaims()`. `isAuthenticated` is
 *    `Boolean(claims?.claims?.sub && !error)`. See the 1Çatı reference at
 *    `D:\Real Estate CRM\Cati\apps\web\proxy.ts` lines 76–93.
 *  - The refreshed cookies must survive onto whatever response is finally
 *    returned, which is why the response is passed in and handed back rather
 *    than created here.
 *  - Never use the service-role key here. This code runs on every matched
 *    request and its imports land in the proxy bundle (SYSTEM-PROMPT §2.7).
 *
 * The no-op below lets the app run unauthenticated today: everything is public,
 * nothing redirects.
 */
// TODO(W1-B): fill this seam. Signature is final — build against it.
async function refreshSupabaseSession(
  request: NextRequest,
  response: NextResponse
): Promise<{ response: NextResponse; isAuthenticated: boolean }> {
  // Referenced so the parameter is not flagged as unused before W1-B lands.
  void request
  return { response, isAuthenticated: false }
}

// ---------------------------------------------------------------------------
// 3. Route guard — TODO(W1-B)
// ---------------------------------------------------------------------------

/**
 * TODO(W1-B): implement the route guard.
 *
 * What must go in here, and nothing else:
 *
 *  - Return `null` to let the request continue; return a `NextResponse` to
 *    redirect or block. Never mutate the response passed through step 2.
 *  - Protected prefixes (`/dashboard`, …) with `isAuthenticated === false`
 *    redirect to `/${ctx.locale}/login?next=<pathWithoutLocale + search>`.
 *    Preserve the query string — CONVENTIONS §5 requires that a session
 *    expiring mid-form does not discard the user's place.
 *  - An authenticated user hitting `/login` redirects to
 *    `/${ctx.locale}/dashboard`.
 *  - A deep link to a route the role may not see must yield a 403 page, NOT a
 *    redirect (CONVENTIONS §5 — redirect loops are the failure mode here).
 *  - `accessProfilesEnabled()` from `lib/env.ts` is the ONLY way to relax the
 *    protected-route redirect, and it is already hard-false in any production
 *    build (SYSTEM-PROMPT §2.12). Do not add a second bypass.
 *  - This is the UX boundary only. RLS is the security boundary and every route
 *    handler re-checks permission server-side regardless of what happens here
 *    (CONVENTIONS §2).
 *
 * The no-op below lets the app run unauthenticated today.
 */
// TODO(W1-B): fill this seam. Signature is final — build against it.
function guardRoute(
  request: NextRequest,
  ctx: { locale: Locale; pathWithoutLocale: string; isAuthenticated: boolean }
): NextResponse | null {
  // Referenced so the parameters are not flagged as unused before W1-B lands.
  void request
  void ctx
  return null
}

// ---------------------------------------------------------------------------
// Proxy
// ---------------------------------------------------------------------------

/**
 * How Next encodes "override these request headers" onto a response — see
 * `handleMiddlewareField` in `next/dist/server/web/spec-extension/response.js`.
 * `NextResponse.next({ request: { headers } })` writes one
 * `x-middleware-request-<name>` per header plus a comma-joined index in
 * `x-middleware-override-headers`.
 */
const OVERRIDE_INDEX_HEADER = "x-middleware-override-headers"
const OVERRIDE_VALUE_PREFIX = "x-middleware-request-"

/**
 * next-intl sets a request header (`X-NEXT-INTL-LOCALE`) through the same
 * mechanism. Because only one response can own the override index, its entries
 * are folded into ours instead of being copied across — copying just the
 * `x-middleware-request-*` value without the index would silently drop it, and
 * W1-C's `getRequestConfig` reads that header to resolve the locale.
 */
function absorbIntlRequestHeaders(
  intlResponse: NextResponse,
  requestHeaders: Headers
): void {
  const index = intlResponse.headers.get(OVERRIDE_INDEX_HEADER)
  if (index === null) return
  for (const entry of index.split(",")) {
    const name = entry.trim()
    if (name.length === 0) continue
    const value = intlResponse.headers.get(`${OVERRIDE_VALUE_PREFIX}${name}`)
    if (value !== null) requestHeaders.set(name, value)
  }
}

/** Response headers next-intl sets that must survive onto our own response. */
const INTL_FORWARDED_RESPONSE_HEADERS = ["link", "vary"]

export default async function proxy(
  request: NextRequest
): Promise<NextResponse> {
  const nonce = createNonce()
  const csp = buildContentSecurityPolicy(nonce)

  // 1. Intl routing (locale prefix, redirects, rewrites).
  const intlResponse = intlMiddleware(request)

  // A locale redirect has no body, so there is nothing for a nonce to protect;
  // stamp the CSP and get out before doing session work on a throwaway request.
  if (intlResponse.headers.has("location")) {
    applySecurityHeaders(intlResponse, csp)
    return intlResponse
  }

  // Next reads the nonce out of the `Content-Security-Policy` REQUEST header and
  // stamps it onto the framework's own <script> tags. Setting it only on the
  // response would leave Next's bootstrap scripts unnonced and blocked. `x-nonce`
  // is the copy application code reads via `headers()`.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("Content-Security-Policy", csp)
  absorbIntlRequestHeaders(intlResponse, requestHeaders)

  // Re-issue next-intl's decision on a response that also carries our request
  // headers. The request object itself is never cloned: `new NextRequest(request,
  // …)` would re-wrap the body stream and break server-action POSTs, which this
  // matcher also covers.
  const rewrite = intlResponse.headers.get("x-middleware-rewrite")
  let response =
    rewrite !== null
      ? NextResponse.rewrite(new URL(rewrite, request.url), {
          request: { headers: requestHeaders },
        })
      : NextResponse.next({ request: { headers: requestHeaders } })

  for (const header of INTL_FORWARDED_RESPONSE_HEADERS) {
    const value = intlResponse.headers.get(header)
    if (value !== null) response.headers.set(header, value)
  }
  for (const cookie of intlResponse.cookies.getAll()) {
    response.cookies.set(cookie)
  }

  // 2. Supabase session refresh (W1-B seam).
  const session = await refreshSupabaseSession(request, response)
  response = session.response

  // 3. Route guard (W1-B seam).
  const { locale, pathWithoutLocale } = getLocaleAndPath(
    request.nextUrl.pathname
  )
  const guarded = guardRoute(request, {
    locale,
    pathWithoutLocale,
    isAuthenticated: session.isAuthenticated,
  })
  if (guarded !== null) {
    applySecurityHeaders(guarded, csp)
    return guarded
  }

  applySecurityHeaders(response, csp)
  return response
}

export const config = {
  // Exactly the matcher specified in tasks/W0-A-foundation.md.
  //
  // The 1Çatı reference also matches `/api/...` so the proxy can origin-check
  // mutations centrally. Ours deliberately does not: W2-B performs the origin
  // check inside each route handler, next to the Zod validation and the RBAC
  // call, where it can return a typed `ApiError` instead of a bare 403 and
  // where it cannot be silently skipped by a matcher edit.
  matcher: ["/", "/(de|en|tr|ru)/:path*"],
} satisfies ProxyConfig
