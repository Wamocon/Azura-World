-- pgTAP · 04 — RLS negative: every role is refused what it must not reach (task W1-A)
--
-- The important file. tasks/W1-A: "Negative tests matter more than positive ones. A
-- permission test that only checks the happy path proves nothing about security."
--
-- Every denial below is made non-vacuous by a seeded fixture:
--
--   AZW-B01-0001  withheld from the catalogue, held by owner   (profile …05)
--   AZW-B01-0002  withheld from the catalogue, held by a SECOND owner with no login
--   AZW-B01-0003  withheld from the catalogue, rented by tenant (profile …06)
--
-- Without those three, "an owner cannot read another owner's unit" would be true for the
-- uninteresting reason that every unit is in the public sales catalogue.
--
-- Two denial shapes appear, and they are not interchangeable:
--   * a write the role holds NO GRANT for raises 42501           → throws_ok
--   * a write the role may issue but no row matches under RLS
--     silently affects ZERO rows                                 → CTE row-count
-- Both are asserted, each on a table where it is the real behaviour. A data-modifying CTE
-- must be at the top level of its statement, so the row-count form cannot be nested inside
-- is() — it is written as `with changed as (...) select is(...) from changed`.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;

select plan(77);

-- The guardian's own unit set, captured while impersonating the guardian, so the
-- child_owner section can assert equality against what the guardian ACTUALLY sees rather
-- than against a literal somebody has to keep in sync.
create temp table guardian_unit_set (unit_id text) on commit drop;
grant select, insert on guardian_unit_set to authenticated;

-- ---------------------------------------------------------------------------
-- 1. The privilege surface, before any impersonation.
--
-- RLS decides WHICH ROWS a role reaches. It says nothing about a role holding EXECUTE on
-- an authority helper or INSERT on a table it must never write, so both are asserted
-- against the catalogue directly.
-- ---------------------------------------------------------------------------

reset role;

select ok(not coalesce(has_function_privilege('anon', 'public.current_user_role()', 'execute'), false),
  'anon cannot execute the role resolver');
select ok(not coalesce(has_function_privilege('anon', 'public.is_admin()', 'execute'), false),
  'anon cannot execute the administrator predicate');
select ok(not coalesce(has_function_privilege('anon', 'public.has_role_level(integer)', 'execute'), false),
  'anon cannot execute the role-threshold check');
select ok(not coalesce(has_function_privilege('anon', 'public.current_user_unit_ids()', 'execute'), false),
  'anon cannot execute the unit-scope resolver');
select ok(not coalesce(has_function_privilege('anon', 'public.current_user_scope_profile_id()', 'execute'), false),
  'anon cannot execute the guardian-scope resolver');

select ok(
  not has_table_privilege('anon', 'public.residents', 'select')
  and not has_table_privilege('anon', 'public.unit_residents', 'select')
  and not has_table_privilege('anon', 'public.profiles', 'select'),
  'anon holds no privilege at all on the personal-data tables');

select ok(
  not has_table_privilege('anon', 'public.units', 'insert')
  and not has_table_privilege('anon', 'public.units', 'update')
  and not has_table_privilege('anon', 'public.units', 'delete'),
  'anon holds no write privilege on the inventory');

select ok(
  not has_table_privilege('authenticated', 'public.units', 'insert')
  and not has_table_privilege('authenticated', 'public.units', 'update')
  and not has_table_privilege('authenticated', 'public.units', 'delete'),
  'no logged-in role holds direct DML on the inventory — writes go through the service context');

select ok(
  not has_table_privilege('authenticated', 'public.guardianships', 'insert')
  and not has_table_privilege('authenticated', 'public.guardianships', 'update')
  and not has_table_privilege('authenticated', 'public.guardianships', 'delete'),
  'no logged-in role may create or revoke a guardianship');

select ok(
  not has_table_privilege('authenticated', 'public.audit_events', 'insert'),
  'no logged-in role may write the audit trail — a client that can write it can forge its own record');

-- ---------------------------------------------------------------------------
-- 2. owner (…05, holds AZW-B01-0001) vs the second owner's unit.
--    The headline denial of the whole schema.
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::integer from public.units where id = 'AZW-B01-0002'), 0,
  'AN OWNER CANNOT READ ANOTHER OWNER''S PRIVATE UNIT');
