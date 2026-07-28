/**
 * The difference between "we believe this is fine" and "we can prove it".
 *                                                              Owner: W3-F
 *
 * `tasks/W3-F`: *"A check with no evidence attached is `not_evidenced`, not
 * `passed`. The distinction between 'we believe this is fine' and 'we can prove
 * this is fine' is the entire value of a compliance module."*
 *
 * ## `not_evidenced` is derived, never stored, and that is the stronger design
 *
 * `compliance_checks.status` is CHECK-constrained by
 * `…0008_documents_compliance.sql` to exactly five values: `pending`,
 * `in_review`, `passed`, `failed`, `waived`. There is no `not_evidenced` among
 * them, and the migration is W1-A's file — `CONTRACTS.md` and the schema are
 * both frozen to this window, and SYSTEM-PROMPT §6 says to report rather than
 * amend.
 *
 * So the state is **computed at read time from the evidence itself**, and that
 * turns out to be better than a column would have been:
 *
 *   - A stored flag can be set. This cannot: a row claiming `passed` with
 *     `evidence_document_id IS NULL` renders as `not_evidenced` no matter who
 *     wrote it or why, because the derivation only has one input and it is the
 *     evidence.
 *   - It stays correct as the evidence changes. A permit that expires tomorrow
 *     moves from `proven` to `evidence_expired` with no write anywhere.
 *   - It cannot drift from the database, because it is not in the database.
 *
 * ## Evidence has to be three things
 *
 * Attached, **approved**, and **unexpired**. Each of the three failures is a
 * different state with a different remedy, so they are kept apart rather than
 * collapsed into one amber badge:
 *
 * | state                 | means                                            | fix              |
 * |-----------------------|--------------------------------------------------|------------------|
 * | `proven`              | passed, evidence approved and in date            | nothing          |
 * | `not_evidenced`       | claims passed or waived, nothing attached        | attach a document |
 * | `evidence_unreviewed` | attached, nobody has approved it                 | review it        |
 * | `evidence_expired`    | attached and approved, past its expiry           | get a new one    |
 * | `failed`              | recorded as failed                               | remediate        |
 * | `open`                | pending or in review, no claim made yet          | work it          |
 *
 * `open` is deliberately not a failure. A check nobody has looked at yet is
 * honest about being unfinished; the dishonest state is the one that claims a
 * pass it cannot support, and that is `not_evidenced`.
 */

import type { ComplianceCheckRecord } from "@/lib/governance-data"
import type { DocumentRecord } from "@/lib/document-data"

export type EvidenceState =
  | "proven"
  | "not_evidenced"
  | "evidence_unreviewed"
  | "evidence_expired"
  | "failed"
  | "open"

/**
 * The states in which the system is claiming something it cannot demonstrate.
 * `coverageSummary` counts these as the number that matters.
 */
export const UNPROVEN_STATES: readonly EvidenceState[] = Object.freeze([
  "not_evidenced",
  "evidence_unreviewed",
  "evidence_expired",
])

export interface EvaluatedCheck {
  check: ComplianceCheckRecord
  state: EvidenceState
  /** The document the check points at, when the caller may read it. */
  evidence: DocumentRecord | null
  /**
   * True when `check.status` claims a pass and `state` says it is not provable.
   * This is the gap the module exists to show.
   */
  overclaimed: boolean
  /** Whole days until `due_at`; negative once overdue, `null` when no due date. */
  daysUntilDue: number | null
}

const MS_PER_DAY = 86_400_000

/**
 * The instant the page classifies against.
 *
 * A function in this module rather than a `Date.now()` in the page, for two
 * reasons. The React Compiler's purity rule rejects an impure call during
 * render and is right to — a component that reads the clock produces a
 * different tree on every re-render. And a single call site means one clock
 * reading per page, so two rows cannot be classified against two different
 * instants, which is how a permit lands in `expiring_soon` on one line and
 * `expired` on the next.
 *
 * Every derivation below takes the value as a parameter, so a probe pins the
 * clock and this function is never on its path.
 */
export function currentAsOfMs(): number {
  return Date.now()
}

/**
 * Classify one check against its evidence.
 *
 * `asOfMs` is a parameter rather than a `Date.now()` call so the derivation is a
 * pure function of its inputs and a probe can pin the clock. Every seed builder
 * in this repository takes the same position.
 */
