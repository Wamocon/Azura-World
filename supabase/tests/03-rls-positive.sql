-- pgTAP · 03 — RLS positive: every role reaches what it should (task W1-A)
--
-- This file exists so the denials in 04-rls-negative.sql cannot be satisfied by an empty
-- table or a policy that denies everyone. For every "role X cannot read Y" there is a
-- "role X does read Z" here, against the same seeded fixtures.
--
-- Impersonation: `reset role`, set the JWT claims auth.uid() reads, then `set local role`.
-- Everything is `set local` and the file ends in rollback, so nothing survives the run.
--
-- Every expected number below was MEASURED against the seeded database before being
-- written down, not derived from the seed script by reading. The inventory is 656 units of
-- which only 22 are publicly listed: `is_publicly_listed` is false for all 631 modelled
-- units (they are never presented as real listings) and for the 3 units assigned to seeded
-- residents.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;

select plan(56);

-- --- admin (profile …01) ----------------------------------------------------

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(public.current_user_role()::text, 'admin',
  'an administrator''s role resolves from public.profiles, never from the JWT');
select is(public.current_user_role_level(), 90, 'the administrator level is CONTRACTS §3''s 90');
select ok(public.is_admin(), 'an administrator satisfies is_admin()');
select ok(public.has_role_level(70), 'an administrator clears the manager threshold');
select is((select count(*)::integer from public.units), 656,
  'an administrator reads the whole 656-unit inventory, withheld units included');
select is((select count(*)::integer from public.findings), 24,
  'an administrator reads the whole conflict register');
select is((select count(*)::integer from public.profiles), 11,
  'an administrator reads all eleven role profiles');
select is((select count(*)::integer from public.residents), 3,
  'an administrator reads every resident record');
select is((select count(*)::integer from public.guardianships), 2,
  'an administrator reads both guardianships');

-- --- manager (profile …02) --------------------------------------------------

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select is(public.current_user_role()::text, 'manager', 'a manager''s role resolves from public.profiles');
select is(public.current_user_role_level(), 70, 'the manager level is CONTRACTS §3''s 70');
select ok(not public.is_admin(), 'a manager is NOT an administrator');
select is((select count(*)::integer from public.units), 656, 'a manager reads the whole inventory');
select is((select count(*)::integer from public.findings), 24,
  'a manager reads all 24 findings — the conflict register starts at manager');
select is((select count(*)::integer from public.profiles), 11, 'a manager reads every role profile');

-- --- accountant (profile …03) and staff (profile …04) -----------------------

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;

select is(public.current_user_role()::text, 'accountant', 'an accountant''s role resolves');
select is(public.current_user_role_level(), 60, 'the accountant level is 60');
select is((select count(*)::integer from public.units), 656,
  'an accountant reads all 656 units — finance scope still clears the staff threshold');
select is((select count(*)::integer from public.residents), 3, 'an accountant reads every resident');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;

select is(public.current_user_role()::text, 'staff', 'a staff member''s role resolves');
select is(public.current_user_role_level(), 40, 'the staff level is 40');
select ok(public.has_role_level(40), 'staff sits exactly on the inventory threshold');
select is((select count(*)::integer from public.units), 656,
  'staff reads all 656 units, the withheld ones included');
select is((select count(*)::integer from public.unit_residents), 3,
  'staff reads every residency edge');

-- --- owner (profile …05) — holds AZW-B01-0001, which is NOT public ----------

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
set local role authenticated;

select is(public.current_user_role()::text, 'owner', 'an owner''s role resolves');
select is(public.current_user_role_level(), 20, 'the owner level is 20');
select is(public.current_user_scope_profile_id(), 'b0000000-0000-4000-8000-000000000005'::uuid,
  'an adult role scopes to itself, not to a guardian');
select is(
  (select coalesce(array_agg(unit_id order by unit_id), array[]::text[])
     from public.current_user_unit_ids() u(unit_id)),
  array['AZW-B01-0001']::text[],
  'an owner''s unit set is exactly the one unit it holds');
select ok(public.current_user_can_view_unit('AZW-B01-0001'),
  'the visibility helper admits an owner to its own unit');
select is((select count(*)::integer from public.units where id = 'AZW-B01-0001'), 1,
  'an owner reads its own unit even though it is withheld from the public catalogue');
select is((select count(*)::integer from public.units), 23,
  'an owner reads the 22 public units plus its own withheld one');
