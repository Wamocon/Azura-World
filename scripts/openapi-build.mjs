/**
 * Builds the OpenAPI document from the route manifest.       Owner: W2-B
 *
 * Shared by `scripts/generate-openapi.mjs` (writes the file) and
 * `scripts/validate-openapi.mjs` (rebuilds it and compares). Both must produce
 * byte-identical output from the same manifest, which is only guaranteed if
 * they run the same code — hence this module rather than two implementations
 * that agree today.
 *
 * ## Why YAML is emitted by hand
 *
 * No YAML library is installed, and `pnpm install` is W0-A's alone (CLAUDE.md
 * §3). Rather than add a dependency this window may not add, the emitter below
 * writes the small, fixed subset of YAML the document actually uses: block
 * mappings, block sequences, and scalars quoted when they need to be.
 *
 * That is only safe because the emitter is never asked to round-trip arbitrary
 * input — it serialises a structure this repository builds, and
 * `validate-openapi.mjs` proves the result matches the file on disk exactly. A
 * quoting bug would show up as a failing gate, not as a corrupt spec.
 */

// ---------------------------------------------------------------------------
// A minimal, deterministic YAML emitter
// ---------------------------------------------------------------------------

/** Scalars that must be quoted or YAML would read them as another type. */
const NEEDS_QUOTES =
  /^$|^[-?:,[\]{}#&*!|>'"%@`]|[:#]\s|\s$|^\s|^(?:true|false|null|yes|no|on|off|~)$|^[-+]?[0-9.]+$/i

function scalar(value) {
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return String(value)
  const text = String(value)
  if (!NEEDS_QUOTES.test(text) && !text.includes("\n")) return text
  // Double quotes with JSON escaping: JSON string syntax is a subset of YAML's
  // double-quoted scalar syntax, so this is correct for every input including
  // the em-dashes and non-ASCII the descriptions contain.
  return JSON.stringify(text)
}

function emit(value, indent = 0) {
  const pad = " ".repeat(indent)

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]\n`
    let out = ""
    for (const item of value) {
      if (item !== null && typeof item === "object") {
        const block = emit(item, indent + 2)
        // Hoist the first line onto the "- " marker so the sequence reads as
        // one item rather than an empty dash followed by a mapping.
        out += `${pad}-${block.slice(indent + 1)}`
      } else {
        out += `${pad}- ${scalar(item)}\n`
      }
    }
    return out
  }

  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value)
    if (keys.length === 0) return `${pad}{}\n`
    let out = ""
    for (const key of keys) {
      const child = value[key]
      // A bare `404:` is an integer key in YAML 1.2, and OpenAPI's Responses
      // Object is keyed by strings. Parsers vary in how forgiving they are, so
      // numeric keys are quoted rather than left to chance.
      const name =
        /^[0-9]+$/.test(key) || !/^[A-Za-z0-9_./{}-]+$/.test(key)
          ? JSON.stringify(key)
          : key
      if (child !== null && typeof child === "object") {
        const isEmpty = Array.isArray(child) ? child.length === 0 : Object.keys(child).length === 0
        out += isEmpty
          ? `${pad}${name}: ${Array.isArray(child) ? "[]" : "{}"}\n`
          : `${pad}${name}:\n${emit(child, indent + 2)}`
      } else {
        out += `${pad}${name}: ${scalar(child)}\n`
      }
    }
    return out
  }

  return `${pad}${scalar(value)}\n`
}

// ---------------------------------------------------------------------------
// Document construction
// ---------------------------------------------------------------------------

/** Universal responses, added to every operation so they are never forgotten. */
function baseResponses(operation) {
  const responses = {}
  const declared = [...operation.responses].sort((a, b) => a - b)

  for (const status of declared) {
    responses[String(status)] = RESPONSE_LIBRARY[String(status)] ?? {
      description: "Success.",
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/ApiSuccess" } },
      },
    }
  }
  // A caller can always send something malformed, and can always be throttled.
  responses["400"] = RESPONSE_LIBRARY["400"]
  if (operation.permission !== null) {
    responses["401"] = RESPONSE_LIBRARY["401"]
    responses["403"] = RESPONSE_LIBRARY["403"]
  }
  responses["429"] = RESPONSE_LIBRARY["429"]

  // Sorted so the emitted order is stable regardless of insertion order.
  const ordered = {}
  for (const code of Object.keys(responses).sort()) ordered[code] = responses[code]
  return ordered
}

const RESPONSE_LIBRARY = {
  200: { $ref: "#/components/responses/Success" },
  400: { $ref: "#/components/responses/ValidationFailed" },
  401: { $ref: "#/components/responses/Unauthorized" },
  403: { $ref: "#/components/responses/Forbidden" },
  404: { $ref: "#/components/responses/NotFound" },
  409: { $ref: "#/components/responses/Conflict" },
  429: { $ref: "#/components/responses/RateLimited" },
  503: { $ref: "#/components/responses/PersistenceUnavailable" },
}

function errorResponse(description) {
  return {
    description,
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
    },
  }
}

function parameterFor(param) {
  const schema = {}
  for (const key of ["type", "enum", "minLength", "maxLength", "minimum", "maximum"]) {
    if (param.schema[key] !== undefined) schema[key] = param.schema[key]
  }
  return {
    name: param.name,
    in: "query",
    required: param.required === true,
    description: param.description,
    schema,
  }
}

export function buildSpec(apiRoutes, apiTags, version) {
  const paths = {}

  // Sorted by path, then by a fixed method order. A spec whose order depends on
  // declaration order produces a diff every time an entry moves.
  const METHOD_ORDER = ["GET", "POST", "PATCH", "DELETE"]
  const sortedRoutes = [...apiRoutes].sort((a, b) => a.path.localeCompare(b.path))

  for (const route of sortedRoutes) {
    const item = {}

    if (route.pathParams !== undefined && route.pathParams.length > 0) {
      item.parameters = route.pathParams.map((name) => ({
        name,
        in: "path",
        required: true,
        description: `The ${name} of the resource.`,
        schema: { type: "string", maxLength: 64 },
      }))
    }

    const operations = [...route.operations].sort(
      (a, b) => METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method)
    )

    for (const operation of operations) {
      const entry = {
        tags: [operation.tag],
        operationId: operation.operationId,
        summary: operation.summary,
        description: operation.description,
      }

      // A public operation says so explicitly. `security: []` on an operation
      // overrides the document-level requirement, and writing the reason beside
      // it means a reviewer never has to guess whether it was deliberate.
      if (operation.permission === null) {
        entry.security = []
        entry["x-azura-public-justification"] = operation.publicJustification ?? ""
      } else {
        entry["x-azura-permission"] = operation.permission
      }

      if (operation.rateLimit !== undefined) {
        entry["x-azura-rate-limit"] = {
          requests: operation.rateLimit.max,
          windowSeconds: Math.round(operation.rateLimit.windowMs / 1000),
        }
      }
      if (operation.audit !== undefined) {
        entry["x-azura-audit"] = {
          action: operation.audit.action,
          entity: operation.audit.entity,
        }
      }
      if (operation.idempotent === true) {
        entry["x-azura-idempotent"] = true
      }
      // The evidence-gap marker, at the HTTP boundary. An operation carrying it
      // must document a 503 and must NOT document a 2xx — the validator checks
      // both, so the spec cannot promise a success this endpoint cannot deliver.
      if (operation.writeGap !== undefined) {
        entry["x-azura-write-gap"] = {
          reason: operation.writeGap.reason,
          owner: operation.writeGap.owner,
        }
      }

      if (operation.query !== undefined && operation.query.length > 0) {
        entry.parameters = operation.query.map(parameterFor)
      }

      if (operation.requestSchema !== undefined) {
        entry.requestBody = {
          required: true,
          description: `Validated by \`${operation.requestSchema}\` in \`lib/validation/schemas.ts\`. Unknown properties are rejected.`,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/JsonObject" },
            },
          },
        }
      }

      entry.responses = baseResponses(operation)
      item[operation.method.toLowerCase()] = entry
    }

    paths[route.path] = item
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Azura World CATI API",
      version,
      summary: "Evidence-backed property-management API for Azura World Residence & Hotel.",
      description:
        "Generated from `apps/web/lib/api-routes.ts`. Do not edit this file by hand: `pnpm test:contract` rebuilds it from the manifest and fails if the result differs by a single byte, so a manual edit is reverted by the next check rather than adopted.\n\nEvery response is the envelope in `CONTRACTS.md` §5. Success is `{ ok: true, data, source, requestId }`, where `source` reports whether the data came from the database or from local seed data — a read may be answered from seed data and says so, and a write never is.\n\nOperations marked `x-azura-write-gap` have no implementation behind them and answer 503. They are documented rather than hidden because an endpoint that silently does nothing is worse than one that says it cannot.",
    },
    servers: [
      { url: "http://127.0.0.1:3200", description: "Local development." },
    ],
    tags: apiTags.map((tag) => ({ name: tag.name, description: tag.description })),
    components: {
      securitySchemes: {
        SupabaseSession: {
          type: "apiKey",
          in: "cookie",
          name: "sb-access-token",
          description:
            "The Supabase Auth session cookie. Role and permissions are resolved server-side from the session; nothing about authority is read from the request body or query string.",
        },
        AccessProfileCookie: {
          type: "apiKey",
          in: "cookie",
          name: "azura_access_profile",
          description:
            "A local-QA role cookie, accepted only when access profiles are enabled and never in production — `lib/access-profile-policy.ts` throws at module load if that combination is ever configured.",
        },
      },
      schemas: {
        ApiError: {
          type: "object",
          required: ["ok", "error", "requestId"],
          properties: {
            ok: { type: "boolean", enum: [false] },
            error: {
              type: "object",
              required: ["code", "message", "retryable"],
              properties: {
                code: {
                  type: "string",
                  enum: [
                    "unauthorized",
                    "forbidden",
                    "not_found",
                    "validation_failed",
                    "rate_limited",
                    "conflict",
                    "persistence_unavailable",
                    "upstream_failed",
                  ],
                },
                message: {
                  type: "string",
                  description:
                    "Display copy, safe to show a user. Never a database message, a stack frame or a file path.",
                },
                retryable: { type: "boolean" },
                details: { type: "object", additionalProperties: { type: "string" } },
              },
            },
            requestId: {
              type: "string",
              description:
                "Also written to the server log, so a support conversation can join a user's report to the server's record of it.",
            },
          },
        },
        ApiSuccess: {
          type: "object",
          required: ["ok", "data", "source", "requestId"],
          properties: {
            ok: { type: "boolean", enum: [true] },
            data: { description: "The operation's payload." },
            source: {
              type: "string",
              enum: ["supabase", "local-seed"],
              description:
                "Where the data came from. `local-seed` on a read means the database was unreachable and this is fallback data; it never appears on a successful write, because a simulated write is reported as 503 instead.",
            },
            requestId: { type: "string" },
          },
        },
        JsonObject: { type: "object", additionalProperties: true },
      },
      responses: {
        Success: {
          description: "The request succeeded.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ApiSuccess" } },
          },
        },
        ValidationFailed: errorResponse(
          "The request was malformed: a bad body, an unknown property, a missing required parameter, or a body over 32 KB."
        ),
        Unauthorized: errorResponse("No session. Sign in and retry."),
        Forbidden: errorResponse(
          "The authenticated role does not hold the required permission. Deliberately indistinguishable from a resource that does not exist."
        ),
        NotFound: errorResponse(
          "No such resource, or none the caller may see. The two are not distinguished, so this endpoint cannot be used to enumerate ids."
        ),
        Conflict: errorResponse(
          "The record changed since it was read (`expectedVersion` mismatch), or an `Idempotency-Key` was reused with a different body."
        ),
        RateLimited: errorResponse(
          "Too many requests. `Retry-After` gives the number of seconds to wait."
        ),
        PersistenceUnavailable: errorResponse(
          "The change was NOT saved. Either the database is not configured, the write did not land, or this operation has no implementation yet (`x-azura-write-gap`). Never returned in place of a success."
        ),
      },
    },
    security: [{ SupabaseSession: [] }, { AccessProfileCookie: [] }],
    paths,
  }
}

export function toYaml(spec) {
  return `# Generated by scripts/generate-openapi.mjs from apps/web/lib/api-routes.ts.
# Do not edit by hand: \`pnpm test:contract\` rebuilds this file and fails on any
# difference, so a manual edit is reverted rather than kept.
${emit(spec)}`
}
