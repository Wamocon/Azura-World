# W2-B — API routes + OpenAPI contract

**Wave:** 2 · **Depends on:** W1-A, W1-B, W2-A · **Blocks:** W3-*, W4-D · **Runs with:** W2-A, W2-C, W2-D

> Read `SYSTEM-PROMPT.md`, `CONVENTIONS.md` §4, `CONTRACTS.md` §5. Then read
> `D:\Real Estate CRM\Cati\apps\web\app\api\site-management\dashboard\route.ts` and
> `scripts\validate-openapi.mjs`.
>
> **Read `HANDOFF/W2-A.md`** for the repository signatures you will call.

---

## Mission

The HTTP boundary, and a machine-checked contract that says exactly what it does. The reference
project holds OpenAPI and implementation at **exact** parity — 50 paths, 87 operations, verified
by a script in the gate. Match that discipline: a spec that drifts from the code is worse than no
spec, because people trust it.

---

## Files you own

```
apps/web/app/api/site-management/**  ·  apps/web/app/api/calendar/**
apps/web/app/api/openapi/route.ts    ·  apps/web/lib/api-handler.ts
apps/web/lib/api-errors.ts           ·  apps/web/lib/validation/*.ts
docs/api/openapi.yaml                ·  scripts/validate-openapi.mjs
HANDOFF/W2-B.md
```

Not yours: `app/api/ai/*` (W2-C), `app/api/access-profile/*` (W1-B).

---

## Deliverables

### 1. `lib/api-handler.ts` — one wrapper, every route

Routes must not hand-roll the security sequence. One helper, applied uniformly:

```ts
export function createHandler<TBody, TResult>(config: {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  permission: Permission | null; // null = public, and you must justify it in a comment
  schema?: ZodSchema<TBody>;
  rateLimit?: { windowMs: number; max: number };
  handler: (ctx: HandlerContext<TBody>) => Promise<TResult>;
}): (req: Request) => Promise<Response>;
```

Executes, in this order — the order is the security property:

1. Method + content-type check
2. Rate limit (required for every `permission: null` route)
3. Zod parse — length ceilings on every string, unknown keys rejected
4. `getUserProfile()`
5. `hasPermission()` — **server-side, always, even when the UI already hid the entry point**
6. Call the repository
7. Map errors to `ApiError`; never leak a Postgres message
8. Write an `audit_events` row for anything that mutates
9. Attach `requestId` to the response and to every log line

### 2. Route inventory

| Path                                        | Methods          | Permission                                        |
| ------------------------------------------- | ---------------- | ------------------------------------------------- |
| `/api/site-management/dashboard`            | GET              | `dashboard:view`                                  |
| `/api/site-management/evidence`             | GET              | `evidence:view`                                   |
| `/api/site-management/evidence/findings`    | GET, PATCH       | `evidence:view` / `evidence:manage`               |
| `/api/site-management/evidence/coverage`    | GET              | `evidence:view`                                   |
| `/api/site-management/inventory/units`      | GET              | `units:view`                                      |
| `/api/site-management/inventory/units/[id]` | GET, PATCH       | `units:view` / `units:update`                     |
| `/api/site-management/inventory/blocks`     | GET              | `units:view`                                      |
| `/api/site-management/portal-listings`      | GET              | `listings:view`                                   |
| `/api/site-management/hotel`                | GET              | `hotel:view`                                      |
| `/api/site-management/reviews`              | GET              | `reviews:view`                                    |
| `/api/site-management/leads`                | GET, POST        | `leads:view` / `leads:create`                     |
| `/api/site-management/buyer-pipeline`       | GET, PATCH       | `buyer_pipeline:*`                                |
| `/api/site-management/finance`              | GET              | `finance:view`                                    |
| `/api/site-management/finance/payments`     | GET, POST        | `finance:view` / `finance:create`                 |
| `/api/site-management/wallet`               | GET              | `wallet:view`                                     |
| `/api/site-management/vendor-invoices`      | GET, POST        | `vendor_invoices:*`                               |
| `/api/site-management/tickets`              | GET, POST, PATCH | `tickets:*`                                       |
| `/api/site-management/activities`           | GET, POST        | `activities:*`                                    |
| `/api/site-management/documents`            | GET, POST        | `documents:*`                                     |
| `/api/site-management/compliance`           | GET              | `compliance:view`                                 |
| `/api/site-management/communications`       | GET, POST        | `communications:*`                                |
| `/api/site-management/reports`              | GET, POST        | `reports:*`                                       |
| `/api/site-management/users`                | GET, POST, PATCH | `users:*`                                         |
| `/api/site-management/search`               | GET              | `dashboard:view`                                  |
| `/api/site-management/actions`              | POST             | varies — audit log write                          |
| `/api/site-management/public/report`        | POST             | **null** — rate-limited, idempotency key required |
| `/api/calendar/ics/[token]`                 | GET              | token-scoped, no session                          |
| `/api/openapi`                              | GET              | null — serves the spec                            |

