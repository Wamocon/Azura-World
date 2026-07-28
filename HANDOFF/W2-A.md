# HANDOFF — W2-A  Repository layer

STATUS: COMPLETE
Completed: 2026-07-27
Window: 1 (chain W1-A → W2-A) · Branch: `feature/INTERNAL-107-w1a-w2a-data`

Read `HANDOFF/W1-A.md` for the schema this layer is written against. Column names here
were verified against the live database, not guessed.

---

## What was built

- **`apps/web/lib/repository-base.ts`** — `withRepository()`, error mapping, coercion,
  pagination clamps, `degraded()`. Every repository goes through it; nothing calls Supabase
  directly.
- **13 repository modules** — 60 read functions across 12 import surfaces.
- **11 `*-data.ts` seed modules** — 53 zero-argument builders, all byte-stable.
- **2 test files** — `repository-base.test.ts` (14) and `repository-contract.test.ts` (10).
  **24 assertions, all executed, all passing.** All eight tests the brief requires are covered.

---

## Verification actually run

| Command | Result | Evidence |
|---|---|---|
| `pnpm --dir apps/web typecheck` | **PASS** | exit 0, whole tree |
| `pnpm --dir apps/web lint` | **PASS** | exit 0, whole tree, 0 errors 0 warnings |
| `pnpm --dir apps/web build` | **PASS** | exit 0, `next build --webpack` |
| `node --test` — both suites | **PASS** | 24 pass, 0 fail |
| pgTAP, 7 files (from W1-A) | **PASS** | 366 pass, 0 fail |

### The eight required tests, and where each lives

| # | Requirement | Where | Result |
|---|---|---|---|
| 1 | Every function returns `source` — **enumerated programmatically** | `repository-contract.test.ts` | 60 reads across 12 modules, all conform |
| 2 | Unconfigured → `local-seed` for all of them | `repository-contract.test.ts` | all 60, each with a `degradedReason` |
| 3 | Configured + forced error → **throws** a mapped `ApiError`, does not fall back | `repository-base.test.ts` | throws `RepositoryError`; fallback provably not invoked |
| 4 | Configured + empty → `source: "supabase"`, empty data, **no seed substitution** | `repository-base.test.ts` | fallback provably not invoked |
| 5 | `owner` cannot retrieve another owner's unit | seed mode: `repository-contract.test.ts` · Supabase mode: `04-rls-negative.sql` | both pass |
| 6 | `child_owner` retrieves a strict subset of `owner` | seed mode: `repository-contract.test.ts` · Supabase mode: `04-rls-negative.sql` | both pass |
| 7 | Seed determinism — two calls, byte-identical JSON | `repository-contract.test.ts` | 53 builders verified |
| 8 | `getEvidenceCoverage()` totals match the dataset's own counts | `repository-contract.test.ts` | totals and every breakdown reconcile |

Tests 3 and 4 were written first, as the brief instructs.

### NOT RUN

| Command | Status | Reason |
|---|---|---|
| `node --test apps/web/lib/*.test.ts` — **the brief's exact command** | **NOT RUN as written** | It fails before running a test. Node cannot resolve the `@/` alias or an extensionless `.ts` import, and no TypeScript runner (`tsx`, `ts-node`, `esbuild`) is installed. Installing one means `pnpm install`, which is W0-A's and forbidden concurrently. The suites were run through a scratchpad resolution hook instead — same files, same assertions, real results. **See "Requests" for the one-line fix.** |

---

## Two bugs the tests caught

**1. A guest could reach an owner's private unit — in seed mode only.**
`inventory-data.ts` marked a unit public iff `data_quality = 'portal_listing'`, but
`supabase/seed.sql` *additionally* withholds the three units assigned to seeded residents.
The same unit was therefore public in seed mode and private in Supabase, so switching
`source` changed what a guest could see. That is exactly the divergence the brief forbids
when it requires seed objects "structurally identical to the Supabase shape, so swapping
`source` changes nothing downstream". Fixed by mirroring the withholding; the constant lives
in one place so the two cannot drift again.

