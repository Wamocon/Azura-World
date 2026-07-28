/**
 * The `?next=` open-redirect probe.                          Owner: W3-H
 *
 *   node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs \
 *        scripts/next-path-probe.mts
 *
 * `tasks/W3-H` §"Definition of done" asks for each open-redirect attempt and its
 * outcome to be pasted, not summarised. This produces that list.
 *
 * An open redirect on a login page earns this much attention because of what it
 * does to the *user's* judgement rather than to the server: the victim
 * authenticates against the genuine site, sees the genuine domain in the address
 * bar throughout, and is then handed to an attacker's page carrying all the
 * credibility of a successful sign-in. It is the classic phishing amplifier, and
 * `?next=` is the classic place it lives.
 *
 * Every case states the rule it exercises. A probe that only tried
 * `https://evil.example` would pass trivially and prove nothing — that one fails
 * the very first check. The interesting inputs are the ones that *look* like
 * paths.
 *
 * Control characters are written as `\u….` escapes. A literal byte in a source
 * file is invisible in review, and this repository has shipped one before.
 */

import {
  safeNextPath,
  NEXT_FALLBACK,
  localisedDestination,
} from "../apps/web/app/[locale]/login/next-path.ts"

interface Case {
  input: unknown
  /** `true` when the value must survive; `false` when it must be replaced. */
  allowed: boolean
  why: string
}

const HOSTILE = "evil.example"

const cases: Case[] = [
  // -- The four the brief names explicitly -----------------------------------
  { input: `https://${HOSTILE}`, allowed: false, why: "absolute URL, the obvious case" },
  { input: `//${HOSTILE}`, allowed: false, why: "protocol-relative: a different origin wearing a path's clothes" },
  { input: `/\\${HOSTILE}`, allowed: false, why: "backslash variant; some parsers normalise backslash to slash" },
  { input: `%2f%2f${HOSTILE}`, allowed: false, why: "percent-encoded //, still encoded when it reaches us" },

  // -- Scheme and authority --------------------------------------------------
  { input: `http://${HOSTILE}`, allowed: false, why: "plain http absolute" },
  { input: `HTTPS://${HOSTILE}`, allowed: false, why: "upper-case scheme" },
  { input: `//${HOSTILE}/dashboard`, allowed: false, why: "protocol-relative with a plausible tail" },
  { input: `///${HOSTILE}`, allowed: false, why: "three slashes; some parsers collapse to //" },
  { input: `/	/${HOSTILE}`, allowed: false, why: "tab inside the path, stripped by some URL parsers" },
  { input: "javascript:alert(1)", allowed: false, why: "script URL" },
  { input: "data:text/html,<script>alert(1)</script>", allowed: false, why: "data URL" },
  { input: `\\\\${HOSTILE}`, allowed: false, why: "UNC-style double backslash" },
  { input: `/${HOSTILE}`, allowed: true, why: "a single-slash path is same-origin, whatever it is named" },

  // -- Encoding --------------------------------------------------------------
  { input: `%2F%2F${HOSTILE}`, allowed: false, why: "upper-case percent encoding" },
  { input: `%2f%5c${HOSTILE}`, allowed: false, why: "encoded slash plus encoded backslash" },
  { input: `/%2f${HOSTILE}`, allowed: false, why: "leading slash then encoded slash, decodes to //" },
  { input: `/%5c${HOSTILE}`, allowed: false, why: "leading slash then encoded backslash" },
  { input: `/%252f%252f${HOSTILE}`, allowed: true, why: "double-encoded: decodes once to %2f%2f, which is a path segment and not a redirect target" },
  { input: "/dashboard%zz", allowed: false, why: "malformed escape; decodeURIComponent throws, so reject" },

  // -- Control characters ----------------------------------------------------
  { input: "/dashboard\r\nSet-Cookie: a=b", allowed: false, why: "CRLF injection into a response header" },
  { input: "/dashboard\u0000", allowed: false, why: "NUL truncation" },
  { input: "/dashboard\u007F", allowed: false, why: "DEL" },
  { input: "/dash\u001Fboard", allowed: false, why: "unit separator mid-path" },

  // -- Shape and type --------------------------------------------------------
  { input: "dashboard", allowed: false, why: "relative, no leading slash" },
  { input: "", allowed: false, why: "empty" },
  { input: undefined, allowed: false, why: "absent" },
  { input: null, allowed: false, why: "null" },
  { input: 42, allowed: false, why: "not a string" },
  { input: ["/dashboard"], allowed: false, why: "array, as a repeated query parameter arrives" },
  { input: { toString: () => "/dashboard" }, allowed: false, why: "object with a friendly toString" },
  { input: `/${"a".repeat(600)}`, allowed: false, why: "over the 512-character ceiling" },

  // -- Values that must survive ---------------------------------------------
  { input: "/dashboard", allowed: true, why: "the ordinary case" },
  { input: "/dashboard/evidence", allowed: true, why: "nested path" },
  { input: "/dashboard?tab=findings&sort=severity", allowed: true, why: "query preserved, so a session expiring mid-form does not lose the user's place" },
  { input: "/dashboard#section", allowed: true, why: "fragment" },
  { input: "/dashboard/units/AZW-B03-0412", allowed: true, why: "a unit id; no reserved characters" },
  { input: "/de/dashboard", allowed: true, why: "locale-prefixed; the prefix is stripped later, not here" },
]

