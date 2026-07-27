-- 06 · operations — service tickets, ticket history, activities, workforce, media reports
-- Azura World CATI (INTERNAL-107, task W1-A)
--
-- Mirrors the structure of 1Çatı's `…0006_service_operations_phase_08_09.sql` and
-- `…0045_activities.sql`. Three deliberate departures, all mandated rather than chosen:
--
--   MONEY. 1Çatı stores integer minor units (`estimated_cost_cents BIGINT`). tasks/W1-A says
--   "Money as numeric(14,2) plus a currency column. Never float." — and migration 02 already
--   set that precedent with units.asking_price_amount. numeric is exact, so this is not the
--   float error the rule guards against.
--
--   NO staff_members TABLE. 1Çatı routes assignment through `public.staff_members`, and its
--   policy pair — workforce_tasks policies reading staff_members, staff_members policies
--   reading workforce_tasks — is precisely the cycle that forced migration
--   `…0037_fix_workforce_staff_rls_recursion` (42P17). Here assignment is a direct
--   `assignee_profile_id uuid references public.profiles(id)`, so the field-worker read path
--   is a plain column compare with nothing to recurse into.
--
--   DENORMALISED SCOPE COLUMNS. Every table here carries its own company_id / site_id /
--   unit_id even where the parent already has them. That is not redundancy for convenience:
--   it is what lets each policy be a column compare instead of a join into another
--   RLS-protected table.
--
-- The one cross-table read that cannot be denormalised away — "a service_provider may see
-- the tickets its assigned tasks belong to" — is routed through the SECURITY DEFINER helper
-- `public.current_user_assigned_ticket_ids()`. Because that function runs as the table owner
-- and no table here is FORCE'd, the nested read does not re-enter workforce_tasks' policies.
--
-- Dependency direction, checked for acyclicity before anything was written:
--
--   service_tickets policies  →  current_user_assigned_ticket_ids()  →  workforce_tasks
--   workforce_tasks policies  →  (own columns + current_user_unit_ids())  →  NOTHING here
--   ticket_events policies    →  current_user_can_view_ticket()        →  service_tickets
--   media_reports policies    →  current_user_can_view_ticket()        →  service_tickets
--
-- workforce_tasks is the sink: no policy in this schema reads it except through the definer
-- helper, and its own policies read no other table in this migration.
--
-- SYSTEM-PROMPT.md §2.5: RLS ships in the same migration as the table it protects.

