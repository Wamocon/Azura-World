/**
 * Access profiles — a deterministic QA capability that must be impossible to
 * ship (SYSTEM-PROMPT §2.12, W1-B brief §3).
 *
 * An access profile lets a reviewer pick a role from the login page without
 * authenticating. That is a deliberate backdoor. It is worth having, because it
 * is the only way to walk eleven roles through every surface before the Supabase
 * data plane has users in it — and it is worth being paranoid about, because a
 * deployed build with an open role picker is a total compromise.
 *
 * Three layers, in increasing severity:
 *
 *  1. `accessProfilesEnabledForEnvironment()` — the runtime gate. Returns
 *     `false` unless the process can **prove** it is a development or test
 *     runtime, so no combination of environment values — and no *absence* of
 *     them — can turn a deployed build into an unauthenticated role switcher.
 *
 *  2. `assertAccessProfileSafety()` — the build-time guard. If a production
 *     process starts with `ENABLE_ACCESS_PROFILES=true` and cannot *prove* it is
 *     isolated from every Supabase data plane, it **throws at module load**. The
 *     process does not boot. A runtime check that only warns gets ignored;
 *     W4-C will try to defeat this, and a warning is not a defence.
 *
 *  3. `resolveAccessProfileRole()` — even when profiles are on, an unparseable
 *     or unknown role resolves to `manager`, never to `admin`.
 *
 * This module is deliberately parameterised on an environment record rather than
 * reading `process.env` inline, mirroring the 1Çatı reference
 * (`lib/access-profile-policy.ts`). That is what makes every branch testable
 * without spawning a process per case — and `scripts/rbac-probe.mts` still
 * spawns a real production process to prove layer 2 actually fires.
 *
 * ## Why `process.env` is read here and nowhere else
 *
 * `lib/env.ts` bans `process.env` elsewhere in the app, and rightly. This module
 * is the documented exception, for two reasons. First, the values it reads
 * (`NODE_ENV`, `VERCEL_ENV`, `AZURA_ENV`, `ACCESS_PROFILE_ROLE`) are deployment
 * shape and a role name — not configuration and not secrets. Second, layer 2
 * must be able to inspect a *raw, unvalidated* environment: `lib/env.ts` parses
 * at module load and throws on malformed input, and a guard that only fires
 * after validation succeeds is a guard an attacker can skip by supplying
 * something malformed.
 */

import { isValidRole } from "./rbac"
import type { Role } from "./contracts"

/** The environment shape this module reasons about. `process.env` satisfies it. */
export type EnvironmentRecord = Readonly<Record<string, string | undefined>>

/** The role an enabled-but-unspecified access profile resolves to. */
export const DEFAULT_ACCESS_PROFILE_ROLE: Role = "manager"

/** Cookie the login role picker writes. Read by `lib/auth.ts`. */
export const ACCESS_PROFILE_COOKIE = "access_profile_role"

/**
 * How long the QA cookie lives. Short on purpose: a reviewer's forgotten cookie
 * should expire, not persist across a week of testing.
 */
export const ACCESS_PROFILE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8

function flag(environment: EnvironmentRecord, name: string): boolean {
  return environment[name] === "true"
}

/**
 * True when this process is a production runtime **or** a production deployment.
 * Both are checked: `NODE_ENV` can be left at `development` on a self-hosted box
 * that is nonetheless serving real traffic, and a platform env var can be
 * `production` on a build that forgot to set `NODE_ENV`. Either one is enough.
 */
export function isProductionEnvironment(
  environment: EnvironmentRecord
): boolean {
  return (
    environment["NODE_ENV"] === "production" ||
    environment["VERCEL_ENV"] === "production" ||
    environment["AZURA_ENV"] === "production"
  )
}

/**
 * `NODE_ENV` values that Next itself treats as non-deployed. `next dev` sets
 * `development`; `next build` and `next start` set `production`; `test` is what
 * the probe scripts and Playwright's own runner use.
 */
const DEVELOPMENT_NODE_ENVS: readonly string[] = ["development", "test"]

