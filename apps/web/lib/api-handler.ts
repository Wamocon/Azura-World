import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import type { ZodType } from "zod"

import { getUserProfile, type UserProfile } from "./auth"
import { flattenOperations } from "./api-routes"
import { hasPermission } from "./rbac"
import { isSupabaseConfigured } from "./env"
import { RepositoryError } from "./repository-base"
import { createServiceRoleClient } from "./supabase/server"
import {
  apiHeaders,
  errorBody,
  forbidden,
  persistenceUnavailable,
  rateLimited,
  scrubInternals,
  statusFor,
  successBody,
  unauthorized,
  upstreamFailed,
  validationFailed,
} from "./api-errors"
import { projectRecord, projectRecords } from "./api-projection"
import type { ApiError, Permission, Role } from "./contracts"

/**
 * `createHandler` — the security sequence, in one place.    Owner: W2-B
 *
 * Twenty-eight routes. If each one wrote its own auth check, twenty-seven would
 * be right and the twenty-eighth would be the incident. So no route is allowed
 * to assemble the sequence itself: a route declares *what* it is and supplies a
 * repository call, and this wrapper decides *whether* it runs.
 *
 * ## The order IS the security property (CONVENTIONS §4)
 *
 *   1. method + content-type      — 405 / 415 before anything is parsed
 *   2. rate limit                 — before the body is read, so a throttled
 *                                   caller's payload is never buffered
 *   3. body ceiling + Zod         — length caps on every string, unknown keys
 *                                   rejected
 *   4. getUserProfile()
 *   5. hasPermission()            — server-side, always, even when the UI
 *                                   already hid the entry point
 *   6. write guard                — 503 when a mutation has no data plane
 *   7. the repository call
 *   8. error mapping              — never a Postgres message, never a stack
 *   9. audit + requestId          — every mutation leaves a row
 *
 * Steps 4 and 5 are *after* validation deliberately: rejecting malformed input
 * before touching the session means an unauthenticated flood cannot make the
 * app do session work. Step 5 is never *before* step 4, because a permission
 * check needs a role.
 *
 * ## What a route cannot do
 *
 * It cannot skip the permission check (there is no parameter for that), cannot
 * return a bare object (the envelope is applied here), cannot throw past the
 * boundary (everything is caught), and cannot mutate without declaring `audit`
 * — `scripts/validate-openapi.mjs` fails the build on a mutating route with no
 * audit declaration.
 */

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Body ceiling. Enforced by counting streamed bytes, not by trusting a header. */
const MAX_BODY_BYTES = 32_768

/** `?limit=` is clamped here as well as in the repository. Belt and braces. */
export const MAX_PAGE_LIMIT = 500

interface RateWindow {
  count: number
  startedAt: number
}

/**
 * In-memory fixed window, shared by every route in this module.
 *
 * Correct for one instance and **wrong for a horizontally scaled deployment**,
 * where each instance would enforce its own budget. Recorded in HANDOFF/W2-B.md
 * rather than papered over; the Postgres-backed replacement needs an RPC that
 * W1-A's migrations do not create, and inventing one against another window's
 * schema is not this task's call.
 */
const rateWindows = new Map<string, RateWindow>()
const MAX_TRACKED_KEYS = 4_096

/**
 * The caller's identity for rate limiting: address **and** a request
 * fingerprint.
 *
 * The brief is specific about why both. An IP alone is trivially defeated by a
 * rotating proxy, and behind a corporate NAT it is shared by many legitimate
 * users — so a per-IP limit is simultaneously too weak and too strong. Mixing
 * in a coarse fingerprint (user agent + accept-language) separates distinct
 * clients behind one address without identifying anybody.
 *
 * Hashed, so the limiter's memory holds no addresses. CONVENTIONS §4 forbids
 * logging PII, and a Map that outlives the request is close enough to a log.
 */
