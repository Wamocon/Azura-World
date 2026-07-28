# HANDOFF — W2-B  API routes + OpenAPI contract

STATUS: COMPLETE
Completed: 2026-07-28
Branch: `feature/INTERNAL-107-w2b-api` (from `main` @ `bb9bf87`, own git worktree `D:\azura-w2b`)

**W4-D's contract gate is green.** `pnpm test:contract` exits 0 at **33 paths · 49 operations ·
13 pass · 0 fail · 23 exempt**, and every exemption prints with the window that owns it and why —
an unverified property is visible in the gate output rather than quietly counted as a pass.

---

## 1. Counts, for the project docs

| | |
|---|---|
| **Paths** | **33** |
| **Operations** | **49** |
| Operations this window owns | 42 |
| Operations another window owns, declared here so they are not shadow endpoints | 7 |
| Mutating operations | 22 |
| Public operations (no permission) | 9 — 3 mine, 6 external |
| Declared write gaps (503 and no 2xx, by construction) | 14 |
| Route files under `app/api` | 28 |

The seven external operations are W1-B's `access-profile` switch and W2-C's four AI endpoints.
`ORCHESTRATION` §4 forbids this window from editing those files, and leaving them out of the
manifest was the obvious option and the wrong one: they would then be absent from the published
spec and outside every check in `validate-openapi.mjs`, which is the exact state that validator
exists to prevent. They are declared, documented, and marked `external`, and the validator
**prints** each check it cannot enforce across the ownership boundary.

---

## 2. Verification actually run

Never through a pipe — exit codes captured from the command.

| Command | Result |
|---|---|
| `pnpm --dir apps/web typecheck` | **PASS** — exit 0, no output |
| `pnpm --dir apps/web lint` | **PASS** — exit 0, 0 errors 0 warnings |
| `pnpm --dir apps/web build` | **PASS** — exit 0; all 28 route files build as `ƒ (Dynamic)` |
| `pnpm test:contract` | **PASS** — exit 0 |
| `scripts/api-matrix-probe.mjs` (dev) | **PASS** — exit 0 |
| `scripts/api-matrix-probe.mjs` (prod) | **PASS** — exit 0 |

### The validator's summary line

```
33 paths · 49 operations · 22 mutating · 14 declared write gaps · 9 public · 7 externally owned
13 pass · 0 fail · 23 exempt
```

### The route matrix

Two servers, because one cannot answer both questions. With Supabase unconfigured, `next dev` has
access profiles ON — so eleven roles are reachable and there is no anonymous state, because a
request with no cookie still resolves to `manager`. `next start` has them hard-`false` (W1-B
layer 1) — so the anonymous case is reachable and no role is. Both were run; both are pasted.

```
Azura World CATI — W2-B route matrix · mode=dev · http://127.0.0.1:3311
42 owned operations · 39 guarded · 3 public · 16 mutating · 11 roles
──────────────────────────────────────────────────────────────────────────────
PASS  0 · fixtures are valid against the real schemas                 16 case(s)
PASS  1 · 403 for every role lacking the permission                  429 case(s)
SKIP  2 · 401 unauthenticated on every guarded operation
PASS  3 · writes return 503 with Supabase unconfigured                15 case(s)
PASS  4 · malformed JSON is a typed 422, never a 500                  64 case(s)
PASS  5 · over-length string is a 422 naming the field                16 case(s)
SKIP  6 · idempotency: replay identical, changed body 409
PASS  7 · rate limit returns 429 with Retry-After                      8 case(s)
PASS  8 · no response body leaks postgres, PGRST, a stack frame        552 case(s)
──────────────────────────────────────────────────────────────────────────────
7 pass · 0 fail · 2 skipped · 552 responses captured
```

