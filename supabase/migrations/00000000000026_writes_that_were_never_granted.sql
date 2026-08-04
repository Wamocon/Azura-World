-- 26 · Three writes that were designed correctly and switched off
--
-- The recurring defect in this project is a correct RLS policy sitting behind a
-- revoked table GRANT. Postgres checks the privilege first and raises 42501
-- before a policy is ever evaluated, so the surface reports a generic failure
-- and the policy — which is right — takes the blame. Migrations 17 and 21
-- closed two rounds of this. Audited again on 2026-08-04, three more were open,
-- and all three were reachable from a control the product renders as working.
--
--   1. `profiles.version` — declared by migration 15, absent from the live
--      database. Every user-administration write faults before any check.
--   2. `documents` INSERT — the policies exist, the grant does not.
--   3. `storage.objects` — RLS on, zero policies, which denies everything.
--
-- Measured before this migration:
--
--   profiles columns          id … updated_at, no `version`
--   documents (authenticated) SELECT
--   storage.objects           relrowsecurity = true, 0 policies, 0 rows
--
-- Deliberately NOT granted here: INSERT and DELETE on `profiles`. See §4.

-- ---------------------------------------------------------------------------
-- 1. profiles.version — migration 15's column, actually applied
--
-- Migration 15 declares this and its trigger. It is not on the live database,
-- which means the migration was written and never run there. Re-declaring it
-- here rather than asking someone to re-run 15 is deliberate: 15 also creates
-- the last-administrator guards, and re-running a migration whose other halves
-- ARE present is how you find out which of its statements are not idempotent.
-- Both statements below are.
--
-- The consequence of its absence was total: `readProfile` selects
-- `role, is_active, version`, so PostgREST answered 400 / 42703 to every role
-- change and every account block, and `assignRole` writes its audit decision row
-- BEFORE that read — so the audit log recorded attempts that never happened.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists version integer not null default 1;

comment on column public.profiles.version is
  'Optimistic-concurrency token, bumped by bump_row_version() on every UPDATE. Matches units, service_tickets, ledger_entries, vendor_invoices, documents and compliance_checks. Declared by migration 15; applied here because 15 never reached this database.';

drop trigger if exists bump_profiles_version on public.profiles;
create trigger bump_profiles_version
  before update on public.profiles
  for each row execute function public.bump_row_version();

-- ---------------------------------------------------------------------------
-- 2. documents INSERT
--
-- `documents_staff_insert` (level ≥ 40 within own company, or admin) and
-- `documents_manager_write` both exist and are correct. Migration 8 line 485
-- grants SELECT and stops. Migration 21 — "restore write grants" — names
-- `documents` in its own list of affected tables and then does not grant it.
--
-- Narrowed to the columns a caller may set. `id`, `created_at` and `updated_at`
-- have defaults and must not be caller-supplied; `review_status`, `reviewed_by`
-- and `reviewed_at` belong to the review path, not to upload; `version` is the
-- concurrency token and is the trigger's to set. A column-scoped grant is stricter
-- than the table-level one migration 8 removed, and it is the shape migration 24
-- established for `notifications`.
-- ---------------------------------------------------------------------------

grant insert (
  company_id, site_id, unit_id, resident_id,
  title, category, storage_bucket, storage_path, original_filename,
  mime_type, size_bytes, checksum_sha256, visibility, retention_class,
  expires_at, uploaded_by, metadata
) on public.documents to authenticated;

-- ---------------------------------------------------------------------------
-- 3. storage.objects — a policy at all
--
-- Row-level security is enabled on `storage.objects` and there are no policies,
-- which is a closed door with no handle: every upload from a caller holding the
-- `authenticated` role is refused, and `storage.objects` holds zero rows, so no
-- upload has ever succeeded in this project's history. The buckets themselves
-- were created on 2026-08-03 and are private, which is correct.
--
-- Scoped to the two buckets by name. A policy without the bucket predicate would
-- hand every authenticated caller write access to any bucket added later — the
-- default-privileges failure mode migration 24 closed on the table side.
--
-- ## Why level 40 and not the document policy's exact predicate
--
-- `documents_staff_insert` also permits an admin outright and pins the company.
-- Neither is expressible here: a storage object carries no `company_id`, and the
-- object row is written before the `documents` row that would name one. So the
-- floor is the trade-level check — `has_role_level(40)` is staff and above,
-- which is exactly the set that `documents_staff_insert` admits — and the
-- `documents` INSERT above remains the narrower gate that decides whether the
-- upload is ever recorded. An object with no document row is unreachable by any
-- read path in the product; `getSignedDocumentUrl` resolves paths only through
-- `documents`.
--
-- Reads go through short-lived signed URLs minted server-side with the service
-- role, which bypasses RLS by design, so no SELECT policy is added: adding one
-- would widen the door without any surface needing it.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'storage' and c.relname = 'objects'
  ) then
    execute $policy$
      drop policy if exists azura_documents_insert on storage.objects;
      create policy azura_documents_insert on storage.objects
        for insert to authenticated
        with check (
          bucket_id in ('azura-documents', 'azura-evidence')
          and (select public.has_role_level(40))
        );
    $policy$;

    execute $policy$
      drop policy if exists azura_documents_update on storage.objects;
      create policy azura_documents_update on storage.objects
        for update to authenticated
        using (
          bucket_id in ('azura-documents', 'azura-evidence')
          and (select public.has_role_level(40))
        )
        with check (
          bucket_id in ('azura-documents', 'azura-evidence')
          and (select public.has_role_level(40))
        );
    $policy$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. What is deliberately NOT granted, and why
--
-- `profiles` INSERT and `profiles` DELETE stay revoked.
--
-- **INSERT.** `createProfile` cannot work even with the grant: `profiles.id` is
-- `not null` with no default and is a foreign key to `auth.users(id)`, and the
-- function supplies no id. A profile without an auth user is a row nobody can
-- ever sign in as. Creating an account is Supabase Auth's business, and the
-- product already says so on the users page — "Invitations are not possible yet.
-- We do not show a form that would save nowhere."
--
-- **DELETE.** The product's own governance copy is "Accounts are blocked, never
-- deleted. The history has to survive", and `audit_events.actor_profile_id`
-- references `profiles`, so deleting an actor would orphan the audit trail this
-- project spent migration 23 repairing.
--
-- Both operations are being removed from the API manifest and from
-- `docs/api/openapi.yaml` in the same change as this migration. A published
-- specification describing an operation that cannot succeed is worse than no
-- specification: a consumer builds against it.
--
-- The assertion below is the guard: if a later migration grants either, this
-- comment has stopped being true and somebody should have to notice.
-- ---------------------------------------------------------------------------

do $$
begin
  if has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     or has_table_privilege('authenticated', 'public.profiles', 'DELETE') then
    raise exception
      'profiles INSERT/DELETE is granted to authenticated. Migration 26 §4 argues it must not be; if that reasoning has changed, update the comment and remove this guard.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Assert what this migration was for
--
-- Loud on failure rather than silent, because every defect this migration
-- closes presented as a working control that quietly did nothing.
-- ---------------------------------------------------------------------------

do $$
declare
  problem text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'version'
  ) then
    problem := 'profiles.version missing';
  elsif not has_column_privilege('authenticated', 'public.documents', 'title', 'INSERT') then
    problem := 'documents INSERT not granted';
  elsif not exists (
    select 1 from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'storage' and c.relname = 'objects'
       and p.polname = 'azura_documents_insert'
  ) then
    problem := 'storage.objects insert policy missing';
  end if;

  if problem is not null then
    raise exception 'migration 26 did not take effect: %', problem;
  end if;
end $$;
