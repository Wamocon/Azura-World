import { createServiceRoleClient } from "@/lib/supabase/server"

/**
 * How much of what this product shows is a fixture.
 *
 * Every row written by `scripts/seed-demo-operations.mjs` carries
 * `metadata.demo = true` and `metadata.demo_seed = "W-DEMO"`. Nothing else in
 * the schema sets that flag, so it is an exact test rather than a heuristic.
 *
 * ## Why this is read, not assumed
 *
 * The landing page promises fixtures are "marked as sample data throughout the
 * system". Making that true with a constant would put a second claim in the
 * codebase that could go stale the same way the first one did — and the first
 * one had been false for the entire life of the project without anything
 * failing. This counts. The day real operational records replace the seed, the
 * notice stops rendering because the count goes to zero, with nobody having to
 * remember to remove it.
 *
 * ## Why the service role
 *
 * The question is "does this deployment hold fixture data", which is a property
 * of the deployment, not of the reader. Counting under the caller's scope would
 * give a tenant a different answer from a manager for the same building, and a
 * resident whose own three tickets happen to be real would be told the system
 * holds no demonstration data while looking at a seeded ledger they cannot see.
 *
 * Only a count crosses the boundary — never a row, never an id.
 */

/** The tables whose contents the landing page describes as sample data. */
const SEEDED_TABLES = [
  "service_tickets",
  "finance_ledger_entries",
  "documents",
  "activities",
  "leads",
] as const

export interface DemonstrationDataCount {
  /** Total rows carrying `metadata.demo = true` across `SEEDED_TABLES`. */
  records: number
}

/**
 * `null` when the question cannot be answered — Supabase unconfigured, or the
 * count failed. Deliberately not `{ records: 0 }`: "no fixtures" and "could not
 * tell" are different answers, and only one of them justifies hiding a notice
 * that exists to prevent a reader trusting a fabricated figure.
 */
export async function countDemonstrationRecords(): Promise<DemonstrationDataCount | null> {
  const client = createServiceRoleClient()
  if (client === null) return null

  try {
    const counts = await Promise.all(
      SEEDED_TABLES.map(async (table) => {
        const { count, error } = await client
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("metadata->>demo", "true")
        return error === null ? (count ?? 0) : 0
      })
    )
    return { records: counts.reduce((sum, n) => sum + n, 0) }
  } catch {
    return null
  }
}
