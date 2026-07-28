-- pgTAP · 02 — RBAC (task W1-A)
--
-- CONTRACTS.md §3 freezes eleven roles, their ORDER, and their levels, so that W1-A (SQL)
-- and W1-B (TypeScript) can be written in parallel without talking. This file is the SQL
-- half of that agreement, asserted mechanically. If W1-B's `roles` array or `roleLevel`
-- map ever diverges from these numbers, one of the two is wrong and this file says which.
--
-- The order assertion is the reason migration 01 uses a real enum rather than a CHECK
-- constraint: enum_range() returns declaration order, so the contract's ordering is
-- testable rather than merely documented.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;

select plan(51);

-- --- the enum itself --------------------------------------------------------

select has_type('public', 'app_role', 'public.app_role exists');

select is(
  (select array_agg(r::text order by r) from unnest(enum_range(null::public.app_role)) r),
  array['admin', 'manager', 'accountant', 'staff', 'owner', 'tenant',
        'guest', 'service_provider', 'child_owner', 'child_tenant', 'child_guest'],
  'the eleven roles are declared in CONTRACTS.md §3 order, exactly'
);

select is(
  (select count(*)::integer from unnest(enum_range(null::public.app_role))),
  11,
  'there are exactly eleven roles — no more, no fewer'
);

-- --- role_level: value for value against CONTRACTS.md §3 --------------------

select is(public.role_level('admin'),            90, 'admin is level 90');
select is(public.role_level('manager'),          70, 'manager is level 70');
select is(public.role_level('accountant'),       60, 'accountant is level 60');
select is(public.role_level('staff'),            40, 'staff is level 40');
select is(public.role_level('service_provider'), 30, 'service_provider is level 30');
select is(public.role_level('owner'),            20, 'owner is level 20');
select is(public.role_level('child_owner'),      15, 'child_owner is level 15');
select is(public.role_level('tenant'),           10, 'tenant is level 10');
select is(public.role_level('child_tenant'),      8, 'child_tenant is level 8');
select is(public.role_level('guest'),             5, 'guest is level 5');
select is(public.role_level('child_guest'),       3, 'child_guest is level 3');

-- --- the additive-authority rule -------------------------------------------
--
-- CONTRACTS.md §3: the five added roles sit STRICTLY BELOW the canonical six and may never
-- widen an existing role's permissions. Asserted as arithmetic rather than as prose.

select ok(
  public.role_level('child_owner') < public.role_level('owner'),
  'child_owner sits strictly below owner'
);
select ok(
  public.role_level('child_tenant') < public.role_level('tenant'),
  'child_tenant sits strictly below tenant'
);
select ok(
  public.role_level('child_guest') < public.role_level('guest'),
  'child_guest sits strictly below guest'
);
select ok(
  public.role_level('service_provider') < public.role_level('staff'),
  'service_provider sits below staff'
);
select ok(
  public.role_level('guest') < public.role_level('tenant'),
  'guest sits below tenant'
);

select is(
  (select count(*)::integer from unnest(enum_range(null::public.app_role)) r
   where public.role_level(r) is null),
  0,
  'every role has a level — an unlevelled role would silently score 0 in every policy'
);

select is(
  (select count(distinct public.role_level(r))::integer
   from unnest(enum_range(null::public.app_role)) r),
  11,
  'no two roles share a level — ties make "or above" thresholds ambiguous'
);

select is(
  (select max(public.role_level(r))::integer from unnest(enum_range(null::public.app_role)) r),
  90,
  'admin is the highest level'
);
select is(
  (select min(public.role_level(r))::integer from unnest(enum_range(null::public.app_role)) r),
  3,
  'child_guest is the lowest level'
);

-- --- role_scope and the guardian mapping -----------------------------------

select is(public.role_scope('admin'),   'company',    'admin scope is company');
select is(public.role_scope('manager'), 'site',       'manager scope is site');
select is(public.role_scope('owner'),   'owned_unit', 'owner scope is owned_unit');
select is(public.role_scope('tenant'),  'rented_unit','tenant scope is rented_unit');

select is(public.guardian_role_for('child_owner')::text,  'owner',  'child_owner shadows owner');
select is(public.guardian_role_for('child_tenant')::text, 'tenant', 'child_tenant shadows tenant');
select is(public.guardian_role_for('child_guest')::text,  'guest',  'child_guest shadows guest');
select is(public.guardian_role_for('owner'),  null, 'an adult role has no guardian role');
select is(public.guardian_role_for('admin'),  null, 'admin has no guardian role');

-- --- helper functions exist and are correctly declared ----------------------

select has_function('public', 'current_user_role', 'current_user_role() exists');
select has_function('public', 'is_admin', 'is_admin() exists');
select has_function('public', 'has_role_level', array['integer'], 'has_role_level(integer) exists');
select has_function('public', 'current_user_role_level', 'current_user_role_level() exists');
select has_function('public', 'current_user_scope_profile_id', 'current_user_scope_profile_id() exists');
select has_function('public', 'current_user_unit_ids', 'current_user_unit_ids() exists');
select has_function('public', 'is_active_guardian_of', array['uuid'], 'is_active_guardian_of(uuid) exists');

-- Every authority helper must be SECURITY DEFINER with an empty pinned search_path.
-- An unpinned definer function resolves unqualified names against the CALLER's
-- search_path, so anyone who can create a schema can shadow public.profiles and make the
-- function read their table instead. That is a privilege escalation with no exploit code.
select is(
  (select count(*)::integer
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('current_user_role', 'is_admin', 'has_role_level',
                       'current_user_role_level', 'current_user_scope_profile_id',
                       'current_user_unit_ids', 'current_user_guardian_id',
                       'is_active_guardian_of', 'current_user_company_id')
     and not p.prosecdef),
  0,
  'every authority helper is SECURITY DEFINER'
);

select is(
  (select count(*)::integer
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg(v)
       where cfg.v in ('search_path=', 'search_path=""')
     )),
  0,
  'every SECURITY DEFINER function in public pins an empty search_path'
);

-- --- anon may not execute any authority helper ------------------------------

select ok(not has_function_privilege('anon', 'public.current_user_role()', 'execute'),
  'anon cannot execute current_user_role()');
select ok(not has_function_privilege('anon', 'public.is_admin()', 'execute'),
  'anon cannot execute is_admin()');
select ok(not has_function_privilege('anon', 'public.has_role_level(integer)', 'execute'),
  'anon cannot execute has_role_level()');
select ok(not has_function_privilege('anon', 'public.current_user_unit_ids()', 'execute'),
  'anon cannot execute current_user_unit_ids()');
select ok(not has_function_privilege('anon', 'public.current_user_scope_profile_id()', 'execute'),
  'anon cannot execute current_user_scope_profile_id()');

-- --- the guardianship table -------------------------------------------------

select has_table('public', 'guardianships', 'guardianships exists');
select col_is_unique('public', 'guardianships', array['guardian_profile_id', 'child_profile_id'],
  'one guardianship per guardian/child pair');

select throws_ok(
  $ins$
    insert into public.guardianships (guardian_profile_id, child_profile_id)
    values ('b0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000005')
  $ins$,
  '23514',
  null,
  'a profile cannot be its own guardian'
);

-- --- the role column on profiles is the enum, and it is authoritative --------

select col_type_is('public', 'profiles', 'role', 'app_role',
  'profiles.role is the app_role enum, not free text');

select is(
  (select count(*)::integer from public.profiles where role is null),
  0,
  'no profile is missing a role'
);

select * from finish();
rollback;