function rateIdentity(request: Request, scope: string): string {
  const edge = request.headers
    .get("x-vercel-forwarded-for")
    ?.split(",")[0]
    ?.trim()
  const production = process.env.NODE_ENV === "production"
  const address =
    edge !== undefined && edge.length > 0
      ? edge
      : production
        ? // Never trust `x-forwarded-for` in production without a trusted edge:
          // a limit keyed on a spoofable header is not a limit. Everything
          // collapses onto one shared bucket instead — degraded, but safe.
          "trusted-edge-unavailable"
        : (request.headers.get("x-real-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0] ??
          "local")
  // NO fingerprint. This used to mix in `user-agent` and `accept-language`,
  // reasoning that a coarse fingerprint separates distinct clients behind one
  // NAT. It does — and it also lets one client separate itself from itself.
  // Both headers are set by the caller and were used raw, so rotating the
  // user-agent string on every request produced a fresh bucket every time and
  // the limit never engaged. That defeated every route in the manifest,
  // including the three public ones and the 60/min search that fans out to a
  // Postgres trigram RPC.
  //
  // Worse, the map evicts by insertion order past `MAX_TRACKED_KEYS`, so an
  // attacker generating 4096 distinct fingerprints could also flush every
  // legitimate caller's counter and reset their budgets on demand.
  //
  // The NAT problem it was solving is real but strictly smaller: a shared
  // address means neighbours share a budget, which is a fairness cost. A
  // defeatable limit is not a limit at all. `lib/ai-rate-limit.ts` already keys
  // on address alone; this now matches it.
  // NUL as the domain separator, so a user-agent containing "|" cannot forge a
  // collision with another scope. Written as `\x00`, never as a literal byte:
  // one raw NUL makes git classify the whole file as binary, and both secret
  // scanners then skip its contents — `git diff --cached | grep` in
  // .githooks/pre-commit and `git grep -I` in ci.yml. `safeNextPath()` takes
  // the same care for the same reason.
  return createHash("sha256")
    .update(`${scope}\x00${address.trim()}`)
    .digest("hex")
    .slice(0, 32)
}

export interface RateLimitVerdict {
  allowed: boolean
  retryAfterSeconds: number
}

function consume(key: string, max: number, windowMs: number): RateLimitVerdict {
  const now = Date.now()
  const current = rateWindows.get(key)
  if (current === undefined || current.startedAt + windowMs <= now) {
    rateWindows.set(key, { count: 1, startedAt: now })
  } else {
    current.count += 1
    // delete + set moves the key to the end of the Map's insertion order, so
    // the eviction below is an LRU rather than an arbitrary cull.
    rateWindows.delete(key)
    rateWindows.set(key, current)
  }
  while (rateWindows.size > MAX_TRACKED_KEYS) {
    const oldest = rateWindows.keys().next().value
    if (typeof oldest !== "string") break
    rateWindows.delete(oldest)
  }
  const count = rateWindows.get(key)?.count ?? 1
  return {
    allowed: count <= max,
    retryAfterSeconds: Math.ceil(windowMs / 1000),
  }
}

/** Test-only. Never called from a route. */
export function resetApiRateLimit(): void {
  rateWindows.clear()
  idempotencyStore.clear()
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

interface IdempotencyRecord {
  fingerprint: string
  status: number
  body: string
  storedAt: number
}

const idempotencyStore = new Map<string, IdempotencyRecord>()
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

/**
 * A ceiling on the replay store, because it had none.
 *
 * Entries live for 24 hours and nothing ever removed them, so the map grew with
 * every idempotent write and held each one's full response body — the created
 * lead, the created payment — in process memory for a day. On a busy instance
 * that is both an unbounded memory leak and a pile of personal data sitting in
 * a heap dump.
 *
 * Expired entries go first; only if the map is still over the ceiling does it
 * drop the oldest live ones. Dropping a live entry costs a replay, which turns
 * a duplicate request into a second write — so it must be the last resort, and
 * the ceiling is set high enough that it effectively never is.
 */
const IDEMPOTENCY_MAX_ENTRIES = 5_000

function pruneIdempotencyStore(): void {
  const now = Date.now()
  for (const [key, record] of idempotencyStore) {
    if (now - record.storedAt >= IDEMPOTENCY_TTL_MS) idempotencyStore.delete(key)
  }
  if (idempotencyStore.size <= IDEMPOTENCY_MAX_ENTRIES) return
  // Map iterates in insertion order, so this drops the oldest first.
  const excess = idempotencyStore.size - IDEMPOTENCY_MAX_ENTRIES
  let dropped = 0
  for (const key of idempotencyStore.keys()) {
    if (dropped >= excess) break
    idempotencyStore.delete(key)
    dropped += 1
  }
}

function fingerprintBody(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

/** Constant-time compare, so a replay cannot be probed byte by byte. */
function sameFingerprint(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

// ---------------------------------------------------------------------------
// Body reading
// ---------------------------------------------------------------------------

type BodyResult =
  { ok: true; raw: string; value: unknown } | { ok: false; error: ApiError }

/**
 * Streams and counts bytes. `Content-Length` is a *claim* — a chunked request
 * need not send one at all — so the streamed count is authoritative and the
 * header is only an early rejection.
 */
async function readBoundedBody(request: Request): Promise<BodyResult> {
  const tooLarge = validationFailed("Request body is too large.")

  const declared = request.headers.get("content-length")
  if (declared !== null) {
    const bytes = Number(declared)
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      return { ok: false, error: validationFailed("Invalid request body.") }
    }
    if (bytes > MAX_BODY_BYTES) return { ok: false, error: tooLarge }
  }

  const stream = request.body
  if (stream === null) return { ok: true, raw: "", value: undefined }

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        return { ok: false, error: tooLarge }
      }
      chunks.push(value)
    }
    const merged = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    // `fatal: true` rejects invalid UTF-8 rather than substituting U+FFFD.
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(merged)
    if (raw.trim().length === 0) return { ok: true, raw: "", value: undefined }
    return { ok: true, raw, value: JSON.parse(raw) as unknown }
  } catch {
    await reader.cancel().catch(() => undefined)
    return {
      ok: false,
      error: validationFailed("Request body is not valid JSON."),
    }
  }
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditDeclaration {
  /** `audit_events.action`, e.g. `"lead.create"`. */
  action: string
  /** The table the mutation targets, for the audit row's `entity_table`. */
  entity: string
}

/**
 * What this module needs from a Supabase client, and nothing more.
 *
 * `supabase/database.types.ts` does not exist — W1-A owns the schema and has not
 * generated types from it — so the service-role client is typed against an
 * unknown schema and every `.insert()` argument resolves to `never`. The
 * repositories dodge this by using the cookie-bound client, whose default
 * generic happens to be permissive; that is not available here, because an
 * audit row must be written even when the caller's own RLS would refuse it.
 *
 * The alternative to this interface was `as never`, which would silence the
 * error and also silence a genuine one — a real column mismatch would then be a
 * runtime failure in the audit path, the one place least likely to be noticed.
 * This states the actual contract instead: one table name, one row of unknown
 * columns, an error or nothing back. When W1-A publishes generated types, this
 * interface is deleted and the client is typed properly; the request for that is
 * in HANDOFF/W2-B.md.
 */
interface AuditWriter {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: unknown }>
  }
}

