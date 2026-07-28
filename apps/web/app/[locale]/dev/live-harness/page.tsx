import { notFound } from "next/navigation"

import type { Locale } from "@/lib/contracts"
import { LiveHarnessClient } from "./live-harness-client"

/**
 * Development-only mount point for `useLiveSnapshot`.          Owner: W2-D
 *
 * ## Why this route can exist at all
 *
 * `process.env.NODE_ENV` is a **build-time constant**, inlined by the bundler,
 * so in a production build this page's body is `notFound()` and there is no
 * configuration — no flag, no cookie, no header — that can bring it back.
 * `e2e/production/live-harness-absent.spec.ts` asserts the 404 against a real
 * production build, in all four locales, *with* the access-profile flags set
 * true.
 *
 * `lib/env.ts` bans `process.env.X` elsewhere in the app and names this exact
 * exception: *"`proxy.ts`, which reads only `process.env.NODE_ENV` (a build-time
 * constant, not configuration)."* This is the same read for the same reason.
 *
 * ## Why not `accessProfilesEnabledForEnvironment()`
 *
 * That was the first implementation, and it was wrong in a way worth recording.
 * The predicate lives in `lib/access-profile-policy.ts`, which calls
 * `assertAccessProfileSafety()` at **module load** and throws when the
 * access-profile flags are set in a production environment. `playwright.config.ts`
 * sets exactly that combination for the production server on purpose — the point
 * of the production project is to prove the flags are inert. So importing the
 * policy here turned a route that should 404 into one that returned **500**,
 * which W4-C classifies as a High finding and which leaks more than a 404 does.
 *
 * Reusing a shared gate is usually right. It is not right when the shared module
 * fails loudly by design and this route needs to fail quietly.
 *
 * ## Why a harness page instead of a unit test
 *
 * There is no React test environment in this repository and adding one needs
 * `pnpm install`, which is W0-A's alone (CLAUDE.md §3). More importantly, jsdom
 * would not prove the thing that is actually unproven: a real WebSocket, a real
 * Service Worker, a real `navigator.onLine`, and React committing in a real
 * browser. Those need a browser, and W4-A now provides one.
 */
export const dynamic = "force-dynamic"

const DEFAULT_TABLES = ["units", "activities"] as const

export default async function LiveHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<React.JSX.Element> {
  if (process.env.NODE_ENV === "production") notFound()

  const { locale } = await params
  const query = await searchParams

  const read = (key: string): string | undefined => {
    const value = query[key]
    return Array.isArray(value) ? value[0] : value
  }

  // `local-seed` is how the `static` branch of `resolveLiveMode` is reached: the
  // repository is authoritative about what it returned, so a seeded response
  // means the data is not live regardless of what the environment claims.
  const source = read("source") === "local-seed" ? "local-seed" : "supabase"

  const tablesParam = read("tables")
  const tables =
    tablesParam === undefined
      ? [...DEFAULT_TABLES]
      : tablesParam
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => /^[a-z_]{1,64}$/.test(entry))

  const pollParam = Number(read("poll") ?? "30000")
  const pollIntervalMs =
    Number.isFinite(pollParam) && pollParam >= 100 && pollParam <= 120_000
      ? Math.trunc(pollParam)
      : 30_000

  return (
    <LiveHarnessClient
      locale={locale as Locale}
      source={source}
      tables={tables}
      pollIntervalMs={pollIntervalMs}
    />
  )
}
