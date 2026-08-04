-- 00000000000024_close_read_leaks_ii.sql
--
-- Six findings from the second adversarial audit pass, each verified against the
-- live database before it was written and each measured again after. The agent
-- that produced this SQL proved every one behaviourally inside rolled-back
-- transactions rather than by reading policy text; the evidence is in the
-- workflow record and the summaries are inline below.
--


-- ===========================================================================
-- 1. Threads inherit the role floor the ticket policies already use.
--
-- current_user_can_view_ticket() gates BOTH of its residency paths at
-- has_role_level(8) — the floor that admits child_tenant (8) and everything
-- above it, and excludes guest (5) and child_guest (3). The three
-- media_reports residency policies use the same 8. This function did not, so a
-- guest holding a unit_residents row read the correspondence about that unit
-- while reading none of the tickets: proven at 6 threads and 19 messages
-- against 0 tickets.
--
-- Only the residency branch gains the floor. created_by and assigned_to are
-- self-authored, not inherited — a guest who opened a thread should still be
-- able to read it, and a vendor's assignment is personal. Widening the floor
-- to those two would take away a thread from the person who wrote it.
--
-- What breaks if this were wider (no floor, i.e. today): a guest with any
-- residency row reads every thread and message about that unit.
-- What breaks if it were narrower (floor on all branches): a guest loses the
-- thread it opened itself.
-- ===========================================================================
create or replace function public.current_user_can_access_thread(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.threads t
    where t.id = p_thread_id
      and (
        public.is_admin()
        -- staff (40)+ : company-wide
        or (
          public.has_role_level(40)
          and t.company_id = public.current_user_company_id()
        )
        -- owner / tenant : threads about a unit they hold. child_* resolves to the
        -- guardian's unit set inside current_user_unit_ids() and never wider.
        -- The level-8 floor is new: residency admits you to the building, not to
        -- the correspondence about it.
        or (
          public.has_role_level(8)
          and t.unit_id is not null
          and t.unit_id in (select unit_id from public.current_user_unit_ids() u(unit_id))
        )
        -- the thread they opened themselves, even if it names no unit
        or t.created_by = public.current_user_scope_profile_id()
        -- service_provider (30) : assignment, and only assignment. Not scoped through
        -- current_user_scope_profile_id() — a vendor has no guardian relation.
        or t.assigned_to = (select auth.uid())
      )
  );
$$;

comment on function public.current_user_can_access_thread(uuid) is
  'The ONLY thread/message visibility decision in the schema. Both public.threads and public.messages route their SELECT policies through it, which is what prevents the two tables'' policies from referencing each other and raising 42P17. The residency branch carries the same has_role_level(8) floor as current_user_can_view_ticket and the three media_reports residency policies: a guest (5) or child_guest (3) holding a unit_residents row has standing to be in a building, not to read the correspondence about it.';


-- ===========================================================================
-- 2. notifications: the column-scoped UPDATE the comment always claimed.
--
-- Migration 09 line 442 reads `revoke insert, delete ... from authenticated`.
-- Migration 11 line 236, for the identical column-grant pattern on
-- ai_conversations, reads `revoke insert, update, delete`. The missing word is
-- the whole bug: notifications was created while Supabase's default ACL still
-- handed `authenticated` full DML, the revoke removed INSERT and DELETE, and
-- the table-wide UPDATE survived underneath the column grant that was supposed
-- to be the only UPDATE path. relacl read `authenticated=rwm`.
--
-- The revoke MUST come first and the grant MUST follow: REVOKE UPDATE at table
-- level also drops the existing per-column ACLs (verified — pg_attribute.attacl
-- for is_read and read_at went to NULL), so without the re-grant a recipient
-- could no longer mark a notification read.
--
-- Narrow because it removes exactly one privilege from one role on one table
-- and immediately restores the two columns the product needs. What breaks if it
-- were wider (today): the recipient of a server-authored notification can
-- rewrite its title, body, link, category, severity, payload and company_id —
-- proven live. In this codebase that is not cosmetic: honesty is the product,
-- and a notification is a record the reader is told the system wrote.
-- ===========================================================================
revoke update on public.notifications from authenticated;
grant update (is_read, read_at) on public.notifications to authenticated;


