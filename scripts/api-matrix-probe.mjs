/**
 * Route-level test matrix.                                        Owner: W2-B
 *
 * `validate-openapi.mjs` proves the spec and the code agree about what exists.
 * This proves the running server behaves the way both of them claim — the eight
 * checks in `tasks/W2-B-api-openapi.md` §"Definition of done", enumerated across
 * every role and every operation rather than spot-checked.
 *
 * ## Two servers, because one cannot answer both questions
 *
 * Test 1 (403 for a role lacking the permission) needs an authenticated session
 * for each of eleven roles. Test 2 (401 unauthenticated) needs no session at
 * all. With Supabase unconfigured those are mutually exclusive:
 *
 *   - `next dev`   → access profiles are ON, so `getUserProfile()` resolves the
 *                    `access_profile_role` cookie, and a request with NO cookie
 *                    still resolves to `manager`. There is no anonymous state.
 *   - `next start` → access profiles are hard-`false` in a production build
 *                    (W1-B layer 1), so every caller is anonymous and there is
 *                    no way to obtain a role.
 *
 * So the probe takes a mode. Run it twice; the handoff pastes both.
 *
 *   AZURA_API_BASE=http://127.0.0.1:3311 AZURA_API_MODE=dev  node scripts/api-matrix-probe.mjs
 *   AZURA_API_BASE=http://127.0.0.1:3312 AZURA_API_MODE=prod node scripts/api-matrix-probe.mjs
 *
 * A check that cannot run in the current mode reports SKIP with the reason. It
 * is never counted as a pass.
 *
 * ## Request bodies
 *
 * `createHandler` runs the Zod parse (step 3) BEFORE the permission check
 * (step 5), which is the order `tasks/W2-B` specifies. A write probed with an
 * empty body therefore answers 422 and never reaches the authorisation code, so
 * test 1 would assert nothing on 16 of the 22 mutating operations.
 *
 * Hence FIXTURES: one minimal valid body per write operation, keyed by
 * operationId. Each is checked against the real Zod schema **before** it is
 * sent — a stale fixture fails loudly here rather than silently degrading the
 * matrix into "everything returns 422, all good".
 *
 * Run with `--experimental-strip-types --import ./scripts/register-ts-resolve.mjs`.
 */

import { flattenOperations } from "../apps/web/lib/api-routes.ts"
import { roles } from "../apps/web/lib/contracts.ts"
import { hasPermission } from "../apps/web/lib/rbac.ts"
import * as schemas from "../apps/web/lib/validation/schemas.ts"
import { leadSources, pipelineStages } from "../apps/web/lib/lead-data.ts"
import {
  activityCategories,
  ticketPriorities,
  ticketStatuses,
} from "../apps/web/lib/operations-data.ts"
import { documentCategories } from "../apps/web/lib/document-data.ts"