select is((select count(*)::integer from public.residents), 1,
  'an owner reads its own resident record');

-- --- tenant (profile …06) — rents AZW-B01-0003 ------------------------------

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
set local role authenticated;

select is(public.current_user_role()::text, 'tenant', 'a tenant''s role resolves');
select is(public.current_user_role_level(), 10, 'the tenant level is 10');
select is(
  (select coalesce(array_agg(unit_id order by unit_id), array[]::text[])
     from public.current_user_unit_ids() u(unit_id)),
  array['AZW-B01-0003']::text[],
  'a tenant''s unit set is exactly the unit it rents');
select is((select count(*)::integer from public.units where id = 'AZW-B01-0003'), 1,
  'a tenant reads the withheld unit it rents');

-- --- child_owner (profile …09) — guardian is the owner (…05) ----------------

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000009","role":"authenticated"}', true);
set local role authenticated;

select is(public.current_user_role()::text, 'child_owner', 'a child_owner''s role resolves');
select is(public.current_user_role_level(), 15,
  'the child_owner level is 15 — strictly below its guardian''s 20');
select is(public.current_user_scope_profile_id(), 'b0000000-0000-4000-8000-000000000005'::uuid,
  'a child_owner scopes to its GUARDIAN''s profile id, not to its own');
select is(
  (select coalesce(array_agg(unit_id order by unit_id), array[]::text[])
     from public.current_user_unit_ids() u(unit_id)),
  array['AZW-B01-0001']::text[],
  'a child_owner inherits exactly its guardian''s unit set');
select is((select count(*)::integer from public.units where id = 'AZW-B01-0001'), 1,
  'a child_owner reads its guardian''s withheld unit through the guardianship');

-- --- child_tenant (profile …10) --------------------------------------------

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000010","role":"authenticated"}', true);
set local role authenticated;

select is(public.current_user_scope_profile_id(), 'b0000000-0000-4000-8000-000000000006'::uuid,
  'a child_tenant scopes to the tenant it shadows');
select is(
  (select coalesce(array_agg(unit_id order by unit_id), array[]::text[])
     from public.current_user_unit_ids() u(unit_id)),
  array['AZW-B01-0003']::text[],
  'a child_tenant inherits exactly its guardian''s rented unit');

-- --- guest (profile …07) — the public catalogue only ------------------------

reset role;
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000007","role":"authenticated"}', true);
set local role authenticated;

select is(public.current_user_role()::text, 'guest', 'a guest''s role resolves');
select is(public.current_user_role_level(), 5, 'the guest level is 5');
select is((select count(*)::integer from public.units), 22,
  'a guest reads the 22-unit public catalogue');

-- --- anon — the public showcase, read through the anon key ------------------
--
-- This block is the regression test for a bug that shipped and was caught here: every
-- policy on public.units whose predicate calls an authority helper is `to authenticated`.
-- Without that, PostgreSQL evaluates those policies for anon too, anon cannot EXECUTE
-- has_role_level(), and the whole SELECT fails 42501 — so the landing page renders nothing.
-- `lives_ok` is the assertion that keeps it fixed.

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select lives_ok('select count(*) from public.units',
  'an anonymous visitor can read public.units AT ALL — the helper-calling policies are scoped to authenticated');
select is((select count(*)::integer from public.units), 22,
  'an anonymous visitor reads exactly the 22 publicly listed units');
select is((select count(*)::integer from public.sites), 1,
  'an anonymous visitor reads the site behind the landing page');
select is((select count(*)::integer from public.site_blocks), 7,
  'an anonymous visitor reads all seven residence blocks');
select is((select count(*)::integer from public.hotels), 1, 'an anonymous visitor reads the hotel');
select is((select count(*)::integer from public.review_sources), 3,
  'an anonymous visitor reads the three review sources');
select is((select count(*)::integer from public.portal_listings), 47,
  'an anonymous visitor reads all 47 harvested portal listings');
select is((select count(*)::integer from public.sources), 56,
  'an anonymous visitor reads the source register — every displayed fact must carry a reachable citation');
select is((select count(*)::integer from public.sourced_facts), 1354,
  'an anonymous visitor reads every sourced fact');
select ok((select count(*) from public.fact_conflicts) > 0,
  'an anonymous visitor reads the losing values of a conflicted fact, as SYSTEM-PROMPT §2.2 requires');

reset role;
select * from finish();
rollback;
