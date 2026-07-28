/**
 * Form state for the public report flow.                      Owner: W3-H
 *
 * In its own module, not in `actions.ts`, because **a `"use server"` file may
 * export only async functions.** W3-H hit that as a hard build failure once
 * already — `actions.ts` exported a plain `initialLoginFormState` object and the
 * first module to import it failed `next build` outright. A `type` export would
 * have been fine (types are erased); only the value had to move. Same shape
 * here, for the same reason, before it can happen a second time.
 */

/** The submission outcome, as the form renders it. */
export type ReportSubmitStatus =
  | "idle"
  /** Durable storage confirmed. `reference` is set and is lookup-able. */
  | "stored"
  /** Validation rejected the input. Field errors are populated. */
  | "invalid"
  /** Rate limited. `retryAfterSeconds` is set. */
  | "throttled"
  /** Persistence unavailable. **No reference is issued.** */
  | "unavailable"
  /** Idempotency key reused with a different body. */
  | "conflict"
  /** Anything else, already scrubbed of internals. */
  | "error"

export interface ReportFormState {
  status: ReportSubmitStatus
  /**
   * Set **only** when `status === "stored"`. Every other branch leaves it null.
   * This is the field that carries `tasks/W3-H` §3's central guarantee, so it is
   * worth being able to grep for: `reference` is assigned in exactly one place
   * in `actions.ts`.
   */
  reference: string | null
  /** One message for the whole form. Never a provider's or a database's. */
  message: string | null
  /** Per-field messages, keyed by the field name the form uses. */
  fieldErrors: Partial<Record<"location" | "description" | "contact", string>>
  /** Populated on `throttled`, so the form can say how long rather than "later". */
  retryAfterSeconds: number | null
  /**
   * Echoed back so a rejected submission does not discard what was typed.
   * CONVENTIONS §5 names discarding typed data as a real bug, and a damage
   * report is exactly the case where somebody has just written three paragraphs.
   */
  values: { location: string; description: string; contact: string }
}

export const emptyReportValues = {
  location: "",
  description: "",
  contact: "",
} as const

export const initialReportFormState: ReportFormState = {
  status: "idle",
  reference: null,
  message: null,
  fieldErrors: {},
  retryAfterSeconds: null,
  values: { ...emptyReportValues },
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

/**
 * The tracker's outcome.
 *
 * There is deliberately **no `"not_found"` distinct from `"unauthorised"`.**
 * DoD item 8 requires a lookup for a non-existent reference to be
 * indistinguishable from an unauthorised one, so both collapse into
 * `"no_result"` before the state ever leaves the server. Keeping them separate
 * here and merging them in the view would put the distinction in a payload the
 * browser can read.
 */
export type ReportLookupStatus =
  | "idle"
  | "found"
  | "no_result"
  | "invalid"
  | "throttled"
  | "error"

export interface ReportLookupState {
  status: ReportLookupStatus
  message: string | null
  retryAfterSeconds: number | null
  /** The reference as typed, echoed back so the field survives a failed lookup. */
  reference: string
  report: {
    reference: string
    submittedAt: string
    status: string
    location: string
    description: string
  } | null
}

export const initialReportLookupState: ReportLookupState = {
  status: "idle",
  message: null,
  retryAfterSeconds: null,
  reference: "",
  report: null,
}