const BASE = process.env["AZURA_API_BASE"] ?? "http://127.0.0.1:3311"
const MODE = process.env["AZURA_API_MODE"] ?? "dev"
if (MODE !== "dev" && MODE !== "prod") {
  console.error(`AZURA_API_MODE must be "dev" or "prod", got ${JSON.stringify(MODE)}`)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UUID = "00000000-0000-0000-0000-000000000001"
const NOW = "2026-07-28T00:00:00.000Z"
const LATER = "2026-07-28T02:00:00.000Z"
const REASON = "Probed by the W2-B route matrix."

/** operationId → [body, schema export name]. The schema name is verified below. */
const FIXTURES = {
  updateEvidenceFinding: [
    { findingId: "F-002", status: "acknowledged", reason: REASON },
    "updateFindingSchema",
  ],
  updateInventoryUnit: [
    { unitId: "AZW-B03-0412", expectedVersion: 1, saleStatus: "reserved" },
    "updateUnitSchema",
  ],
  createLead: [
    { fullName: "Probe Caller", email: "probe@example.com", source: leadSources[0] },
    "createLeadSchema",
  ],
  updateBuyerPipelineEntry: [
    { entryId: UUID, expectedVersion: 1, stage: pipelineStages[0], reason: REASON },
    "updatePipelineSchema",
  ],
  createPayment: [
    {
      direction: "inbound",
      amountMinor: 1000,
      currency: "EUR",
      receivedAt: NOW,
      method: "bank_transfer",
      reference: "PROBE-1",
    },
    "createPaymentSchema",
  ],
  createVendorInvoice: [
    {
      vendorProfileId: UUID,
      totalAmountMinor: 1000,
      currency: "EUR",
      issuedOn: NOW,
      dueOn: LATER,
      reference: "PROBE-INV-1",
    },
    "createVendorInvoiceSchema",
  ],
  createTicket: [
    {
      category: "plumbing",
      priority: ticketPriorities[0],
      title: "Probe ticket",
      description: "Created by the W2-B route matrix.",
    },
    "createTicketSchema",
  ],
  updateTicketStatus: [
    { ticketId: UUID, expectedVersion: 1, toStatus: ticketStatuses[0] },
    "updateTicketStatusSchema",
  ],
  createActivity: [
    {
      category: activityCategories[0],
      title: "Probe activity",
      startsAt: NOW,
      endsAt: LATER,
    },
    "createActivitySchema",
  ],
  createMediaReport: [
    { title: "Probe report", description: "Created by the W2-B route matrix." },
    "createReportSchema",
  ],
  createDocument: [
    {
      category: documentCategories[0],
      title: "Probe document",
      storageBucket: "documents",
      storageKey: "probe/doc-1",
      visibility: "private",
    },
    "createDocumentSchema",
  ],
  createMessage: [
    { threadId: UUID, body: "Probed by the W2-B route matrix." },
    "createMessageSchema",
  ],
  createProfile: [
    { email: "probe.profile@example.com", fullName: "Probe Profile", role: "tenant" },
    "createProfileSchema",
  ],
  updateProfileRole: [
    { profileId: UUID, expectedVersion: 1, role: "tenant", reason: REASON },
    "updateProfileRoleSchema",
  ],
  executeCommand: [
    { command: "ticket.updateStatus", ticketId: UUID, expectedVersion: 1, toStatus: ticketStatuses[0] },
    "commandSchema",
  ],
  submitPublicReport: [
    { location: "Block B3, floor 4", description: "Probed by the W2-B route matrix." },
    "publicReportSchema",
  ],
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const results = []
const capturedBodies = []

function record(test, state, detail) {
  results.push({ test, state, detail: detail ?? null })
}

function collector() {
  const failures = []
  return {
    fail(message) {
      failures.push(message)
    },
    assert(condition, message) {
      if (!condition) failures.push(message)
    },
    failures,
  }
}

function finish(test, c, checked) {
  if (c.failures.length === 0) {
    record(test, "pass", `${checked} case(s)`)
    return
  }
  const shown = c.failures.slice(0, 10).join("\n        ")
  const more = c.failures.length > 10 ? `\n        (+${c.failures.length - 10} more)` : ""
  record(test, "fail", `${c.failures.length} of ${checked} case(s):\n        ${shown}${more}`)
}

function skip(test, reason) {
  record(test, "skip", reason)
}

function pathFor(operation) {
  // The manifest carries the OpenAPI form; the server wants a concrete value.
  return operation.path.replace(/\{[^}]+\}/g, "AZW-B03-0412")
}

/**
 * The rate-limit bucket is `sha256(scope + address + user-agent|accept-language)`,
 * and in a production build `address` collapses to one shared constant because
 * there is no trusted edge header. Without this, test 4's 64 requests exhaust
 * the public route's budget of 5/min and test 5 measures a 429 instead of the
 * validation error it is asking about.
 *
 * So each test section takes its own user-agent, which gives it its own bucket.
 * That isolates the sections; it does not weaken test 7, which sets one
 * user-agent deliberately and bursts against it.
 */
let currentAgent = "azura-w2b-probe/0"

async function call(operation, { role, body, headers = {}, rawBody } = {}) {
  const method = operation.method
  const init = {
    method,
    headers: { "user-agent": currentAgent, ...headers },
    redirect: "manual",
  }
  if (role !== undefined) init.headers["cookie"] = `access_profile_role=${role}`
  if (rawBody !== undefined) {
    init.headers["content-type"] = "application/json"
    init.body = rawBody
  } else if (body !== undefined) {
    init.headers["content-type"] = "application/json"
    init.body = JSON.stringify(body)
  } else if (method !== "GET") {
    init.headers["content-type"] = "application/json"
    init.body = "{}"
  }

  const response = await fetch(`${BASE}${pathFor(operation)}`, init)
  const text = await response.text()
  capturedBodies.push({ op: operation.operationId, status: response.status, text })
  return { status: response.status, text, headers: response.headers }
}

/** Operations this window owns and that the server actually enforces. */
const operations = flattenOperations().filter((op) => op.external === undefined)
const guarded = operations.filter((op) => op.permission !== null)
const publicOps = operations.filter((op) => op.permission === null)
const mutating = operations.filter((op) => op.method !== "GET")

// ---------------------------------------------------------------------------
// 0. Fixture integrity — a wrong fixture must fail here, not weaken test 1
// ---------------------------------------------------------------------------

{
  const c = collector()
  let checked = 0
  for (const op of mutating) {
    const fixture = FIXTURES[op.operationId]
    if (op.requestSchema === undefined) continue
    if (fixture === undefined) {
      c.fail(`${op.operationId}: declares requestSchema ${op.requestSchema} and has no fixture`)
      continue
    }
    const [body, schemaName] = fixture
    checked += 1
    if (schemaName !== op.requestSchema) {
      c.fail(`${op.operationId}: fixture targets ${schemaName}, manifest declares ${op.requestSchema}`)
      continue
    }
    const schema = schemas[schemaName]
    if (schema === undefined) {
      c.fail(`${op.operationId}: lib/validation/schemas.ts exports no ${schemaName}`)
      continue
    }
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")
      c.fail(`${op.operationId}: fixture is not valid against ${schemaName} — ${issues}`)
    }
  }
  finish("0 · fixtures are valid against the real schemas", c, checked)
}