/**
 * True only when the process can **prove** it is a local development or test
 * runtime. This is the inverse of `isProductionEnvironment()`, and the
 * difference between the two is the whole point.
 *
 * `isProductionEnvironment()` is an allowlist of danger markers, so an
 * environment that carries none of them — `NODE_ENV` unset, or set to something
 * unrecognised — reads as "not production". That is the wrong default for a
 * gate that opens an unauthenticated role picker: it means the *absence* of
 * configuration is what unlocks it. `next start` does set `NODE_ENV=production`
 * (see `next/dist/bin/next`, which assigns it before any command runs), so the
 * supported deployment path was never actually exposed — but a custom server, a
 * process manager that scrubs the environment, or a container that drops
 * `NODE_ENV` all produce a real production runtime that the allowlist cannot
 * see, and the seed-fallback clause below would then hand out a role picker
 * whose role comes from a client-supplied cookie.
 *
 * So the polarity is inverted here: unknown is closed, not open. A deployment
 * marker disqualifies even when `NODE_ENV` says development, because a
 * preview deployment is still a deployment on a public URL.
 */
export function isDevelopmentEnvironment(
  environment: EnvironmentRecord
): boolean {
  if (isProductionEnvironment(environment)) return false

  const nodeEnv = environment["NODE_ENV"]
  if (nodeEnv === undefined || !DEVELOPMENT_NODE_ENVS.includes(nodeEnv)) {
    return false
  }

  // `VERCEL_ENV` is only ever set by a Vercel deployment. `development` is what
  // `vercel dev` sets locally; `preview` is a deployed, publicly reachable URL.
  const vercelEnv = environment["VERCEL_ENV"]
  if (vercelEnv !== undefined && vercelEnv !== "development") return false

  const azuraEnv = environment["AZURA_ENV"]
  if (azuraEnv !== undefined && !DEVELOPMENT_NODE_ENVS.includes(azuraEnv)) {
    return false
  }

  return true
}

/**
 * True when *anything* points at a Supabase data plane. Deliberately generous:
 * the question this answers is "could this process reach real data?", and the
 * safe answer to an ambiguous case is yes.
 */
export function hasSupabaseDataPlane(environment: EnvironmentRecord): boolean {
  return Boolean(
    environment["NEXT_PUBLIC_SUPABASE_URL"] ||
    environment["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ||
    environment["SUPABASE_URL"] ||
    environment["SUPABASE_SERVICE_ROLE_KEY"] ||
    environment["SUPABASE_DB_URL"] ||
    environment["SUPABASE_PROJECT_REF"]
  )
}

/**
 * The only escape hatch from the layer-2 throw, and it is not an escape hatch
 * from layer 1: a deployment may declare itself isolated, and it still will not
 * get a role picker in production. All three conditions are required —
 * *claiming* isolation while a Supabase URL sits in the environment is exactly
 * the misconfiguration this exists to catch.
 */
function isProvablyIsolated(environment: EnvironmentRecord): boolean {
  return (
    flag(environment, "AZURA_ALLOW_REMOTE_ACCESS_PROFILES") &&
    flag(environment, "AZURA_DEMO_DATA_ISOLATED") &&
    !hasSupabaseDataPlane(environment)
  )
}

/** Thrown by `assertAccessProfileSafety`. Named so a test can assert the type. */
export class AccessProfileSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AccessProfileSafetyError"
  }
}

/**
 * Layer 2 — the build-time guard. Throws when a production process is
 * configured to allow access profiles without proving it is isolated from every
 * Supabase data plane.
 *
 * Called at module load below with the real `process.env`, so a misconfigured
 * production deploy fails at boot rather than at the first request that happens
 * to hit the login page. Exported so it can be exercised against synthetic
 * environments without spawning eleven processes.
 *
 * This still keys on `isProductionEnvironment()` — the danger-marker allowlist —
 * rather than on `!isDevelopmentEnvironment()`, and deliberately. Layer 1 now
 * fails closed on an environment it cannot classify, so an ambiguous one is
 * already safe and does not need to be fatal; making it fatal would kill every
 * script and one-off `node` process that imports an auth module without setting
 * `NODE_ENV`. The throw is reserved for the case that is unambiguously wrong:
 * a process that *declares* itself production and *asks* for the role picker.
 */