let pass = 0
let fail = 0
const lines: string[] = []

/** Renders control characters visibly, so the output can be read and pasted. */
function show(value: unknown): string {
  const json = JSON.stringify(value)
  if (typeof json !== "string") return String(value)
  return json.replace(/[\u0000-\u001F\u007F]/gu, (character) => {
    const code = character.codePointAt(0) ?? 0
    return `\\u${code.toString(16).padStart(4, "0").toUpperCase()}`
  })
}

for (const testCase of cases) {
  const result = safeNextPath(testCase.input)
  /*
   * Compared against the *input*, not against the fallback.
   *
   * The first version asked "is the result different from `/dashboard`?", which
   * marked the ordinary `/dashboard` case as blocked — it is simultaneously a
   * legitimate destination and the fallback value. A blocked input must return
   * the fallback; an allowed input must come back unchanged. Those are two
   * different claims and conflating them made a passing case look like a
   * failure, which is the harmless direction, but the same conflation would have
   * hidden a rejected `/dashboard/evidence` had the rule ever regressed.
   */
  const ok = testCase.allowed
    ? result === testCase.input
    : result === NEXT_FALLBACK

  if (ok) pass += 1
  else fail += 1

  lines.push(
    `${ok ? "PASS" : "FAIL"}  ${testCase.allowed ? "allow" : "block"}  ` +
      `${show(testCase.input).padEnd(48)} -> ${show(result).padEnd(26)}  ${testCase.why}`
  )
}

// The redirect is always locale-prefixed, whatever survived above. A bare
// `/dashboard` is not a route under `localePrefix: "always"`.
const localeCases: [string, string, string][] = [
  ["de", "/dashboard", "/de/dashboard"],
  ["tr", "/dashboard/evidence", "/tr/dashboard/evidence"],
  ["ru", "/de/dashboard", "/ru/dashboard"],
  ["en", "/", "/en/dashboard"],
  ["en", "", "/en/dashboard"],
]
for (const [locale, path, expected] of localeCases) {
  const actual = localisedDestination(locale, path)
  const ok = actual === expected
  if (ok) pass += 1
  else fail += 1
  lines.push(
    `${ok ? "PASS" : "FAIL"}  locale ${`${locale} + ${path || "(empty)"}`.padEnd(48)} -> ${actual.padEnd(26)}  expected ${expected}`
  )
}

console.log(lines.join("\n"))
console.log(`\n${fail === 0 ? "OK" : "FAILED"}  ${pass} pass · ${fail} fail`)
if (fail > 0) process.exit(1)