/**
 * Writes one `audit_events` row. Never throws, never blocks the response.
 *
 * Service-role, because an audit row must be written even when the caller's own
 * RLS would refuse to insert it — an audit trail a user can suppress by lacking
 * a grant is not an audit trail. It is the one place in this module that
 * bypasses RLS, and it only ever *writes*.
 */
async function writeAudit(input: {
  audit: AuditDeclaration
  profile: UserProfile
  requestId: string
  method: string
  path: string
  outcome: "ok" | "error"
  errorCode: string | null
}): Promise<void> {
  try {
    const client: AuditWriter | null = createServiceRoleClient()
    if (client === null) {
      console.warn(
        "azura.api.audit-skipped",
        JSON.stringify({ requestId: input.requestId, reason: "no-service-role" })
      )
      return
    }
    const { error } = await client.from("audit_events").insert({
      actor_profile_id: input.profile.id,
      company_id: input.profile.companyId,
      action: input.audit.action,
      entity_table: input.audit.entity,
      // A real column since migration 23. It was not one before, so every
      // insert from here failed on an undefined column and the trail held
      // zero rows for the life of the project — see that migration.
      //
      // `request_id` is its own column and is used as one; it is the value a
      // user quotes in a support request, and burying it in jsonb would make
      // the one lookup anybody actually performs a full scan.
      request_id: input.requestId,
      // No request body, no query string, no headers. An audit row records
      // WHAT was attempted and BY WHOM, and putting the payload here would
      // recreate the PII surface the rest of this module avoids.
      metadata: {
        method: input.method,
        path: input.path,
        outcome: input.outcome,
        errorCode: input.errorCode,
        role: input.profile.role,
      },
    })

    // PostgREST RETURNS an error; it does not throw one. So the `catch` below
    // never saw a database failure, and neither did anybody else: the insert
    // was discarded in silence, including the warning that was supposed to
    // announce it. This branch is the one that actually fires.
    if (error !== null && error !== undefined) {
      console.warn(
        "azura.api.audit-failed",
        JSON.stringify({
          requestId: input.requestId,
          action: input.audit.action,
          // The database's own message names the table, the constraint and
          // sometimes the failing value. It goes to the server log, which is
          // where an operator can act on it, and never to a response.
          reason: String(
            (error as { message?: unknown }).message ?? "unknown"
          ).slice(0, 200),
        })
      )
    }
  } catch (thrown) {
    // Kept for a transport-level failure — the client throwing before it ever
    // gets a response. An audit failure must not turn a successful mutation
    // into an error the caller retries, because that would double-apply the
    // write; so it is logged and swallowed, deliberately, and never silently.
    console.warn(
      "azura.api.audit-threw",
      JSON.stringify({
        requestId: input.requestId,
        reason: String(thrown).slice(0, 200),
      })
    )
  }
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE"

export interface HandlerContext<TBody> {
  request: Request
  /** Parsed and validated. `undefined` for a GET or a body-less request. */
  body: TBody
  profile: UserProfile
  role: Role
  requestId: string
  /** Route params, already awaited (Next 16 hands them as a Promise). */
  params: Record<string, string>
  /** `?` parameters, with `limit` already clamped to `MAX_PAGE_LIMIT`. */
  query: URLSearchParams
  limit: number
  offset: number
  signal: AbortSignal
}

export interface HandlerResult<TResult> {
  data: TResult
  source: "supabase" | "local-seed"
}

export interface CreateHandlerConfig<TBody, TResult> {
  method: HttpMethod
  /**
   * The manifest's `operationId`, when the handler was built from it.
   *
   * Used to scope the idempotency replay store, so a key stored by one
   * operation cannot be replayed through another. Optional only because
   * `createHandler` is exported and testable on its own; every real route goes
   * through `createManifestHandler`, which always supplies it. Absent, the
   * replay falls back to the method and path, which is narrower than nothing
   * and still never crosses callers.
   */
  operationId?: string
  /**
   * `null` means public, and `validate-openapi.mjs` then REQUIRES a rate limit
   * and a written justification. There is no way to declare a public route
   * quietly.
   */
  permission: Permission | null
  /** Why this route is public. Required when `permission` is null. */
  publicJustification?: string
  schema?: ZodType<TBody>
  rateLimit?: { windowMs: number; max: number }
  /** Required for POST / PATCH / DELETE. Enforced by the validator. */
  audit?: AuditDeclaration
  /** A mutation with no data plane returns 503 rather than a fake success. */
  requiresPersistence?: boolean
  /**
   * This write has no implementation yet — say so, in the response and in the
   * spec, instead of pretending.
   *
   * W2-A shipped 60 reads and exactly four mutations. The other write paths
   * need repository functions this window does not own and migrations W1-A
   * owns, and inventing either against someone else's schema is the failure
   * ORCHESTRATION §4 exists to prevent. So the route is real — it authenticates,
   * authorises, validates and rate-limits — and then returns 503 naming what is
   * missing and who owns it.
   *
   * This is `SourcedFact`'s `"gap"` confidence at the HTTP boundary: the value
   * is null and the reason is stated. `validate-openapi.mjs` requires an
   * operation declaring one to document a 503 and NO 2xx, so the spec can never
   * advertise a success this endpoint cannot deliver.
   */
  writeGap?: string
  /** Public mutations must accept `Idempotency-Key`. */
  idempotent?: boolean
  handler: (ctx: HandlerContext<TBody>) => Promise<HandlerResult<TResult>>
  /**
   * Render the success body as something other than the JSON envelope.
   *
   * Exactly one route needs this: the iCalendar feed, because a calendar client
   * cannot parse `{ ok: true, data: … }`. Providing the hook here rather than
   * letting that route hand-roll its own `Response` keeps it inside the security
   * sequence — it still gets the rate limit, the bounded work, the error
   * mapping and the headers. Only the final representation differs, and errors
   * are still the standard envelope.
   */
  serialize?: (data: TResult) => {
    body: string
    contentType: string
    headers?: Record<string, string>
  }
}

const MUTATING: readonly HttpMethod[] = ["POST", "PATCH", "DELETE"]

export function isMutating(method: HttpMethod): boolean {
  return MUTATING.includes(method)
}

/**
 * Build a handler from the manifest entry with this `operationId`.
 *
 * Every route file uses this rather than `createHandler` directly, so a route's
 * permission, rate limit, audit action and write-gap are read from
 * `lib/api-routes.ts` instead of restated beside it. Restating them would
 * reintroduce exactly the drift the manifest exists to remove — the route would
 * say `units:view` while the published spec said `units:update`, and both would
 * look right in isolation.
 *
 * An unknown `operationId` throws at module load, which fails `next build`
 * rather than a request.
 */
export function createManifestHandler<TBody, TResult>(
  operationId: string,
  extra: {
    schema?: ZodType<TBody>
    handler: (ctx: HandlerContext<TBody>) => Promise<HandlerResult<TResult>>
    serialize?: (data: TResult) => {
      body: string
      contentType: string
      headers?: Record<string, string>
    }
  }
): (
  request: Request,
  context?: { params?: Promise<Record<string, string>> }
) => Promise<Response> {
  const operation = flattenOperations().find(
    (entry) => entry.operationId === operationId
  )
  if (operation === undefined) {
    throw new Error(
      `No route manifest entry declares operationId "${operationId}". Add it to lib/api-routes.ts.`
    )
  }

  return createHandler<TBody, TResult>({
    method: operation.method,
    operationId,
    permission: operation.permission,
    handler: extra.handler,
    ...(extra.schema === undefined ? {} : { schema: extra.schema }),
    ...(extra.serialize === undefined ? {} : { serialize: extra.serialize }),
    ...(operation.publicJustification === undefined
      ? {}
      : { publicJustification: operation.publicJustification }),
    ...(operation.rateLimit === undefined
      ? {}
      : { rateLimit: operation.rateLimit }),
    ...(operation.audit === undefined ? {} : { audit: operation.audit }),
    ...(operation.requiresPersistence === undefined
      ? {}
      : { requiresPersistence: operation.requiresPersistence }),
    ...(operation.idempotent === undefined
      ? {}
      : { idempotent: operation.idempotent }),
    ...(operation.writeGap === undefined
      ? {}
      : {
          writeGap: `${operation.writeGap.reason} Owner: ${operation.writeGap.owner}.`,
        }),
  })
}

export function createHandler<TBody, TResult>(
  config: CreateHandlerConfig<TBody, TResult>
): (
  request: Request,
  context?: { params?: Promise<Record<string, string>> }
) => Promise<Response> {
  const mutating = isMutating(config.method)

  return async function route(request, context) {
    const requestId = crypto.randomUUID()
    const url = new URL(request.url)

    const respond = (error: ApiError, extra: Record<string, string> = {}) =>
      NextResponse.json(errorBody(error, requestId), {
        status: statusFor(error),
        headers: { ...apiHeaders, ...extra },
      })

    try {
      // 1. Method. Next routes by export name, so a mismatch here means the
      //    file wired the wrong verb — a 405 is the honest answer either way.
      if (request.method !== config.method) {
        return NextResponse.json(
          errorBody(validationFailed("Method not allowed."), requestId),
          {
            status: 405,
            headers: { ...apiHeaders, Allow: config.method },
          }
        )
      }

      // 1b. Content type. A form-encoded POST is how a cross-site form reaches
      //     an endpoint without a preflight, so rejecting it is a CSRF control,
      //     not pedantry. 415, not a parse crash.
      if (mutating) {
        const contentType = request.headers.get("content-type") ?? ""
        if (!contentType.toLowerCase().includes("application/json")) {
          return NextResponse.json(
            errorBody(
              validationFailed("Content-Type must be application/json."),
              requestId
            ),
            { status: 415, headers: apiHeaders }
          )
        }
        // Same-origin only. `Origin` is set by every browser on a cross-site
        // request and cannot be forged by page script.
        const origin = request.headers.get("origin")
        if (origin !== null && origin !== url.origin) {
          return respond(forbidden("Request origin is not allowed."))
        }
      }

      // 2. Rate limit — BEFORE the body is read.
      if (config.rateLimit !== undefined) {
        const verdict = consume(
          rateIdentity(request, `${config.method} ${url.pathname}`),
          config.rateLimit.max,
          config.rateLimit.windowMs
        )
        if (!verdict.allowed) {
          return respond(rateLimited(verdict.retryAfterSeconds), {
            "Retry-After": String(verdict.retryAfterSeconds),
          })
        }
      }

      // 3. Body + Zod.
      let body = undefined as TBody
      let rawBody = ""
      if (mutating) {
        const read = await readBoundedBody(request)
        if (!read.ok) return respond(read.error)
        rawBody = read.raw

        if (config.schema !== undefined) {
          const parsed = config.schema.safeParse(read.value)
          if (!parsed.success) {
            // Field paths and rules only — never the offending value, which is
            // user input and may be a credential typed into the wrong box.
            const details: Record<string, string> = {}
            for (const issue of parsed.error.issues.slice(0, 8)) {
              const path = issue.path.map(String).join(".") || "(root)"
              details[path] = issue.message
            }
            return respond(
              validationFailed("The request body is not valid.", details)
            )
          }
          body = parsed.data
        }
      }

      const idempotencyKey = request.headers.get("idempotency-key")

      // 4. Who is calling.
      const profile = await getUserProfile()

      // 5. May they. Server-side, always.
      if (config.permission !== null) {
        if (!profile.authenticated) return respond(unauthorized())
        if (!hasPermission(profile.role, config.permission)) {
          return respond(forbidden())
        }
      }

      // 5b. Idempotency replay — AFTER authentication and the permission check,
      //     and scoped to the caller and the operation.
      //
      // It used to run at step 3b, before either. The store was a module-global
      // `Map` keyed on the raw `Idempotency-Key` header and nothing else, so a
      // caller who presented a key that was already in it received `stored.body`
      // verbatim: the full success envelope of somebody else's mutation, which
      // for `createLead` is a person's name, email, phone and budget. No session
      // was required to reach that branch, and the key is not a secret — it
      // travels in a plaintext header, is logged by every reverse proxy, and
      // real integrations use predictable values like `invoice-2026-07`.
      //
      // Nor was it scoped to a route: an entry written by one `idempotent`
      // operation could be replayed through another, because the stored record
      // never recorded which operation produced it.
      //
      // Three changes together, and all three are needed. Moving it after the
      // permission check alone would still let a caller with the permission
      // replay another caller's response; namespacing by caller alone would
      // still serve a body to an unauthenticated request; namespacing by
      // operation alone would still cross users.
      const replayKey =
        idempotencyKey === null
          ? null
          : // NUL as the domain separator — `rateIdentity` explains why the
            // escape is written out rather than embedded as a byte. Needed
            // here because the fallback branch contains a space, so a space
            // separator would let a crafted key straddle two fields.
            `${profile.id ?? "anonymous"}\x00${
              config.operationId ?? `${config.method} ${url.pathname}`
            }\x00${idempotencyKey}`

      if (config.idempotent === true && replayKey !== null) {
        const stored = idempotencyStore.get(replayKey)
        if (
          stored !== undefined &&
          Date.now() - stored.storedAt < IDEMPOTENCY_TTL_MS
        ) {
          if (!sameFingerprint(stored.fingerprint, fingerprintBody(rawBody))) {
            // Same key, different body. Returning the stored response would be
            // worse than an error: the caller would believe THIS request
            // succeeded.
            return respond({
              code: "conflict",
              message:
                "This Idempotency-Key was already used with a different request body.",
              retryable: false,
            })
          }
          return new NextResponse(stored.body, {
            status: stored.status,
            headers: {
              ...apiHeaders,
              "Content-Type": "application/json",
              "Idempotency-Replayed": "true",
            },
          })
        }
      }

      // 6. A write with no data plane is 503, never a fake success.
      if (config.requiresPersistence === true && !isSupabaseConfigured()) {
        return respond(persistenceUnavailable())
      }

      // 6b. A declared write gap. AFTER auth, permission and validation, so an
      //     unauthorised caller still gets 401/403 and a malformed body still
      //     gets 422 — the contract is enforced even where the write is not yet
      //     possible, and W4-A's role matrix tests something real.
      if (config.writeGap !== undefined) {
        return respond(persistenceUnavailable(config.writeGap))
      }

      // 7. The repository call.
      const query = url.searchParams
      const rawLimit = Number(query.get("limit") ?? "50")
      const rawOffset = Number(query.get("offset") ?? "0")
      const params = (await context?.params) ?? {}

      const result = await config.handler({
        request,
        body,
        profile,
        role: profile.role,
        requestId,
        params,
        query,
        // A client asking for 100000 gets 500, not an error and not 100000.
        limit: Number.isFinite(rawLimit)
          ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_PAGE_LIMIT)
          : 50,
        offset: Number.isFinite(rawOffset)
          ? Math.max(Math.trunc(rawOffset), 0)
          : 0,
        signal: request.signal,
      })

      // 7b. A simulated write is not a write.
      //
      // Step 6 catches the configured/unconfigured case. This catches the one
      // that is easy to miss: `withRepository()` also degrades to its seed
      // fallback when Supabase IS configured but the call fails, and W2-A's
      // seed branch for `appendTicketEvent` says so outright — *"the row is
      // returned but nothing is stored."* Returning 200 for that would be a
      // fake success with a plausible id attached, which is worse than an
      // error because the caller has no way to tell.
      if (mutating && result.source !== "supabase") {
        return respond(
          persistenceUnavailable(
            "This change was not saved: the database did not accept the write."
          )
        )
      }

      // 9. Envelope, audit, requestId.
      if (config.serialize !== undefined) {
        const rendered = config.serialize(result.data)
        return new NextResponse(rendered.body, {
          status: 200,
          headers: {
            ...apiHeaders,
            ...rendered.headers,
            "Content-Type": rendered.contentType,
            "X-Request-Id": requestId,
          },
        })
      }

      // 9b. Internal bookkeeping does not leave the building.
      //
      // Applied HERE rather than in each route, because "here" is one seam that
      // twenty route files cannot forget and a twenty-first cannot miss. The
      // served OpenAPI document already argued that `metadata` and
      // `idempotencyKey` must never be forwarded; it argued it while
      // /tickets returned both on every row and /documents and /activities
      // returned `metadata` carrying the demo markers. Measured 2026-08-04.
      //
      // `config.serialize` routes are deliberately not projected: those are CSV
      // and iCal builders that pick their own columns explicitly, so a blanket
      // strip would be silent and useless where it is already unnecessary.
      const payload = JSON.stringify(
        successBody(
          Array.isArray(result.data)
            ? projectRecords(result.data)
            : projectRecord(result.data),
          result.source,
          requestId
        )
      )

      if (config.idempotent === true && replayKey !== null) {
        // Stored under the same caller-and-operation-scoped key the lookup
        // uses. A bare `idempotencyKey` here would make the namespacing above
        // decorative: the entry would be findable by anyone who guessed it.
        idempotencyStore.set(replayKey, {
          fingerprint: fingerprintBody(rawBody),
          status: 200,
          body: payload,
          storedAt: Date.now(),
        })
        pruneIdempotencyStore()
      }

      if (mutating && config.audit !== undefined) {
        await writeAudit({
          audit: config.audit,
          profile,
          requestId,
          method: config.method,
          path: url.pathname,
          outcome: "ok",
          errorCode: null,
        })
      }

      return new NextResponse(payload, {
        status: 200,
        headers: { ...apiHeaders, "Content-Type": "application/json" },
      })
    } catch (caught) {
      // 8. Nothing escapes. A repository that threw carries a mapped ApiError
      //    already; anything else becomes a generic upstream failure, and the
      //    detail goes to the log under the same requestId the caller holds.
      const error: ApiError =
        caught instanceof RepositoryError
          ? {
              ...caught.apiError,
              message: scrubInternals(
                caught.apiError.message,
                "The request could not be completed."
              ),
            }
          : upstreamFailed()

      console.error(
        "azura.api.error",
        JSON.stringify({
          requestId,
          path: url.pathname,
          method: config.method,
          code: error.code,
          detail:
            caught instanceof Error ? caught.message.slice(0, 400) : "unknown",
        })
      )

      return respond(error)
    }
  }
}
