/**
 * The QA role picker's endpoint. **Not a production feature.**
 *
 * Every method returns **404** when access profiles are disabled — not 403. A
 * 403 confirms the endpoint exists and invites someone to go looking for the
 * flag that opens it; a 404 says there is nothing here. In a production build
 * `accessProfilesEnabledForEnvironment()` is folded to a constant `false`
 * (`lib/access-profile-policy.ts`), so this route can only ever 404 there.
 *
 * Handler order follows CONVENTIONS §4: method → origin → parse+validate →
 * authorise → execute → typed error. There is no rate limit: the route is
 * unreachable outside a QA environment, and adding one would imply it is
 * exposed.
 *
 * `proxy.ts` deliberately does not match `/api/*` (its matcher covers `/` and
 * the locale prefixes only), so the origin check for unsafe methods happens
 * here, next to the validation, where it cannot be lost to a matcher edit.
 */

import { NextResponse } from "next/server"
import { z } from "zod"
import {
  ACCESS_PROFILE_COOKIE,
  ACCESS_PROFILE_COOKIE_MAX_AGE_SECONDS,
  resolveAccessProfileRole,
} from "@/lib/access-profile-policy"
import { isAccessProfileEnabled } from "@/lib/auth"
import { getAccessibleResources } from "@/lib/rbac"
import { publicEnv } from "@/lib/env"
import {
  apiErrorStatus,
  roles,
  type ApiError,
  type ApiResponse,
  type Role,
} from "@/lib/contracts"

/** Cookies must be written per request; nothing here may be cached. */
export const dynamic = "force-dynamic"

/** Body ceiling. A role name is ~16 bytes; 1 KiB is already absurdly generous. */
const MAX_BODY_BYTES = 1_024

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const

// ---------------------------------------------------------------------------
// Envelope (CONTRACTS §5)
// ---------------------------------------------------------------------------

function ok<T>(data: T, requestId: string): NextResponse {
  const body: ApiResponse<T> = {
    ok: true,
    data,
    source: "local-seed",
    requestId,
  }
  return NextResponse.json(body, { status: 200, headers: responseHeaders })
}

function fail(error: ApiError, requestId: string): NextResponse {
  const body: ApiResponse<never> = { ok: false, error, requestId }
  return NextResponse.json(body, {
    status: apiErrorStatus[error.code],
    headers: responseHeaders,
  })
}

function notFound(requestId: string): NextResponse {
  return fail(
    {
      code: "not_found",
      message: "Not found.",
      retryable: false,
    },
    requestId
  )
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * A same-origin check for unsafe methods. `Origin` is set by every browser on
 * cross-site requests and cannot be forged by page script, which is exactly the
 * attack this blocks: a third-party page silently flipping a reviewer's role.
 *
 * A missing `Origin` is rejected. Same-origin `fetch` from this app always sends
 * one; only a non-browser client omits it, and this endpoint has no non-browser
 * callers.
 */
function mutationOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (origin === null) return false

  const allowed = new Set<string>([publicEnv.NEXT_PUBLIC_APP_URL])
  try {
    allowed.add(new URL(request.url).origin)
  } catch {
    // An unparseable request URL cannot be matched against; the configured app
    // URL is still a valid comparison.
  }

  try {
    return allowed.has(new URL(origin).origin)
  } catch {
    return false
  }
}

/** Streams the body and counts bytes; `Content-Length` is only an early reject. */
async function readBoundedJson(
  request: Request
): Promise<{ ok: true; value: unknown } | { ok: false; error: ApiError }> {
  const declared = request.headers.get("content-length")
  if (declared !== null) {
    const bytes = Number(declared)
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: "Invalid request body.",
          retryable: false,
        },
      }
    }
    if (bytes > MAX_BODY_BYTES) {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: "Request body is too large.",
          retryable: false,
        },
      }
    }
  }

  const body = request.body
  if (body === null) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Request body is required.",
        retryable: false,
      },
    }
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        return {
          ok: false,
          error: {
            code: "validation_failed",
            message: "Request body is too large.",
            retryable: false,
          },
        }
      }
      chunks.push(value)
    }

    const merged = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    // `fatal: true` rejects invalid UTF-8 instead of substituting U+FFFD.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(merged)
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    await reader.cancel().catch(() => undefined)
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Request body is not valid JSON.",
        retryable: false,
      },
    }
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const accessProfileBodySchema = z
  .object({
    // The frozen role list from CONTRACTS §3. Anything else is rejected before
    // it can reach a cookie.
    role: z.enum(roles),
  })
  .strict()

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

