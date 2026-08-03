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
// W1-B seam imports. Both modules are proxy-runtime safe on purpose: neither
// reaches `next/headers` (unavailable here) and neither can construct a
// service-role client. `lib/auth.ts` is deliberately NOT imported for that
// reason — it depends on `cookies()`.
import { accessProfilesEnabledForEnvironment } from "./lib/access-profile-policy"
import { updateSession } from "./lib/supabase/middleware"

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
 *
 * ## S-009 — the constraint this policy creates. Read before adding a route.
 *
 * The production policy below is nonce-based, and Next stamps that nonce onto
 * its <script> tags by reading it back out of the REQUEST header at render
 * time. **A statically prerendered document is built without a request**, so
 * its scripts carry no nonce, and `'strict-dynamic'` — which discards `'self'`
 * and every host allowlist for scripts — blocks all of them. The page renders
 * from server HTML and looks correct while running ZERO JavaScript. Measured
 * by W1-D under `next start`: 0 B JS across 0 files, 0 canvases, one CSP
 * violation per chunk. It does NOT reproduce under `next dev`, because the dev
 * branch of this function omits `strict-dynamic`.
 *
 * A per-request nonce and a build-time-rendered document are mutually
 * exclusive by construction, and this file cannot bridge them: the proxy runs
 * *before* the response body exists and has no way to transform it. Three
 * options were considered (tasks/W-INT-integration.md §2); the policy stays
 * strict and the rendering mode gives way:
 *
 *   **No route in this app may be statically prerendered.**
 *
 * Enforced in two places, neither of which is this file:
 *   - `app/layout.tsx` reads `headers()`, which opts every route beneath the
 *     root layout out of static generation. The default is therefore correct.
 *   - `scripts/csp-probe.mjs` (`pnpm qa:csp`) fails the build if any HTML
 *     route is prerendered outside its documented allowlist, and proves under
 *     `next start` that every script tag actually carries the nonce.
 *
 * Do not "fix" a failing gate by adding `'unsafe-inline'` here. Browsers ignore
 * `'unsafe-inline'` whenever a nonce is present, so it would only take effect
 * once the nonce is also removed — which is CONVENTIONS §4's prohibition, for
 * the public marketing pages specifically.
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
    // The loopback entries cover the local dev server's HMR socket and the
    // local AI gateway probe, and they are DEVELOPMENT ONLY.
    //
    // Shipping them in production widened the CSP in the one direction that
    // matters for exfiltration: `connect-src` decides where injected script may
    // send data, and `http://127.0.0.1:*` plus `ws://127.0.0.1:*` is the
    // VICTIM'S OWN machine — every service they run locally, on any port,
    // reachable from a page that has already loaded their session. It also
    // makes any local listener a usable exfiltration channel that no corporate
    // egress filter will ever see, because the traffic never leaves the host.
    //
    // The Supabase entries stay in both: PostgREST, Storage and Realtime (wss).
    `connect-src 'self'${
      process.env.NODE_ENV === "production"
        ? ""
        : " http://127.0.0.1:* ws://127.0.0.1:*"
    } https://*.supabase.co wss://*.supabase.co`,
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
// 2. Supabase session refresh — filled by W1-B
// ---------------------------------------------------------------------------

/**
 * Supabase session refresh.
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
 * FILLED BY W1-B. The body delegates to `lib/supabase/middleware.ts`, which W1-B
 * owns; keeping the implementation there rather than inline is what limits this
 * W0-A-owned file to one import line and one function body. See
 * HANDOFF/W1-B.md for the exact line ranges touched.
 *
 * `updateSession` honours every constraint listed above: it returns untouched
 * with `isAuthenticated: false` when `isSupabaseConfigured()` is false, writes
 * refreshed cookies to BOTH `request.cookies` and `response.cookies`, uses
 * `getClaims()`, never touches the service-role key, and never throws.
 */
async function refreshSupabaseSession(
  request: NextRequest,
  response: NextResponse
): Promise<{ response: NextResponse; isAuthenticated: boolean }> {
  return updateSession(request, response)
}

// ---------------------------------------------------------------------------
// 3. Route guard — filled by W1-B
// ---------------------------------------------------------------------------

/**
 * Locale-free path prefixes that require a session. Matched as whole segments
 * (`/dashboard` or `/dashboard/...`), never as a bare `startsWith` — a bare one
 * would also protect a future `/dashboards-public` and leave `/dashboardx`
 * looking deliberate rather than accidental.
 */
const PROTECTED_PREFIXES = ["/dashboard"] as const

/**
 * The route guard.
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
 * FILLED BY W1-B.
 *
 * Two deviations from the notes above, both deliberate and both recorded in
 * HANDOFF/W1-B.md:
 *
 *  - The relaxation gate is `accessProfilesEnabledForEnvironment()` from
 *    `lib/access-profile-policy.ts`, not `accessProfilesEnabled()` from
 *    `lib/env.ts`. The W1-B brief §3 defines the gate as
 *    `!isSupabaseConfigured() || (all three flags)`, and `lib/env.ts` omits the
 *    first clause — with it missing, the app is unusable without a database,
 *    which CONVENTIONS §2 requires to work. The two agree exactly in production:
 *    both are hard `false` there, and the policy module additionally *throws at
 *    module load* if a production process is configured otherwise. This is
 *    still not a second bypass; it is the same one, specified more completely.
 *
 *  - The 403-not-redirect rule for a forbidden route is NOT enforced here. This
 *    seam knows only whether a session exists, not which role it carries;
 *    resolving the role needs `cookies()` and a `profiles` read, neither of
 *    which is available in the proxy runtime. Per-role 403s are enforced in the
 *    route segments and route handlers, where the profile is resolvable. What
 *    this seam does guarantee is the property the note is really protecting
 *    against: an authenticated user is never redirected to login, so the
 *    redirect loop cannot form.
 */
function guardRoute(
  request: NextRequest,
  ctx: { locale: Locale; pathWithoutLocale: string; isAuthenticated: boolean }
): NextResponse | null {
  const path = ctx.pathWithoutLocale
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  )
  const isLogin = path === "/login" || path.startsWith("/login/")

  if (isProtected && !ctx.isAuthenticated) {
    if (accessProfilesEnabledForEnvironment()) return null
    const url = request.nextUrl.clone()
    url.pathname = `/${ctx.locale}/login`
    url.search = ""
    // The locale-free path plus its query string, so a session that expires
    // mid-form returns the user to exactly where they were (CONVENTIONS §5).
    // `searchParams.set` percent-encodes, so this cannot smuggle a second
    // parameter; `login/actions.ts` still re-validates it as untrusted input.
    url.searchParams.set("next", `${path}${request.nextUrl.search}`)
    return NextResponse.redirect(url)
  }

  if (isLogin && ctx.isAuthenticated) {
    // Always the dashboard, never `?next=`. Honouring a caller-supplied
    // destination here would put an open-redirect surface in the proxy, and the
    // login action already handles `next` after a successful sign-in.
    return NextResponse.redirect(
      new URL(`/${ctx.locale}/dashboard`, request.url)
    )
  }

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