select ok(not public.current_user_can_view_unit('AZW-B01-0002'),
  'the unit-visibility helper refuses an owner the other owner''s unit');
select is((select count(*)::integer from public.units where not is_publicly_listed), 1,
  'an owner reaches exactly one withheld unit — its own — of the three that exist');
select is((select count(*)::integer from public.units where id = 'AZW-B01-0003'), 0,
  'an owner cannot read the unit a tenant rents');
select is((select count(*)::integer from public.residents
            where id = 'd0000000-0000-4000-8000-000000000002'), 0,
  'an owner cannot read the other owner''s personal record');
select is((select count(*)::integer from public.residents), 1,
  'an owner reads exactly one resident row of the three that exist');
select is((select count(*)::integer from public.findings), 0,
  'an owner cannot read the internal conflict register');
select is((select count(*)::integer from public.finding_values), 0,
  'an owner cannot read the values behind a finding');

select throws_ok(
  $dml$update public.units set unit_no = 'HIJACKED' where id = 'AZW-B01-0002'$dml$,
  '42501', null,
  'an owner cannot update another owner''s unit — the inventory carries no UPDATE grant for a logged-in role');

select throws_ok(
  $dml$insert into public.unit_residents (unit_id, resident_id, relation)
       values ('AZW-B01-0002', 'd0000000-0000-4000-8000-000000000001', 'owner')$dml$,
  '42501', null,
  'an owner cannot attach itself to another owner''s unit');

-- public.profiles is the one table a logged-in role may really UPDATE (four columns are
-- granted by name in migration 00), so it is the only place the silent-zero-rows shape of
-- an RLS write denial is observable at all.
with changed as (
  update public.profiles set full_name = 'Renamed By Another Owner'
   where id = 'b0000000-0000-4000-8000-000000000006' returning 1
)
select is(count(*)::integer, 0,
  'an owner cannot rename another user''s profile — RLS matches no row, so the update silently applies to none')
from changed;

with changed as (
  update public.profiles set full_name = 'Owner'
   where id = 'b0000000-0000-4000-8000-000000000005' returning 1
)
select is(count(*)::integer, 1,
  'the control: the same statement on the caller''s OWN profile changes exactly one row, so the zero above is authority and not a no-op')
from changed;

insert into guardian_unit_set select unit_id from public.current_user_unit_ids() u(unit_id);

-- ---------------------------------------------------------------------------
-- 3. child_owner (…09) — a strict subset of its guardian, never a widening
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000009","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select coalesce(array_agg(unit_id order by unit_id), array[]::text[])
     from public.current_user_unit_ids() u(unit_id)),
  (select coalesce(array_agg(unit_id order by unit_id), array[]::text[]) from guardian_unit_set),
  'a child_owner''s unit set is exactly its guardian''s — never one row wider');
select is((select count(*)::integer from public.units where id = 'AZW-B01-0002'), 0,
  'a child_owner cannot read what its guardian cannot read');
select ok(
  not exists (select 1 from public.current_user_unit_ids() u(unit_id) where u.unit_id = 'AZW-B01-0002'),
  'the other owner''s unit never enters the inherited unit set');
select is((select count(*)::integer from public.units where not is_publicly_listed), 1,
  'a child_owner reaches exactly one withheld unit — its guardian''s');
select is((select count(*)::integer from public.findings), 0,
  'a child_owner cannot read the conflict register');
select is((select count(*)::integer from public.profiles), 1,
  'a child_owner reads no profile but its own — not even its guardian''s');

select throws_ok(
  $dml$insert into public.guardianships (guardian_profile_id, child_profile_id, status)
       values ('b0000000-0000-4000-8000-000000000002',
               'b0000000-0000-4000-8000-000000000009', 'active')$dml$,
  '42501', null,
  'a child cannot grant itself a second guardian and inherit that guardian''s units');

-- ---------------------------------------------------------------------------
-- 4. child_tenant (…10) — cannot cross into the owner branch
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000010","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::integer from public.units where id = 'AZW-B01-0001'), 0,
  'a child_tenant cannot reach the owner''s unit');