export function deriveEvidenceState(input: {
  check: ComplianceCheckRecord
  evidence: DocumentRecord | null
  asOfMs: number
}): EvidenceState {
  const { check, evidence, asOfMs } = input

  if (check.status === "failed") return "failed"
  if (check.status === "pending" || check.status === "in_review") return "open"

  // From here the row is claiming `passed` or `waived`. Everything below decides
  // whether that claim is supported, and the default is that it is not.
  if (check.evidenceDocumentId === null || evidence === null) {
    return "not_evidenced"
  }
  if (evidence.reviewStatus !== "approved") return "evidence_unreviewed"

  if (evidence.expiresAt !== null) {
    const expiresMs = Date.parse(evidence.expiresAt)
    // An unparseable expiry is not "in date". Saying nothing beats asserting a
    // state the data does not support.
    if (Number.isNaN(expiresMs)) return "evidence_unreviewed"
    if (expiresMs <= asOfMs) return "evidence_expired"
  }

  return "proven"
}

/** Classify a whole list, joining each check to its evidence document. */
export function evaluateChecks(input: {
  checks: readonly ComplianceCheckRecord[]
  documents: readonly DocumentRecord[]
  asOfMs: number
}): EvaluatedCheck[] {
  const byId = new Map(
    input.documents.map((document) => [document.id, document])
  )

  return input.checks.map((check) => {
    const evidence =
      check.evidenceDocumentId === null
        ? null
        : (byId.get(check.evidenceDocumentId) ?? null)

    const state = deriveEvidenceState({ check, evidence, asOfMs: input.asOfMs })
    const claimsPass = check.status === "passed" || check.status === "waived"

    return {
      check,
      state,
      evidence,
      overclaimed: claimsPass && state !== "proven",
      daysUntilDue:
        check.dueAt === null || Number.isNaN(Date.parse(check.dueAt))
          ? null
          : Math.floor((Date.parse(check.dueAt) - input.asOfMs) / MS_PER_DAY),
    }
  })
}

export interface CoverageSummary {
  total: number
  proven: number
  /** `not_evidenced` + `evidence_unreviewed` + `evidence_expired`. */
  unproven: number
  failed: number
  open: number
  overdue: number
  /**
   * Rows claiming a pass that cannot be demonstrated. **This is the headline
   * number**, and it is deliberately reported alongside `proven` rather than
   * folded into a single percentage: one figure that mixes "proven" with
   * "asserted" is exactly the flattening this module refuses.
   */
  overclaimed: number
  byState: Readonly<Record<EvidenceState, number>>
}

export function coverageSummary(
  evaluated: readonly EvaluatedCheck[]
): CoverageSummary {
  const byState: Record<EvidenceState, number> = {
    proven: 0,
    not_evidenced: 0,
    evidence_unreviewed: 0,
    evidence_expired: 0,
    failed: 0,
    open: 0,
  }

  let overdue = 0
  let overclaimed = 0

  for (const row of evaluated) {
    byState[row.state] += 1
    if (row.daysUntilDue !== null && row.daysUntilDue < 0) overdue += 1
    if (row.overclaimed) overclaimed += 1
  }

  return {
    total: evaluated.length,
    proven: byState.proven,
    unproven: UNPROVEN_STATES.reduce((sum, state) => sum + byState[state], 0),
    failed: byState.failed,
    open: byState.open,
    overdue,
    overclaimed,
    byState: Object.freeze(byState),
  }
}

/**
 * Provable share as a fraction, or `null` when there is nothing to divide.
 *
 * `null` rather than `0`: zero checks and zero provable checks are different
 * facts, and "0% compliant" is a much worse thing to render than "no checks
 * recorded". The gap-is-not-zero rule (OVERNIGHT-2 §4.3) applies to a computed
 * ratio exactly as it applies to a harvested price.
 */
export function provableShare(summary: CoverageSummary): number | null {
  if (summary.total === 0) return null
  return summary.proven / summary.total
}

/** Badge variant per state. `proven` is the only affirmative treatment. */
export const STATE_VARIANT: Readonly<
  Record<
    EvidenceState,
    "confirmed" | "conflicted" | "single" | "gap" | "destructive" | "muted"
  >
> = Object.freeze({
  proven: "confirmed",
  not_evidenced: "gap",
  evidence_unreviewed: "single",
  evidence_expired: "conflicted",
  failed: "destructive",
  open: "muted",
})
