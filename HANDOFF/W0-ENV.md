# HANDOFF — W0-ENV Supabase environment verified

STATUS: COMPLETE
Completed: 2026-07-27
Window: pre-wave setup (not a numbered task)

## What was built

- `.gitignore` — written before `.env.local` existed, so secrets were never unprotected
- `.env.example` — full template, variable names mirroring the 1Çatı reference project
- `.env.local` — git-ignored; five server secrets generated with `crypto.randomBytes(48)`
- `scripts/verify-supabase.mjs` — 9-stage connection check that never prints a secret
- `SUPABASE-SETUP.md` — where each dashboard value lives, and the service-role warning

## Verification actually run

| Command                                      | Result   | Evidence                                   |
| -------------------------------------------- | -------- | ------------------------------------------ |
| `node scripts/verify-supabase.mjs`           | **PASS** | 22 pass · 0 fail · 2 warn · 1 skip, exit 0 |
| Direct Postgres auth (`pg`, run out-of-tree) | **PASS** | connected, queried, privileges confirmed   |
| DNS + TCP reachability probe                 | **PASS** | direct host IPv6 111ms; pooler IPv4 91ms   |

## Verified environment — do not re-derive this

| Fact                     | Value                                                                          |
| ------------------------ | ------------------------------------------------------------------------------ |
| Project ref              | _(redacted — see `.env.local`)_                                                |
| Region                   | eu-central-1 (Frankfurt)                                                       |
| **PostgreSQL**           | **17.6**                                                                       |
| Connected as             | `postgres`, `CREATE` privilege = true                                          |
| **public schema**        | **0 tables — clean project, safe for migration 00**                            |
| auth + storage internals | 31 tables (normal Supabase)                                                    |
| Extensions present       | `pg_stat_statements`, **`pgcrypto`**, `plpgsql`, `supabase_vault`, `uuid-ossp` |
| Extensions **missing**   | **`pg_trgm`** — W1-A migration 10 must `create extension` it                   |
| Storage buckets          | none yet — `azura-documents`, `azura-evidence` to be created, both **private** |
| Auth providers           | `email` only                                                                   |
| AI gateway               | configured (Sokrates endpoint)                                                 |

## Decisions I made

**`SUPABASE_DB_URL` uses the direct host `db.<ref>.supabase.co:5432`, not the pooler.**
`SUPABASE-SETUP.md` originally recommended the session pooler. The direct host is the better
choice here and I kept it: it is a real Postgres connection with full support for prepared
statements, advisory locks and `LISTEN/NOTIFY`, which is what migrations and pgTAP want.

The caveat is that the direct host is **IPv6-only** — it has no A record. I verified this
machine routes IPv6 to it (TCP connect in 111ms), so it works here. If a later machine or a CI
runner has no IPv6, migrations will fail with a DNS-shaped error that looks like a network
outage. The IPv4 fallback is:

```
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Never port **6543** — that is the transaction pooler and migrations fail on it.

**Fixed a false positive in my own verifier.** The first run reported the anon key as rejected.
It was not: `/rest/v1/` (the OpenAPI root) is service-role-only by design and answers any other
key with `"Only the 'service_role' API key can be used for this endpoint"`. The verifier now
probes a table path and distinguishes "Invalid API key" from an ordinary PostgREST miss. The
anon key was always valid — `/auth/v1/health` returned 200 with it throughout.

## Requests for other windows

| File                         | Owning task | What is needed                                                                       |
| ---------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| `supabase/migrations/…0000`  | W1-A        | `create extension if not exists pgcrypto` — already present, keep the guard          |
| `supabase/migrations/…0010`  | W1-A        | **`create extension if not exists pg_trgm`** — NOT installed, search indexes need it |
| `scripts/setup-supabase.mjs` | W0-A        | create both buckets **private**, with size + MIME limits                             |
| `apps/web/lib/env.ts`        | W0-A        | validate exactly the variable set in `.env.example` — do not invent names            |

## Known gaps

- **pgTAP needs Docker.** Not yet checked whether Docker is available on this machine. W1-A must
  report **NOT RUN** rather than inferring a pass if it is missing — the reference project hit
  exactly this and documented it honestly.
- Buckets do not exist yet; the two WARNs in the verifier are expected until W0-A creates them.
- The `pg` check inside `verify-supabase.mjs` reports SKIP until `pnpm install` provides the
  driver. The connection itself is verified — I ran it out-of-tree to avoid creating
  `node_modules` before W0-A owns it.
- AI gateway credentials are present but the endpoint has **not** been probed. W2-C verifies it.

## Files I wrote

```
.gitignore
.env.example
.env.local            (git-ignored)
SUPABASE-SETUP.md
scripts/verify-supabase.mjs
HANDOFF/W0-ENV.md
```
