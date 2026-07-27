# W3-F — Documents, compliance, reports, users, admin, settings

**Wave:** 3 · **Depends on:** W1-A, W1-B, W2-A, W2-B, W3-B · **Runs with:** all other W3-*

> Read `SYSTEM-PROMPT.md`, `HANDOFF/W3-B.md`, `HANDOFF/W1-B.md` (permission matrix),
> `HANDOFF/W1-A.md` (audit + document tables). Then read
> `D:\Real Estate CRM\Cati\apps\web\components\user-administration-panel.tsx`,
> `role-governance-panel.tsx`, `compliance-live-cockpit.tsx`, `lib\document-storage.ts`.

---

## Mission

The governance surface — who may do what, what was done, what is stored, and what the system can
prove. This module group is where **W4-C's security review will spend most of its time**, so
build it expecting adversarial reading.

---

## Files you own

```
apps/web/app/[locale]/dashboard/{documents,compliance,reports,users,admin,settings}/**
apps/web/components/governance/*
apps/web/lib/document-storage.ts · report-artifacts.ts
HANDOFF/W3-F.md
```

Messages: `dashboard.documents.*`, `dashboard.compliance.*`, `dashboard.reports.*`,
`dashboard.users.*`, `dashboard.admin.*`, `dashboard.settings.*` only.

---

## Deliverables

### 1. Documents — `/dashboard/documents`

- Single canonical bucket. Name it once, in one constant, used everywhere.
- **Signed URLs, short TTL.** No public bucket, no permanent URL.
- Upload: type allowlist, size ceiling, both enforced **server-side**. Client validation is a
  courtesy, not a control.
- **Distinguish a stored upload from a failed completion audit.** 1Çatı's contract does exactly
  this: if the file lands but the audit write fails, that is a retryable incomplete state, not a
  success. Model it explicitly rather than assuming the happy path.
- Categories, versioning, access scoping by role and entity.
- **Without persistent storage configured, upload returns 503.** Never a fake success.

### 2. Compliance — `/dashboard/compliance`

Checks with status, evidence, owner, due date, and history. Cockpit view with a coverage summary.

**Do not overstate.** A check with no evidence attached is `not_evidenced`, not `passed`. The
distinction between "we believe this is fine" and "we can prove this is fine" is the entire value
of a compliance module.

### 3. Reports — `/dashboard/reports`

Parameterised reports over inventory, evidence coverage, finance, and operations.

- Long-running generation is a **job + poll**, not a blocking request.
- Artifacts stored with a retention policy and access scoping.
- Export: CSV, XLSX, PDF. Every export carries provenance columns where it contains sourced
  facts — an export that strips sources recreates the problem this system exists to solve.
- **Evidence coverage report** is the flagship: sources, reachability, facts by confidence,
  findings by severity, as a shareable artifact.

### 4. Users — `/dashboard/users`

Directory, role assignment, activation/deactivation, invitations, role-coverage view.

- **Role assignment is the most sensitive action in the system.** Only `admin`. Every change
  audited with before/after. Consider requiring a second approval for elevation to `admin`.
- **A user must not be able to elevate their own role.** Enforce server-side, and test it.
- Deactivation revokes sessions; it does not delete history.
- Invitations: single-use, expiring, scoped tokens.

### 5. Admin — `/dashboard/admin`

System health, integration status, audit-event browser, feature flags, migration/version display.

**Integration status must be honest.** Show `configured` / `not configured` / `unreachable` per
provider. Never render an unconfigured integration as healthy. The reference project's status doc
is emphatic that provider-capable contracts and placeholders must not be presented as live
integrations — hold that line.

### 6. Settings — `/dashboard/settings`

Profile, locale, theme, notifications, and — for `admin` — organisation settings. Changing your
own locale must not change anyone else's.

---

## Edge cases

- **Self-elevation**: user edits their own role via the API → 403. Test it directly.
- **Last admin**: deactivating or demoting the final `admin` → rejected with a clear message.
  A system with no admin is unrecoverable.
- **Deactivated user with an active session** → next request fails closed.
- **Expired invitation** → clear message, no partial account creation.
- **Signed URL after expiry** → 403 and a re-request path, not a broken image.
- **Upload succeeds, audit write fails** → surfaced as incomplete and retryable. Do not report
  success; do not silently orphan the file.
- **File with a misleading extension** — `.pdf` that is actually HTML. Validate content type by
  sniffing bytes, not by trusting the name. This is the same lesson as W0-B's harvest validation.
- **Filename with path traversal** (`../../etc/passwd`) or Turkish characters → sanitise, and
  preserve the original name only as display metadata.
- **Zip bomb / oversize** → ceiling enforced before the write.
- **Audit browser with 100k events** → server-side pagination and filtering, never client-side.
- **Audit events are append-only** — no UI path to edit or delete, and the database should refuse.
- **Report generation exceeding the timeout** → job survives, user is notified, no orphaned artifact.
- **Concurrent settings save from two tabs** → last write wins is acceptable here, but show what
  was saved.
- **PII in exports** → role-scoped. An `accountant` export must not carry data an accountant
  cannot see in the UI.

---

## Definition of done

```bash
pnpm --dir apps/web typecheck && pnpm --dir apps/web lint && pnpm --dir apps/web build
```

Plus, evidence pasted:
1. Self-elevation attempt → **403**, with the audit row
2. Demote the last admin → rejected
3. Deactivated user's next request → fails closed
4. Upload without storage configured → **503**, not a fake success
5. Upload succeeding but audit failing → surfaced as incomplete + retryable
6. `.pdf` that is actually HTML → rejected by content sniffing
7. Filename `../../evil.txt` → sanitised; show the stored name
8. Expired signed URL → 403 with a re-request path
9. Audit event edit/delete attempted via the API → rejected
10. Evidence coverage report generated, opened, provenance columns present
11. Integration panel with nothing configured → shows "not configured", **not** healthy
12. Permission matrix across all 11 roles for every governance route

---

## Handoff must state

- The canonical bucket name and the signed-URL TTL
- How self-elevation and last-admin protection are enforced (server-side mechanism, not UI)
- Which integrations are actually wired vs declared — **be explicit**; W4-C will verify the UI
  does not overclaim
- The audit event schema and its append-only guarantee
