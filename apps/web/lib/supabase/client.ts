/**
 * Browser Supabase client — **anon key only**.
 *
 * Nothing in this file may ever reference `SUPABASE_SERVICE_ROLE_KEY`. The anon
 * key is public by design; RLS is what protects the data behind it
 * (CONVENTIONS §2). The service-role client lives in `./server.ts` and is
 * guarded there.
 *
 * Returns `null` rather than throwing when Supabase is unconfigured. That is the
 * supported seed-fallback state: a component that needs live data checks for
 * `null` and renders its degraded state, instead of the whole tree crashing on a
 * missing environment variable.
 */

import { createBrowserClient } from "@supabase/ssr"
import { isSupabaseConfigured, publicEnv } from "../env"

/**
 * The browser client type, inferred rather than imported. `@supabase/ssr` does
 * not export a stable name for it, and inferring keeps this file correct across
 * a minor version bump.
 */
export type BrowserSupabaseClient = ReturnType<typeof createBrowserClient>

/**
 * A browser client, or `null` when Supabase is not configured.
 *
 * No `Database` generic yet: W1-A owns the schema and there is no generated
 * `lib/database.types.ts` in the tree. Requested in HANDOFF/W1-B.md — once it
 * exists, add `createBrowserClient<Database>` here, in `./server.ts` and in
 * `./middleware.ts` together, in one commit.
 */
export function createClient(): BrowserSupabaseClient | null {
  if (!isSupabaseConfigured()) return null

  const url = publicEnv.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // `isSupabaseConfigured()` already proved both are present; TypeScript cannot
  // see through the function boundary, so narrow explicitly rather than with `!`
  // (CONVENTIONS §3 bans the non-null assertion for exactly this case).
  if (url === undefined || anonKey === undefined) return null

  return createBrowserClient(url, anonKey)
}
