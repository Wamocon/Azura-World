import { createManifestHandler } from "@/lib/api-handler"
import { forbidden, validationFailed } from "@/lib/api-errors"
import { createActivity, getActivities } from "@/lib/operations-repository"
import { RepositoryError } from "@/lib/repository-base"
import { createClient } from "@/lib/supabase/server"
import { createActivitySchema } from "@/lib/validation/schemas"
import { activityCategories, activityStatuses } from "@/lib/operations-data"
import { readBoolean, readEnum } from "@/lib/validation/query"

export const dynamic = "force-dynamic"

export const GET = createManifestHandler("getActivities", {
  handler: async ({ profile, limit, offset, query }) => {
    const status = readEnum(query, "status", activityStatuses)
    const category = readEnum(query, "category", activityCategories)
    const upcomingOnly = readBoolean(query, "upcomingOnly")

    const result = await getActivities({
      role: profile.role,
      profileId: profile.id,
      limit,
      offset,
      ...(status === undefined ? {} : { status }),
      ...(category === undefined ? {} : { category }),
      ...(upcomingOnly === undefined ? {} : { upcomingOnly }),
    })
    return { data: result.data, source: result.source }
  },
})

/**
 * Schedule an activity, as a draft.
 *
 * `siteId` is optional in the payload but NOT NULL on the table, so an absent
 * one is resolved to the caller's company's site. If that cannot be resolved
 * the request is refused — an activity filed against no site would be invisible
 * to every calendar that scopes by site, which reads as the write having
 * silently failed.
 *
 * Note the deliberate RBAC/RLS mismatch documented on `createActivity()`:
 * `activities:create` is held by three roles the `activities_manager_write`
 * policy does not admit. They are refused by the database, and the page does
 * not offer them the control.
 */
export const POST = createManifestHandler("createActivity", {
  schema: createActivitySchema,
  handler: async ({ body, profile }) => {
    if (profile.id === null || profile.companyId === null) {
      throw new RepositoryError(
        forbidden("You do not have access to this data.")
      )
    }

    const siteId = body.siteId ?? (await resolveDefaultSiteId(profile.companyId))
    if (siteId === null) {
      throw new RepositoryError(
        validationFailed("Choose which site this activity belongs to.", {
          siteId: "Supply the site id.",
        })
      )
    }

    const result = await createActivity({
      role: profile.role,
      profileId: profile.id,
      companyId: profile.companyId,
      siteId,
      title: body.title,
      category: body.category,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      organiserProfileId: profile.id,
      ...(body.description === undefined
        ? {}
        : { description: body.description }),
    })
    return { data: result.data, source: result.source }
  },
})

/**
 * The company's site, when the caller did not name one.
 *
 * Read through the caller's own client, so RLS decides which sites are
 * visible — a company with no site the caller can read resolves to `null` and
 * the request is refused rather than guessing. Returns `null` rather than
 * throwing so the caller can give the field-level message.
 */
async function resolveDefaultSiteId(companyId: string): Promise<string | null> {
  const client = await createClient()
  if (client === null) return null
  const response = await client
    .from("sites")
    .select("id")
    .eq("company_id", companyId)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle()
  const row = response.data
  if (row === null || typeof row !== "object") return null
  const id = (row as { id?: unknown }).id
  return typeof id === "string" ? id : null
}