```
Azura World CATI — W2-B route matrix · mode=prod · http://127.0.0.1:3312
──────────────────────────────────────────────────────────────────────────────
PASS  0 · fixtures are valid against the real schemas                 16 case(s)
SKIP  1 · 403 for every role lacking the permission
PASS  2 · 401 unauthenticated on every guarded operation               42 case(s)
PASS  2b · the access-profile cookie buys nothing in a production build 39 case(s)
SKIP  3 · writes return 503 with Supabase unconfigured
PASS  4 · malformed JSON is a typed 422, never a 500                   64 case(s)
PASS  5 · over-length string is a 422 naming the field                 16 case(s)
SKIP  6 · idempotency: replay identical, changed body 409
PASS  7 · rate limit returns 429 with Retry-After                       8 case(s)
PASS  8 · no response body leaks postgres, PGRST, a stack frame        189 case(s)
──────────────────────────────────────────────────────────────────────────────
7 pass · 0 fail · 3 skipped · 189 responses captured
```

Notes on what those numbers mean:

- **Test 1 is 429 cases — 39 guarded operations × 11 roles.** Not a sample. Every role that lacks
  an operation's permission gets 403, and no role that holds it gets 403.
- **Test 2b is extra**, not in the brief: the QA role cookie is replayed against all 39 guarded
  operations in the production build and buys nothing, 39/39. W1-B's kill-switch is proved at the
  module level by `rbac-probe.mts`; this proves it at the HTTP boundary, which is where somebody
  would actually try it.
- **741 response bodies across the two runs** were captured and grepped for `postgres`, `PGRST`,
  a stack frame, a Windows path, `node_modules` and a Supabase URL. Zero hits.
- **No 500 was observed on any of the 741 responses.**

---

## 3. What was NOT verified

Read this before quoting §2.

1. **Test 2 (401) cannot run in dev and test 1 (403) cannot run in prod.** Each is covered by the
   other run. Nothing is covered by neither, but no single server run covers everything, and a
   CI job that runs only one mode will silently skip half the matrix.
2. **`[GAP]` Test 6 — the idempotency replay path has never executed.** `createHandler` writes the
   idempotency store only after a **successful** response, which is correct: caching a 503 under a
   key would stop the client retrying once the data plane returns. With Supabase unconfigured no
   write reaches 2xx — test 3 proves exactly that — so nothing is ever stored and the replay and
   409-on-changed-body branches are unreachable in this environment. What *was* verified is that
   unstored responses are deterministic across all 11 idempotent operations. **The DoD's item 6 is
   therefore not satisfied and I am not claiming it is.** It needs a data plane.
3. **`[GAP]` No route has been exercised against a real Supabase.** Every read served seed data;
   every write returned 503. The repository call sites typecheck against W2-A's signatures and
   have never run against Postgres.
4. **`[GAP]` The 14 declared write gaps return 503 by construction**, so their success paths, their
   audit rows and their optimistic-concurrency conflicts (`expectedVersion` → 409) are unproven.
   The 503 is enforced *after* authentication, authorisation and validation, so the contract around
   the gap is real even though the write is not.
5. **`[GAP]` `AbortSignal` handling is not tested.** The brief asks for client-disconnect handling
   on long queries; no query here is long enough to test it against seed data.
6. **`[GAP]` No concurrency testing.** Lost updates, double-submit races and the idempotency store
   under parallel identical requests are untested.
7. The matrix ran on `127.0.0.1` only. No proxy, no CDN, so the `x-vercel-forwarded-for` path in
   `rateIdentity()` was never taken — the shared-bucket fallback is what was measured.

---

## 4. Public routes, and the justification for each

Nine operations carry `permission: null`. Three are mine; six belong to other windows and are
declared here so the spec covers them.