-- ===========================================================================
-- 3. media_reports public intake: bound unit_id and site_id.
--
-- Every other conjunct in this policy bounds something. unit_id and site_id
-- bounded nothing, and media_reports_select_own_unit routes a report to whoever
-- holds the named unit — so any authenticated caller could drop a report into a
-- stranger's feed under their own name. Proven live: guest files naming
-- AZW-B01-0001, owner@azura.local reads it.
--
-- The unit clause is copied from service_tickets_insert_requester (migration
-- 17), which solved exactly this. The has_role_level(8) floor from that policy
-- is deliberately NOT copied: guest intake is the feature this policy exists
-- for, and adding the floor would delete it rather than narrow it.
--
-- site_id is bound to the row's OWN company rather than to the caller's,
-- because a guest legitimately has no company_id until check-in (the conjunct
-- above already makes that allowance) and a caller-scoped test would refuse
-- them. sites_select_all is `true`, so the subquery hides nothing that exists.
--
-- Staff are untouched: they insert through media_reports_staff_write, which is
-- FOR ALL and is OR'd with this one. Verified — staff filing about a unit it
-- does not hold is still ALLOWED after the change.
--
-- What breaks if it were wider (today): forged reports in other residents'
-- feeds. What breaks if it were narrower (unit_id forced to null): nobody could
-- report a problem in their own flat.
-- ===========================================================================
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
    -- their own unit, or none at all — a broken lobby light belongs to no unit
    and (
      unit_id is null
      or unit_id in (select u.unit_id from public.current_user_unit_ids() u(unit_id))
    )
    -- a site inside the company the report is filed against
    and (
      site_id is null
      or site_id in (select s.id from public.sites s where s.company_id = media_reports.company_id)
    )
  );

comment on policy media_reports_insert_intake on public.media_reports is
  'A reporter may file about a unit they hold, or about no unit at all (the common areas). Naming somebody else''s unit used to be accepted, and media_reports_select_own_unit then delivered the report into that resident''s feed — the same forgery service_tickets_insert_requester already refuses. Staff are unaffected: they insert through media_reports_staff_write.';


-- ===========================================================================
-- 4. The tenant predicate, on the seven policies that omit it.
--
-- Shape copied from the sibling that already gets this right,
-- media_reports_select_staff: admin stays cross-company (that is the
-- established convention throughout this schema and is_admin() also covers the
-- service context), and the elevated/manager branch gains
-- `company_id = current_user_company_id()`.
--
-- unit_residents has no company_id column, so it is scoped through units. This
-- does not raise 42P17: units' own policies reach unit_residents only via
-- current_user_unit_ids(), which is SECURITY DEFINER over a table that is not
-- FORCEd, so the read runs as the owner and never re-enters the policy.
-- Verified — the counts below ran without error.
--
-- Narrow because it is inert today and measured to be so: eleven roles x four
-- tables, 44 of 44 row counts identical before and after. It is single-tenant
-- now; the point is that the policy is already correct on the day a second
-- company exists, rather than being the one that was forgotten.
--
-- What breaks if it were wider (today): nothing visible — and that is the
-- problem. See the note in `notes` about profiles with a NULL company_id.
-- ===========================================================================
drop policy if exists profiles_select_elevated on public.profiles;
create policy profiles_select_elevated on public.profiles for select
  using (
    (select public.is_admin())
    or ((select public.has_role_level(70)) and company_id = (select public.current_user_company_id()))
  );

drop policy if exists residents_select_staff on public.residents;
create policy residents_select_staff on public.residents for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  );

drop policy if exists residents_manager_write on public.residents;
create policy residents_manager_write on public.residents for all to authenticated
  using (
    (select public.is_admin())
    or ((select public.has_role_level(70)) and company_id = (select public.current_user_company_id()))
  )
  with check (
    (select public.is_admin())
    or ((select public.has_role_level(70)) and company_id = (select public.current_user_company_id()))
  );

drop policy if exists units_select_staff on public.units;
create policy units_select_staff on public.units for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.has_role_level(40)) and company_id = (select public.current_user_company_id()))
  );

