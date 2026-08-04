/**
 * What a repository record loses on its way out of the API.
 *                                                             Owner: W-NIGHT
 *
 * ## Why this exists
 *
 * A repository record is shaped for the product: the pages that read it are
 * trusted, run on the server, and legitimately need fields a caller does not.
 * `metadata` is the clearest case — `components/dashboard/demonstration-data-
 * notice.tsx` counts rows by `metadata.demo`, and `dashboard/compliance` filters
 * `demo_seed` out of a popup — so the column has to reach the server code, and
 * must not reach an API consumer.
 *
 * The served OpenAPI document already says so, in the `/search` description:
 * these fields must never be forwarded. It said it while
 * `GET /api/site-management/tickets` returned `metadata` and `idempotencyKey` on
 * every row, and `/documents` and `/activities` returned `metadata` carrying
 * `{"demo": true, "demo_seed": "W-DEMO"}`. Measured 2026-08-04.
 *
 * ## Why a denylist and not a per-route allowlist
 *
 * An allowlist is the stronger shape in general and the weaker one here. There
 * are five list routes over records with twenty-odd fields each; five hand-kept
 * allowlists would drift the moment a column is added, and drift in an allowlist
 * is a field that silently stops being returned — a caller's integration breaks
 * and nothing says why.
 *
 * This is a small, closed set of fields that are internal **by nature** rather
 * than by route: bookkeeping the product writes about a row, not facts about the
 * thing the row describes. A new column is returned by default, which is the
 * right default for a REST surface, and anything genuinely internal is added
 * here once for every route at the same time.
 *
 * ## What it deliberately does not do
 *
 * It does not touch ids. Removing `id` would break every consumer's ability to
 * refer to a row, and the opaque-id work exists precisely so an id can be shown
 * safely. Nor does it recurse: these are top-level bookkeeping fields, and a
 * deep walk over every row of every list would cost more than it protects.
 */

/**
 * Fields stripped from every record the site-management API returns.
 *
 * Both snake_case and camelCase, because repositories map some records and pass
 * others through, and a denylist that only knew one convention would be a
 * denylist that worked on half the routes.
 */
const INTERNAL_FIELDS: readonly string[] = Object.freeze([
  // Arbitrary jsonb the product writes about a row. Today it carries the demo
  // markers; it is an open column and the next thing put in it will not be
  // reviewed against this file.
  "metadata",
  // The replay key for a mutation. Returning it lets a caller replay somebody
  // else's write, which is the failure `lib/api-handler.ts` moved the
  // idempotency check after authorisation to prevent.
  "idempotencyKey",
  "idempotency_key",
  // Whatever a payment provider sent back, verbatim. Unbounded, unreviewed, and
  // the one field most likely to contain a token.
  "providerPayload",
  "provider_payload",
])

/**
 * One record, without its internal bookkeeping.
 *
 * Returns the value unchanged when it is not a plain object, so an array of
 * strings or a scalar passes through rather than being silently emptied.
 */
export function projectRecord<T>(record: T): T {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return record
  }
  const source = record as Record<string, unknown>
  let touched = false
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (INTERNAL_FIELDS.includes(key)) {
      touched = true
      continue
    }
    out[key] = value
  }
  // The same object back when nothing was removed: identity matters for the
  // large lists this runs over on every request.
  return (touched ? out : record) as T
}

/** Every record in a list, projected. */
export function projectRecords<T>(records: readonly T[]): T[] {
  return records.map(projectRecord)
}

/** Exposed for the probe that asserts this list is enforced. */
export const INTERNAL_API_FIELDS = INTERNAL_FIELDS
