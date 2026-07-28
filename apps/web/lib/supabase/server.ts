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
 * Three mechanisms enforce that, and the first two are live today:
 *
 *  1. `serverEnv` (lib/env.ts) is a Proxy that **throws** on any property read
 *    when `typeof window !== "undefined"`. The key is unreadable in a browser
 *    even if this module were somehow bundled — it cannot return `undefined` and
 *    let a bug propagate silently.
 *  2. The module-load guard below throws the moment this file is *evaluated* in
 *    a browser, so the failure names this import rather than surfacing three
 *    layers away.
 *  3. TODO(W0-A): `import "server-only"` at the top of this file, which turns
 *    the runtime failure into a **build** failure. The package is not in
 *    `apps/web/package.json` and W0-A owns dependency installation — adding it
 *    here would break the build for every other window tonight. Requested in
 *    HANDOFF/W1-B.md. The seam is exactly this line, in this position:
 *
 *        import "server-only"
 *
 * `apps/web/eslint.config.mjs` additionally bans importing `lib/supabase/admin`
 * and `lib/supabase/service-role`; this file is deliberately named neither, per
 * the W1-B brief which places `createServiceRoleClient` in `server.ts`.
 */

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
