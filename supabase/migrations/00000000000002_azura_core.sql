-- 02 · Azura core — companies, sites, blocks, floors, units, residents (task W1-A)
--
-- Mirrors 1Çatı's `…0002_site_crm_core.sql` in structure. Two deliberate departures,
-- both mandated by this project's brief rather than chosen:
--
--   MONEY. 1Çatı stores integer minor units (`amount_cents BIGINT`). tasks/W1-A says
--   "Money as numeric(14,2) plus a currency column. Never float." and W2-A's brief
--   documents the PostgREST consequence ("numeric(14,2) -> \"112000.00\", parse
--   explicitly"). The brief is stricter than the reference, so the brief wins.
--   `numeric` is exact, so this is not the float error the rule guards against.
--
--   UNIT IDENTITY. CONTRACTS.md §2 types `AzuraUnit.id` as the string "AZW-B03-0412",
--   and CONVENTIONS.md §6 fixes the format as AZW-B{block:02}-{seq:04}. The unit code
--   IS the identity here, so `units.id` is text, not a surrogate uuid.
--
-- Public-catalogue vs private-ERP read paths are separated by `units.is_publicly_listed`
-- — see the RLS block for why that column exists.

-- ---------------------------------------------------------------------------
-- Domain enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.unit_layout as enum (
    '1+1', '2+1', '3+1', '4+1', '5+1', '6+1',
    'penthouse', 'townhouse', 'villa', 'president_villa'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sale_status as enum ('available', 'reserved', 'sold', 'unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.unit_data_quality as enum (
    'portal_listing', 'official', 'modelled', 'source_missing'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.build_status as enum ('planned', 'under_construction', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.currency_code as enum ('EUR', 'USD', 'TRY', 'GBP');
exception when duplicate_object then null; end $$;

comment on type public.currency_code is
  'CONTRACTS.md §2 Money.currency. An enum, not free text: CONVENTIONS.md §5 forbids silent currency conversion, and a typo''d currency string is exactly how that happens.';

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------

create table if not exists public.companies (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  name             text not null,
  legal_name       text,
  country          text not null default 'Türkiye',
  default_currency public.currency_code not null default 'EUR',
  founded_year     integer check (founded_year between 1800 and 2100),
  website          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists set_companies_updated_at on public.companies;
create trigger set_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- profiles.company_id was created without its FK in migration 00, because
-- public.companies did not exist yet. Close it now.
do $$ begin
  alter table public.profiles
    add constraint profiles_company_id_fkey
    foreign key (company_id) references public.companies(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- sites
-- ---------------------------------------------------------------------------

create table if not exists public.sites (
  id                              uuid primary key default gen_random_uuid(),
  company_id                      uuid not null references public.companies(id) on delete cascade,
  code                            text not null unique,
  name                            text not null,
  country                         text not null default 'Türkiye',
  province                        text not null default 'Antalya',
  city                            text not null default 'Alanya',
  district                        text not null default 'Türkler',
  plot_area_sqm                   numeric(12, 2),
  green_area_sqm                  numeric(12, 2),
  building_footprint_sqm          numeric(12, 2),
  outdoor_facility_area_sqm       numeric(12, 2),
  residence_block_count           integer,
  building_count                  integer,
  floors_per_building             integer,
  total_units                     integer,
  construction_start              date,
  completion_date                 date,
  build_status                    public.build_status,
  distance_to_sea_m               integer,
  distance_to_alanya_centre_km    numeric(6, 2),
  distance_to_gazipasa_airport_km numeric(6, 2),
  distance_to_antalya_airport_km  numeric(6, 2),
  down_payment_percent            numeric(5, 2) check (down_payment_percent between 0 and 100),
  latitude                        numeric(9, 6),
  longitude                       numeric(9, 6),
  contact_phone                   text,
  contact_email                   text,
  contact_address                 text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

comment on table public.sites is
  'One row: AZW-TRK. Numeric columns are nullable on purpose — CONTRACTS.md §1 invariant 1 says an unestablished figure is NULL with confidence "gap", never a plausible default. The provenance for each of these lives in public.sourced_facts (migration 03).';

create index if not exists idx_sites_company_id on public.sites (company_id);

drop trigger if exists set_sites_updated_at on public.sites;
create trigger set_sites_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- site_blocks / site_floors
-- ---------------------------------------------------------------------------

create table if not exists public.site_blocks (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.sites(id) on delete cascade,
  code       text not null,
  name       text,
  floors     integer,
  unit_count integer,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, code)
);

create index if not exists idx_site_blocks_site_id on public.site_blocks (site_id);

drop trigger if exists set_site_blocks_updated_at on public.site_blocks;
create trigger set_site_blocks_updated_at
  before update on public.site_blocks
  for each row execute function public.set_updated_at();

create table if not exists public.site_floors (
  id         uuid primary key default gen_random_uuid(),
  block_id   uuid not null references public.site_blocks(id) on delete cascade,
  level      integer not null,
  label      text,
  unit_count integer,
  created_at timestamptz not null default now(),
  unique (block_id, level)
);

create index if not exists idx_site_floors_block_id on public.site_floors (block_id);

-- ---------------------------------------------------------------------------
-- units
-- ---------------------------------------------------------------------------

create table if not exists public.units (
  id                     text primary key,
  company_id             uuid not null references public.companies(id) on delete cascade,
  site_id                uuid not null references public.sites(id) on delete cascade,
  block_id               uuid not null references public.site_blocks(id) on delete cascade,
  floor_id               uuid references public.site_floors(id) on delete set null,
  block_code             text not null,
  unit_no                text not null,
  sequence               integer not null,
  layout                 public.unit_layout not null,
  interior_m2            numeric(8, 2),
  outdoor_m2             numeric(8, 2),
  floor_level            integer,
  asking_price_amount    numeric(14, 2),
  asking_price_currency  public.currency_code,
  sale_status            public.sale_status not null default 'unknown',
  data_quality           public.unit_data_quality not null default 'source_missing',
  is_publicly_listed     boolean not null default true,
  version                integer not null default 1,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- CONVENTIONS.md §6: AZW-B{block:02}-{seq:04}.
  constraint units_id_format check (id ~ '^AZW-B[0-9]{2}-[0-9]{4}$'),

  -- tasks/W1-A edge case: unit_no is unique PER BLOCK, not globally.
  unique (block_id, unit_no),

  -- CONVENTIONS.md §5: "a price of 0 is a bug; a price of null is an honest gap".
  -- 0 is therefore rejected outright rather than stored and later coerced.
  constraint units_price_positive check (asking_price_amount is null or asking_price_amount > 0),

  -- A price without its currency is the Housearch-quotes-USD bug waiting to happen.
  constraint units_price_needs_currency check (
    (asking_price_amount is null and asking_price_currency is null)
    or (asking_price_amount is not null and asking_price_currency is not null)
  )
);

comment on column public.units.data_quality is
  'CONTRACTS.md §2: "modelled" = synthesised to fill the 656-unit inventory and NEVER presented as a real listing. W3-C filters and counts on this column, so it is NOT NULL with a pessimistic default.';
comment on column public.units.is_publicly_listed is
  'Separates the public sales catalogue from the private ERP inventory. anon and guest can read only rows where this is true; owner/tenant reach their own units regardless. Without it, "owner cannot read another owner''s unit" is untestable, because a showcase whose catalogue is world-readable makes every unit visible to everyone.';
comment on column public.units.version is
  'Optimistic concurrency. A stale write must return conflict (409); last-write-wins is a bug (CONVENTIONS.md §5).';

create index if not exists idx_units_company_id on public.units (company_id);
create index if not exists idx_units_site_id on public.units (site_id);
create index if not exists idx_units_block_id on public.units (block_id);
create index if not exists idx_units_floor_id on public.units (floor_id);
create index if not exists idx_units_sale_status on public.units (sale_status);
create index if not exists idx_units_layout on public.units (layout);
create index if not exists idx_units_data_quality on public.units (data_quality);
create index if not exists idx_units_public on public.units (is_publicly_listed) where is_publicly_listed;

drop trigger if exists set_units_updated_at on public.units;
create trigger set_units_updated_at
  before update on public.units
  for each row execute function public.set_updated_at();

-- Optimistic concurrency: any UPDATE that changes a business column bumps version.
create or replace function public.bump_row_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version = old.version then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists bump_units_version on public.units;
create trigger bump_units_version
  before update on public.units
  for each row execute function public.bump_row_version();

-- ---------------------------------------------------------------------------
-- residents / unit_residents
-- ---------------------------------------------------------------------------

create table if not exists public.residents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  profile_id  uuid references public.profiles(id) on delete set null,
  full_name   text not null collate "tr-TR-x-icu",
  email       text,
  phone       text,
  nationality text,
  locale      text check (locale in ('de', 'en', 'tr', 'ru')),
  kind        text not null default 'individual' check (kind in ('individual', 'company')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.residents is
  'Personal data. RLS is not optional here (SYSTEM-PROMPT.md §2.5).';

create index if not exists idx_residents_company_id on public.residents (company_id);
create index if not exists idx_residents_profile_id on public.residents (profile_id);

drop trigger if exists set_residents_updated_at on public.residents;
create trigger set_residents_updated_at
  before update on public.residents
  for each row execute function public.set_updated_at();

create table if not exists public.unit_residents (
  id            uuid primary key default gen_random_uuid(),
  unit_id       text not null references public.units(id) on delete cascade,
  resident_id   uuid not null references public.residents(id) on delete cascade,
  relation      text not null check (relation in ('owner', 'tenant', 'guest')),
  share_percent numeric(5, 2) check (share_percent is null or (share_percent > 0 and share_percent <= 100)),
  start_date    date not null default current_date,
  end_date      date,
  is_primary    boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (unit_id, resident_id, relation),
  constraint unit_residents_dates check (end_date is null or end_date >= start_date)
);

comment on table public.unit_residents is
  'The owner/tenant -> unit edge. Every ownership predicate in this schema resolves through this table via public.current_user_unit_ids().';

create index if not exists idx_unit_residents_unit_id on public.unit_residents (unit_id);
create index if not exists idx_unit_residents_resident_id on public.unit_residents (resident_id);
create index if not exists idx_unit_residents_relation on public.unit_residents (relation);

-- ---------------------------------------------------------------------------
-- Scope helpers
--
-- These exist so that no RLS policy ever contains a bare
-- `exists (select … from <another RLS-protected table>)`. That construct is what
-- produced 42P17 in the reference project (`…0037_fix_workforce_staff_rls_recursion`).
-- SECURITY DEFINER + a non-FORCEd table means the nested read runs as the owner and
-- does not re-enter the other table's policies.
-- ---------------------------------------------------------------------------

create or replace function public.current_user_unit_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select ur.unit_id
  from public.unit_residents ur
  join public.residents r on r.id = ur.resident_id
  where r.profile_id = public.current_user_scope_profile_id()
    and (ur.end_date is null or ur.end_date >= current_date);
$$;

comment on function public.current_user_unit_ids() is
  'Units the caller may reach as owner/tenant/guest. Resolves through current_user_scope_profile_id(), so a child_* role transparently receives its GUARDIAN''s unit set and never more.';

create or replace function public.current_user_can_view_unit(p_unit_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role_level(40)
      or exists (select 1 from public.current_user_unit_ids() u(unit_id) where u.unit_id = p_unit_id);
$$;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Read model, by role level:
--   staff (40) and above  → the whole company inventory
--   owner/tenant (10-20)  → their own units, plus the public catalogue
--   child_* (3-15)        → exactly their guardian's set, via the scope helper
--   guest (5) / anon      → the public catalogue only
--
-- The public catalogue path is required, not a convenience: the landing page and
-- the hotel/report surfaces are read by unauthenticated visitors through the anon
-- key, so without it those pages render empty.
-- ---------------------------------------------------------------------------

alter table public.companies     enable row level security;
alter table public.sites         enable row level security;
alter table public.site_blocks   enable row level security;
alter table public.site_floors   enable row level security;
alter table public.units         enable row level security;
alter table public.residents     enable row level security;
alter table public.unit_residents enable row level security;

-- Reference data: the project, its blocks and its floors are public showcase facts.
drop policy if exists companies_select_all on public.companies;
create policy companies_select_all on public.companies for select using (true);

drop policy if exists companies_admin_write on public.companies;
create policy companies_admin_write on public.companies for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists sites_select_all on public.sites;
create policy sites_select_all on public.sites for select using (true);

drop policy if exists sites_manager_write on public.sites;
create policy sites_manager_write on public.sites for all to authenticated
  using ((select public.has_role_level(70))) with check ((select public.has_role_level(70)));

drop policy if exists site_blocks_select_all on public.site_blocks;
create policy site_blocks_select_all on public.site_blocks for select using (true);

drop policy if exists site_blocks_manager_write on public.site_blocks;
create policy site_blocks_manager_write on public.site_blocks for all to authenticated
  using ((select public.has_role_level(70))) with check ((select public.has_role_level(70)));

drop policy if exists site_floors_select_all on public.site_floors;
create policy site_floors_select_all on public.site_floors for select using (true);

drop policy if exists site_floors_manager_write on public.site_floors;
create policy site_floors_manager_write on public.site_floors for all to authenticated
  using ((select public.has_role_level(70))) with check ((select public.has_role_level(70)));

-- units — three read paths, OR'd by PostgreSQL.
drop policy if exists units_select_public on public.units;
create policy units_select_public on public.units for select
  using (is_publicly_listed);

drop policy if exists units_select_staff on public.units;
create policy units_select_staff on public.units for select to authenticated
  using ((select public.has_role_level(40)));

drop policy if exists units_select_own on public.units;
create policy units_select_own on public.units for select to authenticated
  using (id in (select unit_id from public.current_user_unit_ids() u(unit_id)));

drop policy if exists units_manager_write on public.units;
create policy units_manager_write on public.units for all to authenticated
  using ((select public.has_role_level(70))) with check ((select public.has_role_level(70)));

-- residents — personal data. No public path at all.
drop policy if exists residents_select_self on public.residents;
create policy residents_select_self on public.residents for select to authenticated
  using (profile_id = (select public.current_user_scope_profile_id()));

drop policy if exists residents_select_staff on public.residents;
create policy residents_select_staff on public.residents for select to authenticated
  using ((select public.has_role_level(40)));

drop policy if exists residents_manager_write on public.residents;
create policy residents_manager_write on public.residents for all to authenticated
  using ((select public.has_role_level(70))) with check ((select public.has_role_level(70)));

drop policy if exists unit_residents_select_own on public.unit_residents;
create policy unit_residents_select_own on public.unit_residents for select to authenticated
  using (unit_id in (select unit_id from public.current_user_unit_ids() u(unit_id)));

drop policy if exists unit_residents_select_staff on public.unit_residents;
create policy unit_residents_select_staff on public.unit_residents for select to authenticated
  using ((select public.has_role_level(40)));

drop policy if exists unit_residents_manager_write on public.unit_residents;
create policy unit_residents_manager_write on public.unit_residents for all to authenticated
  using ((select public.has_role_level(70))) with check ((select public.has_role_level(70)));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select on public.companies, public.sites, public.site_blocks, public.site_floors, public.units to anon, authenticated;
grant select on public.residents, public.unit_residents to authenticated;
revoke all on public.residents from anon;
revoke all on public.unit_residents from anon;

revoke insert, update, delete on public.companies, public.sites, public.site_blocks,
  public.site_floors, public.units, public.residents, public.unit_residents from anon, authenticated;

revoke all on function public.current_user_unit_ids() from public, anon;
revoke all on function public.current_user_can_view_unit(text) from public, anon;
grant execute on function public.current_user_unit_ids() to authenticated;
grant execute on function public.current_user_can_view_unit(text) to authenticated;