| Operation | Owner | Rate limit | Why it is public |
|---|---|---|---|
| `POST /api/site-management/public/report` | W2-B | **5 / 60s** | Site damage must be reportable by a resident's visitor or a passer-by, who has no account. It accepts no identifiers beyond a free-text contact the submitter chooses to give, is the most tightly limited route in the app, and requires an idempotency key. |
| `GET /api/calendar/ics/{token}` | W2-B | 30 / 60s | Calendar clients cannot carry a session cookie. The token is opaque, single-purpose, read-only, grants activity times only, and is compared in constant time. |
| `GET /api/openapi` | W2-B | 30 / 60s | The spec describes only the shape of a surface an unauthenticated caller can discover by probing anyway. Publishing it makes the parity guarantee externally checkable. |
| `GET`/`POST`/`DELETE /api/access-profile` | W1-B | none — see below | It is the mechanism by which a QA session acquires a role, so it cannot itself require one. Inert unless `ENABLE_ACCESS_PROFILES` is set, and enabling it in production is a startup failure rather than a configuration choice. |
| `POST /api/ai/public-chat` (+ `/stream`, `/feedback`) | W2-C | none here — `lib/ai-rate-limit.ts` | Answers prospective buyers who have no account, over already-published material, and refuses anything it cannot ground. |

**The validator's rule "a public route must declare a rate limit" is not satisfied by the six
external ones, and it says so rather than exempting them silently.** W2-C rate-limits in its own
module; W1-B is environment-gated instead. Both are defensible and neither is visible to this
manifest, which is why they print as `~ not verified by this gate` with the owner named.

---

## 5. Error code → HTTP status, as implemented

`CONTRACTS.md` §5's table is frozen and `lib/contracts.ts` holds it as `apiErrorStatus`.
`lib/api-errors.ts` has no table of its own — it reads that one — so the two cannot drift.

| `ApiError.code` | HTTP | Constructor | Where it comes from |
|---|---|---|---|
| `unauthorized` | **401** | `unauthorized()` | step 4, no authenticated profile |
| `forbidden` | **403** | `forbidden()` | step 5, `hasPermission()` false |
| `not_found` | **404** | `notFound()` | repository returns no row |
| `validation_failed` | **422** | `validationFailed()` | step 3, Zod; `details` names each field |
| `conflict` | **409** | `conflict()` | idempotency key reused with a different body; `expectedVersion` mismatch |
| `rate_limited` | **429** | `rateLimited()` | step 2, with `Retry-After` |
| `persistence_unavailable` | **503** | `persistenceUnavailable()` | step 6, a write with no data plane |
| `upstream_failed` | **502** | `upstreamFailed()` | an upstream did not answer |

**415** and **405** are returned before an `ApiError` exists — wrong content type and wrong verb
are answered at step 1, before anything is parsed. **500 is deliberately absent from every
operation's declared responses**: `createHandler` catches everything and maps it to a code above,
so a 500 means a bug, and documenting it would make that bug look like part of the contract.

---

## 6. Things in `CONTRACTS.md` §5 that needed care

Everything in §5 fitted. Three points where fitting it required a decision:

1. **`source: "supabase" | "local-seed"` is on the success arm only**, so an error carries no
   `source`. Correct — a failed read has no provenance to report — but it means a client cannot
   tell a seed-mode 503 from a live-mode 503 without reading the message. Left as the contract
   specifies.
2. **`details?: Record<string, string>`** is flat, and Zod issues are pathed. Nested paths are
   joined with `.` (`askingPriceCurrency`, `payload.toStatus`), so a caller can address the field
   without the envelope growing a recursive shape. Verified by test 5: the 422 body names the
   offending field in all 16 cases.
3. **`retryable`** is a property of the code, not the request, so it is set by the constructor and
   never by a call site. `persistence_unavailable` and `upstream_failed` are `true`; everything
   else is `false`. A caller retrying a 422 would loop forever.

---

## 7. The one design trade-off worth flagging

**Zod runs before authorisation.** `tasks/W2-B` §1 specifies the order — method/content-type,
rate limit, Zod parse, `getUserProfile()`, `hasPermission()` — and the implementation follows it
exactly. The consequence is that an unauthenticated or unauthorised caller who posts a malformed
body gets a **422 naming the expected fields** rather than a 401/403, so the request schema is
discoverable without credentials.

