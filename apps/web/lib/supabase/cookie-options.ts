import type { CookieOptions } from "@supabase/ssr"

/**
 * Session-cookie hardening.                                     Owner: W-NIGHT
 *
 * `@supabase/ssr` decides the flags on the auth cookie and this application
 * passed them straight through. Measured on a real sign-in, before this file:
 *
 *     sb-…-auth-token   httpOnly=false  secure=false  sameSite=Lax  expires=400d
 *
 * Two of those three are fixed here. The third is not, and it is worth being
 * precise about why rather than quietly leaving it.
 *
 * ## `httpOnly` stays false, and that is a constraint rather than a choice
 *
 * Two real features read this cookie from the browser:
 *
 *   `app/[locale]/login/login-form.tsx`  — phone OTP sign-in calls
 *     `supabase.auth.signInWithOtp()` and `verifyOtp()` in the browser, which
 *     writes the session client-side.
 *   `hooks/use-realtime-channel.ts`      — Realtime authenticates its websocket
 *     with the access token, and RLS is applied to the subscription from it.
 *
 * `httpOnly: true` would break both. Making the session unreadable to script is
 * the right end state and it needs those two paths moved server-side first; it
 * is an architecture change, not a flag. Until then the CSP is what stands
 * between an injected script and the session — which is exactly why
 * `connect-src` no longer permits the victim's own localhost, and why
 * `script-src` uses a per-request nonce with no `unsafe-inline`.
 *
 * ## `secure`
 *
 * Forced on in production. Without it the cookie is sent over plain HTTP, so a
 * single unencrypted request — a typed address, an old bookmark, a mail client
 * that strips the scheme — hands the session to anyone on the path. Left off in
 * development, where there is no TLS and forcing it would mean no session at
 * all on `http://localhost`.
 *
 * ## `maxAge`
 *
 * 400 days is the browser's ceiling, not a decision. A token stolen from a
 * shared machine stayed valid for over a year. Seven days, and it is a ROLLING
 * seven: the proxy rewrites the cookie on every response it touches, so someone
 * who uses the product weekly is never signed out, and a laptop left in a hotel
 * stops being useful within the week.
 */

/** A week, in seconds. Rolling — see the module header. */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

export function hardenedCookieOptions(options: CookieOptions): CookieOptions {
  return {
    ...options,
    // `sameSite` is already "lax" from the library, which is correct: "strict"
    // would drop the cookie on the redirect back from an email link and log the
    // user out at the worst moment.
    secure: process.env.NODE_ENV === "production",
    // Only shorten. A cookie the library is deliberately expiring — maxAge 0 on
    // sign-out — must not be resurrected with a week's life by this helper.
    maxAge:
      options.maxAge !== undefined && options.maxAge <= SESSION_MAX_AGE_SECONDS
        ? options.maxAge
        : SESSION_MAX_AGE_SECONDS,
  }
}
