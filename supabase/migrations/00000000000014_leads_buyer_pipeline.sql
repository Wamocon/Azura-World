-- 14 · Leads and buyer pipeline (task W1-A)
--
-- NOT IN THE BRIEF'S MIGRATION TABLE, and added deliberately. tasks/W1-A lists migrations
-- 00-13 and none of them creates a leads table — but CONTRACTS.md §3 freezes `leads` and
-- `buyer_pipeline` as resources, tasks/W2-A requires a `lead-repository.ts` serving "leads,
-- buyer pipeline", and W3-C owns a `dashboard/buyer-pipeline` route. Three frozen documents
-- assume this table exists.
--
-- The alternative was a repository with no schema behind it, permanently stuck in
-- local-seed mode. SYSTEM-PROMPT.md §4.4 is explicit that a stub which compiles is worse
-- than a clean block, and this is the same principle one layer down: a repository that can
-- never reach Supabase is a stub wearing a real interface.
--
-- Numbered 14 rather than inserted, because CONVENTIONS.md §6 says migrations are
-- sequential and NEVER renumbered. Recorded in HANDOFF/W1-A.md as an addition.

do $$ begin
  create type public.lead_status as enum (
    'new', 'contacted', 'qualified', 'viewing_booked', 'offer_made',
    'negotiating', 'won', 'lost', 'dormant'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_source as enum (
    'website', 'portal', 'referral', 'walk_in', 'phone', 'email',
    'social', 'exhibition', 'partner_agent', 'unknown'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.pipeline_stage as enum (
    'enquiry', 'qualification', 'viewing', 'reservation',
    'contract', 'payment', 'title_deed', 'handover', 'closed'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------

create table if not exists public.leads (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  site_id             uuid references public.sites(id) on delete set null,
  -- The unit a lead is interested in. TEXT, matching units.id.
  unit_id             text references public.units(id) on delete set null,
  reference           text not null,
  full_name           text not null collate "tr-TR-x-icu",
  email               text,
  phone               text,
  locale              text not null default 'de' check (locale in ('de', 'en', 'tr', 'ru')),
  nationality         text,
  status              public.lead_status not null default 'new',
  source              public.lead_source not null default 'unknown',
  source_detail       text,
  -- Budget is money, so it obeys the same rule as every other amount in this schema:
  -- numeric(14,2) with its currency beside it, never a bare number.
  budget_amount       numeric(14, 2) check (budget_amount is null or budget_amount > 0),
  budget_currency     public.currency_code,
  desired_layout      public.unit_layout,
  assigned_to         uuid references public.profiles(id) on delete set null,
  score               smallint check (score is null or score between 0 and 100),
  notes               text,
  last_contacted_at   timestamptz,
  next_action_at      timestamptz,
  lost_reason         text,
  consent_marketing   boolean not null default false,
  metadata            jsonb not null default '{}'::jsonb,
  version             integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (company_id, reference),

  constraint leads_budget_needs_currency check (
    (budget_amount is null and budget_currency is null)
    or (budget_amount is not null and budget_currency is not null)
  ),

  -- A lead has to be reachable somehow, or it is a row nobody can act on.
  constraint leads_contactable check (email is not null or phone is not null),

  -- "Lost" without a reason teaches nothing. The whole point of tracking lost leads is
  -- the reason.
  constraint leads_lost_needs_reason check (
    status <> 'lost' or nullif(btrim(lost_reason), '') is not null
  )
);

comment on table public.leads is
  'Sales enquiries. Personal data — RLS is not optional (SYSTEM-PROMPT.md §2.5). consent_marketing defaults to FALSE: consent is something a person gives, never something a default asserts on their behalf.';
comment on column public.leads.consent_marketing is
  'Defaults to false. An opt-in that defaults to true is not an opt-in.';

create index if not exists idx_leads_company_id on public.leads (company_id);
create index if not exists idx_leads_site_id on public.leads (site_id);
create index if not exists idx_leads_unit_id on public.leads (unit_id);
create index if not exists idx_leads_assigned_to on public.leads (assigned_to);
create index if not exists idx_leads_company_status on public.leads (company_id, status, created_at desc);
create index if not exists idx_leads_next_action on public.leads (next_action_at)
  where status not in ('won'::public.lead_status, 'lost'::public.lead_status);

drop trigger if exists set_leads_updated_at on public.leads;
create trigger set_leads_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

drop trigger if exists bump_leads_version on public.leads;
create trigger bump_leads_version
  before update on public.leads
  for each row execute function public.bump_row_version();

-- ---------------------------------------------------------------------------
-- buyer_pipeline_entries
-- ---------------------------------------------------------------------------

create table if not exists public.buyer_pipeline_entries (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  lead_id          uuid not null references public.leads(id) on delete cascade,
  unit_id          text references public.units(id) on delete set null,
  stage            public.pipeline_stage not null default 'enquiry',
  previous_stage   public.pipeline_stage,
  entered_stage_at timestamptz not null default now(),
  expected_close   date,
  deal_amount      numeric(14, 2) check (deal_amount is null or deal_amount > 0),
  deal_currency    public.currency_code,
  probability      smallint check (probability is null or probability between 0 and 100),
  owner_profile_id uuid references public.profiles(id) on delete set null,
  blocker          text,
  metadata         jsonb not null default '{}'::jsonb,
  version          integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint buyer_pipeline_deal_needs_currency check (
    (deal_amount is null and deal_currency is null)
    or (deal_amount is not null and deal_currency is not null)
  ),

  -- One live pipeline entry per lead. A lead sitting in two stages at once makes every
  -- funnel count wrong, in both directions.
  unique (lead_id)
);

comment on table public.buyer_pipeline_entries is
  'Where a lead currently sits in the sales funnel. One row per lead by constraint: a lead in two stages at once double-counts in every funnel report.';

create index if not exists idx_buyer_pipeline_company_id on public.buyer_pipeline_entries (company_id);
create index if not exists idx_buyer_pipeline_lead_id on public.buyer_pipeline_entries (lead_id);
create index if not exists idx_buyer_pipeline_unit_id on public.buyer_pipeline_entries (unit_id);
create index if not exists idx_buyer_pipeline_owner on public.buyer_pipeline_entries (owner_profile_id);
create index if not exists idx_buyer_pipeline_stage on public.buyer_pipeline_entries (company_id, stage, entered_stage_at desc);

drop trigger if exists set_buyer_pipeline_updated_at on public.buyer_pipeline_entries;
create trigger set_buyer_pipeline_updated_at
  before update on public.buyer_pipeline_entries
  for each row execute function public.set_updated_at();

drop trigger if exists bump_buyer_pipeline_version on public.buyer_pipeline_entries;
create trigger bump_buyer_pipeline_version
  before update on public.buyer_pipeline_entries
  for each row execute function public.bump_row_version();

-- Stage movement is history, so it is recorded rather than overwritten.
create or replace function public.track_pipeline_stage_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stage is distinct from old.stage then
    new.previous_stage := old.stage;
    new.entered_stage_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists track_pipeline_stage_change on public.buyer_pipeline_entries;
create trigger track_pipeline_stage_change
  before update on public.buyer_pipeline_entries
  for each row execute function public.track_pipeline_stage_change();

-- ---------------------------------------------------------------------------
-- RLS
--
-- Leads are commercial personal data. Nothing here is public, and a resident role has no
-- business reading the sales pipeline at all — this is one of the few tables where owner
-- and tenant get NOTHING rather than a scoped subset.
-- ---------------------------------------------------------------------------

alter table public.leads                  enable row level security;
alter table public.buyer_pipeline_entries enable row level security;

drop policy if exists leads_select_staff on public.leads;
create policy leads_select_staff on public.leads for select
  using (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  );

-- An agent always sees the leads assigned to them, even outside the staff path.
drop policy if exists leads_select_assignee on public.leads;
create policy leads_select_assignee on public.leads for select
  using (assigned_to = (select auth.uid()));

drop policy if exists leads_staff_write on public.leads;
create policy leads_staff_write on public.leads for all
  using (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  )
  with check (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  );

drop policy if exists buyer_pipeline_select_staff on public.buyer_pipeline_entries;
create policy buyer_pipeline_select_staff on public.buyer_pipeline_entries for select
  using (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  );

drop policy if exists buyer_pipeline_select_owner on public.buyer_pipeline_entries;
create policy buyer_pipeline_select_owner on public.buyer_pipeline_entries for select
  using (owner_profile_id = (select auth.uid()));

drop policy if exists buyer_pipeline_staff_write on public.buyer_pipeline_entries;
create policy buyer_pipeline_staff_write on public.buyer_pipeline_entries for all
  using (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  )
  with check (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.leads from anon;
revoke all on public.buyer_pipeline_entries from anon;

revoke insert, update, delete on public.leads from authenticated;
revoke insert, update, delete on public.buyer_pipeline_entries from authenticated;

grant select on public.leads to authenticated;
grant select on public.buyer_pipeline_entries to authenticated;

revoke all on function public.track_pipeline_stage_change() from public, anon, authenticated;
