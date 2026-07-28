-- ===========================================================================
-- 15. Admin capability — the two guards, and the audit row that was never written
--
-- Written by W3-H/N5 under OVERNIGHT-2 §3 ("admin capability matrix"), NOT by
-- W1-A who owns supabase/migrations/*. The ownership crossing was raised and
-- explicitly approved before a line was written; the condition of that approval
-- was that this be a NEW file that adds only, so nothing of W1-A's is rewritten
-- and a later `git merge` from W1-A's tree cannot lose work in either direction.
-- Every statement below is `add column if not exists`, `create or replace` on a
-- name that does not yet exist, or a `create trigger` on a trigger name that
-- does not yet exist. Re-running it is a no-op.
--
-- W-UX §5 states the requirement this closes: an administrator must be able to
-- run the system without a developer. Two guards stay, and they are the
-- opposite of friction — they are what stops the system becoming unrecoverable:
--
--   1. The LAST remaining admin cannot be demoted, deactivated or deleted.
--   2. Self-elevation is NOT blocked. It is RECORDED, and visible in the trail.
--
-- Both are enforced here, in Postgres, and not only in the route handler.
-- `apps/web/lib/admin-capability.ts` mirrors rule 1 so the user gets a sentence
-- in their own language instead of SQLSTATE 42501 — but a check that lives only
-- in a route handler is advice, not a boundary. CONVENTIONS §2: RLS is the
-- security boundary. This file is the half that actually holds.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. audit_events.metadata — a column the application has been writing since
--    W2-B shipped, and which has never existed
--
-- `writeAudit()` in apps/web/lib/api-handler.ts inserts:
--
--     await client.from("audit_events").insert({
--       actor_profile_id, company_id, action, entity_table,
--       metadata: { requestId, method, path, outcome, errorCode, role },
--     })
--
-- `audit_events` (migration 08 §5) declares id, company_id, actor_profile_id,
-- action, entity_table, entity_id, before_data, after_data, ip_address,
-- user_agent, request_id, created_at. There is no `metadata`.
--
-- PostgREST rejects the insert with PGRST204 (column not found). writeAudit()
-- catches everything and only warns, deliberately, so that a failing audit
-- write cannot turn a successful mutation into one the caller retries and
-- double-applies. The combination is that EVERY audit row has been silently
-- dropped and the failure surfaces only as an `azura.api.audit-failed` line.
--
-- Discovered while auditing the capability matrix: "an admin can see the audit
-- trail" is not a capability if nothing writes to it. Adding the column is the
-- smaller and more honest fix — the alternative was editing W2-B's handler to
-- drop the field, which would discard the requestId correlation that makes a
-- trail useful.
-- ---------------------------------------------------------------------------

alter table public.audit_events
  add column if not exists metadata jsonb;

comment on column public.audit_events.metadata is
  'Request-correlation envelope written by createHandler: requestId, method, path, outcome, errorCode, role. CONVENTIONS §4 still applies — never the request body, never PII. Added in migration 15; before it existed every insert from writeAudit() failed with PGRST204 and was swallowed.';

create index if not exists idx_audit_events_metadata_request
  on public.audit_events ((metadata ->> 'requestId'))
  where metadata is not null;

-- ---------------------------------------------------------------------------
-- 1b. profiles.version — the optimistic-concurrency token six other schemas
--     already require and this table could never supply
--
-- `updateProfileRoleSchema` declares `expectedVersion: version`, where `version`
-- is `z.number().int().min(1)`. Five other mutating schemas declare the same
-- field, and every table behind them carries `version integer not null default
-- 1` with `bump_row_version()` attached (migration 02 §, 06, 07 ×2, 08 ×2).
--
-- `profiles` does not. So the one field standing between two admins overwriting
-- each other's role change was validated for shape and then compared against
-- nothing — the request had to carry a number, and any number did.
--
-- Adding the column rather than deleting the field, because the field is right:
-- a role change is exactly the mutation that must not silently clobber a
-- concurrent one. `bump_row_version()` is migration 02's, unchanged and reused.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists version integer not null default 1;

comment on column public.profiles.version is
  'Optimistic-concurrency token, bumped by bump_row_version() on every UPDATE. Matches the convention on units, service_tickets, ledger_entries, vendor_invoices, documents and compliance_checks. Added in migration 15; before it existed updateProfileRoleSchema.expectedVersion was validated but unenforceable.';

drop trigger if exists bump_profiles_version on public.profiles;
create trigger bump_profiles_version
  before update on public.profiles
  for each row execute function public.bump_row_version();

-- ---------------------------------------------------------------------------
-- 2. Guard 1 — the last administrator
--
-- Refuses any UPDATE that would take the last active admin out of the admin
-- population, and any DELETE of the last active admin.
--
-- ## Scoped per company, deliberately
--
-- The count is taken within the row's own company_id, compared with IS NOT
-- DISTINCT FROM so the platform-level bucket (company_id IS NULL) is a bucket
-- like any other rather than a hole that never matches.
--
-- Per-company is strictly stronger than a global count, not weaker: every admin
-- belongs to exactly one bucket, so a rule that keeps every bucket non-empty
-- also keeps the global population non-empty. The reverse does not hold — a
-- global rule would happily let company A lose its only admin while company B
-- still had three, and company A would then have nobody who could administer it.
--
-- ## It applies to service_role too
--
-- Unlike is_admin(), this does not exempt the service context. It is an
-- integrity constraint, not an authorisation check: the question is not "may
-- you" but "would the system still be administrable afterwards". A deliberate
-- override is still available to somebody with a direct SQL session
-- (`alter table public.profiles disable trigger enforce_last_admin_survives`),
-- which is a conscious act by a named database role rather than something an
-- application bug can reach.
--
-- ## Why the count excludes the subject row explicitly
--
-- BEFORE UPDATE fires before the new row is visible, so a naive count would
-- still see OLD as an active admin and the guard would never fire. Counting
-- `id <> OLD.id` asks the question that matters: who else is left.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_last_admin_survives()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_others integer;
  v_was_active_admin boolean;
  v_still_active_admin boolean;
begin
  v_was_active_admin := old.role = 'admin' and old.is_active;

  -- Nothing to protect: this row was not part of the admin population.
  if not v_was_active_admin then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    v_still_active_admin := false;
  else
    v_still_active_admin := new.role = 'admin' and new.is_active
      and new.company_id is not distinct from old.company_id;
  end if;

  -- The row stays an active admin in the same company. No population change.
  if v_still_active_admin then
    return new;
  end if;

  select count(*) into v_others
  from public.profiles p
  where p.id <> old.id
    and p.role = 'admin'
    and p.is_active
    and p.company_id is not distinct from old.company_id;

  if v_others = 0 then
    -- 'AZLAD' is a custom SQLSTATE in the user-defined class (5 chars, class
    -- 'AZ' is unassigned by the standard). It is distinguishable from 42501
    -- insufficient_privilege on purpose: this is NOT a permission failure, and
    -- a handler that mapped it to 403 would tell the admin they are not allowed
    -- to do something they are perfectly entitled to do. They are allowed; the
    -- result would just be an unadministrable system.
    raise exception 'This is the last active administrator for this company. Removing administrator rights here would leave nobody able to manage users, so the change was not applied. Give another person administrator rights first, then repeat this change.'
      using errcode = 'AZLAD';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.enforce_last_admin_survives() is
  'W-UX §5 guard 1. Refuses to let the admin population of a company reach zero by demotion, deactivation, company move or deletion. Raises SQLSTATE AZLAD, which is deliberately not 42501 — the caller is authorised, the outcome is what is refused.';

drop trigger if exists enforce_last_admin_survives on public.profiles;
create trigger enforce_last_admin_survives
  before update or delete on public.profiles
  for each row execute function public.enforce_last_admin_survives();

-- ---------------------------------------------------------------------------
-- 3. Guard 2 — authority changes are recorded, and self-elevation is named
--
-- W-UX §5: "An admin cannot silently elevate themselves. Self-elevation is
-- logged and visible in the audit trail. It is NOT blocked, it is recorded."
--
-- So this trigger never raises. It writes.
--
-- ## What counts as an authority change
--
-- role, is_active, company_id — the same three columns
-- prevent_profile_privilege_escalation() (migration 01 §5) already gates on,
-- kept identical on purpose so the set of "authority columns" has one
-- definition rather than two that drift.
--
-- ## Self-elevation is the actor and the subject being the same person AND the
-- ## new role outranking the old one
--
-- Self-DEMOTION is recorded too, as `profile.authority_changed`, but is not
-- flagged: an admin stepping down is not the event this guard exists to catch.
-- The flag is what a reviewer filters on.
--
-- ## AFTER, not BEFORE
--
-- A BEFORE trigger would record attempts that a later BEFORE trigger — guard 1,
-- or the escalation guard — then rejects, so the trail would contain changes
-- that never happened. AFTER means every row in the trail describes a committed
-- change. Statement ordering within a transaction still applies: if the
-- transaction rolls back, so does the audit row, which is correct.
--
-- ## SECURITY DEFINER because `authenticated` holds no INSERT on audit_events
--
-- That grant is withheld on purpose (migration 08 §5: "a client that can write
-- this table can forge the record of its own actions"). The trigger runs as the
-- owner so the row is written by the database, not by the client — the actor
-- cannot suppress it by lacking a privilege, and cannot forge it either,
-- because actor_profile_id comes from auth.uid() and not from the payload.
-- ---------------------------------------------------------------------------

create or replace function public.record_profile_authority_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_self_elevation boolean;
  v_old_level integer;
  v_new_level integer;
begin
  if new.role is not distinct from old.role
     and new.is_active is not distinct from old.is_active
     and new.company_id is not distinct from old.company_id then
    return new;
  end if;

  v_actor := (select auth.uid());
  v_old_level := coalesce(public.role_level(old.role), 0);
  v_new_level := coalesce(public.role_level(new.role), 0);
  v_self_elevation := v_actor is not null
    and v_actor = new.id
    and v_new_level > v_old_level;

  insert into public.audit_events (
    company_id, actor_profile_id, action, entity_table, entity_id,
    before_data, after_data, metadata
  ) values (
    coalesce(new.company_id, old.company_id),
    v_actor,
    case when v_self_elevation
      then 'profile.self_elevated'
      else 'profile.authority_changed'
    end,
    'profiles',
    new.id::text,
    -- The three authority columns only. CONVENTIONS §4 forbids logging full
    -- rows: email, phone and avatar_url are PII and none of them is what
    -- changed.
    jsonb_build_object(
      'role', old.role,
      'is_active', old.is_active,
      'company_id', old.company_id
    ),
    jsonb_build_object(
      'role', new.role,
      'is_active', new.is_active,
      'company_id', new.company_id
    ),
    jsonb_build_object(
      'selfElevation', v_self_elevation,
      'actorIsSubject', v_actor is not null and v_actor = new.id,
      'roleLevelBefore', v_old_level,
      'roleLevelAfter', v_new_level,
      'source', 'trigger:record_profile_authority_change'
    )
  );

  return new;
end;
$$;

comment on function public.record_profile_authority_change() is
  'W-UX §5 guard 2. Writes one audit_events row for every committed change to role, is_active or company_id, flagging metadata->>''selfElevation'' when the actor raised their own role level. Never blocks — the requirement is that self-elevation be visible, not impossible.';

drop trigger if exists record_profile_authority_change on public.profiles;
create trigger record_profile_authority_change
  after update on public.profiles
  for each row execute function public.record_profile_authority_change();

-- ---------------------------------------------------------------------------
-- 4. Reading the trail
--
-- audit_events already carries RLS from migration 08. This adds nothing to the
-- read path and deliberately does not widen it: an admin can already read the
-- trail for their own company, and platform rows (company_id IS NULL) stay
-- admin-only because the manager policy matches on company equality and NULL
-- never equals anything.
--
-- The export path is a read of the same rows through the same policy
-- (GET /api/site-management/users?view=audit), so there is no second
-- authorisation surface to keep in step.
-- ---------------------------------------------------------------------------

comment on table public.audit_events is
  'Append-only ledger of every mutation. Written server-side with the service-role client, or by a SECURITY DEFINER trigger — `authenticated` holds no INSERT privilege, because a client that can write this table can forge the record of its own actions. Since migration 15, public.profiles writes its own authority changes here directly, so a role change is recorded even when it did not arrive through the API.';
