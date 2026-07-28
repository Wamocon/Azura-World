# W2-A — Repository layer

**Wave:** 2 · **Depends on:** W1-A (schema), W1-B (auth) · **Blocks:** W2-B, W2-D, all W3-* · **Runs with:** W2-B, W2-C, W2-D

> Read `SYSTEM-PROMPT.md`, `CONVENTIONS.md` §2, `CONTRACTS.md` §4. Then read
> `D:\Real Estate CRM\Cati\apps\web\lib\site-management-repository.ts` **in full** — it is the
> pattern you are mirroring, not merely consulting.
>
> **Read `HANDOFF/W1-A.md` first** for the actual table and column names. Do not guess them;
> guessed column names typecheck and fail at runtime.

---

## Mission

The single data-access layer. Every route handler and every server component goes through you.
Two rules define the whole task:

1. **Every function returns `RepositoryResult<T>` with a `source` field.** This is how the app
   demos without a database and how anyone debugs a data problem — check `source` before
   suspecting Postgres.
2. **Unconfigured Supabase falls back silently and labels itself. Configured-but-failing throws.**
   Collapsing those two cases hides a production outage behind plausible seed data.

---

## Files you own

```
apps/web/lib/*-repository.ts
apps/web/lib/*-data.ts          (seed data — EXCEPT azura-world-data.ts, which is W0-B's)
apps/web/lib/seed-data.ts · apps/web/lib/repository-base.ts
HANDOFF/W2-A.md
```

## Repositories to build

| File                           | Serves                                                |
| ------------------------------ | ----------------------------------------------------- |
| `repository-base.ts`           | `withRepository()` wrapper, error mapping, `nowIso()` |
| `evidence-repository.ts`       | sources, snapshots, sourced facts, findings           |
| `inventory-repository.ts`      | site, blocks, floors, units, availability rollups     |
| `portal-repository.ts`         | portal listings, competing prices, staleness          |
| `hotel-repository.ts`          | hotel, rooms, review sources, quotes                  |
| `lead-repository.ts`           | leads, buyer pipeline                                 |
| `finance-repository.ts`        | ledger, payments, wallets, vendor invoices            |
| `operations-repository.ts`     | tickets, activities, workforce tasks                  |
| `document-repository.ts`       | documents, compliance checks                          |
| `communications-repository.ts` | threads, messages, notifications                      |
| `governance-repository.ts`     | profiles, roles, audit events                         |
| `dashboard-repository.ts`      | KPI snapshot aggregation                              |
| `search-repository.ts`         | global search over `operational_search_documents`     |

---

## Deliverables

### 1. `repository-base.ts`

```ts
export async function withRepository<T>(
  fn: (client: SupabaseClient) => Promise<T>,
  fallback: () => T,
  label: string,
): Promise<RepositoryResult<T>>;
```

Behaviour:

- Supabase unconfigured → `{ data: fallback(), source: "local-seed", fetchedAt }`
- Configured + succeeds → `{ data, source: "supabase", fetchedAt }`
- Configured + fails → **throw** a mapped `ApiError`. Log the real Postgres detail server-side;
  never let it reach the client.
- Configured + returns empty → that is `source: "supabase"` with empty data. **An empty result is
  not a failure and must not trigger the seed fallback** — silently substituting seed data for a
  legitimately empty table is how demos lie.

### 2. Seed data mirroring the real schema

Every `*-data.ts` returns objects structurally identical to the Supabase shape, so swapping
`source` changes nothing downstream. Seeds are **deterministic** — no `Math.random()`, no
`Date.now()`. A seeded dashboard must render identically on every run or Playwright snapshots
become useless.

Seed the confirmed figures: 7 blocks, 656 units, 188 hotel rooms, 23 sources, findings F-001…F-010.

### 3. `evidence-repository.ts` — the Azura-specific one

