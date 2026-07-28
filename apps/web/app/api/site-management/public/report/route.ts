import { createManifestHandler } from "@/lib/api-handler"
import { publicReportSchema } from "@/lib/validation/schemas"

export const dynamic = "force-dynamic"

/**
 * The only unauthenticated mutation surface in the app.
 *
 * Everything about it is tighter as a result: five requests per minute against
 * the app's 120, a mandatory `Idempotency-Key`, a schema that accepts no
 * identifier belonging to anyone but the submitter, and a body ceiling shared
 * with every other route.
 *
 * It is also, currently, a declared gap — there is no repository write path for
 * public intake — so it validates and rate-limits the submission and then
 * answers 503. That is the uncomfortable but correct behaviour: a 202 here would
 * tell somebody reporting real damage that it had been received by somebody,
 * and nobody would ever see it.
 */
export const POST = createManifestHandler("submitPublicReport", {
  schema: publicReportSchema,
  handler: () => {
    throw new Error("unreachable: submitPublicReport declares a write gap")
  },
})