interface AccessProfileState {
  enabled: true
  role: Role
  /** True when the role came from the cookie rather than a fallback. */
  explicit: boolean
  accessibleResources: string[]
  roles: readonly Role[]
}

function stateFor(role: Role, explicit: boolean): AccessProfileState {
  return {
    enabled: true,
    role,
    explicit,
    accessibleResources: getAccessibleResources(role),
    roles,
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Reports the active QA role and the role list the picker should offer. */
export async function GET(request: Request): Promise<NextResponse> {
  const requestId = crypto.randomUUID()
  if (!isAccessProfileEnabled()) return notFound(requestId)

  const cookieHeader = request.headers.get("cookie") ?? ""
  const current = readCookie(cookieHeader, ACCESS_PROFILE_COOKIE)
  const role = resolveAccessProfileRole(current)
  return ok(stateFor(role, current !== undefined), requestId)
}

/** Switches the QA role. */
export async function POST(request: Request): Promise<NextResponse> {
  const requestId = crypto.randomUUID()
  if (!isAccessProfileEnabled()) return notFound(requestId)

  if (!mutationOriginAllowed(request)) {
    return fail(
      {
        code: "forbidden",
        message: "Request origin is not allowed.",
        retryable: false,
      },
      requestId
    )
  }

  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("application/json")) {
    return fail(
      {
        code: "validation_failed",
        message: "Content-Type must be application/json.",
        retryable: false,
      },
      requestId
    )
  }

  const body = await readBoundedJson(request)
  if (!body.ok) return fail(body.error, requestId)

  const parsed = accessProfileBodySchema.safeParse(body.value)
  if (!parsed.success) {
    return fail(
      {
        code: "validation_failed",
        message: "role must be one of the eleven known roles.",
        details: {
          // Only the field path and the rule are reported; never the value.
          role: "unknown or missing role",
        },
        retryable: false,
      },
      requestId
    )
  }

  const response = ok(stateFor(parsed.data.role, true), requestId)
  response.cookies.set(ACCESS_PROFILE_COOKIE, parsed.data.role, {
    httpOnly: true,
    sameSite: "lax",
    // Never `secure: true` unconditionally: this route only runs in non-production
    // environments, which are usually plain http on 127.0.0.1, and a `secure`
    // cookie would be silently dropped there.
    secure: new URL(publicEnv.NEXT_PUBLIC_APP_URL).protocol === "https:",
    path: "/",
    maxAge: ACCESS_PROFILE_COOKIE_MAX_AGE_SECONDS,
  })
  return response
}

/** Clears the QA role, returning to the configured default. */
export async function DELETE(request: Request): Promise<NextResponse> {
  const requestId = crypto.randomUUID()
  if (!isAccessProfileEnabled()) return notFound(requestId)

  if (!mutationOriginAllowed(request)) {
    return fail(
      {
        code: "forbidden",
        message: "Request origin is not allowed.",
        retryable: false,
      },
      requestId
    )
  }

  const response = ok(
    stateFor(resolveAccessProfileRole(undefined), false),
    requestId
  )
  response.cookies.set(ACCESS_PROFILE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(publicEnv.NEXT_PUBLIC_APP_URL).protocol === "https:",
    path: "/",
    maxAge: 0,
  })
  return response
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * Minimal cookie reader. `next/headers`' `cookies()` is not used here because
 * this handler receives the plain `Request`, and parsing the header it already
 * holds avoids a second async hop for one value.
 */
function readCookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const separator = part.indexOf("=")
    if (separator === -1) continue
    if (part.slice(0, separator).trim() !== name) continue
    return decodeURIComponent(part.slice(separator + 1).trim())
  }
  return undefined
}