select is((select count(*)::integer from public.units where id = 'AZW-B01-0002'), 0,
  'a child_tenant cannot reach the second owner''s unit');
select is(
  (select coalesce(array_agg(unit_id order by unit_id), array[]::text[])
     from public.current_user_unit_ids() u(unit_id)),
  array['AZW-B01-0003']::text[],
  'a child_tenant inherits its guardian''s single rented unit and nothing else');
select is((select count(*)::integer from public.residents), 1,
  'a child_tenant reads only the resident record of its guardian');

-- ---------------------------------------------------------------------------
-- 5. tenant (…06) — rents one unit, owns nothing
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::integer from public.units where id = 'AZW-B01-0001'), 0,
  'a tenant cannot read an owner''s private unit');
select is((select count(*)::integer from public.units where id = 'AZW-B01-0002'), 0,
  'a tenant cannot read the second owner''s private unit');
select is((select count(*)::integer from public.units where not is_publicly_listed), 1,
  'a tenant reaches exactly one withheld unit — the one it rents');
select is((select count(*)::integer from public.unit_residents), 1,
  'a tenant sees only its own residency edge, not the two ownership edges');
select is((select count(*)::integer from public.findings), 0,
  'a tenant cannot read the conflict register');

select throws_ok(
  $dml$insert into public.units (id, company_id, site_id, block_id, block_code, unit_no, sequence, layout)
       select 'AZW-B01-9999', u.company_id, u.site_id, u.block_id, u.block_code, '9999', 9999, u.layout
         from public.units u where u.id = 'AZW-B01-0003'$dml$,
  '42501', null,
  'a tenant cannot create a unit');

-- ---------------------------------------------------------------------------
-- 6. guest (…07) and child_guest (…11) — public data only
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000007","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::integer from public.units where not is_publicly_listed), 0,
  'a guest reaches no unit withheld from the public catalogue');
select is((select count(*)::integer from public.current_user_unit_ids() u(unit_id)), 0,
  'a guest holds no unit at all');
select is((select count(*)::integer from public.residents), 0,
  'a guest reads no personal data');
select is((select count(*)::integer from public.findings), 0,
  'a guest cannot read the conflict register');

select throws_ok(
  $dml$insert into public.residents (company_id, full_name)
       values ('11111111-1111-4111-8111-111111111111', 'Injected Resident')$dml$,
  '42501', null,
  'a guest cannot create a resident record');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
set local role authenticated;

select is(public.current_user_scope_profile_id(), '00000000-0000-0000-0000-000000000000'::uuid,
  'a child_guest with no recorded guardian resolves to the nil uuid, which matches no resident — a broken guardianship denies rather than leaks');
select is((select count(*)::integer from public.units where not is_publicly_listed), 0,
  'a child_guest reaches no withheld unit');
select is((select count(*)::integer from public.residents), 0,
  'a child_guest reads no personal data');

-- ---------------------------------------------------------------------------
-- 7. The evidence register is manager and above — with the control that proves it
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.findings), 0,
  'staff cannot read the conflict register — evidence review starts at manager');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.findings), 0,
  'an accountant cannot read the conflict register — finance scope is not evidence scope');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000008","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.findings), 0,
  'a service provider cannot read the conflict register');
select is((select count(*)::integer from public.units where not is_publicly_listed), 0,
  'a service provider reaches no withheld unit — vendor scope is not inventory scope');
select is((select count(*)::integer from public.residents), 0,
  'a service provider reads no resident record');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.findings), 24,
  'the control: a manager DOES read all 24 findings, so every zero above is authority and not an empty table');

-- ---------------------------------------------------------------------------
-- 8. A non-admin must not satisfy is_admin().
--
-- Regression test for a real privilege escalation this suite caught. is_admin() is
-- SECURITY DEFINER, so `current_user` inside it is the function's OWNER, not the caller.
-- The first version of is_service_context() tested `current_user in ('postgres', …)`,
-- which was therefore ALWAYS true — making every authenticated session an administrator
-- and opening every admin-only write policy in the schema. is_service_context() now tests
-- only the request's JWT role claim.
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
set local role authenticated;

select ok(not public.is_admin(), 'an owner does not satisfy is_admin()');
select ok(not public.is_service_context(),
  'an authenticated session is not a service context, whatever role the connection was opened as');
