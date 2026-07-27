# W1-A — Database schema, RLS, pgTAP

**Wave:** 1 · **Depends on:** W0-A · **Blocks:** W2-A, W2-B, W4-C · **Runs with:** W1-B, W1-C, W1-D

> Read `SYSTEM-PROMPT.md`, `CONVENTIONS.md`, `CONTRACTS.md` first. Then read
> `D:\Real Estate CRM\Cati\supabase\migrations\` — start with `…0002_site_crm_core.sql`.

---

## Mission

The persistence layer and its security boundary, written together. **RLS is not a later pass.**
A table holding personal or financial data ships with its policy in the same migration or it does
not ship.

You and W1-B are the two halves of RBAC — you own the SQL side, W1-B owns the TypeScript side.
`CONTRACTS.md` §3 freezes the role list so you can work in parallel without talking. **Neither of
you may change that list.**

---

## Files you own

```
supabase/migrations/*.sql · supabase/seed.sql · supabase/config.toml
supabase/tests/*.sql · HANDOFF/W1-A.md
```

Do **not** write `apps/web/lib/rbac.ts` (W1-B) or `supabase/imports/*` (W0-B).

---

## Deliverables

### Migrations — sequential, never renumbered

| # | File | Contents |
|---|---|---|
| 00 | `…0000_initial_schema.sql` | `profiles` extending `auth.users`, signup trigger, own-row RLS |
| 01 | `…0001_rbac.sql` | 11-role enum **in `CONTRACTS.md` §3 order**, `roleLevel` helper, `current_user_role()`, `is_admin()`, `has_role_level(int)` |
| 02 | `…0002_azura_core.sql` | `companies`, `sites`, `site_blocks`, `site_floors`, `units`, `residents`, `unit_residents` |
| 03 | `…0003_evidence.sql` | `sources`, `source_snapshots`, `sourced_facts`, `findings` — the provenance store |
| 04 | `…0004_hotel_reviews.sql` | `hotels`, `hotel_rooms`, `review_sources`, `review_quotes` |
| 05 | `…0005_portal_listings.sql` | `portal_listings`, `competing_prices` |
| 06 | `…0006_operations.sql` | `service_tickets`, `ticket_events`, `activities`, `workforce_tasks`, `media_reports` |
| 07 | `…0007_finance.sql` | `finance_ledger_entries`, `payment_transactions`, `wallets`, `vendor_invoices` |
| 08 | `…0008_documents_compliance.sql` | `documents`, `compliance_checks`, `audit_events`, `access_events` |
| 09 | `…0009_communications.sql` | `threads`, `messages`, `notifications`, `integration_outbox` |
| 10 | `…0010_search.sql` | `operational_search_documents`, tsvector + trigram indexes |
| 11 | `…0011_ai_observability.sql` | `ai_action_logs`, `ai_conversations`, `ai_messages`, `ai_feedback` |
| 12 | `…0012_realtime.sql` | Realtime publication registration for dashboard tables |
| 13 | `…0013_hardening.sql` | Grant hardening, `search_path` pinning, function `SECURITY DEFINER` audit |

### The evidence tables — Azura-specific, get these right

```sql
create table public.sources (
  id text primary key,                    -- "seaside-alanya"
  publisher text not null,
  tier smallint not null check (tier between 1 and 6),
  url text not null,
  kind text not null check (kind in
    ('official','developer','hotel','portal','review','booking','press','social')),
  created_at timestamptz not null default now()
);

create table public.source_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.sources(id),
  fetched_at timestamptz not null,
  http_status text not null,              -- number OR transport label
  snapshot_path text,
  snapshot_sha256 text,
  bytes integer not null default 0,
  content_validated boolean not null default false
);

create table public.sourced_facts (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,              -- 'project' | 'unit' | 'hotel' | 'review'
  entity_id text not null,
  field_path text not null,               -- 'project.residenceBlockCount'
  value jsonb,
  confidence text not null check (confidence in
    ('confirmed','official','single_source','conflicted','inferred','gap')),
  note text,
  unique (entity_type, entity_id, field_path)
);
```

**Enforce the contract invariants in the database, not just in TypeScript:**

```sql
alter table public.sourced_facts add constraint gap_implies_null
  check (confidence <> 'gap' or (value is null and note is not null));
```

A constraint outlives a code review. Add the equivalent for `conflicted` (must have ≥1 row in
`fact_conflicts`) as a deferred constraint trigger.

### RLS — every table, in its creating migration

- Read `…0001` helpers, never the JWT. `user_metadata` is client-mutable; reading a role from it
  is a privilege-escalation hole. 1Çatı documents this explicitly — do not regress it.
- `owner` and `tenant` see only their own units, via `unit_residents`.
- `child_*` roles inherit a **strict subset** of their guardian. Write a test that proves a
  `child_owner` cannot read what `owner` cannot.
- `service_provider` sees only assigned tasks.
- `guest` sees public data only.
- Evidence tables: read for `manager`+, write for `admin` only.
- **Beware recursive policies.** 1Çatı needed migration `…0037_fix_workforce_staff_rls_recursion`
  to undo a policy that queried a table protected by the same policy. Check every policy for
  self-reference before you commit it.

### Financial invariants — triggers, not conventions

```sql
-- posted ledger entries are immutable
create trigger prevent_posted_ledger_mutation
  before update or delete on public.finance_ledger_entries
  for each row execute function public.reject_posted_mutation();
```

Also: no negative wallet balance without an explicit overdraft flag; a payment cannot exceed its
invoice; double-entry sums to zero per transaction group.

### `supabase/seed.sql`

Deterministic. Seeds the confirmed Azura figures: 1 company, 1 site, **7 blocks, 656 units**,
1 hotel with 188 rooms, the 23 sources, and findings F-001…F-010.

- Portable date math only — no shell arithmetic. The reference repo has a commit fixing exactly
  this (`fix: make supabase seed date math portable`).
- Idempotent: `supabase db reset` twice gives an identical database.
- Seed users for all 11 roles with predictable ids so W4-A can log in as each.

### pgTAP — `supabase/tests/`

Minimum **150 assertions** across:

| File | Covers |
|---|---|
| `01-schema.sql` | tables, columns, types, NOT NULLs, FKs present |
| `02-rbac.sql` | all 11 roles exist, level ordering, helper functions correct |
| `03-rls-positive.sql` | each role CAN reach what it should |
| `04-rls-negative.sql` | each role CANNOT reach what it should not — **the important one** |
| `05-finance-invariants.sql` | posted-immutability trigger fires; negative balance rejected |
| `06-evidence-invariants.sql` | gap⟹null constraint; conflicted⟹conflict rows |
| `07-seed-integrity.sql` | 7 blocks, 656 units, 188 rooms, 10 findings |

Negative tests matter more than positive ones. A permission test that only checks the happy path
proves nothing about security.

---

## Edge cases

- Docker may be unavailable on this machine — the reference project hit exactly this and could
  not run pgTAP. If so: validate SQL statically, **report the tests as NOT RUN**, and do not
  claim a green database. Say it in the handoff.
- `gen_random_uuid()` needs `pgcrypto`; enable it in migration 00.
- Timezone: store `timestamptz`, always UTC. Türkiye is UTC+3 with no DST.
- Turkish collation for name sorting: `collate "tr-TR-x-icu"` on display-sorted text columns.
- Money as `numeric(14,2)` plus a `currency` column. **Never float.** Never a single "price"
  column without its currency — Housearch quotes USD and everyone else EUR.
- `unit_no` unique **per block**, not globally.
- Cascade deletes: never on financial or audit tables. `on delete restrict` there.
- Index every FK used in an RLS policy — policy predicates run per row and unindexed ones make
  a 656-row table behave like a 656,000-row one.
- Migration filenames must be LF. CRLF breaks the Supabase CLI.

---

## Definition of done

```bash
npx supabase db reset               # applies 0→13 + seed, clean
npx supabase test db                # pgTAP, all assertions pass
npx supabase db lint                # no warnings
npx supabase gen types typescript --local --schema public > /tmp/types.ts   # generates
```

Paste real output. If Docker is unavailable, say **NOT RUN** and why — never "should pass".

---

## Handoff must state

- Migration count and final number (W2-A needs it)
- The exact table + column names W2-A will query — this is the contract between you
- pgTAP: assertions **planned** vs **actually executed**. Distinguish them. The reference
  project's status doc carefully separates "326 planned" from "139 executed"; match that rigour.
- Any RLS policy you found recursive and how you resolved it
- Confirmation the role list matches `CONTRACTS.md` §3 exactly, in order
