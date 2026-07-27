-- 01 · RBAC — Azura World CATI (INTERNAL-107, task W1-A)
--
-- The SQL half of RBAC. W1-B owns the TypeScript half (`apps/web/lib/rbac.ts`).
-- CONTRACTS.md §3 freezes the role list so the two halves can be written in parallel
-- without talking; NEITHER window may change it.
--
-- Eleven roles, in CONTRACTS.md §3 order, as a real PostgreSQL enum. An enum rather
-- than a CHECK constraint (which is what 1Çatı used) because the contract also freezes
-- the ORDER, and `enum_range(null::public.app_role)` makes that order mechanically
-- testable — see supabase/tests/02-rbac.sql.
--
-- DIVERGENCE FROM THE REFERENCE, recorded deliberately: 1Çatı's `role_level()` scores the
-- five added roles differently (service_provider 25, guest 15, child_owner 7,
-- child_tenant 6, child_guest 5). CONTRACTS.md §3 is the frozen authority for this
-- project and it says 30 / 5 / 15 / 8 / 3. The contract wins. See HANDOFF/W1-A.md.
--
-- Every helper below is SECURITY DEFINER with `SET search_path = ''`. That is not
-- decoration: it is the mechanism that lets an RLS policy consult another table
-- without re-entering that table's policies. 1Çatı needed migration
-- `…0037_fix_workforce_staff_rls_recursion` to retrofit exactly this after shipping a
-- policy pair that recursed (42P17). No policy in this schema references another
-- table directly.

-- ---------------------------------------------------------------------------
-- 1. The role enum — CONTRACTS.md §3 order, exactly
-- ---------------------------------------------------------------------------

do $$
begin
  create type public.app_role as enum (
    'admin',
    'manager',
    'accountant',
    'staff',
    'owner',
    'tenant',
    'guest',
    'service_provider',
    'child_owner',
    'child_tenant',
    'child_guest'
  );
exception
  when duplicate_object then null;
end;
$$;

comment on type public.app_role is
  'The eleven platform roles, frozen by CONTRACTS.md §3. Declaration order is part of the contract and is asserted by supabase/tests/02-rbac.sql.';

-- Convert profiles.role from the bootstrap text column to the enum.
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  alter column role drop default;

alter table public.profiles
  alter column role type public.app_role using role::public.app_role;

alter table public.profiles
  alter column role set default 'tenant'::public.app_role;

-- ---------------------------------------------------------------------------
-- 2. Role hierarchy — CONTRACTS.md §3 `roleLevel`, value for value
-- ---------------------------------------------------------------------------

create or replace function public.role_level(p_role public.app_role)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'admin'            then 90
    when 'manager'          then 70
    when 'accountant'       then 60
    when 'staff'            then 40
    when 'service_provider' then 30
    when 'owner'            then 20
    when 'child_owner'      then 15
    when 'tenant'           then 10
    when 'child_tenant'     then 8
    when 'guest'            then 5
    when 'child_guest'      then 3
  end;
$$;

comment on function public.role_level(public.app_role) is
  'Mirrors CONTRACTS.md §3 roleLevel exactly. Must stay identical to roleLevel in apps/web/lib/rbac.ts (W1-B).';

create or replace function public.role_scope(p_role public.app_role)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'admin'            then 'company'
    when 'manager'          then 'site'
    when 'accountant'       then 'finance'
    when 'staff'            then 'field'
    when 'service_provider' then 'vendor'
    when 'owner'            then 'owned_unit'
    when 'tenant'           then 'rented_unit'
    when 'guest'            then 'public'
    when 'child_owner'      then 'managed_minor'
    when 'child_tenant'     then 'managed_minor'
    when 'child_guest'      then 'managed_minor'
  end;
$$;

