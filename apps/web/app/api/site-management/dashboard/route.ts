import { createManifestHandler } from "@/lib/api-handler"
import { getDashboardSnapshot } from "@/lib/dashboard-repository"

/**
 * Every route in this API is dynamic.
 *
 * S-009 (HANDOFF/W-INT.md §4) makes pages dynamic through the root layout's
 * `headers()` call, but a route handler sits outside that layout and does not
 * inherit it. An API response is per-caller by definition — role-scoped, with
 * `Cache-Control: no-store` — so a prerendered one would be one caller's data
 * served to the next. Declared explicitly rather than relied upon.
 */
export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getDashboardSnapshot", {
  handler: async ({ profile }) => {
    const result = await getDashboardSnapshot({
      role: profile.role,
      ...(profile.id === null ? {} : { profileId: profile.id }),
    })
    return { data: result.data, source: result.source }
  },
})