// ---------------------------------------------------------------------------
// 1. Every guarded operation returns 403 for a role lacking its permission
// ---------------------------------------------------------------------------

currentAgent = "azura-w2b-probe/authz"

if (MODE !== "dev") {
  skip(
    "1 · 403 for every role lacking the permission",
    "needs an authenticated session per role; access profiles are hard-false in a production build (W1-B layer 1). Run in dev mode."
  )
} else {
  const c = collector()
  let checked = 0
  for (const op of guarded) {
    const fixture = FIXTURES[op.operationId]
    const body = fixture === undefined ? undefined : fixture[0]
    for (const role of roles) {
      const holds = hasPermission(role, op.permission)
      const { status } = await call(op, { role, body })
      checked += 1
      if (!holds) {
        // The one property that matters: a role without the permission is
        // refused, and never receives data.
        if (status !== 403) {
          c.fail(`${op.method} ${op.path} as ${role} (lacks ${op.permission}) → ${status}, expected 403`)
        }
      } else if (status === 403) {
        c.fail(`${op.method} ${op.path} as ${role} (HOLDS ${op.permission}) → 403`)
      } else if (status === 422 && body !== undefined) {
        c.fail(`${op.method} ${op.path} as ${role} → 422 with a schema-valid fixture; the fixture or the schema has drifted`)
      }
    }
  }
  finish("1 · 403 for every role lacking the permission", c, checked)
}

// ---------------------------------------------------------------------------
// 2. Every guarded operation returns 401 unauthenticated
// ---------------------------------------------------------------------------

currentAgent = "azura-w2b-probe/anon"

