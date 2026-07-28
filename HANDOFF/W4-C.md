# HANDOFF — W4-C Adversarial security review

STATUS: COMPLETE
Completed: 2026-07-28
Branch: `feature/INTERNAL-107-w4c-security` (from `main` @ `bb9bf87`, own git worktree `D:\azura-w4c`)

**Two Critical and five High findings are open. None of them is mine to fix** — this window writes
no application code. Every finding is routed to an owning window in §5, and the two Criticals need
a decision before this branch is useful to anyone.

Full detail: [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md). This file is the routing slip.

---

## 1. What was written

| File                                | What it is                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `SECURITY-REVIEW.md`                | 22 findings, coverage statement, residual risks                                 |
| `docs/security/threat-model.md`     | Assets, actors, trust boundaries, 20 falsifiable properties                     |
| `docs/security/module-checklist.md` | Ten rules for the next dashboard module, each with the finding that produced it |
| `scripts/security-probe.mjs`        | 27 checks; exit 1 on Critical/High, exit 2 when a gate could not run            |

No application file was modified. `git diff main --stat` touches four paths, all of them in the
list above.

---

## 2. The findings, by severity

| id      | Severity     | Title                                                                                              | Owner            |
| ------- | ------------ | -------------------------------------------------------------------------------------------------- | ---------------- |
| SEC-001 | **Critical** | The repository is public and `CLAUDE.md` §1 says it must not be                                    | repository owner |
| SEC-002 | **Critical** | `lib/auth.ts` selects two columns that do not exist; every authenticated user degrades to `tenant` | W1-B + W1-A      |
| SEC-003 | **High**     | The evidence cockpit is served to nine of eleven roles in the RSC payload                          | W3-C + W3-B      |
| SEC-004 | **High**     | Three identifiable hotel staff are named in the committed dataset                                  | W0-B             |
| SEC-005 | **High**     | `format="number"` silently rounds every fractional figure                                          | W1-D             |
| SEC-006 | **High**     | F-002 claims four publishers and carries three                                                     | W0-B             |
| SEC-007 | **High**     | F-002's headline `2.1x` is a division across two currencies                                        | W0-B             |
| SEC-008 | Medium       | A NUL byte hides a file from both secret scanners                                                  | W0-A             |
| SEC-009 | Medium       | The secret-scan patterns miss every key format this stack issues                                   | W0-A             |
| SEC-010 | Medium       | `lib/env.ts`'s server schema is published to the browser                                           | W2-D + W0-A      |
| SEC-011 | Medium       | `profiles.roles` is authority-bearing; the escalation trigger does not guard it                    | W1-A + W1-B      |
| SEC-012 | Medium       | The role picker may be enabled against a live data plane on a self-declared flag                   | W1-B             |
| SEC-013 | Medium       | A child with two active guardians resolves to a non-deterministic scope                            | W1-A             |
| SEC-014 | Medium       | Off Vercel the AI rate limit collapses to one global bucket                                        | W2-C             |
| SEC-015 | Low          | `routeForPath` resolves dot-segment paths onto a real route                                        | W3-B             |
| SEC-016 | Low          | The CI step named "Scan history" does not scan history                                             | W0-A             |
| SEC-017 | Low          | `server-only` is not installed and no module is guarded by it                                      | W0-A             |
| SEC-018 | Low          | A service-role client is resolved and never used                                                   | W2-C             |
| SEC-019 | Low          | `/kitchen-sink` ships in the production build, publicly reachable                                  | W1-D             |
| SEC-020 | Info         | Anonymous AI feedback returns `persisted: false`; no consumer yet                                  | W3-H             |
| SEC-021 | Info         | `AiResponse.source` distinguishes the fallback; no consumer yet                                    | W3-H             |
| SEC-022 | Info         | `forcedTheme="light"` makes W1-D's suite assert an unreachable state                               | W1-D             |

The user's prediction was right about where to look. **W1-A's `is_admin()` bug does have siblings,
and they are in the same two places:** the guardian relation (SEC-013 — two structural gaps) and the
privilege-escalation trigger (SEC-011 — it guards three columns and the application reads a fourth
that is authority-bearing). Both are static findings; see §4.

The service-role audit the user asked for came back **almost empty**, which is the good outcome:
exactly one call site outside `lib/supabase/server.ts`, in `lib/ai-observability.ts:145`, and it is
dead — resolved and never used. That is SEC-018 and it is a Low, not a hole.

---

## 3. Verification actually run

