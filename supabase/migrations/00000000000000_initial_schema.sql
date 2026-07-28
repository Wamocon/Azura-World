-- 00 · initial schema — Azura World CATI (INTERNAL-107, task W1-A)
--
-- Establishes the identity spine: `public.profiles` extending `auth.users`, the
-- signup trigger, the shared `updated_at` trigger function, and own-row RLS.
--
-- Two deliberate departures from the 1Çatı reference `00000000000000_initial_schema.sql`,
-- both of which that project had to correct in a later migration:
--
--   1. `handle_new_user()` NEVER reads a role out of `raw_user_meta_data`.
--      `user_metadata` is client-mutable, so honouring a requested role at signup is a
--      privilege-escalation hole. Every new account lands on 'tenant'; elevation is an
--      explicit administrative act (see migration 01).
--   2. The role CHECK lists all eleven roles from CONTRACTS.md §3 from the outset, so
--      this file is coherent on its own. Migration 01 replaces it with a real enum.
--
-- SYSTEM-PROMPT.md §2.5: RLS ships in the same migration as the table it protects.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

-- `gen_random_uuid()` is in core since PostgreSQL 13, but HANDOFF/W0-ENV.md asked for
-- the guard to be kept: pgcrypto is already installed in `extensions` on the linked
-- project and other digest functions depend on it.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Shared trigger helper
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Generic BEFORE UPDATE trigger: stamps updated_at with now(). Attached by every table that carries the column.';

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  full_name    text,
  -- Replaced by the public.app_role enum in migration 01. Listed in CONTRACTS.md §3 order.
  role         text not null default 'tenant',
  phone        text,
  locale       text not null default 'de',
  -- FK to public.companies is added in migration 02, where that table is created.
  company_id   uuid,
  is_active    boolean not null default true,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Application identity, 1:1 with auth.users. The role column here is the ONLY authoritative role source — never read a role from a JWT claim.';
comment on column public.profiles.role is
  'Authoritative platform role. auth.jwt()->>''role'' is NOT authoritative: user_metadata is client-mutable.';

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in (
    'admin', 'manager', 'accountant', 'staff', 'owner', 'tenant',
    'guest', 'service_provider', 'child_owner', 'child_tenant', 'child_guest'
  ));

alter table public.profiles
  drop constraint if exists profiles_locale_check;
alter table public.profiles
  add constraint profiles_locale_check check (locale in ('de', 'en', 'tr', 'ru'));

-- Turkish collation on the display-sorted name column. CONVENTIONS.md §5:
-- "I".toLowerCase() is not "ı" in Turkish, and the default collation sorts
-- ı/İ/ş/ğ/ç/ö/ü wrongly for a Türkiye-based tenant directory.
alter table public.profiles
  alter column full_name type text collate "tr-TR-x-icu";

create index if not exists idx_profiles_role on public.profiles (role);
create index if not exists idx_profiles_company_id on public.profiles (company_id);
create index if not exists idx_profiles_is_active on public.profiles (is_active);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — own row only. Elevated read paths arrive in migration 01, once the
-- role helper functions exist. Shipping the table without RLS, even for one
-- migration, would leave a window where `anon` can read every profile.
-- ---------------------------------------------------------------------------

-- ENABLE, never FORCE. Every cross-table policy predicate in this schema is routed
-- through a SECURITY DEFINER helper owned by the table owner — that is how the
-- 1Çatı project's `…0037_fix_workforce_staff_rls_recursion` cycle is avoided here
-- from the start. FORCE would subject the owner to RLS too, so a helper reading
-- public.profiles would re-enter profiles' own policies and recurse (42P17).
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Signup trigger
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The role is hardcoded on purpose. Do not read it from NEW.raw_user_meta_data:
  -- that object is writable by the client during signup.
  insert into public.profiles (id, email, full_name, role, locale)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    'tenant',
    case
      when new.raw_user_meta_data ->> 'locale' in ('de', 'en', 'tr', 'ru')
        then new.raw_user_meta_data ->> 'locale'
      else 'de'
    end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT on auth.users. Creates the profile row at role ''tenant''. Never honours a client-supplied role.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Grants
--
-- Supabase's default privileges grant `anon` and `authenticated` full DML on every new
-- table in `public`. RLS restricts WHICH ROWS a role reaches; it does nothing about a role
-- holding INSERT on a table it should never write. Both have to be closed, and the revoke
-- must name each role — `revoke … from public` does not undo a grant made to a role by
-- name. Migration 13 sweeps for exactly this and fails the chain if it finds it.
--
-- UPDATE is granted per column. The privilege-escalation trigger in migration 01 already
-- rejects a role change, but a column grant is the stronger boundary: it makes the
-- privileged columns unwritable rather than merely guarded.
-- ---------------------------------------------------------------------------

revoke all on public.profiles from anon;
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone, locale, avatar_url) on public.profiles to authenticated;