```ts
getSources(): Promise<RepositoryResult<SourceRef[]>>
getFinding(id: string): Promise<RepositoryResult<Finding | null>>
getFindings(filter?: { severity?; area?; resolved?: boolean }): Promise<RepositoryResult<Finding[]>>
getFactsForEntity(type: string, id: string): Promise<RepositoryResult<Record<string, SourcedFact<unknown>>>>
getEvidenceCoverage(): Promise<RepositoryResult<CoverageReport>>
getSourceHealth(): Promise<RepositoryResult<Array<{ source: SourceRef; lastStatus: string; lastOk: string | null }>>>
```

`getEvidenceCoverage()` powers the evidence cockpit: fact counts by confidence, source counts by
reachability, findings by severity. It is the honest self-assessment of the dataset, and it
should be uncomfortable reading when the data is thin — that is the point.

### 4. Role scoping — inside the repository, not above it

Every function taking a `role` applies its scope:

- `owner` → only units they own (via `unit_residents`)
- `tenant` → only their rented unit
- `service_provider` → only assigned tasks
- `child_*` → strict subset of the guardian
- `guest` → public data only

**This duplicates RLS deliberately.** RLS is the boundary that must hold; repository scoping is
defence in depth and the thing that works in local-seed mode where RLS does not exist.

---

## Edge cases

- **Empty ≠ error.** Covered above; it is the most common repository bug.
- **Partial failure** — 4 of 5 parallel queries succeed. Return what succeeded plus a
  `degradedReason` naming what did not. Do not fail the whole dashboard for one panel.
- **N+1**: 656 units each fetching its block is 657 queries. Join or batch.
- **Pagination**: never `select()` unbounded. Default limit 50, hard ceiling 500.
- **`noUncheckedIndexedAccess`**: `rows[0]` is `T | undefined`. Handle it; do not `!`.
- **Numeric from Postgres** arrives as a string via PostgREST. `numeric(14,2)` → `"112000.00"`.
  Parse explicitly. `Number("112000.00")` is fine; assuming it is already a number is not.
- **`null` vs `0`**: a price of `0` is a bug, `null` is an honest gap. Never `?? 0`.
- **Timezone**: `timestamptz` in, ISO UTC out. Format at the edge only.
- **Currency**: never aggregate across currencies. `sum(EUR) + sum(USD)` is meaningless — return
  per-currency totals and let the UI decide.
- **Concurrent update**: optimistic concurrency via a version column; a stale write returns
  `conflict` (409), never last-write-wins.
- **A `modelled` unit** must be filterable and countable separately from `portal_listing`
  everywhere. W3-C depends on this to keep them visually distinct.
- **Realtime + repository disagreement**: repository is the source of truth on reload; realtime
  is an optimisation. Never let a realtime event write state the repository would not return.

---

## Definition of done

```bash
pnpm --dir apps/web typecheck
pnpm --dir apps/web lint
node --test apps/web/lib/*.test.ts
```

Required tests, output pasted:

1. Every repository function returns a `source` field — enumerate them programmatically and
   assert, so a new function cannot be added without one
2. Unconfigured Supabase → `local-seed` for all of them
3. Configured + forced error → **throws** a mapped `ApiError`, does **not** fall back
4. Configured + empty table → `source: "supabase"`, empty data, **no seed substitution**
5. `owner` role cannot retrieve another owner's unit — in both Supabase and seed modes
6. `child_owner` retrieves a strict subset of `owner`
7. Seed determinism: two calls produce byte-identical JSON
8. `getEvidenceCoverage()` totals match the dataset's own counts

Test 3 and test 4 are the ones that catch real bugs. Write them first.

---

## Handoff must state

- The full function signature list, grouped by repository — W2-B and every W3-* window codes
  against this
- Which functions are Supabase-backed vs seed-only today
- Any place W1-A's schema did not fit what the surfaces need (a request for W1-A, not a
  unilateral migration)
- Measured seed-mode dashboard query count and timing
