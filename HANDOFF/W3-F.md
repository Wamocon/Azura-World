# HANDOFF — W3-F Documents, compliance, reports, users, admin, settings

STATUS: COMPLETE
Completed: 2026-07-28 · Window: N4 · Branch: `feature/INTERNAL-107-n4-governance`
Worktree: `D:\azura-n4`

> **W4-C: §3 is the attack surface, §9 is what I did not test.** Both are written
> for you rather than for a reader who wants to be reassured.

---

## 1. What exists now

Six routable modules, all guarded server-side before any repository call.

| Route                    | Permission        | Holders                              |
| ------------------------ | ----------------- | ------------------------------------ |
| `/dashboard/users`       | `users:view`      | admin, manager                       |
| `/dashboard/admin`       | `settings:manage` | **admin only**                       |
| `/dashboard/documents`   | `documents:view`  | admin, manager, accountant, staff, owner, tenant, service_provider |
| `/dashboard/compliance`  | `compliance:view` | admin, manager, accountant           |
| `/dashboard/reports`     | `reports:view`    | admin, manager, accountant, staff, owner, tenant, child_owner, child_tenant |
| `/dashboard/settings`    | `settings:view`   | admin, manager                       |

Plus `GET /[locale]/dashboard/reports/export?report=…&format=csv`.

Files written (31 in the commit):

```
apps/web/app/[locale]/dashboard/users/{page.tsx,actions.ts,role-policy.ts}
apps/web/app/[locale]/dashboard/admin/{page.tsx,actions.ts,integrations.ts}
apps/web/app/[locale]/dashboard/documents/{page.tsx,actions.ts}
apps/web/app/[locale]/dashboard/compliance/{page.tsx,compliance-model.ts}
apps/web/app/[locale]/dashboard/reports/{page.tsx,export/route.ts}
apps/web/app/[locale]/dashboard/settings/{page.tsx,actions.ts}
apps/web/components/governance/*.tsx          (8 files)
apps/web/lib/{document-storage,report-artifacts,governance-audit}.ts
apps/web/lib/dashboard-routing.ts             (5 `pending: true` flags removed)
apps/web/messages/{de,en,tr,ru}.json          (six sub-namespaces, +310 keys each)
scripts/governance-probe.mts
```

---

## 2. Two files outside the ownership matrix, and why

Both are **new files no other window claims**. Same situation and same reasoning
as W1-B's `lib/auth-resolution.ts`, which is also absent from ORCHESTRATION §4.

- **`apps/web/lib/governance-audit.ts`** — the write side of `audit_events`.
  W2-A's `governance-repository.ts` is read-only and its header says so:
  _"No write helper is exported here, so nothing can reach for the wrong client
  by accident."_ Adding a writer to that file would destroy that property, so the
  writer is a separate module whose name makes an import of it visible in review.
- **`scripts/governance-probe.mts`** — the per-window probe convention already in
  use (`rbac-probe.mts` W1-B, `dashboard-probe.mts` W3-B, `security-probe.mjs`
  W4-C, `realtime-probe.mts` W2-D). New filename, no collision.

`apps/web/lib/dashboard-routing.ts` **is** W3-B's file. The only change is
deleting five `pending: true` lines, which W3-B's module contract delegates
explicitly: _"When your module lands, delete that one flag. That is the whole
registration."_ Nothing else in that file was touched, and `pnpm qa:dashboard`
still reports **647 pass · 0 fail**.

---

## 3. What W4-C should aim at

### 3.1 The canonical bucket and the signed-URL TTL

- Bucket: **`azura-documents`**, declared once as `DOCUMENT_BUCKET` in
  `lib/document-storage.ts` and imported everywhere else. `azura-evidence` is the
  other CHECK-permitted value and belongs to the harvest, not to user uploads.