-- The guardian a child_* role derives its (strictly narrower) authority from.
create or replace function public.guardian_role_for(p_role public.app_role)
returns public.app_role
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'child_owner'  then 'owner'::public.app_role
    when 'child_tenant' then 'tenant'::public.app_role
    when 'child_guest'  then 'guest'::public.app_role
    else null
  end;
$$;

comment on function public.guardian_role_for(public.app_role) is
  'Maps a child_* role to the adult role it shadows. CONTRACTS.md §3 additive-authority rule: a child role may never widen its guardian.';

-- ---------------------------------------------------------------------------
-- 3. Caller identity helpers
--
-- These are the ONLY sanctioned way for a policy to learn the caller's role.
-- Never read it from auth.jwt(): `user_metadata` is client-mutable, so a policy
-- that trusts it hands out admin to anyone who can call the signup endpoint.
-- ---------------------------------------------------------------------------

create or replace function public.is_service_context()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role')
      or coalesce(
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
           ''
         ) = 'service_role';
$$;

comment on function public.is_service_context() is
  'True for migrations, the seed and server-side service-role calls. An `authenticated` session can never satisfy it.';

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active
  limit 1;
$$;

comment on function public.current_user_role() is
  'The caller''s authoritative role, read from public.profiles. Returns NULL for anon and for a deactivated profile — a suspended account resolves no authority.';

create or replace function public.current_user_role_level()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.role_level(public.current_user_role()), 0);
$$;

create or replace function public.has_role_level(p_min_level integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.role_level(public.current_user_role()) >= p_min_level, false);
$$;

comment on function public.has_role_level(integer) is
  'Threshold check for "manager or above" style policies. Prefer this over enumerating roles inline.';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_service_context()
      or coalesce(public.current_user_role() = 'admin', false);
$$;

create or replace function public.current_user_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.company_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 4. Guardianships — the child_* ⊂ guardian relation
-- ---------------------------------------------------------------------------

create table if not exists public.guardianships (
  id                   uuid primary key default gen_random_uuid(),
  guardian_profile_id  uuid not null references public.profiles(id) on delete cascade,
  child_profile_id     uuid not null references public.profiles(id) on delete cascade,
  relation             text not null default 'guardian'
                         check (relation in ('parent', 'guardian', 'delegate')),
  status               text not null default 'active'
                         check (status in ('pending', 'active', 'revoked')),
  consent_recorded_at  timestamptz,
  created_at           timestamptz not null default now(),
  revoked_at           timestamptz,
  unique (guardian_profile_id, child_profile_id),
  constraint guardianships_no_self check (guardian_profile_id <> child_profile_id)
);

comment on table public.guardianships is
  'Links a child_* profile to the adult profile whose authority it shadows. A child never sees more than its guardian: repository and policy scoping resolve the child to the guardian''s unit set and then narrow it.';

create index if not exists idx_guardianships_guardian on public.guardianships (guardian_profile_id);
create index if not exists idx_guardianships_child on public.guardianships (child_profile_id);
create index if not exists idx_guardianships_status on public.guardianships (status);

create or replace function public.current_user_guardian_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.guardian_profile_id
  from public.guardianships g
  where g.child_profile_id = (select auth.uid())
    and g.status = 'active'
    and g.revoked_at is null
  limit 1;
$$;

comment on function public.current_user_guardian_id() is
  'The active guardian of the calling child_* profile, or NULL. SECURITY DEFINER so policies on other tables can resolve the guardian without re-entering guardianships'' own policies.';

create or replace function public.is_active_guardian_of(p_child uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.guardianships g
    where g.guardian_profile_id = (select auth.uid())
      and g.child_profile_id = p_child
      and g.status = 'active'
      and g.revoked_at is null
  );
$$;

-- The identity whose scope the caller inherits: itself for an adult role, its
-- guardian for a child_* role. Every ownership predicate in migration 02 routes
-- through this, which is what makes "child ⊆ guardian" structural rather than
-- a rule somebody has to remember.
create or replace function public.current_user_scope_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case
      when public.guardian_role_for(public.current_user_role()) is not null
        then public.current_user_guardian_id()
      else (select auth.uid())
    end,
    '00000000-0000-0000-0000-000000000000'::uuid
  );
