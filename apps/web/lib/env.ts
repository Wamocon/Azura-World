/**
 * Validated environment access — the single door to configuration.
 *
 * After this module exists, `process.env.X` is banned everywhere else in the
 * app. Two exceptions, both deliberate and both commented at their site:
 *   - `next.config.ts`, which the Next CLI evaluates before any app module.
 *   - `proxy.ts`, which reads only `process.env.NODE_ENV` (a build-time
 *     constant, not configuration).
 *
 * The variable set is exactly the one in `.env.example`, no more and no fewer.
 * `HANDOFF/W0-ENV.md` requires it: those names mirror the 1Çatı reference so
 * scripts and conventions transfer unchanged. Do not invent or rename one.
 *
 * Design rules enforced here:
 *
 * 1. `publicEnv` holds only `NEXT_PUBLIC_*` values and is safe in the browser.
 *    `serverEnv` holds everything else and THROWS when read client-side — it
 *    never returns `undefined`, because a silent `undefined` turns a bundling
 *    mistake into a runtime mystery.
 *
 * 2. Next inlines `NEXT_PUBLIC_*` at build time only when the source contains a
 *    literal member expression. Every public variable is therefore read on its
 *    own line as `process.env.NEXT_PUBLIC_…`. Never `process.env[name]` in a
 *    loop for the public set — the loop form produces `undefined` in the
 *    browser bundle with no error. Server variables are read from `process.env`
 *    as a whole object on purpose: that shape is what keeps webpack's
 *    DefinePlugin from ever inlining a secret literal into a client chunk.
 *
 * 3. Validation runs at module load, so a misconfigured deploy fails at boot
 *    rather than at the first request that happens to touch a bad value.
 *
 * 4. Blank is tolerated; malformed is fatal. The app runs on the seed fallback
 *    until W1-A applies migrations (CONVENTIONS §2), so an *absent* Supabase
 *    value is a supported state. A *present but malformed* value is a hard
 *    failure — that is a misconfiguration, not a fallback. A value that is
 *    still the `.env.example` placeholder counts as absent, not as configured.
 *
 * 5. No secret value is ever logged, stringified, or re-exported. Every error
 *    message names the variable and never the value.
 */

import { z } from "zod"

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * `NODE_ENV` is a Next build-time constant, not configuration. Reading it as a
 * literal member expression is correct and is what lets webpack fold the
 * production branches of `accessProfilesEnabled()` away entirely.
 */
const isProductionBuild = process.env.NODE_ENV === "production"

/** True in every server runtime (Node, edge, and SSR of a client component). */
const isServerRuntime = typeof window === "undefined"

/** Minimum length for a hand-generated server secret. 48 random bytes ⟹ 64 chars base64url. */
const MIN_SECRET_LENGTH = 32

/** Template text that must never survive into a real deployment. */
const PLACEHOLDER_PREFIXES = [/^replace-with-/i, /^your-/i, /^changeme/i]

/**
 * Verbatim fragments from `.env.example`'s Supabase placeholders. A value
 * containing one of these was copied from the template and never filled in.
 * Matched as substrings because `SUPABASE_DB_URL`'s placeholder buries them
 * mid-string (`postgresql://postgres.your-project-ref:PASSWORD@…`).
 */
const SUPABASE_PLACEHOLDER_MARKERS = [
  "your-project-ref",
  "your-anon-key",
  "your-service-role-key",
  ":PASSWORD@",
]

function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDER_PREFIXES.some((pattern) => pattern.test(value))
}

/**
 * `""` means "not set". `.env.example` ships several deliberately blank values
 * (`NEXT_PUBLIC_FX_RATE_DATE`, `JIRA_EMAIL`, `JIRA_API_TOKEN`), and dotenv hands
 * those through as empty strings rather than omitting them.
 */
function blankToUndefined(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Treats an unfilled Supabase placeholder as absent rather than as a fatal
 * error. That keeps a fresh `cp .env.example .env.local` on the supported
 * seed-fallback path instead of crashing at boot, while still ensuring
 * `isSupabaseConfigured()` reports the truth: nothing is configured.
 */
function supabaseValue(value: string | undefined): string | undefined {
  const cleaned = blankToUndefined(value)
  if (cleaned === undefined) return undefined
  const lowered = cleaned.toLowerCase()
  const isPlaceholder = SUPABASE_PLACEHOLDER_MARKERS.some((marker) =>
    lowered.includes(marker.toLowerCase())
  )
  return isPlaceholder ? undefined : cleaned
}

/** Same blank normalisation, applied across the whole server-side `process.env`. */
function normalizeServerSource(
  source: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    const cleaned = blankToUndefined(value)
    if (cleaned !== undefined) normalized[key] = cleaned
  }
  for (const key of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_DB_URL",
    "SUPABASE_PROJECT_REF",
  ]) {
    const kept = supabaseValue(normalized[key])
    if (kept === undefined) delete normalized[key]
  }
  return normalized
}