**2. `toApiError()` did not map SQLSTATE `22023`.** `search_operational_records()` raises it
for a query over its 120-character ceiling. It fell through to `persistence_unavailable`
(503, `retryable: true`) — telling the caller the service was broken and the request worth
retrying, when in fact the input was too long and would fail forever. Now
`validation_failed` (422, not retryable).

---

## The function list — W2-B and every W3-* window codes against this

```
repository-base.ts     withRepository · runRepository · RepositoryError · toApiError · unwrap
                       nowIso · seedIso · SEED_ANCHOR_ISO · clampLimit · clampOffset
                       asRecord · asString · asNullableString · asBoolean · asNumber
                       asNullableNumber · asMoney · relatedRecord · totalsByCurrency
                       degraded · seedResult

evidence-repository    getSources · getSourceHealth · getFindings · getFinding
                       getFactsForEntity · getEvidenceCoverage · searchOperationalRecords
search-repository      searchOperationalRecords · SearchHit   (named surface; implementation
                       lives in evidence-repository because both read the same source index)
inventory-repository   getSite · getBlocks · getFloors · getUnits · getUnit
                       getAvailabilityRollup · getUnitsForResident
portal-repository      getPortalListings · getCompetingPricesForUnit · getStaleListings
                       getPriceSpread
hotel-repository       getHotel · getHotelRooms · getReviewSources · getReviewQuotes
                       getReviewSummary
lead-repository        getLeads · getLead · getBuyerPipeline · getPipelineSummary
finance-repository     getLedgerEntries · getLedgerEntry · getFinanceSummary · getWallets
                       getWalletForProfile · getVendorInvoices · getVendorInvoice
                       getPaymentTransactions · reverseLedgerEntry · settleVendorInvoice
operations-repository  getTickets · getTicket · getTicketEvents · getActivities
                       getWorkforceTasks · getMediaReports · getOperationsSummary
                       appendTicketEvent · updateTicketStatus
document-repository    getDocuments · getDocument · getSignedDocumentUrl
                       getDocumentsForUnit · getComplianceDocuments
communications-repo    getThreads · getThread · getMessages · getNotifications
                       getUnreadNotificationCount
governance-repository  getProfiles · getProfile · getGuardianships · getAuditEvents
                       getAccessEvents · getComplianceChecks
dashboard-repository   getDashboardSnapshot
```

**Every read is Supabase-backed with a seed fallback.** None is seed-only. The three
mutations (`reverseLedgerEntry`, `settleVendorInvoice`, `updateTicketStatus`,
`appendTicketEvent`) are Supabase-only and **currently fail with `forbidden`** — see below.

### Call conventions

- Reads take a single options object with defaults, e.g. `getUnits({ role, profileId, limit })`.
- **Pass `role` and `profileId`.** Both repositories fail CLOSED when `role` is absent —
  an omitted role is treated as anon/guest, not as an administrator.
- Limits are clamped to `[1, 500]`, default 50. Nothing calls a bare `select()`.
- `numeric` arrives from PostgREST as a **string**. Money is `Money | null`, never `?? 0`.
- Currency totals are always **per currency**: `Record<string, number>`, never one number.

---

## Measured seed-mode performance

Mean of 20 calls, Node 22.14, seed mode, after one warm-up:

| Call | Time | Queries |
|---|---|---|
| `getDashboardSnapshot({ role: "manager" })` | **0.04 ms** | 0 (seed) |
| `getUnits({ limit: 500 })` | 3.43 ms | 0 (seed) |
| `getAvailabilityRollup()` | 2.31 ms | 0 (seed) |
| `getEvidenceCoverage()` | 0.14 ms | 0 (seed) |

Supabase-mode query counts, by construction rather than measurement `[I]`:
`getEvidenceCoverage()` is a constant **11** queries — the 1,354-row fact table is counted
server-side with `head: true`, never paged into memory. `getFindings()` is **3** regardless
of finding count. `getUnits()` is **1**, using a PostgREST embedded join for the block, so
the 656-unit N+1 the brief warns about cannot occur. `getDashboardSnapshot()` fans out with
`Promise.allSettled`, so one failing panel degrades that panel and not the dashboard.