drop policy if exists units_manager_write on public.units;
create policy units_manager_write on public.units for all to authenticated
  using (
    (select public.is_admin())
    or ((select public.has_role_level(70)) and company_id = (select public.current_user_company_id()))
  )
  with check (
    (select public.is_admin())
    or ((select public.has_role_level(70)) and company_id = (select public.current_user_company_id()))
  );

drop policy if exists unit_residents_select_staff on public.unit_residents;
create policy unit_residents_select_staff on public.unit_residents for select to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.has_role_level(40))
      and unit_id in (
        select u.id from public.units u
        where u.company_id = (select public.current_user_company_id())
      )
    )
  );

drop policy if exists unit_residents_manager_write on public.unit_residents;
create policy unit_residents_manager_write on public.unit_residents for all to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.has_role_level(70))
      and unit_id in (
        select u.id from public.units u
        where u.company_id = (select public.current_user_company_id())
      )
    )
  )
  with check (
    (select public.is_admin())
    or (
      (select public.has_role_level(70))
      and unit_id in (
        select u.id from public.units u
        where u.company_id = (select public.current_user_company_id())
      )
    )
  );


-- ===========================================================================
-- 5. Default privileges, and a sweep instead of an event trigger.
--
-- Migration 13 narrowed the default to remove INSERT/UPDATE/DELETE/TRUNCATE but
-- left SELECT, so pg_default_acl still read `anon=rm, authenticated=rm` — every
-- table a future migration creates would be world-readable through PostgREST
-- before anyone wrote a grant block. `m` is PG17's MAINTAIN, which did not
-- exist when migration 18 swept truncate/trigger/references.
--
-- Both roles are revoked, not just anon. A future table should be closed until
-- somebody grants it, and the failure is loud — PostgREST returns 42501
-- "permission denied for table", not an empty result set. A silent empty list is
-- the failure mode this project cannot have.
--
-- These four statements affect FUTURE tables only, except the fourth, which
-- sweeps MAINTAIN off the 46 tables that already exist. MAINTAIN covers VACUUM,
-- ANALYZE, CLUSTER, REINDEX and REFRESH MATERIALIZED VIEW; PostgREST cannot
-- issue any of them, so removing it cannot affect a single read or write.
--
-- ## WHAT THIS DOES NOT COVER, stated rather than implied
--
-- `pg_default_acl` holds TWO entries for schema public, and these statements
-- rewrite one of them. Measured, unfiltered by role:
--
--   defaclrole      defaclacl
--   supabase_admin  {postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm,
--                    service_role=arwdDxtm}
--   postgres        {postgres=arwdDxtm, anon=rm, authenticated=rm,
--                    service_role=arwdDxtm}
--
-- Default privileges apply per creating role. These run as `postgres`
-- (`current_user` = postgres) and therefore change only the second row. The
-- `supabase_admin` default grants anon and authenticated the FULL DML set —
-- insert, update, delete, truncate — on any future table created by that role,
-- which is strictly worse than the SELECT this section is about.
--
-- It cannot be revoked from here: `rolsuper` is false for `postgres` and
-- `pg_has_role('postgres','supabase_admin','member')` is false, both measured.
-- `alter default privileges for role supabase_admin …` would simply fail.
--
-- So this is a NAMED RESIDUAL, not a silence. A table created by
-- `supabase_admin` — which is what the Supabase dashboard's SQL editor and its
-- managed tooling use, not `supabase db push` — arrives world-writable. The
-- sweep below is what catches it: it asserts on privileges as well as RLS, so
-- the next migration to run after such a table appears fails loudly instead of
-- the table going unnoticed forever.
-- ===========================================================================
alter default privileges in schema public revoke select on tables from anon;
alter default privileges in schema public revoke select on tables from authenticated;
alter default privileges in schema public revoke maintain on tables from anon, authenticated;
revoke maintain on all tables in schema public from anon, authenticated;