if (MODE !== "prod") {
  skip(
    "2 · 401 unauthenticated on every guarded operation",
    "in dev mode access profiles are ON, so a request with no cookie still resolves to `manager` and there is no anonymous state. Run in prod mode."
  )
} else {
  const c = collector()
  let checked = 0
  for (const op of guarded) {
    const fixture = FIXTURES[op.operationId]
    const { status } = await call(op, { body: fixture === undefined ? undefined : fixture[0] })
    checked += 1
    if (status !== 401) {
      c.fail(`${op.method} ${op.path} unauthenticated → ${status}, expected 401`)
    }
  }
  // And the declared-public ones must NOT 401.
  for (const op of publicOps) {
    const fixture = FIXTURES[op.operationId]
    const { status } = await call(op, { body: fixture === undefined ? undefined : fixture[0] })
    checked += 1
    if (status === 401) {
      c.fail(`${op.method} ${op.path} is declared public and returned 401`)
    }
  }
  finish("2 · 401 unauthenticated on every guarded operation", c, checked)

  // 2b. The QA backdoor must not open the API either. W1-B's kill-switch is
  // proved at the module level by scripts/rbac-probe.mts; this proves it at the
  // HTTP boundary, which is where an attacker would actually try it.
  const b = collector()
  let attempted = 0
  for (const op of guarded) {
    const fixture = FIXTURES[op.operationId]
    const { status } = await call(op, {
      role: "admin",
      body: fixture === undefined ? undefined : fixture[0],
    })
    attempted += 1
    if (status !== 401) {
      b.fail(`${op.method} ${op.path} with access_profile_role=admin → ${status}, expected 401`)
    }
  }
  finish("2b · the access-profile cookie buys nothing in a production build", b, attempted)
}

// ---------------------------------------------------------------------------
// 3. Every write returns 503 with no data plane — never a fake success
// ---------------------------------------------------------------------------

currentAgent = "azura-w2b-probe/writes"

if (MODE !== "dev") {
  skip("3 · writes return 503 with Supabase unconfigured", "needs a permitted role; run in dev mode.")
} else {
  const c = collector()
  let checked = 0
  for (const op of mutating) {
    if (op.permission === null) continue
    const holder = roles.find((role) => hasPermission(role, op.permission))
    if (holder === undefined) {
      c.fail(`${op.operationId}: no role holds ${op.permission}, so the write path is unreachable`)
      continue
    }
    const fixture = FIXTURES[op.operationId]
    const { status } = await call(op, { role: holder, body: fixture === undefined ? undefined : fixture[0] })
    checked += 1
    if (status >= 200 && status < 300) {
      c.fail(`${op.method} ${op.path} as ${holder} → ${status}. A 2xx with no data plane is a fake write success.`)
    } else if (status !== 503 && status !== 422) {
      c.fail(`${op.method} ${op.path} as ${holder} → ${status}, expected 503`)
    }
  }
  finish("3 · writes return 503 with Supabase unconfigured", c, checked)
}

// ---------------------------------------------------------------------------
// 4. Malformed JSON → 422, typed, never an unhandled throw
// ---------------------------------------------------------------------------

currentAgent = "azura-w2b-probe/malformed"

{
  const c = collector()
  let checked = 0
  const role = MODE === "dev" ? "admin" : undefined
  for (const op of mutating) {
    for (const raw of ["{not json", '{"a":', "[]", "null"]) {
      const { status, text } = await call(op, { role, rawBody: raw })
      checked += 1
      if (status === 500) {
        c.fail(`${op.method} ${op.path} with ${JSON.stringify(raw)} → 500`)
        continue
      }
      if (MODE === "prod" && status === 401) continue // authz first is fine
      if (status !== 422 && status !== 400 && status !== 403) {
        c.fail(`${op.method} ${op.path} with ${JSON.stringify(raw)} → ${status}, expected 422`)
        continue
      }
      if (status === 422 || status === 400) {
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch {
          c.fail(`${op.method} ${op.path} with ${JSON.stringify(raw)} → body is not JSON`)
          continue
        }
        if (parsed?.error?.code === undefined) {
          c.fail(`${op.method} ${op.path} with ${JSON.stringify(raw)} → no typed error code`)
        }
      }
    }
  }
  finish("4 · malformed JSON is a typed 422, never a 500", c, checked)
}