---

## Requests for other windows

| File | Owning task | What is needed |
|---|---|---|
| `apps/web/tsconfig.json` | **W0-A** | Add `"allowImportingTsExtensions": true`. `noEmit` is already on, so it is safe. Without it there is no way to write a `.test.ts` that both `tsc` accepts and `node --test` can load, and the brief's own command `node --test apps/web/lib/*.test.ts` cannot run. One line. |
| `apps/web/package.json` | **W0-A** | A `"test:unit"` script wiring the two suites, once the above lands. |
| `apps/web/lib/rbac.ts` | **W1-B** | `staff` holds no `leads:*` or `buyer_pipeline:*` permission, but migration 14's RLS originally admitted staff. I **tightened the SQL to manager (70)** so RLS is not looser than RBAC. If sales agents are meant to be `staff`, add `leads:view` there and tell me to relax the policy — changing only one side re-opens the gap. Same question for `compliance:view`. |
| `supabase/migrations/*` | **W1-A (me)** | Recorded rather than silently done: `getPipelineSummary`, `getFinanceSummary` and `getOperationsSummary` aggregate in TypeScript over one 500-row page because PostgREST cannot `GROUP BY`. They set `truncated` + a `degradedReason` when the exact count exceeds the page. An exact aggregate at volume needs a SQL view or RPC. Not built tonight. |
| `docs/api/openapi.yaml` | **W2-B** | Finance and ticket **mutations are revoked for `authenticated`** by migrations 07 and 06 — the tables expect service-role RPCs that do not exist yet. `reverseLedgerEntry()`, `settleVendorInvoice()` and `updateTicketStatus()` are written and typed but will return `forbidden` (42501) until those RPCs land. They were deliberately **not** given a service-role client: that would bypass RLS from a request path. |
| `apps/web/lib/database.types.ts` | **unowned** | Does not exist, so the Supabase client is untyped and every row is mapped from `unknown`. Safe, but `supabase gen types` needs an owner. Blocked tonight by Docker (see W1-A). |

---

## Known gaps

- **`[GAP]` Five tables are seeded EMPTY in both modes**: `service_tickets`, `finance_ledger_entries`,
  `audit_events`, `access_events`, `compliance_checks`. Synthetic fixtures for them were drafted
  and then deliberately removed — one included a fabricated price change against a real harvested
  figure, which would have looked researched and contradicted the database the moment Supabase is
  configured. The row TYPES are exported as the contract to build against; **the fixtures belong in
  `supabase/seed.sql`**. W3-D/E/F have no demo data on those surfaces today.
- **`[GAP]` `getDashboardSnapshot()` does not scope inventory per owner.** It reports the
  restriction in `restrictedPanels` rather than guessing the `unit_residents` join. `owner`/`tenant`
  get the public showcase there; per-unit inventory is `getUnitsForResident()`.

- **`[GAP]` `updateTicketStatus()` is two statements, not one transaction** (UPDATE, then a
  `ticket_events` insert). A crash between them leaves a moved ticket with no history row.
  The fix is a SQL-side RPC; it is not papered over in code.
- **`[GAP]` Summary functions under-count beyond 500 rows in scope.** They say so via
  `truncated` and `degradedReason` rather than reporting a confident wrong number.
- **`[GAP]` `getSignedDocumentUrl()` is untested against real storage.** The buckets
  `azura-documents` and `azura-evidence` do not exist yet (W0-A's `setup-supabase.mjs` has
  only been dry-run). In seed mode it returns `null` with a reason rather than a fake link.
- **`[I]` `getMessages()` drops `is_internal_note` for callers below staff, and when no role
  is given.** RLS does *not* filter that column — migration 09 documents the gap — so this is
  the only thing standing between a resident and staff-only annotations. Do not add an
  override.
- **`[I]` Repository role scoping duplicates RLS deliberately.** RLS is the boundary that
  must hold; this is defence in depth and the only boundary that exists in seed mode, where
  RLS does not run at all.
- **`[GAP]` No route handler consumes any of this yet.** W2-B is the first caller; the
  signatures above are the contract.