That is a small information disclosure, and it is bounded: the same schema is published at
`GET /api/openapi`, deliberately (§4). So nothing is leaked that is not already public, and the
ordering buys something real — a rate limit that runs before any body is read, and validation that
cannot be skipped by an authorisation short-circuit.

I implemented the specified order rather than quietly reordering it. **If W4-C or the owner would
rather authorise first, it is a two-line move** in `lib/api-handler.ts` and the matrix will still
pass — test 1's fixtures are schema-valid, so they reach the permission check either way.

---

## 8. Requests for other windows

| # | Owner | Request |
|---|---|---|
| 1 | **W2-A** | Eleven of the fourteen write gaps are yours (§1). Each route already authenticates, authorises, validates and rate-limits, then returns 503 naming what is missing — so landing a repository mutation is a one-line swap at the call site, not a new route. `updateFindingSchema`, `createLeadSchema`, `createTicketSchema` and the rest are the shapes the handlers will hand you. |
| 2 | **W1-A** | Three write gaps need migrations or RPCs first: `POST /finance/payments` (the double-entry group must balance atomically), and `POST`/`PATCH /users` (a profile insert and a role change, both of which the escalation trigger governs). |
| 3 | **W4-D** | `pnpm test:contract` is green and is yours to wire. Please also wire `scripts/api-matrix-probe.mjs` — **but run it in both modes**, or half the matrix silently skips (§3.1). It needs a server; if the gate cannot stand one up, run the dev mode at minimum, because that is the one covering the 429-case role matrix. |
| 4 | **W3-\*** | The dashboard surfaces do not need to call these routes: they are Server Components and can call W2-A's repositories directly, which skips a network hop. Use these when a **client** component needs data, or when something outside the app does. Either way the permission is enforced server-side in both paths. |
| 5 | **W2-C** | Your four AI operations are declared in `lib/api-routes.ts` with `external: { owner }` so they appear in the published spec. If you change a method, a status or a public justification, that file is where the spec learns about it — and `test:contract` will fail until it does. |
| 6 | **W1-B** | Same for `access-profile`'s three operations. Also: **the production kill-switch holds at the HTTP boundary**, verified 39/39 (§2, test 2b). |
| 7 | **W0-A** | `scripts/api-matrix-probe.mjs` is a new script outside my declared file list; flagging rather than burying it. A `qa:api` entry in `package.json` would be the natural home — that file is yours. |

---

## 9. One fix made outside the route work

`lib/api-handler.ts` carried **two literal NUL bytes** inside the rate-limit hash input. They are
a correct domain separator, but written as raw bytes rather than the `\x00` escape they made git
classify the whole file as binary — and both secret scanners skip binary files:
`git diff --cached | grep` in `.githooks/pre-commit`, and `git grep -I` in `.github/workflows/ci.yml`.
A secret added to this file would have committed clean.

Replaced with the escape; behaviour is byte-identical. Verified that `git grep` now matches inside
the file. `safeNextPath()` in W1-B's login action already takes this care and says why, so the
codebase had the right idiom and this file had missed it.

**`apps/web/lib/ai-rate-limit.ts:63` has the same defect and is W2-C's file** — not touched.

---

## 10. Is this ready for W4-D?

**Yes.** `pnpm test:contract` exits 0 and the spec is at exact parity with the implementation, in
both directions, with every unenforceable check printed rather than dropped.

Two things a later window should not undo:

1. **The manifest in `lib/api-routes.ts` is the single source of truth.** `docs/api/openapi.yaml`
   is generated from it and the validator reads both. Hand-editing the YAML will be reverted by the
   next generate and caught by the gate in between.
2. **`external` is not an escape hatch.** It marks a route another window owns so it stays in the
   spec; it does not silence a check, it re-labels one as unverified and names who could verify it.
   A route marked `external` to make a gate green would be the same lie as a stubbed test.
