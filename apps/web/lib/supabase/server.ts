/**
 * Server-side Supabase clients.
 *
 * Two clients with very different blast radii:
 *
 *  - `createClient()` — request-scoped, carries the **caller's own cookies and
 *    JWT**. Every query it runs is filtered by RLS as that user. This is the
 *    client every route handler and Server Component should use.
 *
 *  - `createServiceRoleClient()` — **bypasses RLS completely**. It exists for
 *    the handful of operations that legitimately have no caller (audit writes,
 *    observability traces, rate-limit counters). Reaching for it because a query
 *    "returned nothing" is how an RLS bug becomes a data breach.
 *
 * ## The client-bundle guarantee
 *
 * SYSTEM-PROMPT §2.7: the service-role key never reaches the browser bundle.
 * Three mechanisms enforce that, and all three are live today:
 *
 *  1. `import "server-only"` on the first line below. This is the only one of
 *    the three that fails at **build** time: the package's browser entry point
 *    throws on import, so if any client module ever reaches this file — directly
 *    or through a chain of re-exports — `next build` stops with the offending
 *    import chain printed. The other two mechanisms can only report the mistake
 *    once a browser has already been served the code.
 *
 *    The former TODO here said the package was not installed. It does not need
 *    to be: Next aliases the `server-only` specifier to its own
 *    `next/dist/compiled/server-only`, which is why `lib/api-handler.ts` has
 *    imported it since W2-B without a `package.json` entry. Do not "fix" a
 *    resolution error by adding a dependency; a resolution error here means the
 *    alias is gone and the guarantee needs re-establishing, not restoring.
 *  2. `serverEnv` (lib/env.ts) is a Proxy that **throws** on any property read
 *    when `typeof window !== "undefined"`. The key is unreadable in a browser
 *    even if this module were somehow bundled — it cannot return `undefined` and
 *    let a bug propagate silently.
 *  3. The module-load guard below throws the moment this file is *evaluated* in
 *    a browser, so the failure names this import rather than surfacing three
 *    layers away. Kept even though mechanism 1 subsumes it at build time: it is
 *    what catches a module evaluated in a browser by a path the bundler never
 *    analysed, and it is the one that names *this* file in its message.
 *
 * `apps/web/eslint.config.mjs` additionally bans importing `lib/supabase/admin`
 * and `lib/supabase/service-role`; this file is deliberately named neither, per
 * the W1-B brief which places `createServiceRoleClient` in `server.ts`.
 */

import "server-only"

import { createServerClient } from "@supabase/ssr"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import { isSupabaseConfigured, publicEnv, serverEnv } from "../env"

// Mechanism 2. Cheap, and it fires at import time rather than at first use.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/supabase/server.ts was imported into a client bundle. It can construct a service-role client, which bypasses RLS entirely. Move the import into a Server Component, a route handler or a server action. (SYSTEM-PROMPT §2.7)"
  )
}

export type ServerSupabaseClient = ReturnType<typeof createServerClient>
export type ServiceRoleSupabaseClient = ReturnType<typeof createSupabaseClient>

/**
 * Request-scoped client carrying the caller's cookies. `null` when Supabase is
 * unconfigured — the caller falls back to seed data and labels it
 * (CONTRACTS §4).
 */
export async function createClient(): Promise<ServerSupabaseClient | null> {
  if (!isSupabaseConfigured()) return null

  const url = publicEnv.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (url === undefined || anonKey === undefined) return null

  const cookieStore = await cookies()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Writing a cookie from a Server Component throws in Next 16. That is
          // expected and safe to swallow *here* because `proxy.ts` refreshes the
          // session on every matched request — this path only ever loses a
          // refresh that the proxy has already performed. If the proxy seam is
          // ever removed, sessions will silently stop refreshing; that is the
          // failure this comment exists to make findable.
        }
      },
    },
  })
}

/**
 * RLS-bypassing client. `null` when either the URL or the service-role key is
 * absent, so an unconfigured environment degrades instead of crashing.
 *
 * Never build this from a request path that a user's input can reach without an
 * authorisation check first. `autoRefreshToken` and `persistSession` are off:
 * this client is stateless and must never write a session anywhere.
 */
export function createServiceRoleClient(): ServiceRoleSupabaseClient | null {
  const url = publicEnv.NEXT_PUBLIC_SUPABASE_URL
  if (url === undefined) return null

  // Reading this property in a browser throws by design (lib/env.ts).
  const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY
  if (serviceRoleKey === undefined) return null

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