| What                                                      | Result                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `scripts/security-probe.mjs`, no server                   | 10 clean · 16 open (7 C/H) · 1 skipped · **exit 1**                                                     |
| `scripts/security-probe.mjs`, with `AZURA_PROBE_BASE_URL` | same, plus SEC-D02 executed · **exit 1**                                                                |
| `pnpm --dir apps/web build`                               | **exit 0**, all routes `ƒ (Dynamic)` — S-009 holds                                                      |
| Live HTTP against `127.0.0.1:3299`                        | 4 roles × the evidence route; 3 error-handling probes; 1 prompt-injection probe; 1 oversized-body probe |
| Client bundle scan                                        | 55 chunks, value-shaped patterns, **0 hits**                                                            |
| Secret scan of tracked content **and full history**       | 0 hits outside the scanners' own definitions                                                            |
| Pre-commit hook bypass                                    | **executed** in a scratch repository: normal file BLOCKED, NUL-containing file passes                   |
| RLS / pgTAP                                               | **NOT RUN — see §4**                                                                                    |

Probe checks that **passed** and are worth naming, because they are the parts a future window can
stop re-deriving: the production role-picker kill-switch (24 environment shapes), the boot guard,
cookie escalation, additive-role authority, unauthenticated dashboard access across all 11 roles,
permission backing for every allowed pair, gap-never-renders-as-0 across nine formats, and
seed-labelling on every repository-reading surface.

---

## 4. What was NOT tested, and why

**This is the most important section in this handoff.** Read it before quoting any result above.

1. **No SQL was executed. Not one statement.** No Docker daemon, no `psql`, no Supabase CLI on this
   machine — all three checked. `pnpm db:test` cannot run here. **Every RLS, policy, trigger and
   helper-function finding (SEC-011, SEC-013) is static analysis of the migration text**, and the
   runtime behaviour of all fifteen migrations is unverified by this review. W1-A's pgTAP suite is
   the right instrument and it needs a machine that can start Postgres. If one number from this
   review should be carried into wave 5, it is this one.
2. **No authenticated Supabase session existed at any point.** Every live test used the
   access-profile path with Supabase unconfigured. The `getUserProfile()` Supabase branch — the one
   SEC-002 says is broken — was never exercised end to end. SEC-002's consequence is derived from
   PostgREST's documented `42703` behaviour plus the resolver's own decision table, not observed.
3. **SEC-003 was proved under `next dev`, not `next start`.** The access-profile path is hard-`false`
   in a production build, so there is no way to obtain an authenticated non-admin session without a
   data plane. The mechanism is identical in both modes; the production run has not happened.
4. **`safeNextPath()`'s hostile corpus was not executed.** The module imports `next/navigation`
   transitively and will not load outside a request scope. The probe **skips** rather than
   approximates. It was reviewed by reading and looks correct; that is worth less.
5. **IDOR: untested, because there is no `[id]` route in the tree.** No `/dashboard/units/[id]`, no
   `GET /api/*/[id]`. Coverage absent because the code is. The first object-reference route lands
   with no precedent.
6. **No mutation surface beyond login and AI feedback exists**, so ledger immutability, audit
   tamper-resistance, last-admin protection, lost updates and idempotency replay are all untested.
   The tables exist in migrations 06–08 and 14; nothing in the application writes to them.
7. **Signed URLs, storage, exports: untested.** No Supabase Storage bucket exists.
8. **No service-worker cache enumeration**, no timing analysis, no `pnpm audit`.
9. **Competitor systems: deliberately untouched.** Nothing outside this repository and
   `127.0.0.1` was contacted, except one `gh repo view` against our own repository. No harvest was
   re-run. This is a scope boundary, not a gap.

---

## 5. Requests for other windows

Ordered by severity. Each is a request, not a patch — no application code was written here.

