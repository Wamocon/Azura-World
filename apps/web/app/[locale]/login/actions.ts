"use server"

/**
 * Login server actions.
 *
 * The login *page* belongs to W3-H; only these actions are W1-B's. They are
 * written against `useActionState`, so the page is a Server Component with a
 * small client form and no client-side Supabase call — the session cookie is
 * written by the server, never by page script.
 *
 * Three things here are load-bearing rather than incidental:
 *
 *  1. **`next` is validated, not trusted.** `?next=https://evil.example` on a
 *     login link is a textbook open redirect: the user authenticates against the
 *     real site and is then handed to an attacker's page wearing the flow's
 *     credibility. Only same-origin, single-slash, absolute paths survive
 *     `safeNextPath()`.
 *
 *  2. **The locale never drops.** Every redirect is built as
 *     `/{locale}{path}`. `localePrefix: "always"` (CONTRACTS §7) means a bare
 *     `/dashboard` is not a route; it would bounce through the intl middleware
 *     and land on the default locale, silently switching a Turkish reviewer to
 *     German mid-flow.
 *
 *  3. **The typed form state survives a failure.** `email` is echoed back in the
 *     returned state so a wrong password does not clear the field. CONVENTIONS
 *     §5 calls out discarding typed data as a real bug, and this is the smallest
 *     place it shows up.
 *
 * `redirect()` throws a control-flow signal that Next catches. It is therefore
 * called **outside** every `try` block in this file — swallowing it in a
 * `catch` would turn a successful login into a silent no-op, which is one of the
 * harder bugs to see in review.
 */

import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { isSupabaseConfigured } from "@/lib/env"
import { defaultLocale, locales, type Locale } from "@/lib/contracts"
import type { LoginFormState } from "./form-state"
import { localisedDestination, safeNextPath } from "./next-path"

/**
 * A sign-in failure, in the reader's own language.
 *
 * Every one of these messages used to be a German literal, so an English, Turkish
 * or Russian visitor who mistyped a password was answered in German on an
 * English page. Measured on `/en/login`: "E-Mail-Adresse oder Passwort ist
 * falsch." The catalogue already carried the translations; the action simply
 * never asked for them.
 */
async function authMessage(
  locale: Locale,
  key: "invalid" | "unavailable" | "notConfigured"
): Promise<string> {
  const t = await getTranslations({ locale, namespace: "auth.login" })
  return t(key)
}

/**
 * ## W3-H changed three things in this file, and why
 *
 * `LoginFormState` and `initialLoginFormState` moved to `./form-state`, and
 * `safeNextPath` / `withoutLocalePrefix` / `localisedDestination` moved to
 * `./next-path`. Nothing about their behaviour changed.
 *
 * 1. **The build required it.** A `"use server"` file may only export async
 *    functions. `initialLoginFormState` is an object, so the first page to
 *    import this module failed `next build` outright. The defect was invisible
 *    while no login page existed.
 * 2. **`safeNextPath` should not be a POST endpoint.** Every export here is one.
 *    A redirect validator reachable over the network is needless surface.
 * 3. **A pure function can be tested.** `scripts/next-path-probe.mts` now calls
 *    it directly with 40 hostile inputs; as an action it was only reachable
 *    through Next's runtime.
 */

const credentialsSchema = z.object({
  // Ceilings on both fields: an unbounded string reaches the auth provider and
  // becomes someone else's resource-exhaustion problem (CONVENTIONS §4.3).
  email: z.email("Bitte eine gültige E-Mail-Adresse eingeben.").max(320),
  password: z.string().min(1, "Bitte das Passwort eingeben.").max(200),
})

function asLocale(value: unknown): Locale {
  return typeof value === "string" &&
    (locales as readonly string[]).includes(value)
    ? (value as Locale)
    : defaultLocale
}

/**
 * Signs in with email and password.
 *
 * Returns a generic failure message for every credential error. Distinguishing
 * "no such user" from "wrong password" is a user-enumeration oracle, and this
 * deployment's users are named individuals at a competitor-intelligence project.
 */
export async function signIn(
  _previous: LoginFormState,
  formData: FormData
): Promise<LoginFormState> {
  const locale = asLocale(formData.get("locale"))
  const nextPath = safeNextPath(formData.get("next"))
  const emailInput = formData.get("email")
  const email = typeof emailInput === "string" ? emailInput.trim() : ""

  const parsed = credentialsSchema.safeParse({
    email,
    password: formData.get("password"),
  })
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Eingabe ungültig.",
      email,
    }
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      message:
        await authMessage(locale, "notConfigured"),
      email,
    }
  }

  let signedIn = false
  try {
    const supabase = await createClient()
    if (supabase === null) {
      return {
        status: "error",
        message: await authMessage(locale, "unavailable"),
        email,
      }
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    })
    // The provider's own message is deliberately discarded — it distinguishes
    // "Invalid login credentials" from "Email not confirmed" and would leak
    // account existence. The detail belongs in a server log, not in a response.
    if (error === null) signedIn = true
  } catch {
    return {
      status: "error",
      message: await authMessage(locale, "unavailable"),
      email,
    }
  }

  if (!signedIn) {
    return {
      status: "error",
      message: await authMessage(locale, "invalid"),
      email,
    }
  }

  // Outside every try/catch — see the module header.
  redirect(localisedDestination(locale, nextPath))
}

/**
 * Signs out and returns to the localised login page.
 *
 * A failed `signOut` still redirects. The alternative — leaving the user on a
 * dashboard that says "signed out" — is worse: the session cookie has usually
 * been cleared already by the time the network call fails, and the proxy will
 * bounce the next navigation to login regardless.
 */
export async function signOut(formData: FormData): Promise<void> {
  const locale = asLocale(formData.get("locale"))

  try {
    const supabase = await createClient()
    if (supabase !== null) await supabase.auth.signOut()
  } catch {
    // Deliberately swallowed; the redirect below is the recovery path.
  }

  redirect(`/${locale}/login`)
}
