/**
 * The login form's state shape.                               Owner: W3-H
 *
 * Split out of `actions.ts` because **a `"use server"` file may only export
 * async functions.** `initialLoginFormState` is a plain object, and exporting it
 * from an actions module makes `next build` fail with
 * `A "use server" file can only export async functions, found object`.
 *
 * That error had never fired, because nothing imported `actions.ts` — there was
 * no login page. The first import turned a latent defect into a build failure,
 * which is the good outcome: the alternative was discovering it in a deployment.
 *
 * A `type` export from a `"use server"` file would have been fine (types are
 * erased). Only the value had to move.
 */

/** What the form component renders. Never carries a password. */
export interface LoginFormState {
  status: "idle" | "error"
  /** Display-safe. Never a provider message, never internals. */
  message: string | null
  /** Echoed so a failed attempt does not clear the field. */
  email: string
}

export const initialLoginFormState: LoginFormState = {
  status: "idle",
  message: null,
  email: "",
}
