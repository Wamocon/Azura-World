-- 03 · Evidence — the provenance store (task W1-A)
--
-- This is the Azura-specific migration and the one the whole project rests on.
-- CONTRACTS.md §1 makes provenance a TYPE in the application; this file makes it a
-- CONSTRAINT in the database. tasks/W1-A: "A constraint outlives a code review."
--
-- The six invariants of CONTRACTS.md §1, and where each is enforced:
--
--   1. gap ⟹ value is null and note is non-empty        → CHECK sourced_facts_gap_implies_null
--   2. conflicted ⟹ ≥1 conflicting value recorded       → deferred constraint trigger
--   3. confirmed ⟹ ≥2 sources on DISTINCT hosts         → deferred constraint trigger
--   4. inferred ⟹ note explains the derivation          → CHECK sourced_facts_inferred_needs_note
--   5. zero sources is legal only for gap               → deferred constraint trigger
--   6. every snapshot hash resolves to a stored file    → FK to source_snapshots + a filesystem
--                                                         check that only scripts/verify-evidence.mjs
--                                                         (W0-B) can perform. The FK is the half the
--                                                         database can honestly enforce; see below.
--
-- Invariants 2, 3 and 5 depend on child rows, so they cannot be plain CHECKs — a CHECK
-- cannot see another table. They are DEFERRABLE INITIALLY DEFERRED constraint triggers,
-- which means a loader may insert a fact and its sources in any order within one
-- transaction and is judged only at COMMIT. That is the only workable shape: the
-- alternative would force every writer to insert children before parents.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.fact_confidence as enum (
    'confirmed', 'official', 'single_source', 'conflicted', 'inferred', 'gap'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.finding_severity as enum ('critical', 'high', 'medium', 'low', 'info');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.finding_area as enum (
    'structure', 'pricing', 'timeline', 'geography', 'branding', 'availability', 'harvest'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- sources
-- ---------------------------------------------------------------------------

create table if not exists public.sources (
  id         text primary key,
  publisher  text not null,
  -- CONTRACTS.md §1 SourceTier: 1 official · 2 developer · 3 hotel · 4 portal
  -- · 5 review/booking · 6 press/secondary. Lower number wins the DISPLAY value.
  tier       smallint not null check (tier between 1 and 6),
  url        text not null,
  -- Stored, not derived, because invariant 3 counts DISTINCT HOSTS and a query that
  -- re-parses the URL every time would make that check both slow and fragile.
  host       text not null,
  kind       text not null check (kind in
               ('official', 'developer', 'hotel', 'portal', 'review', 'booking', 'press', 'social')),
  created_at timestamptz not null default now()
);

comment on table public.sources is
  'The source register. id is a stable slug such as "seaside-alanya", so a citation survives a URL change.';
comment on column public.sources.host is
  'Registrable host of `url`. Invariant 3 ("confirmed" needs two DISTINCT hosts) is counted on this column — two URLs on one host are one opinion, not corroboration. Finding F-016 is exactly this failure mode: a Tripadvisor score re-served by a reseller would otherwise have looked like two hosts agreeing.';

create index if not exists idx_sources_tier on public.sources (tier);
create index if not exists idx_sources_host on public.sources (host);

-- ---------------------------------------------------------------------------
-- source_snapshots
-- ---------------------------------------------------------------------------

create table if not exists public.source_snapshots (
  id                uuid primary key default gen_random_uuid(),
  source_id         text not null references public.sources(id) on delete restrict,
  fetched_at        timestamptz not null,
  -- Text, not integer: CONTRACTS.md §2 HarvestEntry.status is `number | string` and the
  -- real harvest recorded 15 transport labels — dns_timeout, robots_disallowed, soft_404,
  -- http_404, http_500, redirected, expect_missing — alongside 45 numeric 200s.
  http_status       text not null,
  snapshot_path     text,
  snapshot_sha256   text,
  bytes             integer not null default 0 check (bytes >= 0),
  -- CONVENTIONS.md §5: validate the BYTES, not the status line. Ataberg shipped 51 of 154
  -- "downloads" as 404 pages wearing a .jpg extension.
  content_validated boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (source_id, fetched_at, snapshot_sha256)
);

-- A hash must be unique so a fact can cite it as a foreign key (invariant 6, DB half).
-- A table CONSTRAINT rather than a partial unique index: PostgreSQL will not accept a
-- partial index as an FK target. A plain UNIQUE is correct anyway — NULLs compare as
-- distinct, so the many failed harvests that carry no hash are all still permitted.
do $$ begin
  alter table public.source_snapshots
    add constraint source_snapshots_sha256_key unique (snapshot_sha256);
exception when duplicate_table or duplicate_object then null; end $$;

create index if not exists idx_source_snapshots_source_id on public.source_snapshots (source_id);
create index if not exists idx_source_snapshots_validated on public.source_snapshots (content_validated);

-- A snapshot that validated must have the bytes to prove it.
alter table public.source_snapshots
  drop constraint if exists source_snapshots_validated_needs_body;
alter table public.source_snapshots
  add constraint source_snapshots_validated_needs_body
  check (not content_validated or (snapshot_sha256 is not null and bytes > 0));

-- ---------------------------------------------------------------------------
-- sourced_facts
-- ---------------------------------------------------------------------------

create table if not exists public.sourced_facts (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in
                ('project', 'site', 'block', 'unit', 'hotel', 'review', 'portal_listing')),
  entity_id   text not null,
  field_path  text not null,
  value       jsonb,
  confidence  public.fact_confidence not null,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (entity_type, entity_id, field_path)
);

comment on table public.sourced_facts is
  'One row per displayed fact. field_path is the dotted CONTRACTS.md path, e.g. "project.residenceBlockCount".';

create index if not exists idx_sourced_facts_entity on public.sourced_facts (entity_type, entity_id);
create index if not exists idx_sourced_facts_confidence on public.sourced_facts (confidence);
create index if not exists idx_sourced_facts_field_path on public.sourced_facts (field_path);

drop trigger if exists set_sourced_facts_updated_at on public.sourced_facts;
create trigger set_sourced_facts_updated_at
  before update on public.sourced_facts
  for each row execute function public.set_updated_at();

-- Invariant 1. The exact constraint named in tasks/W1-A, widened to also reject an
-- empty-string note, because '' is not an explanation.
alter table public.sourced_facts
  drop constraint if exists sourced_facts_gap_implies_null;
alter table public.sourced_facts
  add constraint sourced_facts_gap_implies_null
  check (confidence <> 'gap' or (value is null and nullif(btrim(note), '') is not null));

-- Invariant 4.
alter table public.sourced_facts
  drop constraint if exists sourced_facts_inferred_needs_note;
alter table public.sourced_facts
  add constraint sourced_facts_inferred_needs_note
  check (confidence <> 'inferred' or nullif(btrim(note), '') is not null);

-- ---------------------------------------------------------------------------
-- fact_sources — the SourceRef[] behind one fact
-- ---------------------------------------------------------------------------

create table if not exists public.fact_sources (
  id              uuid primary key default gen_random_uuid(),
  fact_id         uuid not null references public.sourced_facts(id) on delete cascade,
  source_id       text not null references public.sources(id) on delete restrict,
  -- Invariant 6, database half: a citation must point at a snapshot that was actually
  -- stored. Whether the file still exists on disk under sources/raw/ is checked by
  -- scripts/verify-evidence.mjs (W0-B) — Postgres cannot stat a file, and pretending
  -- otherwise would be the kind of half-enforcement this schema is trying to avoid.
  snapshot_sha256 text references public.source_snapshots(snapshot_sha256) on delete restrict,
  created_at      timestamptz not null default now(),
  unique (fact_id, source_id, snapshot_sha256)
);

create index if not exists idx_fact_sources_fact_id on public.fact_sources (fact_id);
create index if not exists idx_fact_sources_source_id on public.fact_sources (source_id);

-- ---------------------------------------------------------------------------
-- fact_conflicts — the conflictsWith[] of a "conflicted" fact
-- ---------------------------------------------------------------------------

create table if not exists public.fact_conflicts (
  id              uuid primary key default gen_random_uuid(),
  fact_id         uuid not null references public.sourced_facts(id) on delete cascade,
  value           jsonb,
  source_id       text not null references public.sources(id) on delete restrict,
  snapshot_sha256 text references public.source_snapshots(snapshot_sha256) on delete restrict,
  created_at      timestamptz not null default now()
);

comment on table public.fact_conflicts is
  'The LOSING values, kept. SYSTEM-PROMPT.md §2.2: never silently resolve a conflict — both values and both URLs are stored, and the loser stays visible on demand.';

create index if not exists idx_fact_conflicts_fact_id on public.fact_conflicts (fact_id);
create index if not exists idx_fact_conflicts_source_id on public.fact_conflicts (source_id);

-- ---------------------------------------------------------------------------
-- Deferred invariant enforcement — invariants 2, 3 and 5
-- ---------------------------------------------------------------------------

create or replace function public.assert_fact_invariants()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fact_id       uuid;
  v_confidence    public.fact_confidence;
  v_source_count  integer;
  v_host_count    integer;
  v_conflict_count integer;
begin
  -- Resolve the fact this row belongs to, whichever table fired the trigger.
  if tg_table_name = 'sourced_facts' then
    v_fact_id := coalesce(new.id, old.id);
  else
    v_fact_id := coalesce(new.fact_id, old.fact_id);
  end if;

  select f.confidence into v_confidence
  from public.sourced_facts f
  where f.id = v_fact_id;

  -- The fact was deleted inside this transaction; its children went with it.
  if not found then
    return null;
  end if;

  select count(*), count(distinct s.host)
    into v_source_count, v_host_count
  from public.fact_sources fs
  join public.sources s on s.id = fs.source_id
  where fs.fact_id = v_fact_id;

  select count(*) into v_conflict_count
  from public.fact_conflicts fc
  where fc.fact_id = v_fact_id;

  -- Invariant 5: no sources is legal only for a gap.
  if v_source_count = 0 and v_confidence <> 'gap' then
    raise exception
      'Fact % has confidence % but no sources. Only "gap" may be sourceless (CONTRACTS.md §1 invariant 5).',
      v_fact_id, v_confidence
      using errcode = '23514';
  end if;

  -- Invariant 3: "confirmed" means independent corroboration, which means two HOSTS.
  if v_confidence = 'confirmed' and v_host_count < 2 then
    raise exception
      'Fact % is "confirmed" but cites % source(s) across only % distinct host(s). Two distinct hosts are required (CONTRACTS.md §1 invariant 3).',
      v_fact_id, v_source_count, v_host_count
      using errcode = '23514';
  end if;

  -- Invariant 2: "conflicted" must keep the losing values.
  if v_confidence = 'conflicted' and v_conflict_count < 1 then
    raise exception
      'Fact % is "conflicted" but records no competing value. The losing value must be kept (CONTRACTS.md §1 invariant 2).',
      v_fact_id
      using errcode = '23514';
  end if;

  return null;
end;
$$;

comment on function public.assert_fact_invariants() is
  'Deferred enforcement of CONTRACTS.md §1 invariants 2, 3 and 5. Deferred because a loader legitimately writes a fact before its sources; judged at COMMIT, so ordering inside a transaction is free but the end state is not negotiable.';

drop trigger if exists assert_fact_invariants_on_fact on public.sourced_facts;
create constraint trigger assert_fact_invariants_on_fact
  after insert or update on public.sourced_facts
  deferrable initially deferred
  for each row execute function public.assert_fact_invariants();

-- Also fire from the child tables: deleting the second source of a "confirmed" fact
-- must fail just as loudly as never adding it.
drop trigger if exists assert_fact_invariants_on_sources on public.fact_sources;
create constraint trigger assert_fact_invariants_on_sources
  after insert or update or delete on public.fact_sources
  deferrable initially deferred
  for each row execute function public.assert_fact_invariants();

drop trigger if exists assert_fact_invariants_on_conflicts on public.fact_conflicts;
create constraint trigger assert_fact_invariants_on_conflicts
  after insert or update or delete on public.fact_conflicts
  deferrable initially deferred
  for each row execute function public.assert_fact_invariants();

-- ---------------------------------------------------------------------------
-- findings — the conflict register
-- ---------------------------------------------------------------------------

create table if not exists public.findings (
  id           text primary key check (id ~ '^F-[0-9]{3}$'),
  severity     public.finding_severity not null,
  area         public.finding_area not null,
  field_path   text not null,
  message      text not null,
  resolution   text not null,
  -- NULL means deliberately unresolved (CONTRACTS.md §2). It does not mean "not yet
  -- looked at" — `resolution` is NOT NULL and carries the reasoning either way.
  resolved_to  jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column public.findings.resolved_to is
  'The value the conflict was resolved to, or NULL for a conflict left deliberately open. CONVENTIONS.md §6: finding ids run F-001 upward and are never reused.';

create index if not exists idx_findings_severity on public.findings (severity);
create index if not exists idx_findings_area on public.findings (area);

drop trigger if exists set_findings_updated_at on public.findings;
create trigger set_findings_updated_at
  before update on public.findings
  for each row execute function public.set_updated_at();

create table if not exists public.finding_values (
  id              uuid primary key default gen_random_uuid(),
  finding_id      text not null references public.findings(id) on delete cascade,
  value           jsonb,
  source_id       text not null references public.sources(id) on delete restrict,
  snapshot_sha256 text references public.source_snapshots(snapshot_sha256) on delete restrict,
  created_at      timestamptz not null default now()
);

create index if not exists idx_finding_values_finding_id on public.finding_values (finding_id);
create index if not exists idx_finding_values_source_id on public.finding_values (source_id);

-- ---------------------------------------------------------------------------
-- RLS
--
-- A judgement call, recorded here and in HANDOFF/W1-A.md rather than left implicit.
--
-- tasks/W1-A says "Evidence tables: read for manager+, write for admin only."
-- Applied literally to ALL seven tables, the product cannot work: SYSTEM-PROMPT.md §2.1
-- requires every fact displayed to ANY user — including an anonymous visitor on the
-- landing page — to carry its source URL. If `sources` and `sourced_facts` were
-- manager-only, every public number would render with an unreachable citation, which is
-- precisely the failure CONTRACTS.md §1 exists to prevent.
--
-- The split drawn here:
--   PUBLIC   sources, source_snapshots, sourced_facts, fact_sources, fact_conflicts
--            — these ARE the citation shown beside a number, and the losing value that
--              SYSTEM-PROMPT.md §2.2 requires to stay "visible on demand". All of it is
--              scraped public competitor data; none of it is personal or financial.
--   MANAGER+ findings, finding_values — the internal self-assessment register with
--            severity ratings. This is the "source/conflict cockpit" that CONTRACTS.md §3
--            gates behind `evidence:view`, so the brief's rule applies here in full.
--
-- Writes are admin-only everywhere, exactly as the brief states.
-- ---------------------------------------------------------------------------

alter table public.sources          enable row level security;
alter table public.source_snapshots enable row level security;
alter table public.sourced_facts    enable row level security;
alter table public.fact_sources     enable row level security;
alter table public.fact_conflicts   enable row level security;
alter table public.findings         enable row level security;
alter table public.finding_values   enable row level security;

drop policy if exists sources_select_all on public.sources;
create policy sources_select_all on public.sources for select using (true);
drop policy if exists sources_admin_write on public.sources;
create policy sources_admin_write on public.sources for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists source_snapshots_select_all on public.source_snapshots;
create policy source_snapshots_select_all on public.source_snapshots for select using (true);
drop policy if exists source_snapshots_admin_write on public.source_snapshots;
create policy source_snapshots_admin_write on public.source_snapshots for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists sourced_facts_select_all on public.sourced_facts;
create policy sourced_facts_select_all on public.sourced_facts for select using (true);
drop policy if exists sourced_facts_admin_write on public.sourced_facts;
create policy sourced_facts_admin_write on public.sourced_facts for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists fact_sources_select_all on public.fact_sources;
create policy fact_sources_select_all on public.fact_sources for select using (true);
drop policy if exists fact_sources_admin_write on public.fact_sources;
create policy fact_sources_admin_write on public.fact_sources for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists fact_conflicts_select_all on public.fact_conflicts;
create policy fact_conflicts_select_all on public.fact_conflicts for select using (true);
drop policy if exists fact_conflicts_admin_write on public.fact_conflicts;
create policy fact_conflicts_admin_write on public.fact_conflicts for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists findings_select_manager on public.findings;
create policy findings_select_manager on public.findings for select
  using ((select public.has_role_level(70)));
drop policy if exists findings_admin_write on public.findings;
create policy findings_admin_write on public.findings for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists finding_values_select_manager on public.finding_values;
create policy finding_values_select_manager on public.finding_values for select
  using ((select public.has_role_level(70)));
drop policy if exists finding_values_admin_write on public.finding_values;
create policy finding_values_admin_write on public.finding_values for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select on public.sources, public.source_snapshots, public.sourced_facts,
  public.fact_sources, public.fact_conflicts to anon, authenticated;
grant select on public.findings, public.finding_values to authenticated;
revoke all on public.findings from anon;
revoke all on public.finding_values from anon;

revoke insert, update, delete on public.sources, public.source_snapshots, public.sourced_facts,
  public.fact_sources, public.fact_conflicts, public.findings, public.finding_values
  from anon, authenticated;
