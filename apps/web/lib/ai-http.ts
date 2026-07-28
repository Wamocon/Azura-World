/**
 * Transport helpers shared by the four `/api/ai/*` routes.
 *
 * Factored out because the alternative is four copies of a byte-bounded body
 * reader, and a security control that exists in four places is a security
 * control that will exist in three after the next refactor.
 *
 * ## Why not `request.json()`
 *
 * By the time `request.json()` resolves, the whole body is already in memory —
 * a `Content-Length` header is a *claim*, and a chunked request need not send
 * one at all. `readBoundedJson` streams and counts actual bytes, cancelling the
 * reader the moment the ceiling is crossed. Zod cannot substitute for this: it
 * validates a value that has already been buffered.
 *
 * `TextDecoder("utf-8", { fatal: true })` rejects invalid UTF-8 rather than
 * substituting U+FFFD, so a malformed body is a 422 instead of a string with
 * replacement characters silently embedded in it.
 */

import { NextResponse } from "next/server"
import { apiErrorStatus, type ApiError, type ApiResponse } from "./contracts"

export const aiResponseHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const

export function apiOk<T>(data: T, requestId: string): NextResponse {
  const body: ApiResponse<T> = {
    ok: true,
    data,
    // The concierge answers from the generated evidence dataset, which ships in
    // the bundle rather than coming from Postgres. `local-seed` is the honest
    // label for that under CONTRACTS §5, and it stays honest when W2-A moves
    // the dataset behind a repository.
    source: "local-seed",
    requestId,
  }
  return NextResponse.json(body, { status: 200, headers: aiResponseHeaders })
}

export function apiFail(
  error: ApiError,
  requestId: string,
  extraHeaders: Record<string, string> = {}
): NextResponse {
  const body: ApiResponse<never> = { ok: false, error, requestId }
  return NextResponse.json(body, {
    status: apiErrorStatus[error.code],
    headers: { ...aiResponseHeaders, ...extraHeaders },
  })
}

export type BoundedJsonResult =
  { ok: true; value: unknown } | { ok: false; error: ApiError }

const TOO_LARGE: ApiError = {
  code: "validation_failed",
  message: "Request body is too large.",
  retryable: false,
}

const NOT_JSON: ApiError = {
  code: "validation_failed",
  message: "Request body is not valid JSON.",
  retryable: false,
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number
): Promise<BoundedJsonResult> {
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
    if (bytes > maxBytes) return { ok: false, error: TOO_LARGE }
  }

  const stream = request.body
  if (stream === null) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Request body is required.",
        retryable: false,
      },
    }
  }

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      // The streamed count is authoritative; Content-Length was only a hint.
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { ok: false, error: TOO_LARGE }
      }
      chunks.push(value)
    }

    const merged = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(merged)
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    await reader.cancel().catch(() => undefined)
    return { ok: false, error: NOT_JSON }
  }
}

/** `application/json` or nothing. Guards against a form-encoded CSRF post. */
export function requiresJsonContentType(request: Request): ApiError | null {
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.toLowerCase().includes("application/json")) return null
  return {
    code: "validation_failed",
    message: "Content-Type must be application/json.",
    retryable: false,
  }
}