| #   | Owner                | Request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **repository owner** | **SEC-001.** `github.com/Wamocon/Azura-World` is PUBLIC; `CLAUDE.md` §1 says "do not push it to a public remote"; `azura-ui-ux` §7 says "this repository is public" and every media decision is built on that. Decide, then make the two documents agree. Not a security decision, and not one this window will make for you.                                                                                                                                                                                                  |
| 2   | **W1-B + W1-A**      | **SEC-002.** `lib/auth.ts:152` selects `roles` and `anonymized_at`; no migration creates either. Land **one** change, not two: W1-A adds the columns, or W1-B removes them from the select list. `normalizeRoleList` and the `anonymized_at` check already tolerate `undefined`, so removal is the smaller fix. Then surface `degradedReason` — it currently has zero consumers, so the fallback is invisible.                                                                                                                 |
| 3   | **W3-C**             | **SEC-003.** Assert `evidence:view` at the top of `app/[locale]/dashboard/evidence/page.tsx` and `forbidden()` before any repository read. Your 100-assertion Chromium review passed because it asserted on the rendered page; the content is in the flight payload beside it. `curl -H "Cookie: access_profile_role=tenant"` reproduces it in one line.                                                                                                                                                                       |
| 4   | **W3-B**             | **SEC-003, second half.** The shell makes a client-side guard look like enforcement, and six modules are queued behind your table contract. Consider a `requirePermission()` helper the module pages call — one line per route, and the probe's `SEC-D01` check will fail the build for any module that forgets. Also **SEC-015**: resolve dot segments in `normalizeDashboardPath`.                                                                                                                                           |
| 5   | **W0-B**             | **SEC-004.** `sanemsii`, `Tulane` and `Han` are in `azura-world-data.ts` and `hotel-data.ts`. Redact in `scripts/build-azura-dataset.py` and regenerate — the file's own header says _"fix the parser, never this file"_, which settles the argument W3-G raised about display-time filtering. Use a visible marker (`[Mitarbeitername]`), not a silent deletion. `Han` is a common word; review the ten recovered quotes by hand rather than writing a regex.                                                                 |
| 6   | **W0-B**             | **SEC-006 + SEC-007**, both on F-002, the finding this project calls its primary honesty gate. It claims four publishers and carries three (add Alanya-Home). Its `2.1x` is 239 171 USD ÷ 112 000 EUR — the conversion `CONVENTIONS` §5 forbids, `ai-retrieval.ts:643` instructs the model never to make, and W3-C built two axes to avoid. The EUR-only span is 2.77×. State it per currency or drop it.                                                                                                                      |
| 7   | **W1-D**             | **SEC-005.** `formatFactValue`'s `"number"` case calls `formatNumber(value, locale)` with no fraction digits, so `4.6 → "5"` and `0.4 → "0"`. `kilometres` and `stars` pass `1`; `number` passes nothing. Add a passthrough or a `score` format, then delete W3-G's `scoreAsDisplayFact()` workaround as they asked. Also **SEC-019** (`/kitchen-sink` is public in the production build) and **SEC-022** (the dark-mode suite asserts a state `forcedTheme` makes unreachable).                                               |
| 8   | **W0-A**             | **SEC-008 / SEC-009 / SEC-016 / SEC-017.** Four scanner and boundary items: write the NUL in `ai-rate-limit.ts` as `\x00` and fail on any tracked source file containing one; extend both pattern lists to `sb_secret_`, `sb_publishable_`, `sbp_`, `sk-ant-`, `ghp_`/`github_pat_`, `AKIA`; make the CI step named "Scan history" actually read history or rename it; install `server-only` and close the `TODO(W0-A)` at `lib/supabase/server.ts:27`.                                                                        |
| 9   | **W1-A**             | **SEC-011 + SEC-013.** Add `roles` and `anonymized_at` to `prevent_profile_privilege_escalation()`'s condition **now**, before either column exists — a guard written first cannot be forgotten later. Add `create unique index … on guardianships (child_profile_id) where status = 'active' and revoked_at is null`, which makes `current_user_guardian_id()`'s `limit 1` deterministic by construction, and a constraint tying the guardian's role to `guardian_role_for(child_role)`. Two negative pgTAP cases for each.   |
| 10  | **W1-B**             | **SEC-012.** `isProvablyIsolated()` requires no Supabase data plane; `accessProfilesEnabledForEnvironment()` does not, so below production the picker can open over a real project on `AZURA_DEMO_DATA_ISOLATED=true` alone. Either require the same predicate on both paths, or rename the flag to what it is.                                                                                                                                                                                                                |
| 11  | **W2-D**             | **SEC-010.** `hooks/use-live-snapshot.ts:36` imports `isSupabaseConfigured` from `@/lib/env` in a `"use client"` module, which put the whole server env schema into a public chunk. Pass the boolean as a prop, or move it to a module that holds nothing else.                                                                                                                                                                                                                                                                |
| 12  | **W2-C**             | **SEC-014 + SEC-018.** Make the trusted client-IP header configurable so a non-Vercel deployment does not fall back to one global bucket; and delete the dead `createServiceRoleClient()` at `ai-observability.ts:145` — let the window that adds `ai_request_traces` add it back deliberately. **Your open retention question is answered: do not persist anonymous transcripts.** A transcript keyed on an IP address is personal data whose only purpose is giving a thumbs-down somewhere to live, and that is not enough. |
| 13  | **W3-H**             | **SEC-020 + SEC-021.** Both APIs are already honest and both need you to render it. The feedback route answers `persisted: false` — a widget that says "Thanks, recorded!" converts a correct API into a fake write success. `AiResponse.source` distinguishes `"gateway"` from `"deterministic-fallback"` — an answer from the rules engine shown as an AI answer is an unconfigured integration presented as healthy.                                                                                                        |
| 14  | **W0-A or W4-D**     | Add `"qa:security": "node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs scripts/security-probe.mjs"` to `package.json`. It is your file; I did not edit it. `pnpm quality:gate` should call it.                                                                                                                                                                                                                                                                                                        |