// ---------------------------------------------------------------------------
// 5. Over-length string → 422 naming the field
// ---------------------------------------------------------------------------

currentAgent = "azura-w2b-probe/oversize"

{
  const c = collector()
  let checked = 0
  const role = MODE === "dev" ? "admin" : undefined
  for (const op of mutating) {
    const fixture = FIXTURES[op.operationId]
    if (fixture === undefined) continue
    const [body] = fixture
    const field = Object.keys(body).find((k) => typeof body[k] === "string" && k !== "command")
    if (field === undefined) continue
    const oversized = { ...body, [field]: "x".repeat(5_000) }
    const { status, text } = await call(op, { role, body: oversized })
    checked += 1
    if (MODE === "prod" && status === 401) continue
    if (status !== 422) {
      c.fail(`${op.method} ${op.path} with a 5000-char ${field} → ${status}, expected 422`)
      continue
    }
    if (!text.includes(field)) {
      c.fail(`${op.method} ${op.path} 422 body does not name the offending field ${field}`)
    }
  }
  finish("5 · over-length string is a 422 naming the field", c, checked)
}

// ---------------------------------------------------------------------------
// 6. Idempotent public mutation: replay is byte-identical, different body is 409
// ---------------------------------------------------------------------------

currentAgent = "azura-w2b-probe/idempotency"

