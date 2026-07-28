# Supabase setup — what I need from you

`.env.local` is created and git-ignored. All five server secrets are **already generated** and
filled in. Five values are still blank because only you can get them.

---

## The five values

Open your Supabase project, then:

### 1–3. Dashboard → Project Settings → **API**

| `.env.local` key                | What to copy              | Notes                         |
| ------------------------------- | ------------------------- | ----------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | **Project URL**           | `https://<ref>.supabase.co`   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **anon** / **public** key | Safe in the browser by design |
| `SUPABASE_SERVICE_ROLE_KEY`     | **service_role** key      | ⚠️ see the warning below      |

### 4. `SUPABASE_PROJECT_REF`

Just the subdomain from the URL. If your URL is `https://abcdefghijklmnop.supabase.co`, the ref
is `abcdefghijklmnop`.

### 5. Dashboard → Project Settings → **Database** → Connection string → **URI**

```
SUPABASE_DB_URL=postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Two things that will bite you here:

- **Use port `5432` (session pooler), not `6543`.** The transaction pooler on 6543 doesn't support
  prepared statements or advisory locks, so migrations and pgTAP fail with confusing errors.
- **URL-encode special characters in the password.** `@` → `%40`, `#` → `%23`, `/` → `%2F`,
  `:` → `%3A`. An unencoded `@` silently truncates the host and you get "getaddrinfo ENOTFOUND".

---

## ⚠️ About the service_role key

It **bypasses Row Level Security completely** — full read and write on every table, ignoring
every policy you will ever write. It is not "an admin login", it is closer to the database
password.

- Server-side only. Never in a `NEXT_PUBLIC_*` variable, never in a client component.
- Never paste it into a chat window, a ticket, or a screenshot.
- W1-B enforces this with `import "server-only"` so a leak breaks the build rather than shipping.
- If it does leak: Dashboard → Settings → API → **Rotate**.

`.gitignore` already covers `.env.local`, so it will not be committed.

---

## Then verify

```bash
node scripts/verify-supabase.mjs            # or --verbose
```

It checks, without ever printing a secret:

1. Every required variable is present and not still a placeholder
2. The project ref in the URL matches `SUPABASE_PROJECT_REF`
3. **The anon and service_role keys aren't the same value** (a very common paste error)
4. `SUPABASE_DB_URL` points at the same project and uses port 5432
5. REST API responds to both keys
6. Auth service responds
7. Storage responds, and the two buckets exist **and are private**
8. Schema introspection — reports whether the database is empty or already has tables
9. Direct Postgres connection, server version, and whether `pgcrypto` / `pg_trgm` are installed

Exit code is non-zero on any failure, so it works as a gate.

---

## What I can then do on my own

With those five values in place:

| Capability                         | How                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| Apply the full schema              | `supabase link --project-ref` then `supabase db push` (W1-A's 14 migrations)  |
| Inspect and query any table        | service-role REST, or direct `psql` via `SUPABASE_DB_URL`                     |
| Generate TypeScript types          | `supabase gen types typescript --linked`                                      |
| Create + configure storage buckets | `scripts/setup-supabase.mjs` (private, size limits, MIME allowlist)           |
| Seed the Azura dataset             | `supabase/seed.sql` — 7 blocks, 656 units, 188 rooms, 23 sources, F-001…F-010 |
| Run pgTAP                          | `supabase test db` — needs Docker locally                                     |
| Verify RLS adversarially           | connect as each of the 11 roles and assert what they cannot reach             |
| Check migration drift              | `supabase migration list --linked` (local vs deployed)                        |

---

## What I will not do without you saying so explicitly

These are destructive or outward-facing, so they need a separate go-ahead each time:

- `supabase db reset` against the **linked cloud** project — it drops everything
- Dropping or altering any table that already holds data
- Rotating keys
- Enabling auth providers or changing auth settings
- Anything that emails real users

The verify script reports whether your database is empty. **If it already has tables, tell me
what they are before I run migrations** — W1-A's migration `00` assumes a clean project, and I'd
rather adapt than overwrite something you meant to keep.

---

## Two ways to give me the values

**Option A — you fill them in.** Open `.env.local`, paste the five values, save, and tell me.
I'll run the verifier. This is the better option: no secret ever passes through the chat log.

**Option B — you paste them here** and I write them in. Faster, but the service_role key ends up
in the conversation transcript. If you take this route, rotate the key once the build is
finished.

Either way, nothing is blocked in the meantime — waves 0 through 2 build against the seed
fallback and don't need a live database until W1-A applies the migrations.