-- An assertion, not a repair — the same shape as migration 13 section 2. A table
-- that reaches this point without RLS has a bug in its own migration, and
-- silently enabling RLS here would hide it behind a table that has privileges
-- but no policies, which is indistinguishable from an oversight.
--
-- This replaces the event trigger. An event trigger is not merely expensive
-- here, it is impossible: `create event trigger` requires superuser, and the
-- migration role has rolsuper = false and is not a member of supabase_admin.
-- The statement would fail outright. A migration-time sweep costs one catalogue
-- scan, runs at exactly the moment a mistake is cheapest to fix, and is visible
-- in the migration rather than hidden in the catalogue.
do $$
declare
  v_open   text;
  v_writes text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_open
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity;
  if v_open is not null then
    raise exception 'Tables in schema public without row level security: %', v_open;
  end if;

  -- The privilege half, which is what catches the `supabase_admin` default
  -- named above. A table created by that role arrives with INSERT/UPDATE/
  -- DELETE/TRUNCATE for anon and authenticated, and RLS enabled or not, that is
  -- never something a migration in this repository intended: every write grant
  -- here is written out by hand next to the policy that narrows it.
  --
  -- Listed rather than repaired, for the same reason as the RLS check. A
  -- privilege this schema did not grant is a question about where it came from,
  -- and revoking it silently would answer the question by erasing it.
  select string_agg(format('%s(%s)', t.table_name, t.privs), ', ' order by t.table_name)
    into v_writes
  from (
    select g.table_name,
           string_agg(distinct g.privilege_type, '/' order by g.privilege_type) as privs
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.grantee in ('anon', 'authenticated')
      and g.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
    group by g.table_name
  ) t;
  if v_writes is not null then
    raise exception
      'Schema-owner privileges reached anon/authenticated on: %. Nothing in this repository grants TRUNCATE, REFERENCES or TRIGGER — see migration 18 — so these came from a default privilege (probably supabase_admin''s; see section 5) and need revoking by a role that can.',
      v_writes;
  end if;
end $$;


-- ===========================================================================
-- 6. notifications.link — close the `/\` open redirect.
--
-- `^/` and `!~ '^//'` were not enough. A browser normalises the backslash in
-- `/\evil.example` to a forward slash, so the link resolves off-site exactly as
-- `//evil.example` would. Two further tightenings, both necessary:
--
--   no backslash anywhere       `/dash\board` is never a legitimate route here,
--                               and allowing it anywhere invites the same
--                               normalisation one path segment later.
--   no control characters       the URL parser STRIPS tab, CR and LF before it
--                               parses, so a tab between the two slashes turns
--                               into `//evil.example` and the `^//` test never
--                               sees it. This is the case a regex-only fix
--                               misses.
--
-- strpos(link, chr(92)) rather than a backslash regex: unambiguous under
-- standard_conforming_strings, immutable, and it survives being copied between
-- a .sql file and a client without an escape-level argument.
--
-- notifications_link_has_no_locale (migration 19) is a separate constraint and
-- is deliberately left in place — verified still firing on '/de/dashboard'.
--
-- The ADD CONSTRAINT validates the existing rows; all 37 rows carrying a link
-- passed on the rehearsal run. If it raises, a stored link is already unsafe and
-- should be corrected rather than the constraint relaxed.
--
-- Narrow because it only ever refuses a value; nothing that renders today
-- changes. What breaks if it were wider (today): notifications.link goes
-- straight into <Link href> in notification-list.tsx with no application-side
-- guard, so this CHECK is the entire boundary.
-- ===========================================================================
alter table public.notifications
  drop constraint if exists notifications_link_is_relative;

alter table public.notifications
  add constraint notifications_link_is_relative check (
    link is null
    or (
          link ~ '^/'                     -- site-relative
      and link !~ '^//'                   -- not protocol-relative
      and strpos(link, chr(92)) = 0       -- no backslash: '/\x' normalises to '//x'
      and link !~ '[[:cntrl:]]'           -- no tab/CR/LF: the URL parser strips them first
    )
  );

comment on constraint notifications_link_is_relative on public.notifications is
  'A notification link is a server-authored URL the reader is invited to click, which makes it an open-redirect surface. Site-relative only, and none of the three forms a browser normalises back into a protocol-relative URL: a leading //, a backslash anywhere, or a stripped control character. Works with notifications_link_has_no_locale, which is a separate constraint.';