select ok(not public.has_role_level(70), 'an owner does not clear the manager threshold');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000007","role":"authenticated"}', true);
set local role authenticated;
select ok(not public.is_admin(), 'a guest does not satisfy is_admin()');

-- ---------------------------------------------------------------------------
-- 9. anon — the tables an unauthenticated visitor must not touch at all.
--    Each is a privilege denial, refused before RLS is ever consulted.
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select throws_ok('select count(*) from public.residents', '42501', null,
  'an anonymous visitor cannot read resident personal data');
select throws_ok('select count(*) from public.unit_residents', '42501', null,
  'an anonymous visitor cannot read who lives in which unit');
select throws_ok('select count(*) from public.findings', '42501', null,
  'an anonymous visitor cannot read the internal conflict register');
select throws_ok('select count(*) from public.profiles', '42501', null,
  'an anonymous visitor cannot enumerate profiles');
select throws_ok('select count(*) from public.audit_events', '42501', null,
  'an anonymous visitor cannot read the audit trail');
select throws_ok('select count(*) from public.finance_ledger_entries', '42501', null,
  'an anonymous visitor cannot read the ledger');
select throws_ok('select count(*) from public.documents', '42501', null,
  'an anonymous visitor cannot read stored documents');
select throws_ok('select count(*) from public.messages', '42501', null,
  'an anonymous visitor cannot read messages');
select throws_ok('select count(*) from public.integration_outbox', '42501', null,
  'an anonymous visitor cannot read the integration outbox');
select throws_ok('select count(*) from public.operational_search_documents', '42501', null,
  'an anonymous visitor cannot read the operational search projection');

select is((select count(*)::integer from public.units), 22,
  'an anonymous visitor reaches exactly the 22 public units and none of the 634 withheld ones');

select throws_ok(
  $dml$insert into public.residents (company_id, full_name)
       values ('11111111-1111-4111-8111-111111111111', 'Anonymous Injection')$dml$,
  '42501', null,
  'an anonymous visitor cannot create a resident record');

-- ---------------------------------------------------------------------------
-- 10. A deactivated profile resolves no authority — role AND residency.
--
-- The second bug this suite caught. current_user_scope_profile_id() used to fall through
-- to auth.uid() whenever guardian_role_for(current_user_role()) was null — which is also
-- the case when current_user_role() itself is null. A deactivated OWNER therefore kept
-- resolving its own unit set and kept reading its withheld unit, so deactivation revoked
-- role authority while silently leaving residency authority intact.
--
-- The flag is flipped under `reset role` because the escalation trigger refuses is_active
-- changes outside a service context, and set back the same way.
-- ---------------------------------------------------------------------------

-- The service-role claim is required here, and that requirement is itself the escalation
-- guard from migration 01 working: is_active is one of the three columns
-- prevent_profile_privilege_escalation() refuses to let a non-administrator change.
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.profiles set is_active = false where id = 'b0000000-0000-4000-8000-000000000005';

select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
set local role authenticated;

select is(public.current_user_role()::text, null,
  'a deactivated profile resolves no role at all, retained JWT or not');
select is(public.current_user_role_level(), 0, 'a deactivated profile resolves level 0');
select ok(not public.has_role_level(10), 'a deactivated profile clears no threshold');
select is(public.current_user_scope_profile_id(), '00000000-0000-0000-0000-000000000000'::uuid,
  'a deactivated profile resolves NO residency scope — deactivation revokes role and residency together');
select is((select count(*)::integer from public.current_user_unit_ids() u(unit_id)), 0,
  'a deactivated owner holds no units');
select is((select count(*)::integer from public.units where id = 'AZW-B01-0001'), 0,
  'a deactivated owner can no longer read the unit it holds');
select is((select count(*)::integer from public.units), 22,
  'a deactivated owner falls back to the public catalogue, losing its withheld unit');

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.profiles set is_active = true where id = 'b0000000-0000-4000-8000-000000000005';

select is((select is_active::text from public.profiles
            where id = 'b0000000-0000-4000-8000-000000000005'), 'true',
  'the fixture is restored: the owner profile is active again');

reset role;
select * from finish();
rollback;