-- ---------------------------------------------------------------------------
-- 1. Domain enums
--
-- Real enums rather than CHECK constraints (which is what 1Çatı used), matching the
-- precedent set by migrations 01-03. An enum makes the permitted set mechanically testable
-- from pgTAP via enum_range().
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.ticket_status as enum (
    'draft', 'open', 'assigned', 'in_progress', 'blocked', 'resolved', 'closed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_priority as enum ('low', 'normal', 'high', 'urgent');
exception when duplicate_object then null; end $$;

comment on type public.ticket_priority is
  'One priority vocabulary shared by tickets and workforce tasks. 1Çatı uses ''medium'' for tasks and ''normal'' for tickets, and its own seed has to translate between them; there is no translation layer here to drift.';

do $$ begin
  create type public.ticket_severity as enum ('minor', 'moderate', 'major', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_category as enum (
    'maintenance', 'cleaning', 'security', 'technical', 'amenity',
    'billing', 'concierge', 'inspection', 'complaint', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_event_kind as enum (
    'created', 'status_changed', 'assigned', 'unassigned', 'comment', 'escalated',
    'sla_breached', 'cost_estimated', 'media_attached', 'resolved', 'reopened',
    'closed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.activity_status as enum (
    'draft', 'scheduled', 'open', 'full', 'in_progress', 'completed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.activity_category as enum (
    'wellness', 'sports', 'kids', 'social', 'excursion', 'dining', 'maintenance_window', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.workforce_task_status as enum (
    'open', 'assigned', 'in_progress', 'blocked', 'completed', 'verified', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.media_report_status as enum (
    'new', 'triaged', 'linked', 'resolved', 'rejected', 'spam'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. service_tickets
-- ---------------------------------------------------------------------------

create table if not exists public.service_tickets (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.companies(id) on delete cascade,
  site_id                   uuid not null references public.sites(id) on delete cascade,
  -- Nullable: a common-area ticket (lobby lighting, pool pump) belongs to no unit.
  -- ON DELETE SET NULL, never CASCADE — deleting a unit must not silently erase its
  -- operational history.
  unit_id                   text references public.units(id) on delete set null,
  ticket_no                 text not null,
  title                     text not null collate "tr-TR-x-icu",
  description               text,
  category                  public.ticket_category not null default 'other',
  priority                  public.ticket_priority not null default 'normal',
  status                    public.ticket_status not null default 'open',
  severity                  public.ticket_severity not null default 'moderate',
  requester_profile_id      uuid references public.profiles(id) on delete set null,
  assignee_profile_id       uuid references public.profiles(id) on delete set null,
  reported_at               timestamptz not null default now(),
  sla_due_at                timestamptz,
  resolved_at               timestamptz,
  closed_at                 timestamptz,
  estimated_cost            numeric(14, 2),
  currency                  public.currency_code,
  requires_finance_approval boolean not null default false,
  metadata                  jsonb not null default '{}'::jsonb,
  idempotency_key           text,
  version                   integer not null default 1,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- CONVENTIONS.md §6 / tasks/W1-A: ticket_no is unique PER COMPANY, not globally.
  unique (company_id, ticket_no),

  constraint service_tickets_ticket_no_shape check (char_length(ticket_no) between 3 and 32),
  constraint service_tickets_title_len check (char_length(title) between 1 and 200),
  constraint service_tickets_description_len check (description is null or char_length(description) <= 8000),

  -- 0 is a legitimate estimate here (a warranty callout is genuinely free), unlike
  -- units.asking_price_amount where migration 02 rejects 0 outright. Negative is not.
  constraint service_tickets_cost_non_negative check (estimated_cost is null or estimated_cost >= 0),

  -- A cost without its currency is the Housearch-quotes-USD bug wearing a different hat.
  constraint service_tickets_cost_needs_currency check (
    (estimated_cost is null and currency is null)
    or (estimated_cost is not null and currency is not null)
  ),

  constraint service_tickets_resolution_order check (
    resolved_at is null or resolved_at >= reported_at
  ),
  constraint service_tickets_close_order check (
    closed_at is null or closed_at >= reported_at
  )
);

comment on table public.service_tickets is
  'Resident and staff service requests. Personal data (requester identity, free-text description of a private dwelling) — RLS is not optional here (SYSTEM-PROMPT.md §2.5).';
comment on column public.service_tickets.version is
  'Optimistic concurrency. A stale write must return conflict (409); last-write-wins is a bug (CONVENTIONS.md §5).';
comment on column public.service_tickets.idempotency_key is
  'CONVENTIONS.md §4: idempotency keys on every public mutation. Nullable so staff-created and seeded rows need no key; uniqueness is enforced by a PARTIAL index, which is why it is an index and not a table constraint.';

create index if not exists idx_service_tickets_company_id on public.service_tickets (company_id);
create index if not exists idx_service_tickets_site_id on public.service_tickets (site_id);
create index if not exists idx_service_tickets_unit_id on public.service_tickets (unit_id);
create index if not exists idx_service_tickets_requester on public.service_tickets (requester_profile_id);
create index if not exists idx_service_tickets_assignee on public.service_tickets (assignee_profile_id);
create index if not exists idx_service_tickets_company_status on public.service_tickets (company_id, status, priority);
create index if not exists idx_service_tickets_reported_at on public.service_tickets (company_id, reported_at desc);

-- Open-work SLA queue. The predicate keeps closed history out of the index, which is most
-- of the table after the first season.
create index if not exists idx_service_tickets_sla_due on public.service_tickets (sla_due_at)
  where status not in (
    'resolved'::public.ticket_status,
    'closed'::public.ticket_status,
    'cancelled'::public.ticket_status
  );

create unique index if not exists ux_service_tickets_idempotency_key
  on public.service_tickets (company_id, idempotency_key)
  where idempotency_key is not null;

drop trigger if exists set_service_tickets_updated_at on public.service_tickets;
create trigger set_service_tickets_updated_at
  before update on public.service_tickets
  for each row execute function public.set_updated_at();

drop trigger if exists bump_service_tickets_version on public.service_tickets;
create trigger bump_service_tickets_version
  before update on public.service_tickets
  for each row execute function public.bump_row_version();

-- ---------------------------------------------------------------------------
-- 3. ticket_events — append-only history
-- ---------------------------------------------------------------------------

create table if not exists public.ticket_events (
  id               uuid primary key default gen_random_uuid(),
  -- ON DELETE RESTRICT, not CASCADE. tasks/W1-A: "Cascade deletes: never on financial or
  -- audit tables." A ticket carrying history cannot be deleted at all; it is cancelled.
  ticket_id        uuid not null references public.service_tickets(id) on delete restrict,
  -- Denormalised on purpose. Without it the staff read path would have to join into
  -- service_tickets — an RLS-protected table — which is the shape that produces 42P17.
  company_id       uuid not null references public.companies(id) on delete restrict,
  kind             public.ticket_event_kind not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  from_status      public.ticket_status,
  to_status        public.ticket_status,
  note             text,
  payload          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),

  constraint ticket_events_note_len check (note is null or char_length(note) <= 8000),
  -- A status_changed event that records no transition is a lie about what happened.
  constraint ticket_events_status_change_complete check (
    kind <> 'status_changed' or to_status is not null
  )
);

comment on table public.ticket_events is
  'Append-only ticket history. There is no updated_at column because a row here is never updated: UPDATE and DELETE are rejected by trigger AND revoked at the grant level. History you can edit is not history.';

create index if not exists idx_ticket_events_ticket_id on public.ticket_events (ticket_id, created_at desc);
create index if not exists idx_ticket_events_company_id on public.ticket_events (company_id, created_at desc);
create index if not exists idx_ticket_events_actor on public.ticket_events (actor_profile_id);
create index if not exists idx_ticket_events_kind on public.ticket_events (kind);

-- Belt and braces with the grant-level revoke below. The revoke stops `authenticated`;
-- this trigger also stops the service role, the seed, and a psql session connected as the
-- table owner — i.e. every path that RLS and grants do not cover.
create or replace function public.reject_ticket_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'public.ticket_events is append-only; % is not permitted. Append a corrective event instead.', tg_op
    using errcode = '42501';
  return null;
end;
$$;

drop trigger if exists reject_ticket_events_mutation on public.ticket_events;
create trigger reject_ticket_events_mutation
  before update or delete on public.ticket_events
  for each row execute function public.reject_ticket_event_mutation();

-- ---------------------------------------------------------------------------
-- 4. activities — scheduled site activities
-- ---------------------------------------------------------------------------

create table if not exists public.activities (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  site_id              uuid not null references public.sites(id) on delete cascade,
  title                text not null collate "tr-TR-x-icu",
  description          text,
  category             public.activity_category not null default 'other',
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  capacity             integer,
  location             text,
  status               public.activity_status not null default 'draft',
  organiser_profile_id uuid references public.profiles(id) on delete set null,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- An activity that ends before it starts is a data-entry error, not a zero-length event.
  -- Equality is permitted: a marker with no duration is legitimate.
  constraint activities_time_order check (ends_at >= starts_at),
  constraint activities_capacity_positive check (capacity is null or capacity > 0),
  constraint activities_title_len check (char_length(title) between 1 and 200),
  constraint activities_description_len check (description is null or char_length(description) <= 8000)
);

comment on column public.activities.capacity is
  'NULL means uncapped, not zero. CONVENTIONS.md §5 draws that distinction for prices; it applies to a headcount too, so 0 is rejected rather than stored and later read as "unlimited".';

create index if not exists idx_activities_company_id on public.activities (company_id);
create index if not exists idx_activities_site_id on public.activities (site_id);
create index if not exists idx_activities_organiser on public.activities (organiser_profile_id);
create index if not exists idx_activities_schedule on public.activities (company_id, starts_at desc);
create index if not exists idx_activities_status on public.activities (status);

drop trigger if exists set_activities_updated_at on public.activities;
create trigger set_activities_updated_at
  before update on public.activities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. workforce_tasks
--
-- The sink of the dependency graph described in the header. Nothing in this table's
-- policies reads another table in this migration, which is what makes the
-- service_provider path safe.
-- ---------------------------------------------------------------------------

create table if not exists public.workforce_tasks (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  site_id             uuid not null references public.sites(id) on delete cascade,
  -- Optional link. ON DELETE SET NULL so a task survives its ticket; the ticket cannot in
  -- fact be deleted while it has history (§3), so this is the residual case only.
  ticket_id           uuid references public.service_tickets(id) on delete set null,
  unit_id             text references public.units(id) on delete set null,
  -- Assignment is a profile FK, NOT a staff_members FK. See the header: the
  -- workforce_tasks <-> staff_members policy pair is the exact 42P17 cycle this schema
  -- refuses to construct.
  assignee_profile_id uuid references public.profiles(id) on delete set null,
  task_no             text not null,
  title               text not null collate "tr-TR-x-icu",
  team                text,
  status              public.workforce_task_status not null default 'open',
  priority            public.ticket_priority not null default 'normal',
  sla_due_at          timestamptz,
  started_at          timestamptz,
  completed_at        timestamptz,
  checklist           jsonb not null default '[]'::jsonb,
  field_note          text,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (company_id, task_no),

  constraint workforce_tasks_task_no_shape check (char_length(task_no) between 3 and 32),
  constraint workforce_tasks_title_len check (char_length(title) between 1 and 200),
  constraint workforce_tasks_field_note_len check (field_note is null or char_length(field_note) <= 8000),
  constraint workforce_tasks_completion_order check (
    completed_at is null or started_at is null or completed_at >= started_at
  )
);

comment on table public.workforce_tasks is
  'Field work assigned to a profile. A service_provider (30) sees ONLY rows where assignee_profile_id is their own id, and reaches the parent ticket through public.current_user_assigned_ticket_ids() rather than through a policy on this table.';

create index if not exists idx_workforce_tasks_company_id on public.workforce_tasks (company_id);
create index if not exists idx_workforce_tasks_site_id on public.workforce_tasks (site_id);
create index if not exists idx_workforce_tasks_ticket_id on public.workforce_tasks (ticket_id);
create index if not exists idx_workforce_tasks_unit_id on public.workforce_tasks (unit_id);
create index if not exists idx_workforce_tasks_company_status on public.workforce_tasks (company_id, status, priority);

-- Backs BOTH the assignee read policy and current_user_assigned_ticket_ids(). The helper is
-- called once per row of a service_tickets scan, so an unindexed lookup here would make
-- every ticket query quadratic (tasks/W1-A: "Index every FK used in an RLS policy").
create index if not exists idx_workforce_tasks_assignee
  on public.workforce_tasks (assignee_profile_id, ticket_id);

create index if not exists idx_workforce_tasks_sla_due on public.workforce_tasks (sla_due_at)
  where status not in (
    'completed'::public.workforce_task_status,
    'verified'::public.workforce_task_status,
    'cancelled'::public.workforce_task_status
  );

drop trigger if exists set_workforce_tasks_updated_at on public.workforce_tasks;
create trigger set_workforce_tasks_updated_at
  before update on public.workforce_tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. media_reports — public QR / photo intake
-- ---------------------------------------------------------------------------

create table if not exists public.media_reports (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  site_id               uuid references public.sites(id) on delete set null,
  -- Nullable: a QR sticker on a lift or a pool gate identifies a place, not a dwelling.
  unit_id               text references public.units(id) on delete set null,
  ticket_id             uuid references public.service_tickets(id) on delete set null,
  reporter_profile_id   uuid references public.profiles(id) on delete set null,
  reporter_name         text collate "tr-TR-x-icu",
  reporter_email        text,
  reporter_phone        text,
  description           text not null,
  -- Storage object paths, never public URLs. CONVENTIONS.md §4: signed URLs with a short
  -- TTL are minted at read time; no public buckets, so a path stored here leaks nothing.
  media_paths           text[] not null default '{}'::text[],
  status                public.media_report_status not null default 'new',
  is_public_intake      boolean not null default false,
  triaged_by_profile_id uuid references public.profiles(id) on delete set null,
  triaged_at            timestamptz,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint media_reports_description_len check (char_length(description) between 1 and 4000),
  constraint media_reports_reporter_name_len check (reporter_name is null or char_length(reporter_name) <= 200),
  constraint media_reports_reporter_email_len check (reporter_email is null or char_length(reporter_email) <= 320),
  constraint media_reports_reporter_phone_len check (reporter_phone is null or char_length(reporter_phone) <= 40),

  -- Length ceiling on an unauthenticated-in-spirit write path (CONVENTIONS.md §4).
  constraint media_reports_media_paths_bounded check (cardinality(media_paths) <= 20),

  -- A public-intake row with no way to reach the reporter is unactionable, and an
  -- unactionable row in a queue humans work is worse than a rejected insert.
  constraint media_reports_intake_needs_contact check (
    not is_public_intake
    or reporter_profile_id is not null
    or reporter_email is not null
    or reporter_phone is not null
  )
);

comment on table public.media_reports is
  'QR / photo damage-and-issue reports. The ONLY table in this migration that grants INSERT to `authenticated` — see the grants block for what bounds that exception.';
comment on column public.media_reports.is_public_intake is
  'Marks a row that arrived through the QR path rather than from staff. It is part of the INSERT policy predicate, not decoration: a guest may only ever write rows where this is true, which keeps a low-trust writer out of the staff-authored range of the table.';

create index if not exists idx_media_reports_company_id on public.media_reports (company_id);
create index if not exists idx_media_reports_site_id on public.media_reports (site_id);
create index if not exists idx_media_reports_unit_id on public.media_reports (unit_id);
create index if not exists idx_media_reports_ticket_id on public.media_reports (ticket_id);
create index if not exists idx_media_reports_reporter on public.media_reports (reporter_profile_id);
create index if not exists idx_media_reports_company_status on public.media_reports (company_id, status, created_at desc);
create index if not exists idx_media_reports_intake on public.media_reports (company_id, created_at desc)
  where is_public_intake;

drop trigger if exists set_media_reports_updated_at on public.media_reports;
create trigger set_media_reports_updated_at
  before update on public.media_reports
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Scope helpers
--
-- Defined AFTER the tables they read, deliberately. A `language sql` function body is
-- parsed and validated at CREATE time, so a helper written above public.workforce_tasks
-- would fail with "relation does not exist" — the reordering is not cosmetic.
--
-- These exist so that no RLS policy below ever contains a bare
-- `exists (select … from <another RLS-protected table>)`. SECURITY DEFINER + a non-FORCE'd
-- table means the nested read runs as the owner and does not re-enter the other table's
-- policies. Same mechanism as migrations 01 and 02.
-- ---------------------------------------------------------------------------

create or replace function public.current_user_assigned_ticket_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct wt.ticket_id
  from public.workforce_tasks wt
  where wt.assignee_profile_id = (select auth.uid())
    and wt.ticket_id is not null
    and wt.status <> 'cancelled'::public.workforce_task_status;
$$;

comment on function public.current_user_assigned_ticket_ids() is
  'Tickets the caller may reach BECAUSE a workforce task is assigned to them — the service_provider (level 30) read path. Written inline as `exists (select … from workforce_tasks)` inside a service_tickets policy this would recurse the moment any workforce_tasks policy referenced service_tickets (42P17). Assignment is personal, so it resolves auth.uid() and NOT current_user_scope_profile_id(): a child_* role must never inherit a guardian''s work queue.';

create or replace function public.current_user_can_view_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.service_tickets t
    where t.id = p_ticket_id
      and (
        public.is_admin()
        or (public.has_role_level(40) and t.company_id = public.current_user_company_id())
        -- Residency is inherited: scope_profile_id resolves a child_* role to its guardian
        -- and never wider (migration 01).
        or (public.has_role_level(8) and t.requester_profile_id = public.current_user_scope_profile_id())
        or (public.has_role_level(8) and t.unit_id is not null
            and t.unit_id in (select u.unit_id from public.current_user_unit_ids() u(unit_id)))
        -- Assignment is personal, not inherited.
        or t.assignee_profile_id = (select auth.uid())
        or t.id in (select a.ticket_id from public.current_user_assigned_ticket_ids() a(ticket_id))
      )
  );
$$;

comment on function public.current_user_can_view_ticket(uuid) is
  'The single definition of "may this caller see this ticket". ticket_events and media_reports both delegate here so the three tables cannot drift apart — a history row visible to someone who cannot see its ticket is a leak. Level 8 is child_tenant, the lowest role holding a residency relation: guest (5) and child_guest (3) fall below it and get no read path, which is the brief''s "guest may insert a media report but read nothing else".';

-- ---------------------------------------------------------------------------
-- 8. RLS
--
-- ENABLE, never FORCE — migration 00 explains why: FORCE subjects the table owner to RLS
-- too, so the SECURITY DEFINER helpers above would re-enter the policies they are called
-- from and recurse (42P17).
--
-- Read model, by role level (CONTRACTS.md §3):
--   admin (90)               → everything, plus the service context
--   staff (40) and above     → everything in their own company
--   service_provider (30)    → ONLY workforce_tasks assigned to them, and the tickets those
--                              tasks belong to. Nothing else in this migration.
--   owner (20) / tenant (10) → tickets, reports and tasks for units they hold, plus rows
--                              where they are the requester/reporter
--   child_owner (15) / child_tenant (8) → exactly their guardian's set. Never wider.
--   guest (5) / child_guest (3) → may INSERT a public-intake media report. Read nothing.
--   anon                     → nothing, enforced at the grant level.
--
-- Multiple SELECT policies on one table are OR'd by PostgreSQL, so each read path is a
-- separate named policy. That keeps 04-rls-negative.sql able to name the exact policy a
-- failing assertion is about.
-- ---------------------------------------------------------------------------

alter table public.service_tickets enable row level security;
alter table public.ticket_events   enable row level security;
alter table public.activities      enable row level security;
alter table public.workforce_tasks enable row level security;
alter table public.media_reports   enable row level security;

-- --- service_tickets --------------------------------------------------------

drop policy if exists service_tickets_select_staff on public.service_tickets;
create policy service_tickets_select_staff on public.service_tickets for select
  using (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  );

-- Residency paths gated at level 8 (child_tenant) so that guest (5) and child_guest (3) get
-- nothing even if someone holds a unit_residents row with relation 'guest' — migration 02
-- permits that relation, so the level gate is doing real work, not restating the join.
drop policy if exists service_tickets_select_own_unit on public.service_tickets;
create policy service_tickets_select_own_unit on public.service_tickets for select
  using (
    (select public.has_role_level(8))
    and unit_id is not null
    and unit_id in (select unit_id from public.current_user_unit_ids() u(unit_id))
  );

drop policy if exists service_tickets_select_requester on public.service_tickets;
create policy service_tickets_select_requester on public.service_tickets for select
  using (
    (select public.has_role_level(8))
    and requester_profile_id = (select public.current_user_scope_profile_id())
  );

-- Assignment is personal: auth.uid(), not the scope profile.
drop policy if exists service_tickets_select_assignee on public.service_tickets;
create policy service_tickets_select_assignee on public.service_tickets for select
  using (assignee_profile_id = (select auth.uid()));

-- THE service_provider path, and the reason §7 exists.
drop policy if exists service_tickets_select_assigned_task on public.service_tickets;
create policy service_tickets_select_assigned_task on public.service_tickets for select
  using (id in (select ticket_id from public.current_user_assigned_ticket_ids() t(ticket_id)));

drop policy if exists service_tickets_staff_write on public.service_tickets;
create policy service_tickets_staff_write on public.service_tickets for all
  using (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  )
  with check (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  );

-- --- ticket_events ----------------------------------------------------------

drop policy if exists ticket_events_select_staff on public.ticket_events;
create policy ticket_events_select_staff on public.ticket_events for select
  using (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  );

-- Everyone else sees exactly the history of the tickets they can already see. Delegating to
-- the helper rather than restating the ticket predicate is what stops the two from drifting.
drop policy if exists ticket_events_select_visible_ticket on public.ticket_events;
create policy ticket_events_select_visible_ticket on public.ticket_events for select
  using (public.current_user_can_view_ticket(ticket_id));

drop policy if exists ticket_events_insert_staff on public.ticket_events;
create policy ticket_events_insert_staff on public.ticket_events for insert
  with check (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  );

-- A resident may append a comment to a ticket they can see, and nothing else. The kind
-- restriction is the point: without it this policy would let a tenant forge a
-- 'status_changed' or 'resolved' entry in the audit trail.
drop policy if exists ticket_events_insert_comment on public.ticket_events;
create policy ticket_events_insert_comment on public.ticket_events for insert
  with check (
    kind = 'comment'::public.ticket_event_kind
    and actor_profile_id = (select auth.uid())
    and from_status is null
    and to_status is null
    and public.current_user_can_view_ticket(ticket_id)
  );

-- Deliberately no UPDATE and no DELETE policy on this table, at any role level, including
-- admin. The trigger in §3 would reject the statement anyway; the absence of a policy means
-- the attempt never even reaches it.

-- --- activities -------------------------------------------------------------

drop policy if exists activities_select_staff on public.activities;
create policy activities_select_staff on public.activities for select
  using (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  );

-- Residents see the published calendar. Draft rows stay internal: an activity still being
-- planned is not a promise to a resident.
drop policy if exists activities_select_resident on public.activities;
create policy activities_select_resident on public.activities for select
  using (
    (select public.has_role_level(8))
    and company_id = (select public.current_user_company_id())
    and status <> 'draft'::public.activity_status
  );

drop policy if exists activities_manager_write on public.activities;
create policy activities_manager_write on public.activities for all
  using (
    (select public.is_admin())
    or ((select public.has_role_level(70)) and company_id = (select public.current_user_company_id()))
  )
  with check (
    (select public.is_admin())
    or ((select public.has_role_level(70)) and company_id = (select public.current_user_company_id()))
  );

-- --- workforce_tasks --------------------------------------------------------
--
-- Every predicate below is a column compare or a call into a helper from migration 01/02.
-- None of them touches service_tickets. That is deliberate and load-bearing: it is the half
-- of the cycle that, in the reference project, closed the loop.

drop policy if exists workforce_tasks_select_staff on public.workforce_tasks;
create policy workforce_tasks_select_staff on public.workforce_tasks for select
  using (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  );

drop policy if exists workforce_tasks_select_assignee on public.workforce_tasks;
create policy workforce_tasks_select_assignee on public.workforce_tasks for select
  using (assignee_profile_id = (select auth.uid()));

drop policy if exists workforce_tasks_select_own_unit on public.workforce_tasks;
create policy workforce_tasks_select_own_unit on public.workforce_tasks for select
  using (
    (select public.has_role_level(8))
    and unit_id is not null
    and unit_id in (select unit_id from public.current_user_unit_ids() u(unit_id))
  );

drop policy if exists workforce_tasks_manager_write on public.workforce_tasks;
create policy workforce_tasks_manager_write on public.workforce_tasks for all
  using (
    (select public.is_admin())
    or ((select public.has_role_level(70)) and company_id = (select public.current_user_company_id()))
  )
  with check (
    (select public.is_admin())
    or ((select public.has_role_level(70)) and company_id = (select public.current_user_company_id()))
  );

-- A field worker progresses their own task. The WITH CHECK repeats the assignee test so the
-- same statement cannot hand the task to somebody else on the way out — a USING-only update
-- policy is an assignment-laundering hole.
drop policy if exists workforce_tasks_update_assignee on public.workforce_tasks;
create policy workforce_tasks_update_assignee on public.workforce_tasks for update
  using (assignee_profile_id = (select auth.uid()))
  with check (assignee_profile_id = (select auth.uid()));

-- --- media_reports ----------------------------------------------------------

drop policy if exists media_reports_select_staff on public.media_reports;
create policy media_reports_select_staff on public.media_reports for select
  using (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  );

drop policy if exists media_reports_select_own_unit on public.media_reports;
create policy media_reports_select_own_unit on public.media_reports for select
  using (
    (select public.has_role_level(8))
    and unit_id is not null
    and unit_id in (select unit_id from public.current_user_unit_ids() u(unit_id))
  );

drop policy if exists media_reports_select_reporter on public.media_reports;
create policy media_reports_select_reporter on public.media_reports for select
  using (
    (select public.has_role_level(8))
    and reporter_profile_id = (select public.current_user_scope_profile_id())
  );

drop policy if exists media_reports_select_linked_ticket on public.media_reports;
create policy media_reports_select_linked_ticket on public.media_reports for select
  using (ticket_id is not null and public.current_user_can_view_ticket(ticket_id));

-- Public intake. This is the one write any authenticated role may perform, guest (5) and
-- child_guest (3) included, and every conjunct bounds it:
--   is_public_intake      — a guest cannot author a row in the staff-authored range
--   status = 'new'        — cannot inject a row that is already triaged or resolved
--   ticket_id is null     — cannot attach itself to a ticket it is not allowed to read
--   reporter_profile_id   — cannot file under someone else's identity
--   company scope         — a guest profile often has no company_id yet (it is assigned at
--                           check-in), so the test is "matches, or the caller has none".
-- NOTE FOR W2-A: there is deliberately NO guest SELECT path, so this INSERT must be issued
-- with `Prefer: return=minimal`. A RETURNING clause needs a SELECT policy and fails 42501.
drop policy if exists media_reports_insert_intake on public.media_reports;
create policy media_reports_insert_intake on public.media_reports for insert
  with check (
    is_public_intake
    and status = 'new'::public.media_report_status
    and ticket_id is null
    and reporter_profile_id = (select auth.uid())
    and (
      (select public.current_user_company_id()) is null
      or company_id = (select public.current_user_company_id())
    )
  );

drop policy if exists media_reports_staff_write on public.media_reports;
create policy media_reports_staff_write on public.media_reports for all
  using (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  )
  with check (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  );

-- ---------------------------------------------------------------------------
-- 9. Grants
--
-- anon gets nothing at all here. None of these five tables has a public read path: unlike
-- units and sites in migration 02, operational data is never part of the showcase.
-- ---------------------------------------------------------------------------

revoke all on public.service_tickets from anon;
revoke all on public.ticket_events   from anon;
revoke all on public.activities      from anon;
revoke all on public.workforce_tasks from anon;
revoke all on public.media_reports   from anon;

revoke insert, update, delete on public.service_tickets from authenticated;
revoke insert, update, delete on public.ticket_events   from authenticated;
revoke insert, update, delete on public.activities      from authenticated;
revoke insert, update, delete on public.workforce_tasks from authenticated;
revoke insert, update, delete on public.media_reports   from authenticated;

grant select on public.service_tickets to authenticated;
grant select on public.ticket_events   to authenticated;
grant select on public.activities      to authenticated;
grant select on public.workforce_tasks to authenticated;
grant select on public.media_reports   to authenticated;

-- The single deliberate exception to the blanket revoke above: the brief requires a guest to
-- be able to file a public-intake media report. An RLS INSERT policy is unreachable without
-- the table privilege behind it, so media_reports_insert_intake would be dead text if this
-- GRANT were omitted. It must come after the REVOKE, and it grants INSERT only — never
-- UPDATE or DELETE, so a reporter can file a report and can never retract or triage one.
grant insert on public.media_reports to authenticated;

-- ticket_events carries no UPDATE/DELETE grant to anyone, matching the append-only trigger.

revoke all on function public.current_user_assigned_ticket_ids() from public, anon;
revoke all on function public.current_user_can_view_ticket(uuid) from public, anon;
revoke all on function public.reject_ticket_event_mutation() from public, anon, authenticated;

grant execute on function public.current_user_assigned_ticket_ids() to authenticated;
grant execute on function public.current_user_can_view_ticket(uuid) to authenticated;

-- Realtime publication registration for these tables is migration 12's, not this file's.
