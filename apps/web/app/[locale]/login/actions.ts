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
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { isSupabaseConfigured } from "@/lib/env"
import { defaultLocale, locales, type Locale } from "@/lib/contracts"

/** What the form component renders. Never carries a password. */
export interface LoginFormState {
  status: "idle" | "error"
  /** Display-safe. Never contains a provider message or any internals. */
  message: string | null
  /** Echoed so a failed attempt does not clear the field. */
  email: string
}

export const initialLoginFormState: LoginFormState = {
  status: "idle",
  message: null,
  email: "",
}

const credentialsSchema = z.object({
  // Ceilings on both fields: an unbounded string reaches the auth provider and
  // becomes someone else's resource-exhaustion problem (CONVENTIONS §4.3).
  email: z.email("Bitte eine gültige E-Mail-Adresse eingeben.").max(320),
  password: z.string().min(1, "Bitte das Passwort eingeben.").max(200),
})

function asLocale(value: unknown): Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value)
    ? (value as Locale)
    : defaultLocale
}

/**
 * Reduces an untrusted `next` value to a same-origin path, or to the dashboard.
 *
 * Rejected: absolute URLs, protocol-relative `//host` (which browsers resolve as
 * a *different origin* despite looking like a path), backslash variants that
 * some parsers normalise to slashes, and anything not starting with `/`.
 */
export async function safeNextPath(value: unknown): Promise<string> {
  const fallback = "/dashboard"
  if (typeof value !== "string" || value.length === 0) return fallback
  if (value.length > 512) return fallback
  if (!value.startsWith("/")) return fallback
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback
  if (value.includes("\\")) return fallback
  // A control character can smuggle a header or a line break through a logger
  // or a redirect. Written as escapes, never as literal bytes.
  if (/[\u0000-\u001F\u007F]/.test(value)) return fallback
  return value
}

/**
 * Strips a leading locale segment. A `next` captured by `proxy.ts` is already
 * locale-free, but a hand-written link may not be, and `/de/de/dashboard` is a
 * 404 that looks like a routing bug.
 */
function withoutLocalePrefix(path: string): string {
  const segments = path.split("/").filter(Boolean)
  const first = segments[0]
  if (first !== undefined && (locales as readonly string[]).includes(first)) {
    return `/${segments.slice(1).join("/")}`
  }
  return path
}

function localisedDestination(locale: Locale, path: string): string {
  const withoutLocale = withoutLocalePrefix(path)
  const normalised =
    withoutLocale === "/" || withoutLocale === "" ? "/dashboard" : withoutLocale
  return `/${locale}${normalised}`
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
  const nextPath = await safeNextPath(formData.get("next"))
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
        "Die Anmeldung ist in dieser Umgebung nicht konfiguriert. Es gibt keine Datenbankverbindung.",
      email,
    }
  }

  let signedIn = false
  try {
    const supabase = await createClient()
    if (supabase === null) {
      return {
        status: "error",
        message: "Die Anmeldung ist derzeit nicht verfügbar.",
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
      message: "Die Anmeldung ist derzeit nicht verfügbar.",
      email,
    }
  }

  if (!signedIn) {
    return {
      status: "error",
      message: "E-Mail-Adresse oder Passwort ist falsch.",
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
