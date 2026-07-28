/**
 * Session refresh for `proxy.ts`.
 *
 * Supabase access tokens are short-lived. Something has to exchange the refresh
 * token and write the new cookies back, and in Next 16 that something cannot be
 * a Server Component — `cookies().set()` throws there. The proxy is the only
 * place in the request lifecycle that can both read the incoming cookies and
 * write to the outgoing response, so it is where the refresh belongs.
 *
 * The subtle part is that refreshed cookies must land in **two** places:
 *
 *  - `request.cookies` — so the Server Components rendered later in *this same
 *    request* see the new token rather than the expired one they came in with.
 *  - `response.cookies` — so the browser stores it for the next request.
 *
 * Writing only the response is the classic bug: the current render still uses
 * the stale token and the user sees one spurious logged-out page per refresh
 * cycle.
 */

import { createServerClient } from "@supabase/ssr"
import type { NextRequest, NextResponse } from "next/server"
import { isSupabaseConfigured, publicEnv } from "../env"

/** What the proxy needs back: the response to keep, and whether there is a user. */
export interface SessionRefreshResult {
  response: NextResponse
  isAuthenticated: boolean
}

/**
 * Refreshes the Supabase session and reports whether the caller is
 * authenticated.
 *
 * Returns `isAuthenticated: false` untouched when Supabase is unconfigured —
 * that is the supported seed-fallback state (CONVENTIONS §2) and must not
 * redirect anyone. It also never throws: a Supabase outage during a token
 * refresh must degrade to "not authenticated", which the route guard turns into
 * a login redirect, rather than a 500 on every page of the site.
 *
 * `getClaims()` rather than `getUser()`: it verifies the JWT locally against the
 * project's JWKS instead of making a network round trip to `/auth/v1/user` on
 * every matched request, and the proxy runs on *every* matched request. The
 * authoritative profile read still uses `getUser()` — see `lib/auth.ts`.
 */
export async function updateSession(
  request: NextRequest,
  response: NextResponse
): Promise<SessionRefreshResult> {
  if (!isSupabaseConfigured()) {
    return { response, isAuthenticated: false }
  }

  const url = publicEnv.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (url === undefined || anonKey === undefined) {
    return { response, isAuthenticated: false }
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          // Both, deliberately. See the module header.
          request.cookies.set(name, value)
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  try {
    const { data, error } = await supabase.auth.getClaims()
    const subject = data?.claims?.sub
    return {
      response,
      isAuthenticated:
        error === null && typeof subject === "string" && subject.length > 0,
    }
  } catch {
    // A network failure, an expired refresh token or a malformed cookie all land
    // here. Treating them as "not authenticated" is the fail-closed answer: the
    // guard sends the user to login, which is recoverable. Throwing would take
    // down every route the matcher covers, including the public ones.
    return { response, isAuthenticated: false }
  }
}