export function assertAccessProfileSafety(
  environment: EnvironmentRecord
): void {
  if (!isProductionEnvironment(environment)) return
  if (!flag(environment, "ENABLE_ACCESS_PROFILES")) return
  if (isProvablyIsolated(environment)) return

  throw new AccessProfileSafetyError(
    [
      "ENABLE_ACCESS_PROFILES is true in a production environment.",
      "Access profiles are an unauthenticated role picker and must never reach a production build (SYSTEM-PROMPT §2.12).",
      "This process refuses to start.",
      "",
      "Fix: unset ENABLE_ACCESS_PROFILES in this deployment.",
      "The only accepted alternative is a deployment that proves isolation, which requires ALL of:",
      "  - AZURA_ALLOW_REMOTE_ACCESS_PROFILES=true",
      "  - AZURA_DEMO_DATA_ISOLATED=true",
      "  - no Supabase data plane configured at all (no NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,",
      "    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL or SUPABASE_PROJECT_REF)",
      "Even then, access profiles stay DISABLED in production — the isolation clause only downgrades this hard",
      "failure to a silent no-op. There is no configuration that enables the role picker in production.",
      "",
      "No environment values are printed here, only variable names.",
    ].join("\n")
  )
}

/**
 * Layer 1 — the runtime gate.
 *
 * A **positive** proof of a development or test runtime is checked first and is
 * authoritative: anything this process cannot prove is local gets `false`,
 * including an environment record that is simply empty. Inside a proven
 * development runtime the rule is the one in the W1-B brief:
 *
 *   - Supabase unconfigured ⟹ enabled. This is the supported seed-fallback mode
 *     (CONVENTIONS §2): with no data plane there is nothing to authenticate
 *     against and nothing to leak, and the app must still be walkable.
 *   - Supabase configured ⟹ all three QA flags must be true. Real auth exists,
 *     so bypassing it needs an explicit, deliberate opt-in.
 *
 * The seed-fallback clause is the one place where an *absent* value rather than
 * a present flag opens the picker, and it is why the first check has to be a
 * proof rather than a check for danger markers. `NODE_ENV=development` — which
 * only `next dev` and the probe scripts set — is that clause's explicit opt-in.
 * The failure it prevents: a deployed build whose `NODE_ENV` never got set,
 * serving `/login` with a role picker whose chosen role arrives in a
 * client-controlled cookie and may be `admin`.
 *
 * None of the three flags is `NEXT_PUBLIC_*`, because the decision is
 * server-side; a public flag could be flipped by anyone reading the bundle.
 */
export function accessProfilesEnabledForEnvironment(
  environment: EnvironmentRecord = process.env
): boolean {
  if (!isDevelopmentEnvironment(environment)) return false

  const supabaseConfigured = Boolean(
    environment["NEXT_PUBLIC_SUPABASE_URL"] &&
    environment["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
  )
  if (!supabaseConfigured) return true

  return (
    flag(environment, "ENABLE_ACCESS_PROFILES") &&
    flag(environment, "AZURA_ALLOW_REMOTE_ACCESS_PROFILES") &&
    flag(environment, "AZURA_DEMO_DATA_ISOLATED")
  )
}

/**
 * Layer 3 — cookie → env → `manager`.
 *
 * An unknown cookie value does not crash and does not escalate: it falls through
 * to the next source and finally to `manager`. `manager` is the brief's
 * specified default because it is the broadest role that is still *not* `admin`
 * — a QA reviewer who lands on a role picker should see the operational product,
 * not the user-administration surface.
 */
export function resolveAccessProfileRole(
  cookieValue: string | undefined,
  environment: EnvironmentRecord = process.env
): Role {
  if (isValidRole(cookieValue)) return cookieValue

  const configured = environment["ACCESS_PROFILE_ROLE"]
  if (isValidRole(configured)) return configured

  return DEFAULT_ACCESS_PROFILE_ROLE
}

// Layer 2 fires here, at module load, against the real environment. Every module
// that touches auth imports this file transitively, so a misconfigured
// production process cannot serve a single request before this runs.
assertAccessProfileSafety(process.env)