---

## 6. SYSTEM-PROMPT §2, one by one

Seventeen non-negotiables, seventeen verdicts. `[STATIC]` means the verdict is from reading, not
running.

### Data integrity

| #   | Rule                                                                   | Verdict                                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Every fact carries its source URL; do not cast around `SourcedFact<T>` | **HOLDS.** No cast around the type was found. W3-A, W3-C and W3-G each report zero bare numeric literals in their own surfaces, and the components enforce it structurally — `PlatformGroup` carries `scale` beside `score` so a bare score cannot reach JSX.                                                                                                    |
| 2   | Never silently resolve a conflict                                      | **HOLDS.** F-002's `resolvedTo` is `null`, `qa:evidence` fails the build if anyone sets it, losing values are retained on every conflicted fact, and `conflictRange()` returns `null` across currencies rather than imply a conversion.                                                                                                                          |
| 3   | Never invent a number                                                  | **VIOLATED — SEC-007.** F-002's `2.1x` appears in no fetched source; it is a USD ÷ EUR division performed at an implied rate of 1.0. That is a figure not in a source, presented as the finding's headline. **SEC-005 is the same rule running the other way**: a formatter silently altering `4.6` to `5` and `0.4` to `0` publishes a number no source states. |
| 4   | Generated files carry a generator header and are never hand-edited     | **HOLDS.** `azura-world-data.ts` opens with `GENERATED FILE — do not hand-edit`, names `scripts/build-azura-dataset.py`, its inputs, and the regenerate command. This is what makes SEC-004's fix a parser change rather than an edit.                                                                                                                           |

### Security

| #   | Rule                                                                       | Verdict                                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | RLS on every table in the same migration that creates it                   | **HOLDS** `[STATIC]`. Checked programmatically across all 15 migrations: every `create table public.*` is matched by `alter table public.* enable row level security` in the same file. Zero exceptions. The _content_ of the policies is unverified (§4.1).                                                                                                               |
| 6   | `lib/rbac.ts` and the SQL role helpers change together                     | **HOLDS.** `contracts.ts`'s `roles` and the `public.app_role` enum are byte-identical **including declaration order**, all eleven, verified programmatically.                                                                                                                                                                                                              |
| 7   | The service-role key never reaches the browser bundle                      | **HOLDS.** 55 client chunks scanned for value-shaped secrets: zero. `createServiceRoleClient` and `service_role` appear in no chunk. The **related** boundary is weaker — SEC-010 put `lib/env.ts` in a chunk — but no key value crossed.                                                                                                                                  |
| 8   | RBAC decision before the model call                                        | **HOLDS.** `app/api/ai/chat/route.ts` resolves `getUserProfile()` and returns `unauthorized` before `runConcierge()`. Confirmed live: a hostile public request produced `source: "deterministic-fallback"`, so no outbound call was made.                                                                                                                                  |
| 9   | The AI system prompt forbids executing financial/access/permission changes | **HOLDS.** Present verbatim in all four locales in `lib/ai-prompt.ts` — _"only recommend and state when human approval is required"_ — plus the base rule at line 244. Wording not weakened.                                                                                                                                                                               |
| 10  | No secrets in code                                                         | **HOLDS.** Only `.env.example` is tracked. A pattern sweep over all tracked content **and the full history** returns matches only inside the scanners' own definitions. The _guard_ around this rule is weak — SEC-008, SEC-009 — but the rule itself is not broken today.                                                                                                 |
| 11  | Validate every API input; typed errors, never an unhandled exception       | **HOLDS.** Verified live on four hostile requests: wrong content-type, `{"message":{"$ne":null}}`, a 200 KB body, and a prompt-injection payload. All four returned a typed `ApiError` with a `requestId`. No stack frame, no PostgreSQL code, no table name, no upstream text in any response body observed.                                                              |
| 12  | Access profiles triple-gated and impossible in a production build          | **HOLDS at the stated boundary, WEAK one layer down.** 24 environment shapes × the boot guard: production can never enable the picker, and a misconfigured production process refuses to start. Below production, `AZURA_DEMO_DATA_ISOLATED` asserts an isolation that layer 1 does not check — SEC-012. The rule as written says "production build path", and that holds. |

