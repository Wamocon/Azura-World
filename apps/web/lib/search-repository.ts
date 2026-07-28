/**
 * # Search repository — global search over `operational_search_documents`
 *
 * Owned by **W2-A**. This is the module the W2-A brief names, and the import path
 * every route handler and server component should use for search.
 *
 * ## Why the implementation lives in `evidence-repository.ts`
 *
 * Search and evidence read the same two things: the search projection, and the
 * source registry used to resolve a hit back to something citable. Implementing
 * search here would mean a second copy of the source-index loader, and two copies
 * of that logic drift — one of them would eventually resolve a citation the other
 * would not. So the implementation sits beside the code it shares, and this file
 * is the named public surface rather than a second implementation.
 *
 * ## The one thing callers must know
 *
 * `operational_search_documents` is **revoked from `authenticated` entirely**
 * (migration 10). A direct `.from("operational_search_documents")` cannot work
 * from a session client, by design — RLS alone was not enough, because a resident
 * could otherwise reach the projection through PostgREST. The only read path is
 * the `search_operational_records()` RPC, which enforces, in order:
 *
 *   1. role authority — below staff (level 40) raises SQLSTATE `42501`
 *   2. company scope — no company context and not admin raises `42501`
 *   3. an input ceiling of 120 characters, raising `22023`
 *   4. a per-row authority floor (`min_role_level`) compared to the caller's level
 *   5. a bounded result set — default 20, hard ceiling 50
 *
 * A caller below staff therefore gets a mapped `forbidden` error rather than an
 * empty list. That is deliberate: an empty list would read as "nothing matched",
 * which is a different and misleading claim.
 */

export {
  searchOperationalRecords,
  type SearchHit,
} from "@/lib/evidence-repository"