$$;

comment on function public.current_user_scope_profile_id() is
  'Whose data the caller may reach: itself, or its guardian when the caller holds a child_* role. Falls back to the nil UUID (matches nothing) rather than NULL, so a broken guardianship denies rather than leaks.';

alter table public.guardianships enable row level security;

drop policy if exists guardianships_select on public.guardianships;
create policy guardianships_select
  on public.guardianships for select
  using (
    guardian_profile_id = (select auth.uid())
    or child_profile_id = (select auth.uid())
    or (select public.has_role_level(70))
  );

-- Only an administrator may create or revoke a guardianship. A child that could
-- write this table could grant itself a guardian and inherit that guardian's units.
drop policy if exists guardianships_admin_write on public.guardianships;
create policy guardianships_admin_write
  on public.guardianships for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 5. Privilege-escalation guard on profiles
-- ---------------------------------------------------------------------------

create or replace function public.prevent_profile_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    new.role is distinct from old.role
    or new.company_id is distinct from old.company_id
    or new.is_active is distinct from old.is_active
  ) and not public.is_admin() then
    raise exception 'Role, company and activation changes require an administrator.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_profile_privilege_escalation on public.profiles;
create trigger prevent_profile_privilege_escalation
  before update on public.profiles
  for each row execute function public.prevent_profile_privilege_escalation();

-- ---------------------------------------------------------------------------
-- 6. Profile policies, restated against the helpers
--
-- Migration 00 shipped own-row-only. Now that the role helpers exist, add the
-- elevated read path. `has_role_level(70)` is manager-and-above.
-- ---------------------------------------------------------------------------

drop policy if exists profiles_select_elevated on public.profiles;
create policy profiles_select_elevated
  on public.profiles for select
  using ((select public.has_role_level(70)));

-- A guardian can read the profile of a child it is responsible for.
drop policy if exists profiles_select_ward on public.profiles;
create policy profiles_select_ward
  on public.profiles for select
  using (public.is_active_guardian_of(id));

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write
  on public.profiles for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 7. Grants
--
-- Supabase's default privileges hand `authenticated` full DML on every new public
-- table and EXECUTE on every new public function. `REVOKE ... FROM PUBLIC, anon`
-- alone does not undo that explicit grant — it has to be revoked by name.
-- ---------------------------------------------------------------------------

revoke all on public.guardianships from anon;
revoke insert, update, delete on public.guardianships from authenticated;
grant select on public.guardianships to authenticated;

revoke all on function public.role_level(public.app_role) from public, anon;
revoke all on function public.role_scope(public.app_role) from public, anon;
revoke all on function public.guardian_role_for(public.app_role) from public, anon;
revoke all on function public.current_user_role() from public, anon;
revoke all on function public.current_user_role_level() from public, anon;
revoke all on function public.has_role_level(integer) from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_service_context() from public, anon;
revoke all on function public.current_user_company_id() from public, anon;
revoke all on function public.current_user_guardian_id() from public, anon;
revoke all on function public.is_active_guardian_of(uuid) from public, anon;
revoke all on function public.current_user_scope_profile_id() from public, anon;

grant execute on function public.role_level(public.app_role) to authenticated;
grant execute on function public.role_scope(public.app_role) to authenticated;
grant execute on function public.guardian_role_for(public.app_role) to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_role_level() to authenticated;
grant execute on function public.has_role_level(integer) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_service_context() to authenticated;
grant execute on function public.current_user_company_id() to authenticated;
grant execute on function public.current_user_guardian_id() to authenticated;
grant execute on function public.is_active_guardian_of(uuid) to authenticated;
grant execute on function public.current_user_scope_profile_id() to authenticated;