### Correctness

| #   | Rule                                                         | Verdict                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13  | TypeScript strict, no `any` without a one-line justification | **HOLDS, with one exception.** One occurrence in the tree: `lib/repository-base.test.ts:35`, `{} as any as RepositoryClient`, with no justifying comment. A test fixture, not application code. Worth a comment.                                                                                                                 |
| 14  | Server Components by default                                 | **HOLDS.** 49 `"use client"` modules across `app/`, `components/` and `hooks/`, each for state, effects or a browser API. Note the corollary this review found the hard way: _because_ Server Components are the default, everything they render crosses to the browser in the flight payload — which is exactly SEC-003.        |
| 15  | Every repository function returns `source`                   | **HOLDS.** All twelve repository modules distinguish `"supabase"` from `"local-seed"`, and every one documents that an empty result from a configured Supabase stays `"supabase"` rather than falling back to seed. Both surfaces that read a repository render the discriminator; probe `SEC-H06` enforces it for the next one. |
| 16  | Posted ledger entries immutable, by trigger not convention   | **HOLDS** `[STATIC]`. `prevent_posted_ledger_mutation` fires `before update or delete on public.finance_ledger_entries`, plus `assert_ledger_group_balanced` on the double-entry invariant. **Never executed** — §4.1. Nothing in the application writes to this table yet, so the trigger has never fired in anger.             |
| 17  | Platform-portable date arithmetic; no shell date math        | **HOLDS.** No `date -d`, no `date +%s`, no `$(date …)` in any script or migration.                                                                                                                                                                                                                                               |

**Two violations, both of §2.3, both in the honesty class.** Nothing violates §2.5, §2.6, §2.7,
§2.8, §2.9, §2.10, §2.16 or §2.17 — though four of those verdicts are static and one is untested by
execution.

---

## 7. Known gaps in this review

- `[GAP]` The probe cannot execute SQL. **Not one of its 27 checks reasons about Postgres** — they
  reason about TypeScript, built output, files and HTTP responses. A pgTAP equivalent for the two
  SQL findings does not exist and should be written by W1-A, who owns the suite.
- `[GAP]` `SEC-R01` (open redirect) skips rather than runs. The probe exits 2 when only skips
  remain, so this cannot be mistaken for a pass — but it is a hole in the gate, not just in the
  review.
- `[GAP]` The probe's live half (`SEC-D02`) needs `AZURA_PROBE_BASE_URL` and a server with access
  profiles enabled. In CI, where no such server exists, it skips. W4-D should decide whether
  `quality:gate` stands up a server for it or accepts the static check alone.
- `[GAP]` **The honesty checks are heuristics over source text**, not semantic analysis. `SEC-H03`
  was narrowed after its first version reported F-006, whose "corroborated by three hosts" is about
  a different field. It now matches only `across N publishers`. A finding phrased differently will
  slip past it. Every honesty finding in `SECURITY-REVIEW.md` was confirmed by reading the record,
  not by trusting the pattern.
- `[I]` Severity is my judgement. SEC-001 as Critical is a judgement that a stated project
  constraint being violated outranks its technical impact, and SEC-005 as High is a judgement that a
  demonstrated-then-worked-around defect counts as live. Both are arguable; both are argued in
  `SECURITY-REVIEW.md`.

---

## 8. Is this branch safe to merge?

**Yes — it adds four files and changes no behaviour.** `git diff main --stat` is
`SECURITY-REVIEW.md`, `docs/security/threat-model.md`, `docs/security/module-checklist.md`,
`scripts/security-probe.mjs`.

Merging it makes `pnpm` (once W4-D wires §5.14) fail on seven findings, which is the point. The
probe is written against the **desired** state, so each check flips to PASS on its own the day its
finding is fixed — there is no expected-failure list to fall out of date, and no edit to the probe
is needed to close a finding.

**What must not happen:** nobody should suppress a check to make the gate green. A failing probe
that names its owner is information; a suppressed one is the same lie as a stubbed script, and
`CLAUDE.md` §5 already says so about a different file.