/** `"true"` / `"false"` only. Absent ⟹ `false`. Anything else is a hard failure. */
const envBoolean = z
  .enum(["true", "false"], 'must be exactly "true" or "false"')
  .default("false")
  .transform((value) => value === "true")

/** A server secret: absent is fine, present must be real and long enough. */
function serverSecret(name: string) {
  return z
    .string()
    .min(
      MIN_SECRET_LENGTH,
      `${name} must be at least ${MIN_SECRET_LENGTH} characters. Generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
    )
    .refine(
      (value) => !looksLikePlaceholder(value),
      `${name} is still the .env.example placeholder. Generate an independent high-entropy value; never derive it from the service-role key.`
    )
    .optional()
}

// ---------------------------------------------------------------------------
// Public schema — NEXT_PUBLIC_* only. Safe to evaluate in the browser.
// ---------------------------------------------------------------------------

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .url("must be an absolute URL, e.g. https://<project-ref>.supabase.co")
    .optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, "does not look like a Supabase anon key (too short)")
    .optional(),
  /** `0` is the documented "not configured" value — see `fxDisplayRate()`. */
  NEXT_PUBLIC_EUR_TRY_RATE: z.coerce
    .number()
    .min(0, "must be a non-negative number (0 means FX display is off)")
    .default(0),
  NEXT_PUBLIC_EUR_USD_RATE: z.coerce
    .number()
    .min(0, "must be a non-negative number (0 means FX display is off)")
    .default(0),
  /** CONVENTIONS §5: a converted figure is only honest next to its rate date. */
  NEXT_PUBLIC_FX_RATE_DATE: z.iso
    .date("must be an ISO date, YYYY-MM-DD")
    .optional(),
  NEXT_PUBLIC_APP_URL: z
    .url("must be an absolute URL, e.g. http://127.0.0.1:3200")
    .default("http://127.0.0.1:3200"),
})

/**
 * One literal `process.env.NEXT_PUBLIC_…` read per line. This shape is load
 * bearing: see rule 2 in the module header. Do not refactor into a loop.
 */
const rawPublicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: supabaseValue(process.env.NEXT_PUBLIC_SUPABASE_URL),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseValue(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ),
  NEXT_PUBLIC_EUR_TRY_RATE: blankToUndefined(
    process.env.NEXT_PUBLIC_EUR_TRY_RATE
  ),
  NEXT_PUBLIC_EUR_USD_RATE: blankToUndefined(
    process.env.NEXT_PUBLIC_EUR_USD_RATE
  ),
  NEXT_PUBLIC_FX_RATE_DATE: blankToUndefined(
    process.env.NEXT_PUBLIC_FX_RATE_DATE
  ),
  NEXT_PUBLIC_APP_URL: blankToUndefined(process.env.NEXT_PUBLIC_APP_URL),
}

// ---------------------------------------------------------------------------
// Server schema — everything that is not NEXT_PUBLIC_*.
// ---------------------------------------------------------------------------

const serverEnvSchema = z
  .object({
    // — Supabase ————————————————————————————————————————————————
    SUPABASE_SERVICE_ROLE_KEY: z
      .string()
      .min(20, "does not look like a Supabase service-role key (too short)")
      .optional(),
    SUPABASE_DB_URL: z
      .url("must be a postgresql:// connection URI")
      .refine((value) => {
        // The url check above already reported an unparseable value; do not
        // report it twice.
        try {
          return new URL(value).port !== "6543"
        } catch {
          return true
        }
      }, "uses port 6543 (the transaction pooler). Migrations and pgTAP need prepared statements and advisory locks — use the direct host or the session pooler on 5432. See HANDOFF/W0-ENV.md.")
      .optional(),
    SUPABASE_PROJECT_REF: z.string().min(1).optional(),

    // — Storage buckets ————————————————————————————————————————
    // `.env.example` documents exactly one value. A second mode is not invented
    // here: if a later window needs one, amend `.env.example` (W0-A) and this
    // schema together, in one change.
    DOCUMENT_STORAGE_MODE: z
      .literal("supabase", 'must be "supabase" — the only documented value')
      .default("supabase"),
    SUPABASE_DOCUMENT_BUCKET: z.string().min(1).default("azura-documents"),
    SUPABASE_EVIDENCE_BUCKET: z.string().min(1).default("azura-evidence"),

    // — Server-only secrets ————————————————————————————————————
    CALENDAR_FEED_TOKEN_SECRET: serverSecret("CALENDAR_FEED_TOKEN_SECRET"),
    PUBLIC_REPORT_SECURITY_SECRET: serverSecret(
      "PUBLIC_REPORT_SECURITY_SECRET"
    ),
    REGISTRATION_IDENTITY_PEPPER: serverSecret("REGISTRATION_IDENTITY_PEPPER"),
    REGISTRATION_RECEIPT_PEPPER: serverSecret("REGISTRATION_RECEIPT_PEPPER"),
    EVIDENCE_SNAPSHOT_HMAC_SECRET: serverSecret(
      "EVIDENCE_SNAPSHOT_HMAC_SECRET"
    ),

    // — AI gateway (OpenAI-compatible) ——————————————————————————
    // No invented defaults: an unconfigured gateway is a supported state and
    // CONTRACTS §6 requires a deterministic fallback rather than a guess.
    AI_API_URL: z.url("must be an absolute URL").optional(),
    AI_API_KEY: z.string().min(1).optional(),
    AI_CHAT_COMPLETIONS_PATH: z
      .string()
      .startsWith("/", "must be a path beginning with /")
      .default("/chat/completions"),
    AI_MODEL_FAST: z.string().min(1).optional(),
    AI_MODEL_REASONING: z.string().min(1).optional(),
    AI_MODEL_GERMAN_COPY: z.string().min(1).optional(),
    AI_MODEL_PRO: z.string().min(1).optional(),

    // — Harvest ————————————————————————————————————————————————
    HARVEST_USER_AGENT: z.string().min(1).optional(),
    HARVEST_MIN_DELAY_MS: z.coerce
      .number()
      .int("must be a whole number of milliseconds")
      .min(0, "must be zero or greater")
      .default(2000),
    HARVEST_MAX_CONCURRENCY: z.coerce
      .number()
      .int("must be a whole number")
      .min(1, "must be at least 1")
      .default(3),
    HARVEST_ALLOW_INVALID_TLS: envBoolean,

    // — Access profiles: QA only, triple-gated (SYSTEM-PROMPT §2.12) ————
    ENABLE_ACCESS_PROFILES: envBoolean,
    AZURA_ALLOW_REMOTE_ACCESS_PROFILES: envBoolean,
    AZURA_DEMO_DATA_ISOLATED: envBoolean,

    // — Jira (INTERNAL-107) ————————————————————————————————————
    JIRA_BASE_URL: z.url("must be an absolute URL").optional(),
    JIRA_EMAIL: z.email("must be an email address").optional(),
    JIRA_API_TOKEN: z.string().min(1).optional(),
    JIRA_PROJECT_KEY: z.string().min(1).default("INTERNAL"),

    // — Local tooling ——————————————————————————————————————————
    PLAYWRIGHT_BROWSERS_PATH: z.string().min(1).default(".tmp/pw"),
  })
  .superRefine((values, ctx) => {
    // W0-ENV records this as a common paste error: the two keys come from
    // adjacent rows of the same dashboard panel, and swapping them ships a
    // full RLS bypass to the browser.
    const anonKey = rawPublicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (
      anonKey !== undefined &&
      values.SUPABASE_SERVICE_ROLE_KEY !== undefined &&
      anonKey === values.SUPABASE_SERVICE_ROLE_KEY
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["SUPABASE_SERVICE_ROLE_KEY"],
        message:
          "is identical to NEXT_PUBLIC_SUPABASE_ANON_KEY. The service-role key bypasses RLS entirely and must never be the public key. Re-copy both from Project Settings → API.",
      })
    }
  })

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PublicEnv = z.infer<typeof publicEnvSchema>
export type ServerEnv = z.infer<typeof serverEnvSchema>

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Renders issues as `VARIABLE_NAME: message`. Deliberately never touches
 * `issue.input` — zod attaches the offending value to every issue, and printing
 * it would put a secret in a log line.
 */
function describeIssues(scope: string, error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const name = issue.path.map((segment) => String(segment)).join(".")
    return `  - ${name.length > 0 ? name : "(root)"}: ${issue.message}`
  })
  return [
    `Invalid ${scope} environment configuration (${error.issues.length} problem${
      error.issues.length === 1 ? "" : "s"
    }):`,
    ...lines,
    "",
    "Fix the named variables in .env.local. See .env.example for the full set.",
    "Values are never printed here — only variable names.",
  ].join("\n")
}

function parsePublicEnv(): PublicEnv {
  const result = publicEnvSchema.safeParse(rawPublicEnv)
  if (!result.success) {
    throw new Error(describeIssues("public", result.error))
  }
  return result.data
}

function parseServerEnv(): ServerEnv {
  const result = serverEnvSchema.safeParse(normalizeServerSource(process.env))
  if (!result.success) {
    throw new Error(describeIssues("server", result.error))
  }
  return result.data
}

/** Validated at module load — a misconfigured deploy fails at boot. */
export const publicEnv: PublicEnv = parsePublicEnv()

/**
 * Server values are only parsed server-side. In the browser the parse is
 * skipped entirely (there is nothing to parse — Next never ships these to the
 * client) and every read throws instead.
 */
const serverEnvValues: ServerEnv | null = isServerRuntime
  ? parseServerEnv()
  : null

/**
 * Server-only configuration.
 *
 * Reading any property in the browser throws rather than returning `undefined`.
 * A thrown error points at the import that dragged server config into a client
 * component; a silent `undefined` produces a bug three layers away.
 */
export const serverEnv: ServerEnv = new Proxy({} as ServerEnv, {
  get(_target, property) {
    if (!isServerRuntime || serverEnvValues === null) {
      throw new Error(
        `serverEnv.${String(property)} was read in the browser. Server-only configuration must never reach the client bundle — move this read into a Server Component, a route handler, or a server action. (CONVENTIONS §4)`
      )
    }
    return serverEnvValues[property as keyof ServerEnv]
  },
  has(_target, property) {
    if (!isServerRuntime || serverEnvValues === null) return false
    return property in serverEnvValues
  },
})

// ---------------------------------------------------------------------------
// Helpers other windows depend on
// ---------------------------------------------------------------------------

/**
 * CONVENTIONS §2 keys the whole repository fallback pattern off this: false ⟹
 * `source: "local-seed"`, true ⟹ a Supabase failure is a real error, not a
 * fallback. Public-only, so it is safe in the browser.
 */
export function isSupabaseConfigured(): boolean {
  return (
    publicEnv.NEXT_PUBLIC_SUPABASE_URL !== undefined &&
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY !== undefined
  )
}

/**
 * Server-only. CONTRACTS §6 rule 2: an unconfigured gateway means
 * `source: "deterministic-fallback"`, never a 5xx.
 */
export function isAiGatewayConfigured(): boolean {
  return (
    serverEnv.AI_API_URL !== undefined && serverEnv.AI_API_KEY !== undefined
  )
}

/**
 * The triple gate for QA-only access profiles (SYSTEM-PROMPT §2.12).
 *
 * All three flags are server-side by design — a `NEXT_PUBLIC_*` flag could be
 * flipped by anyone reading the bundle. All three must be true.
 *
 * `NODE_ENV === "production"` returns false unconditionally and before the
 * flags are even consulted. The brief requires that no combination of
 * environment values can turn a production build into an unauthenticated role
 * switcher; because `process.env.NODE_ENV` is a build-time constant, this early
 * return also lets the bundler fold the whole function to `false` in a
 * production build, so the capability is not merely disabled — it is absent.
 */
export function accessProfilesEnabled(): boolean {
  if (isProductionBuild) return false
  if (!isServerRuntime) return false
  return (
    serverEnv.ENABLE_ACCESS_PROFILES &&
    serverEnv.AZURA_ALLOW_REMOTE_ACCESS_PROFILES &&
    serverEnv.AZURA_DEMO_DATA_ISOLATED
  )
}

// ---------------------------------------------------------------------------
// Currency display
// ---------------------------------------------------------------------------

export type FxPair = "EUR_TRY" | "EUR_USD"

/**
 * CONVENTIONS §5: the pipeline never converts, and a displayed conversion must
 * carry the rate's date. A rate of `0` means "not configured" — callers get a
 * discriminated union so there is no way to reach a number without also having
 * the date, and no way to silently multiply by zero.
 */
export type FxDisplayRate =
  | { configured: true; pair: FxPair; rate: number; rateDate: string }
  | {
      configured: false
      pair: FxPair
      reason: "rate_not_set" | "rate_date_not_set"
    }

export function fxDisplayRate(pair: FxPair): FxDisplayRate {
  const rate =
    pair === "EUR_TRY"
      ? publicEnv.NEXT_PUBLIC_EUR_TRY_RATE
      : publicEnv.NEXT_PUBLIC_EUR_USD_RATE

  if (rate <= 0) return { configured: false, pair, reason: "rate_not_set" }

  const rateDate = publicEnv.NEXT_PUBLIC_FX_RATE_DATE
  if (rateDate === undefined) {
    return { configured: false, pair, reason: "rate_date_not_set" }
  }

  return { configured: true, pair, rate, rateDate }
}

export function isFxDisplayConfigured(pair: FxPair): boolean {
  return fxDisplayRate(pair).configured
}
