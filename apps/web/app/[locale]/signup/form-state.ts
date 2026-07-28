/**
 * Form state for the access request.                          Owner: W3-H
 *
 * Separate module for the same reason as the login and report equivalents: a
 * `"use server"` file may export only async functions, and W3-H has already
 * broken `next build` once by exporting a plain object from one.
 */

export type AccessRequestStatus =
  | "idle"
  /** Recorded durably. Only reachable when a provisioning path exists. */
  | "received"
  | "invalid"
  | "throttled"
  /** No provisioning path. Nothing was recorded and nothing was granted. */
  | "unavailable"
  | "error"

export interface AccessRequestState {
  status: AccessRequestStatus
  message: string | null
  fieldErrors: Partial<Record<"fullName" | "email" | "company" | "reason", string>>
  retryAfterSeconds: number | null
  /** Echoed back so a rejected request does not discard what was typed. */
  values: {
    fullName: string
    email: string
    company: string
    reason: string
  }
}

export const emptyAccessRequestValues = {
  fullName: "",
  email: "",
  company: "",
  reason: "",
} as const

export const initialAccessRequestState: AccessRequestState = {
  status: "idle",
  message: null,
  fieldErrors: {},
  retryAfterSeconds: null,
  values: { ...emptyAccessRequestValues },
}