- TTL: **60 seconds** (`DEFAULT_SIGNED_URL_TTL_SECONDS`, W2-A's), clamped to
  [15, 300]. Minted only by `getSignedDocumentUrl()`; nothing here calls
  `getPublicUrl()` or builds a storage path into a URL.
- The re-request path for an expired URL is `requestSignedUrl` in
  `documents/actions.ts`. The URL is returned to the caller and is never logged,
  persisted, cached, or put in an audit payload. The **request** is audited.

### 3.2 How self-elevation and last-admin protection are enforced

Server-side, in a **pure** module — `app/[locale]/dashboard/users/role-policy.ts`
— with no I/O, no `next/headers` and no `"use server"`, precisely so the probe
executes the rules rather than reading them.

`decideRoleChange` evaluates in this order, and the order is the security
property:

1. authentication → 401
2. `hasPermission(actor.role, "users:manage")` → 403 (`not_permitted`)
3. **separation of duties** → 403 (`self_elevation` / `self_role_change`)
4. shape (unknown role → 422, unknown subject role → 409, no-op → `no_change`)
5. **last-admin** → 409 (`last_admin`) or 503 (`census_unavailable`)

Authorisation precedes shape so a caller who may not assign roles cannot map the
role enum by watching which values produce which complaint. Separation of duties
precedes the census so a non-admin cannot discover how many administrators exist.

**Stricter than the brief, deliberately.** The brief forbids self-*elevation*;
this forbids every self role change including a demotion, because a
self-demotion by the only administrator reaches the unrecoverable state through
a different door, and "you may lower your own role but not raise it" is a rule
whose edge a reviewer has to re-derive every time.

**The census is `otherActiveAdmins`** — excluding the subject (counting them
makes every demotion look safe) and counting only `is_active` rows (a
deactivated admin cannot sign in, so it is not a recovery path). A directory
that could not be read is `countable: false` and **refuses**, rather than being
treated as an empty one. In local-seed mode the census is deliberately
uncountable: the seed's eleven profiles describe a fixture, not the deployment.

Three further layers, none of them in the application:

- `profiles_admin_write` requires `is_admin()`, and the update runs on the
  **caller's** session client, so Postgres re-decides it.
- `prevent_profile_privilege_escalation()` raises `42501` if `role`,
  `company_id` or `is_active` change without `is_admin()`.
- Deletion is refused outright (405). `audit_events.actor_profile_id` is
  `on delete restrict`, so an account that has acted cannot be hard-deleted.

### 3.3 Which integrations are actually wired

**Be suspicious of this panel and then check it.** The four states are
`not_configured`, `configured_unverified`, `reachable`, `unreachable`, and
`integrationStatuses()` **can never return `reachable`** — it is synchronous and
I/O-free by construction. `reachable` is reachable only through
`checkIntegration`, a user-pressed action with a 4 s timeout that stamps its
observation with a time.

| provider     | wired | read from                   | truth today                                        |
| ------------ | ----- | --------------------------- | -------------------------------------------------- |
| `supabase`   | yes   | `NEXT_PUBLIC_SUPABASE_URL`  | not configured in this build                       |
| `storage`    | yes   | `NEXT_PUBLIC_SUPABASE_URL`  | **no bucket exists** — W0-A ran `--dry-run` only   |
| `aiGateway`  | yes   | `AI_GATEWAY_API_KEY`        | not configured                                     |
| `jira`       | **no**| `JIRA_API_TOKEN`            | declared in `lib/env.ts`, called by a script only  |

`storage` is listed separately from `supabase` on purpose: a configured project
with no bucket created is exactly the state this deployment is in, and folding
the two together would hide that from the person reading the panel to find out
why an upload returned 503. `wired: false` on `jira` is the honest label for a
provider-capable contract that no application code path calls.

Only variable **names** are rendered, never values. SEC-010 is a Medium against
publishing the server-variable inventory to the browser; the names here are the
minimum needed to make the panel actionable, and the probe asserts the rendered
string matches `^[A-Z0-9_]+$`.

### 3.4 The audit event schema and its append-only guarantee

Written only by `writeAuditEvent()` in `lib/governance-audit.ts`, through
`createServiceRoleClient()`, **after** the RBAC decision. `authenticated` holds
no INSERT grant on `audit_events` by design — a session that can write the ledger
can forge the record of its own actions.

```
action            users.role_change.refused.last_admin   (dotted, filterable)
entity_table      profiles | documents | integrations
entity_id         TEXT — a uuid or a business code, or null
actor_profile_id  the caller
company_id        nullable
before_data       CHANGED COLUMNS ONLY, bounded to 32 keys / 4000 chars
after_data        same
request_id        nullable
```

There is deliberately **no** `ip_address` / `user_agent` field on the input type,
though the columns exist. CONVENTIONS §4 forbids logging PII, and a
request-scoped address recorded against a named person on every settings save is
the same retention question W4-C answered "do not persist" for anonymous AI
transcripts. A window with a reason adds them deliberately.

Append-only is enforced **three deep, and none of it is in this code**:

1. `revoke insert, update, delete, truncate … from authenticated` (migration 08)
   and again from `anon` (migration 13);
2. `reject_append_only_mutation()`, a `BEFORE UPDATE OR DELETE` trigger raising
   `42501` unless the session GUC `app.allow_append_only_mutation` is `'on'`;
3. this module exports no update and no delete, and the audit browser renders no
   row action — **absent controls, not disabled ones**.

**Refusals are audited too.** A trail recording only successful changes cannot
show you somebody spending an afternoon trying to promote themselves, which is
the most interesting thing an audit trail could say about this module.
`users.role_change.refused.self_elevation` is a real action name and the browser
gives refusal rows the amber conflict treatment.

**An audit write that fails is never folded into success.** `AuditOutcome` has
`recorded` / `unavailable` / `failed`, and a change that landed without its log
entry surfaces as `incomplete`, with both halves in one sentence and a retry.
Same for uploads: `stored_unaudited` carries the storage path so the object can
be reconciled, and the row stays `pending_review` so nothing downstream treats it
as usable.

---

## 4. `not_evidenced` is derived, not stored — and that is the stronger design

`compliance_checks.status` is CHECK-constrained to exactly five values —
`pending`, `in_review`, `passed`, `failed`, `waived`. **There is no
`not_evidenced` among them**, the migration is W1-A's, and `CONTRACTS.md` is
frozen. So rather than amend either (SYSTEM-PROMPT §6), the state is computed at
read time from the evidence itself, in `compliance/compliance-model.ts`.

That turned out better than a column:

- **A stored flag can be set. This cannot.** A row claiming `passed` with
  `evidence_document_id IS NULL` renders as `not_evidenced` no matter who wrote
  it or why, because the derivation has one input and it is the evidence.
- It stays correct as evidence changes — a permit expiring tomorrow moves from
  `proven` to `evidence_expired` with no write anywhere.
- It cannot drift from the database, because it is not in the database.

Evidence must be three things: **attached, approved, and unexpired**. Each
failure is a separate state with a separate remedy:

| state                 | means                                        |
| --------------------- | -------------------------------------------- |
| `proven`              | passed, evidence approved and in date        |
| `not_evidenced`       | claims passed or waived, nothing attached    |
| `evidence_unreviewed` | attached, nobody approved it                 |
| `evidence_expired`    | attached and approved, past its expiry       |
| `failed`              | recorded as failed                           |
| `open`                | pending or in review, no claim made yet      |

`open` is deliberately not a failure: a check nobody has looked at is honest
about being unfinished. The dishonest state is the one claiming a pass it cannot
support.

The cockpit headline is **two numbers, not one** — how many checks are provable,
and how many claim a pass that cannot be demonstrated. A single compliance score
would average those together, and the averaging is the dishonesty; it is the same
objection this product raises to F-002's `2.1x` (SEC-007). `provableShare()`
returns `null` rather than `0` for an empty set: "0% compliant" is a much worse
string to render than "no checks recorded".

A check whose evidence document the **caller** may not read resolves to
`not_evidenced` for them, because from where they stand it genuinely is.

---

## 5. Uploads: the filename is a claim, the bytes are the fact

Order in `validateUpload()` (pure, probe-executed):

1. size ceiling on the **real byte length** (25 MB), before anything else;
2. sniff the leading 512 bytes;
3. **refuse markup outright**, whatever it claims to be;
4. refuse content that disagrees with the claim;
5. only then look at the name, and only to derive a storage key.

Step 3 is separate from step 4 on purpose: a `.html` uploaded honestly as
`text/html` would pass step 4, and it is still the file we least want in a bucket
whose contents come back through signed URLs. HTML served from our own storage
origin is a stored-XSS primitive, so it is refused for being HTML, not for lying.
The sniffer skips a BOM and leading whitespace and is case-insensitive: a sniffer
defeated by two spaces is decoration.

**Path traversal is handled by taking the basename**, not by stripping `../` — a
blocklist that removes `../` turns `....//` into `../`, which is exactly how that
filter fails. The name is split on both separators, the last non-empty segment
kept, every character outside `[A-Za-z0-9._-]` replaced, Turkish letters
transliterated explicitly (not via `toLowerCase()`, whose behaviour on `İ`/`I` is
locale-dependent), control characters removed, leading dots stripped, Windows
device names replaced. **The extension comes from the sniffed type, never the
claim**, and the key carries a `randomUUID` so two uploads of `rechnung.pdf`
cannot collide against `unique (storage_bucket, storage_path)`.

The original filename is kept as display metadata only, and both are rendered.

**A zip bomb is refused on its compressed size**, which is sufficient here
because nothing on this path ever decompresses the bytes: they are stored opaque
and handed back through a signed URL.

`.env`-less builds: `storeDocument` returns `unavailable` with `httpStatus: 503`,
the action passes it through, and the form renders the literal **503**. The
documents page states the storage situation **above** the form rather than after
a wasted upload.

---

## 6. Verification actually run

| Command                                            | Result                        |
| -------------------------------------------------- | ----------------------------- |
| `pnpm --dir apps/web typecheck`                    | **PASS** exit 0, no output    |
| `pnpm --dir apps/web lint`                         | **PASS** exit 0, 0 warnings   |
| `pnpm --dir apps/web build`                        | **PASS** exit 0               |
| `node … scripts/governance-probe.mts`              | **PASS** — 216 pass · 0 fail  |
| `node … scripts/dashboard-probe.mts` (W3-B's)      | **PASS** — 647 pass · 0 fail  |
| `node scripts/check-i18n.mjs`                      | **PASS** — 0 errors, 6 warnings, identical key sets |
| `node scripts/csp-probe.mjs --port 3241`           | **PASS** — 30 pass · 0 fail   |
| `node scripts/check-plain-language.mjs`            | **FAIL 116 — unchanged from `main`** (see below) |
| live HTTP check, 11 roles × 6 routes + the export  | **PASS** — 155 pass · 0 fail  |

**The plain-language gate fails identically on `main` and on this branch: 116
findings before, 116 after.** Filtering `--list` to my paths and namespaces
returns **zero**. This branch adds none and fixes none; the 116 are pre-existing
and belong to other windows.

### Build — all seven routes are Dynamic

```
├ ƒ /[locale]/dashboard/admin
├ ƒ /[locale]/dashboard/compliance
├ ƒ /[locale]/dashboard/documents
├ ƒ /[locale]/dashboard/reports
├ ƒ /[locale]/dashboard/reports/export
├ ƒ /[locale]/dashboard/settings
├ ƒ /[locale]/dashboard/users
```

No `export const dynamic` anywhere. The S-009 class of CSP failure needs a
prerendered document; none of these is one.

### `pnpm qa:csp`

```
30 pass · 0 fail
```

Production build + `next start` + Chromium, 0 CSP violations, React hydrated. Its
three routes are the public ones; the six here need a session, which a production
build cannot grant without a data plane (see §9.3).

### The governance probe — 216 assertions

```
── [DoD 1] Self-elevation is refused, server-side, with a 403
── [DoD 2] The last administrator cannot be demoted or deactivated
── Ordering, permission, and shape
── [DoD 6] A .pdf that is actually HTML is rejected by content sniffing
── [DoD 7] Filenames are sanitised, and the original is kept as metadata
── A check with no evidence is not_evidenced, never passed
── [DoD 11] An unconfigured integration is never rendered as healthy
── [DoD 10] Exports carry provenance, and refuse to serialise without it
── [DoD 12] The permission matrix across all 11 roles × 6 routes
  admin=documents,compliance,reports,users,admin,settings
  manager=documents,compliance,reports,users,settings
  accountant=documents,compliance,reports
  staff=documents,reports
  owner=documents,reports
  tenant=documents,reports
  guest=none
  service_provider=documents
  child_owner=reports
  child_tenant=reports
  child_guest=none

216 pass · 0 fail
```

Every fail-closed case is paired with a **positive control**. Without them, a
`decideRoleChange` returning `not_permitted` for everything would pass every
refusal assertion while being completely broken. Self-elevation is crossed with
all eleven roles, not spot-checked on admin. The suite fails itself below 150
assertions.

### The live HTTP check — 155 assertions, all six routes

Run against `next dev --webpack` on 127.0.0.1:3242 with W1-B's access-profile
cookie. Every forbidden (role, route) pair renders the **server-side** 403 and
carries no repository data beyond the shell baseline; every permitted pair
renders its data.

```
── Shell baseline (/de/dashboard), @azura.local per role: admin=1 manager=1 … child_guest=1
  (10 leak assertions skipped: the seed carries no rows for that surface)
155 pass · 0 fail
```

The admin evidence-coverage export, as served:

```
Erzeugt am,2026-07-28T16:33:38.489Z
Datenherkunft,local-seed

Kennzahl,Wert,Grundlage
sources.total,11,getEvidenceCoverage().totals.sources
snapshots.total,11,getEvidenceCoverage().totals.snapshots
```

`accountant`, `staff`, `tenant` and `guest` receive **403** from the same URL;
`inventory_split` (declared, not built) and `../../etc/passwd` both receive
**404**; `format=xlsx` and `format=pdf` receive **501**.

**Three bugs in my own check script, found by running it, fixed in the script
and not in the code** — worth recording because each would have produced a
confident wrong finding:

1. React splits the flight stream across `self.__next_f.push()` calls and a
   string can straddle two, so a plain grep reported the refusal marker as
   absent when it was present.
2. In the flight payload the attribute quotes are backslash-escaped, so
   searching for `data-testid="governance-forbidden"` with raw quotes matches
   neither the payload nor the SSR'd HTML of a refused page.
3. **next-intl ships the whole message catalogue to the client on every page**,
   and the topbar renders the caller's own email on every dashboard page. So an
   absence assertion on UI copy or on `@azura.local` reports a leak that is not
   one — `"Rollenabdeckung"` appears exactly once on `/de` for every role. Both
   are now count comparisons against a per-role shell baseline. Measured: `admin`
   on `/dashboard/users` = 23 occurrences, every other role = 1.

This is the same class of error as W3-B's focus-ring assertion, and the same
resolution.

---

## 7. Definition of done, item by item

| #   | Required                                             | Where                              | Result |
| --- | ---------------------------------------------------- | ---------------------------------- | ------ |
| 1   | Self-elevation → 403, with the audit row              | probe `[DoD 1]`, 22 assertions     | **PASS** |
| 2   | Demote the last admin → rejected                      | probe `[DoD 2]`, 14 assertions     | **PASS** — 409 |
| 3   | Deactivated user's next request fails closed          | §9.2                               | **NOT RUN** — W1-B's resolver, not exercised here |
| 4   | Upload without storage → 503                          | `storeDocument` + live check       | **PASS** |
| 5   | Upload succeeds, audit fails → incomplete + retryable | `stored_unaudited`, modelled       | **PARTIAL** — the state exists and is rendered; not provoked live (§9.1) |
| 6   | `.pdf` that is actually HTML → rejected by sniffing   | probe `[DoD 6]`, 20 assertions     | **PASS** |
| 7   | `../../evil.txt` → sanitised, stored name shown       | probe `[DoD 7]`, 18 assertions     | **PASS** |
| 8   | Expired signed URL → 403 with a re-request path       | `requestSignedUrl` exists          | **NOT RUN** — no bucket (§9.1) |
| 9   | Audit edit/delete via the API → rejected              | no such export, no UI path         | **PASS by construction**, DB unverified (§9.1) |
| 10  | Evidence coverage report, provenance columns present  | live check, output above           | **PASS** |
| 11  | Integration panel with nothing configured → not healthy | probe `[DoD 11]` + live check    | **PASS** |
| 12  | Permission matrix, 11 roles × every governance route  | probe `[DoD 12]` + live, 66 cells  | **PASS** |

Items 3, 5, 8 and half of 9 are **not proven** and the reasons are in §9. None of
them is proven by reading the code, and none is claimed as passing.

---

## 8. Requests for other windows

| File                                    | Owner    | What is needed                                                                                                                                                                                                                                                                    |
| --------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/dashboard-routing.ts`     | **W3-B** | A record for `/dashboard/admin`. There is none, and `CONTRACTS.md` §3 has no `admin` resource, so I did not invent one. Suggested: `{ href: "/dashboard/admin", labelKey: "dashboard.admin.title", icon: "ServerCog", permission: "settings:manage", group: "governance", resource: "settings" }`. **Until then `decideDashboardAccess` answers `unknown_route` for that path and the client guard passes it through, so the server check in `admin/page.tsx` is the only gate.** It is `settings:manage`, admin-only, and it runs before any read. `/dashboard/settings` links there meanwhile. |
| `package.json`                          | **W0-A** | `"qa:governance": "node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs scripts/governance-probe.mts"`. W4-D's `quality-gate.mjs` should call it.                                                                                                          |
| `supabase/migrations/*`                 | **W1-A** | Four tables these modules are honest about not having: `invitations` (single-use, expiring, scoped), `report_jobs` + `report_artifacts` (the `ReportJob` shape in `lib/report-artifacts.ts` is the contract), and a notification-preferences table. Each surface names the missing table rather than stubbing it. |
| `supabase/migrations/…0001_rbac.sql`    | **W1-A** | SEC-011: add `roles` and `anonymized_at` to `prevent_profile_privilege_escalation()`'s condition **before** either column exists. My role-change path cannot self-elevate, but it is not the only writer of `profiles` — `profiles_update_own` is.                               |
| `apps/web/lib/database.types.ts`        | **W1-A** | Three `as unknown as never` casts exist solely because the Supabase clients have no `Database` generic (`governance-audit.ts`, `document-storage.ts`, `settings/actions.ts`). Each row object is fully typed on our side; delete the casts when the generated types land.        |
| `apps/web/package.json`                 | **W0-A** | An XLSX and a PDF library, if those export formats are wanted. `REPORT_FORMATS` marks both unavailable with a reason rather than emitting an empty file.                                                                                                                        |
| `.gitignore`                            | **W0-A** | `node_modules` as a **symlink** is not matched by a `node_modules/` pattern, so `git status` in a worktree that links to the main tree's install lists it as untracked. Not committed here; it will trip the next window that runs `git add -A`.                                 |

---

## 9. What was NOT tested, and why

**This is the most important section for W4-C.** Every line is a place this
handoff gives no assurance.

1. **No SQL was executed.** No Docker, no `psql`, no Supabase CLI on this
   machine — the same constraint W4-C recorded in its §9.1. Every claim about
   RLS, the append-only trigger, `profiles_admin_write` and
   `prevent_profile_privilege_escalation()` is **read from the migration text**.
   The application-side half of each is executed by the probe; the database half
   is not. In particular, **"the database refuses an audit UPDATE" is unverified
   by execution** — it is `revoke` plus a trigger I read, not a `42501` I saw.
2. **No authenticated Supabase session existed at any point.** Every live test
   used the access-profile path with Supabase unconfigured. So the *write* half
   of every action — the actual `UPDATE profiles`, the actual
   `INSERT audit_events`, the actual storage upload — **has never run**. What is
   proven is every refusal, which is the half that writes nothing, plus the 503
   for every permitted write. SEC-002 compounds this: against a real project,
   `lib/auth.ts` selects two columns no migration creates, so every user degrades
   to `tenant` and none of these surfaces would be reachable at all.
3. **Nothing here was verified under `next start`.** The access-profile path is
   hard-`false` in a production runtime, so there is no way to obtain a non-admin
   session without a data plane. `pnpm qa:csp` covers the production build for
   the three public routes and passes (30/0); these six are unobserved in
   production. The mechanism is identical in both modes, but the run has not
   happened, and W4-C's own §9.3 makes the same point about SEC-003.
4. **DoD 3 — deactivated user's next request — was not run.** The mechanism is
   W1-B's `resolveSupabaseProfile`, which treats `is_active = false` as no
   session, and W1-B proves it with 20 probe assertions. I did not re-prove it
   and this module does not implement it; I am citing someone else's evidence.
5. **DoD 5 — upload stored, audit failed — was not provoked.** The state exists,
   is returned, and is rendered with its own treatment, but producing it needs
   storage that accepts a write and an `audit_events` insert that then fails.
   That needs a real project.
6. **DoD 8 — expired signed URL — was not run.** No bucket exists. The TTL, the
   clamp and the re-request action are code I wrote and did not exercise.
7. **The compliance module has never rendered a single check.**
   `supabase/seed.sql` inserts **no** rows into `compliance_checks`, so
   `seedComplianceChecks()` returns `[]`. Every state in §4 is proven by the
   probe against constructed fixtures; the page has only ever rendered its empty
   state. Ten of the live leak assertions were skipped for exactly this reason
   and are reported as skipped rather than counted as passes. **This is the
   biggest gap in the module group** and it closes when W1-A seeds the table.
8. **The audit browser has never rendered a row.** Same reason:
   `seedAuditEvents()` returns `[]`. Pagination, the refusal treatment and the
   payload rendering are unexercised against real data.
9. **No screen-reader pass, no Lighthouse, no performance measurement, no
   dependency scan.** Semantics are correct by construction — `role="alert"` on
   every refusal, `role="status"` on standing notices, a `<caption>` on every
   table, one `<h1>` per page — but nothing was driven with NVDA or VoiceOver.
10. **The four locales were not reviewed by a native speaker.** German is mine to
    stand behind; Turkish and Russian carry the same caveat W3-A and W3-C
    recorded. `check-i18n` proves the key sets match and that no German string
    exceeds 1.4× its English counterpart; it cannot prove a translation is good.
11. **`storeDocument`'s I/O half is unexecuted.** The probe covers
    `sniffContent`, `sanitiseFilename`, `validateUpload` and `storagePathFor`,
    which is every decision. The upload, the insert and the audit call are read,
    not run.

---

## 10. Decisions I made

**Six modules, and the two the brief called most important were built first.**
`users` and `admin` are where W4-C will spend its time, so they were written,
typechecked and probed before the other four existed.

**Every security decision lives in a pure module.** `role-policy.ts`,
`compliance-model.ts`, the top two thirds of `document-storage.ts` and
`integrations.ts` have no I/O and no `next/headers`, so `governance-probe.mts`
executes them. `document-storage.ts` reaches its Supabase and audit imports
through **dynamic `import()`** for the same reason: a static import would make
the whole module unloadable outside Next and reduce the sniffing rules to
something that can only be reviewed. Next resolves a dynamic import identically
for bundling, so nothing about the build changes.

**`/dashboard/reports/export` is a Route Handler under my own segment**, not
under `app/api/` — that tree is W2-B's. A download needs `Content-Disposition`,
which a server action cannot set, and a route handler is also something W4-C can
hit with `curl` and a cookie, which is the right way to test an export's access
control. It inherits `PROTECTED_PREFIXES` from `proxy.ts` for free.

**The reports catalogue shows reports the caller cannot export.** This departs
from the sidebar's rule of withholding what a role cannot use, deliberately: the
nav answers "what can I do", and this page answers "what does this system
produce", which a manager needs in order to ask someone else. A locked row shows
a name and a permission, both of which are in `CONTRACTS.md`.

**`REPORT_DEFINITIONS.available` is load-bearing in both directions.** An
unavailable report renders "not built yet" instead of a download button, and the
route answers 404 for the same id. The first version had the page offering a
button that would 404 — a definition whose `available` disagrees with its route
is the "declared as live" failure this module group exists to refuse.

**No theme picker in settings.** `forcedTheme="light"` overrides both
`defaultTheme` and any stored preference, so a picker would be a control that
changes nothing. The section states the fixed value. SEC-022 records the
consequence for W1-D's suite.

**A 404, not a 400, for an unknown report id.** A 400 that distinguishes
"unknown report" from "forbidden report" is an enumeration oracle for the
catalogue.

**CSV fields beginning `=`, `+`, `-`, `@`, tab or CR are prefixed with a quote.**
Excel and Sheets evaluate such a field as a formula, and a harvested publisher
name is exactly the kind of string we do not control. The quote is visible in the
cell, which is the right trade: a visibly odd string beats a silently executed
one.

**A `null` CSV field is the empty field**, never `0` and never a dash. A
spreadsheet averages a zero and sorts a dash as text; both misrepresent an
absence.

**`SEC-002`'s orphaned `degradedReason` now has three consumers** — the users,
admin and settings pages each render it. SEC-002 records that it had none, so a
user whose profile could not be read saw a minimal dashboard and was never told
why. That is one line of the finding closed; the column mismatch itself is
W1-B's and W1-A's.

**A literal NUL in my own source, caught and fixed.** The filename sanitiser's
control-character class was first written with literal control bytes, which made
`lib/document-storage.ts` binary to git — precisely SEC-008's finding, where a
NUL hides a file from both secret scanners. It is now `\u0000-\u001f\u007f-\u009f`
as escapes, which is what `safeNextPath()` already does and comments on.

---

## 11. Known gaps

- **`[GAP]` `/dashboard/admin` is not in the sidebar.** §8. Reachable from
  `/dashboard/settings`; the server-side `settings:manage` check is the gate.
- **`[GAP]` Compliance and the audit browser have never rendered a row.** §9.7,
  §9.8. The single biggest gap here.
- **`[GAP]` No write has ever succeeded.** §9.2. Every refusal is proven; every
  permitted write is proven only as far as its 503.
- **`[GAP]` Invitations, background report jobs, stored report artefacts, XLSX,
  PDF and notification preferences do not exist.** Each surface names the missing
  table or library and its owner. None is stubbed.
- **`[GAP]` A second approval for elevation to `admin` is modelled, not
  enforced.** `decideRoleChange` returns `requiresSecondApproval: true` for a
  promotion to `admin` and nothing consumes it. The brief says "consider"; a
  real two-person rule needs a pending-approvals table, which does not exist.
- **`[GAP]` Compliance evidence is joined in application code**, not by the
  database. `getComplianceChecks()` and `getDocuments()` are two reads joined by
  id in `evaluateChecks`. Correct and role-scoped on both sides, but it means a
  check whose evidence sits beyond the 500-row document page would read as
  `not_evidenced`. It errs toward understating, which is the right direction, and
  it needs a repository-level join to be right at scale.
- **`[GAP]` The audit browser has no filter UI.** `getAuditEvents` takes
  `entityTable`, `entityId`, `action`, `actorProfileId` and `since`, and the page
  wires only paging. Server-side filtering is available and unexposed.