### 3. `docs/api/openapi.yaml`

OpenAPI 3.1. Every path, every method, every status, every schema. `ApiResponse` and `ApiError`
as reusable components. Security schemes declared. Examples on every response — including error
responses, which are the ones people actually need examples of.

### 4. `scripts/validate-openapi.mjs`

Bidirectional, exits non-zero on any of:

1. A route in the filesystem missing from the spec
2. A path in the spec with no route file
3. A method mismatch
4. A response status in the spec the code cannot produce (or vice versa)
5. A request schema disagreeing with the Zod schema
6. A route with `permission: null` and no rate limit
7. A mutating route with no audit write

Checks 6 and 7 are security gates wearing a contract-test costume. Keep them.

---

## Edge cases

- **Never 500 for a handled condition.** W4-C treats any reachable 500 as a High finding. Map
  everything: no persistence → 503; bad input → 422; forbidden → 403.
- **503 must be honest.** When Supabase is unconfigured and the route _writes_, return 503 —
  do not pretend success against seed data. Reads may serve seed; writes may not.
  The reference project is explicit: _"Seed- oder Prozessdaten sind kein Persistenznachweis."_
- **Idempotency** on every public mutation. Same key + same fingerprint → return the stored
  response byte-identically. Same key + different body → 409.
- **Rate limiting** keyed on IP **and** a request fingerprint. IP alone is trivially defeated;
  behind a proxy it may also be shared by many legitimate users.
- **`GET` must never mutate.** Not even a "last viewed" timestamp. It breaks caching and prefetch.
- **Pagination**: `?limit` capped at 500 server-side. A client asking for 100000 gets 500, not an
  error and not 100000.
- **Sort injection**: `?sort=` must be an allowlist, never interpolated into SQL.
- **Large payloads**: body size ceiling, enforced before parsing.
- **`AbortSignal`**: honour client disconnect on long queries; do not keep working for nobody.
- **Currency in aggregates**: return per-currency totals. Never sum EUR and USD.
- **Content negotiation**: reject non-JSON bodies with 415, not a parse crash.
- **CORS**: same-origin only. No wildcard, ever.
- **Trailing-slash and case**: `/API/…` must not bypass the guard. Normalise before matching.

---

## Definition of done

```bash
pnpm --dir apps/web typecheck
pnpm --dir apps/web lint
pnpm --dir apps/web build
pnpm test:contract              # validate-openapi exits 0
```

Paste the validator's summary line: paths and operations, matching exactly.

Plus a route-level test matrix, output pasted:

1. Every route with a permission returns **403** for a role lacking it — enumerate roles × routes
   programmatically, do not spot-check
2. Every route returns **401** unauthenticated (except the declared-public ones)
3. Every write route returns **503** with Supabase unconfigured — not a fake success
4. Malformed JSON → **422** with a typed error, never an unhandled throw
5. Over-length string → **422**, and the error names the field
6. Public report POST replayed with the same idempotency key → identical response
7. Rate limit exceeded → **429** with `Retry-After`
8. No route response body contains the substring `postgres`, `PGRST`, or a stack frame

Test 8 is a grep over every captured response. It catches leaked internals that reviews miss.

---

## Handoff must state

- Final path and operation counts (they go in the project docs)
- Which routes are public, and the justification for each
- The error-code → HTTP mapping as implemented
- Anything in `CONTRACTS.md` §5 that did not fit
