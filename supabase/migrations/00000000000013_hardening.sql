-- 13 · Hardening — grants, search_path pinning, SECURITY DEFINER audit (task W1-A)
--
-- The last migration. Everything here is a sweep that re-asserts a rule the earlier
-- migrations already followed, so that a table or function added later without the rule is
-- caught here rather than in production.
--
-- Three sweeps:
--   1. Default privileges — stop Supabase handing `authenticated` full DML on the NEXT
--      table somebody creates.
--   2. A verification function that fails loudly if any public function is missing a pinned
--      search_path, or if `anon` can execute a SECURITY DEFINER authority helper.
--   3. Re-assert the anon revocations, because a `create table` between migrations 00 and
--      here would have picked up the old defaults.

-- ---------------------------------------------------------------------------
-- 1. Default privileges
--
-- Supabase ships ALTER DEFAULT PRIVILEGES granting `anon` and `authenticated` full DML on
-- every new table in `public`. That default is why every migration in this chain ends with
-- an explicit revoke block. Narrowing the default means a table created without a grant
-- block is closed rather than open — the safe direction to fail in.
-- ---------------------------------------------------------------------------

alter default privileges in schema public
  revoke insert, update, delete, truncate on tables from anon;

alter default privileges in schema public
  revoke insert, update, delete, truncate on tables from authenticated;

alter default privileges in schema public
  revoke all on functions from anon;

alter default privileges in schema public
  revoke all on sequences from anon;

-- ---------------------------------------------------------------------------
-- 2. Sweep: every SECURITY DEFINER function in public pins an empty search_path
--
-- An unpinned SECURITY DEFINER function resolves unqualified names against the CALLER's
-- search_path. A caller who can create a schema earlier in that path can shadow
-- `public.profiles` with their own table and make the function read it — a privilege
-- escalation with no exploit code, just a CREATE TABLE.
--
-- This raises rather than repairs. A function that reached this point unpinned has a bug in
-- its own migration, and silently patching it here would hide that.
-- ---------------------------------------------------------------------------

do $$
declare
  v_unpinned text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into v_unpinned
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and not exists (
      select 1
      from unnest(coalesce(p.proconfig, array[]::text[])) as cfg(value)
      where cfg.value in ('search_path=', 'search_path=""')
    );

  if v_unpinned is not null then
    raise exception
      'SECURITY DEFINER functions without a pinned empty search_path: %. Add `set search_path = ''''` to each and re-run.',
      v_unpinned;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Sweep: anon must not execute any authority helper
--
-- Every function that answers "who is the caller and what may they reach" is listed here.
-- anon holding EXECUTE on one of these is not itself an escalation — they all resolve to
-- NULL or false without a session — but it is a reliable smell, and a future helper that
-- DOES leak would be caught by the same list.
-- ---------------------------------------------------------------------------

do $$
declare
  v_leaked text;
begin
  select string_agg(sig, ', ' order by sig)
    into v_leaked
  from (
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'current_user_role', 'current_user_role_level', 'has_role_level', 'is_admin',
        'is_service_context', 'current_user_company_id', 'current_user_guardian_id',
        'is_active_guardian_of', 'current_user_scope_profile_id', 'current_user_unit_ids',
        'current_user_can_view_unit', 'current_user_resident_ids',
        'current_user_assigned_ticket_ids', 'current_user_can_view_ticket',
        'current_user_can_access_thread', 'current_user_can_access_ai_conversation',
        'is_finance_visible_role', 'can_read_company_finance', 'can_write_company_finance',
        'can_read_unit_finance', 'can_read_own_wallet', 'current_user_wallet_ids',
        'is_invoice_vendor', 'role_level', 'role_scope', 'guardian_role_for'
      )
      and has_function_privilege('anon', p.oid, 'execute')
  ) leaked;

  if v_leaked is not null then
    raise exception 'anon can execute authority helpers: %.', v_leaked;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Sweep: every table in public has RLS enabled
--
-- SYSTEM-PROMPT.md §2.5 requires RLS on every table holding personal or financial data, in
-- the same migration that creates it. This sweep is stricter — it requires RLS on EVERY
-- public table — because a table nobody bothered to classify is exactly the one that turns
-- out to hold something sensitive.
-- ---------------------------------------------------------------------------

do $$
declare
  v_open text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into v_open
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if v_open is not null then
    raise exception 'Tables in public without row level security: %.', v_open;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Sweep: no table in public grants write access to anon
-- ---------------------------------------------------------------------------

do $$
declare
  v_writable text;
begin
  select string_agg(distinct c.relname, ', ' order by c.relname)
    into v_writable
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and (
      has_table_privilege('anon', c.oid, 'insert')
      or has_table_privilege('anon', c.oid, 'update')
      or has_table_privilege('anon', c.oid, 'delete')
    );

  if v_writable is not null then
    raise exception 'anon holds write privileges on: %.', v_writable;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Re-assert: the append-only ledgers and the outbox stay closed
--
-- Restated rather than assumed. These three are the tables where a stray grant does the
-- most damage, and repeating the revoke costs nothing.
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate on public.audit_events from anon, authenticated;
revoke insert, update, delete, truncate on public.access_events from anon, authenticated;
revoke all on public.integration_outbox from anon, authenticated;
revoke all on table public.operational_search_documents from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Schema-level grants
--
-- USAGE on the schema only. Without it PostgREST cannot resolve any table name at all; with
-- it and nothing else, a role still reaches only what its table grants allow.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

-- service_role is the server-side identity. It has rolbypassrls, so RLS does not constrain
-- it — which is exactly why the application must never hand it to a browser, and why
-- CONVENTIONS.md §4 makes importing the service-role client into anything under
-- components/ a review failure.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;