{
  const idempotent = operations.filter((op) => op.idempotent === true)
  if (idempotent.length === 0) {
    skip("6 · idempotency replay", "no operation in the manifest declares `idempotent: true`")
  } else {
    const c = collector()
    let checked = 0
    const notStored = []
    for (const op of idempotent) {
      const fixture = FIXTURES[op.operationId]
      if (fixture === undefined) {
        c.fail(`${op.operationId}: declares idempotent and has no fixture`)
        continue
      }
      const [body] = fixture
      // A guarded idempotent write needs a role that actually holds its
      // permission, or the probe measures the 403 path instead.
      const role =
        MODE === "dev" && op.permission !== null
          ? roles.find((r) => hasPermission(r, op.permission))
          : undefined
      const key = `probe-${op.operationId}-${checked}`
      const first = await call(op, { role, body, headers: { "idempotency-key": key } })
      const replay = await call(op, { role, body, headers: { "idempotency-key": key } })
      checked += 2

      // `createHandler` writes the store only after a SUCCESSFUL response, which
      // is right: caching a 503 under an idempotency key would stop the client
      // retrying once the data plane returns. So the replay guarantee only
      // applies to a first response that was actually stored. With Supabase
      // unconfigured no write reaches 2xx (test 3 proves it), which makes the
      // stored-replay path unreachable in this environment — recorded as such
      // rather than claimed as a pass.
      const stored = first.status >= 200 && first.status < 300
      if (!stored) {
        notStored.push(`${op.method} ${op.path} (first response ${first.status})`)
        if (first.status !== replay.status) {
          c.fail(
            `${op.method} ${op.path}: an unstored response is not deterministic — ${first.status} then ${replay.status}`
          )
        }
        continue
      }

      if (first.text !== replay.text) {
        c.fail(`${op.method} ${op.path}: replay body is not byte-identical`)
      }
      if (replay.headers.get("idempotency-replayed") !== "true") {
        c.fail(`${op.method} ${op.path}: replay carried no Idempotency-Replayed header`)
      }
      const conflicting = await call(op, {
        role,
        body: { ...body, description: "A different body under the same key." },
        headers: { "idempotency-key": key },
      })
      checked += 1
      if (conflicting.status !== 409) {
        c.fail(`${op.method} ${op.path}: same key + different body → ${conflicting.status}, expected 409`)
      }
    }
    if (c.failures.length === 0 && notStored.length === idempotent.length) {
      skip(
        "6 · idempotency: replay identical, changed body 409",
        `no idempotent write reached 2xx with Supabase unconfigured, so nothing was stored and the replay path could not be exercised. Unstored responses were verified deterministic across ${notStored.length} operation(s). Needs a data plane.`
      )
    } else {
      finish("6 · idempotency: replay identical, changed body 409", c, checked)
      if (notStored.length > 0) {
        record(
          "6b · idempotent operations whose store path was not exercised",
          "skip",
          notStored.join("; ")
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Rate limit → 429 with Retry-After
// ---------------------------------------------------------------------------

currentAgent = "azura-w2b-probe/burst"

{
  const target = publicOps.find((op) => op.rateLimit !== undefined && FIXTURES[op.operationId] !== undefined)
  if (target === undefined) {
    skip("7 · rate limit returns 429 with Retry-After", "no public operation has both a rate limit and a fixture")
  } else {
    const c = collector()
    const [body] = FIXTURES[target.operationId]
    const budget = target.rateLimit.max
    let limited = null
    for (let i = 0; i < budget + 3; i += 1) {
      const response = await call(target, { body: { ...body, description: `Burst probe ${i}.` } })
      if (response.status === 429) {
        limited = response
        break
      }
    }
    if (limited === null) {
      c.fail(`${target.method} ${target.path}: ${budget + 3} requests against a limit of ${budget} never produced a 429`)
    } else {
      const retryAfter = limited.headers.get("retry-after")
      if (retryAfter === null || Number.isNaN(Number(retryAfter))) {
        c.fail(`${target.method} ${target.path}: 429 carried Retry-After ${JSON.stringify(retryAfter)}`)
      }
    }
    finish("7 · rate limit returns 429 with Retry-After", c, budget + 3)
  }
}

// ---------------------------------------------------------------------------
// 8. No captured response body leaks internals
// ---------------------------------------------------------------------------

{
  const c = collector()
  const needles = [
    ["postgres", /postgres/i],
    ["PGRST", /PGRST\d*/],
    ["stack frame", /\n\s+at\s+\S+\s+\(?[A-Za-z]:[\\/]|\bat\s+\w+\s+\([^)]*\.(?:ts|tsx|js|mjs):\d+:\d+\)/],
    ["file path", /[A-Za-z]:\\\\?(?:Users|azura)/],
    ["node_modules", /node_modules/],
    ["supabase url", /https:\/\/[a-z0-9]+\.supabase\.co/],
  ]
  for (const capture of capturedBodies) {
    for (const [label, pattern] of needles) {
      if (pattern.test(capture.text)) {
        c.fail(`${capture.op} (${capture.status}) leaks ${label}: ${capture.text.slice(0, 160)}`)
      }
    }
  }
  finish("8 · no response body leaks postgres, PGRST, a stack frame or a path", c, capturedBodies.length)
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const bar = "─".repeat(78)
console.log(bar)
console.log(`Azura World CATI — W2-B route matrix · mode=${MODE} · ${BASE}`)
console.log(
  `${operations.length} owned operations · ${guarded.length} guarded · ${publicOps.length} public · ${mutating.length} mutating · ${roles.length} roles`
)
console.log(bar)

for (const r of results) {
  const mark = r.state === "pass" ? "PASS" : r.state === "skip" ? "SKIP" : "FAIL"
  console.log(`${mark}  ${r.test}`)
  if (r.detail !== null) console.log(`        ${r.detail}`)
}

const failed = results.filter((r) => r.state === "fail")
const skipped = results.filter((r) => r.state === "skip")
console.log(bar)
console.log(
  `${results.length - failed.length - skipped.length} pass · ${failed.length} fail · ${skipped.length} skipped · ${capturedBodies.length} responses captured`
)
if (skipped.length > 0) {
  console.log("")
  console.log("SKIPPED — not passes:")
  for (const r of skipped) console.log(`  ${r.test}\n    ${r.detail}`)
}
console.log(bar)
process.exit(failed.length > 0 ? 1 : 0)
