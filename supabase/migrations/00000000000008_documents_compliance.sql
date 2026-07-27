-- 08 · documents & compliance — Azura World CATI (INTERNAL-107, task W1-A)
--
-- Four tables, two very different security postures:
--
--   documents / compliance_checks  — mutable operational records, RLS-scoped.
--   audit_events / access_events   — APPEND-ONLY ledgers. They are the record of what
--                                    everyone else did, so they cannot themselves be
--                                    editable by the actors they describe.
--
-- Every cross-table predicate goes through a SECURITY DEFINER helper. No policy in this
-- file contains a bare `exists (select … from <RLS-protected table>)` — that construct is
-- what produced 42P17 in the reference project.
--
-- FK policy in this file: audit and compliance foreign keys are `on delete restrict`. An
-- audit row must never be removed as a side effect of deleting something else.

-- ---------------------------------------------------------------------------
-- 1. Append-only enforcement — one function, both ledgers
-- ---------------------------------------------------------------------------

create or replace function public.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The only sanctioned bypass. It exists because erasure and legal-hold redaction are
  -- real obligations that must be satisfiable WITHOUT dropping the ledger row and losing
  -- the fact that the event happened. `set local` inside a SECURITY DEFINER RPC is the
  -- intended caller; no such RPC exists yet, and adding one is a reviewed change.
  if coalesce(current_setting('app.allow_append_only_mutation', true), 'off') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  raise exception 'public.% is append-only; % is rejected.', tg_table_name, tg_op
    using errcode = '42501',
          hint = 'Retention/erasure edits run inside a SECURITY DEFINER RPC that issues `set local app.allow_append_only_mutation = ''on''`.';
end;
$$;

-- Deliberately NOT security definer: it needs no privileges of its own, and a SECURITY
-- DEFINER trigger is a larger attack surface for zero benefit.
--
-- Honest limitation, stated rather than hidden: any session can `SET` a custom GUC on
-- itself, so this trigger is defence in depth, not the security boundary. The boundary is
-- the grant block at the end of this file — `authenticated` and `anon` hold no UPDATE or
-- DELETE privilege on either ledger, so they cannot reach the trigger at all.
comment on function public.reject_append_only_mutation() is
  'BEFORE UPDATE OR DELETE guard for audit_events and access_events. Raises 42501 unless the session GUC app.allow_append_only_mutation is ''on''. Defence in depth behind the grant block — not a substitute for it.';

-- ---------------------------------------------------------------------------
-- 2. Scope helper — the resident identities the caller speaks for
--
-- The unit-scoped analogue (public.current_user_unit_ids()) already exists in migration
-- 02. This is the resident-scoped one, first needed here: a resident's own identity
-- document is attached to their resident row, not to a unit.
-- ---------------------------------------------------------------------------

create or replace function public.current_user_resident_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
  from public.residents r
  where r.profile_id = public.current_user_scope_profile_id();
$$;

comment on function public.current_user_resident_ids() is
  'Resident rows the caller may reach as themselves. SECURITY DEFINER so a policy can consult public.residents without re-entering that table''s own policies. Routed through current_user_scope_profile_id(), so a child_* role resolves to its GUARDIAN''s resident set and never wider.';

-- ---------------------------------------------------------------------------
-- 3. documents
-- ---------------------------------------------------------------------------

create table if not exists public.documents (
  id                uuid primary key default gen_random_uuid(),
  -- restrict, not cascade: a title deed or a finance record is a retained document.
  -- Tearing down a company must be an explicit ordered operation, never a cascade.
  company_id        uuid not null references public.companies(id) on delete restrict,
  -- The subject may disappear; the document survives it. That is what retention means.
  site_id           uuid references public.sites(id) on delete set null,
  unit_id           text references public.units(id) on delete set null,
  resident_id       uuid references public.residents(id) on delete set null,
  title             text collate "tr-TR-x-icu" not null
                      check (char_length(title) between 1 and 200),
  category          text not null default 'general' check (category in (
                      'title_deed', 'contract', 'invoice', 'identity', 'permit',
                      'insurance', 'handover', 'inspection', 'correspondence',
                      'marketing', 'evidence', 'general'
                    )),
  storage_bucket    text not null default 'azura-documents',
  storage_path      text not null check (char_length(storage_path) between 1 and 1024),
  original_filename text,
  mime_type         text,
  size_bytes        bigint check (size_bytes is null or size_bytes >= 0),
  checksum_sha256   text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  visibility        text not null default 'private'
                      check (visibility in ('private', 'company', 'unit')),
  review_status     text not null default 'pending_review'
                      check (review_status in ('pending_review', 'approved', 'rejected')),
  retention_class   text not null default 'general' check (retention_class in (
                      'identity', 'legal', 'finance', 'service', 'guest', 'general'
                    )),
  expires_at        timestamptz,
  uploaded_by       uuid references public.profiles(id) on delete set null,
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,
  metadata          jsonb not null default '{}'::jsonb,
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- One metadata row per stored object. Two rows pointing at one object means one of them
  -- carries the wrong ACL, and there is no way to tell which.
  unique (storage_bucket, storage_path),

  -- CONVENTIONS.md §4: "Signed URLs for documents, short TTL. No public buckets." Both
  -- named buckets are created private, outside this migration. Pinning the column to that
  -- pair means no later migration and no application code path can quietly relocate a
  -- document into a world-readable bucket: the row simply will not insert. The binary is
  -- NEVER served from a public URL or an unsigned storage path — a short-TTL signed URL is
  -- the only sanctioned read path.
  constraint documents_bucket_is_private check (
    storage_bucket in ('azura-documents', 'azura-evidence')
  ),

  -- visibility 'unit' is meaningless without a unit to scope it to, and would read as
  -- "nobody" rather than failing loudly.
  constraint documents_unit_visibility_needs_unit check (
    visibility <> 'unit' or unit_id is not null
  ),

  constraint documents_review_decision_recorded check (
    review_status = 'pending_review'
    or (reviewed_by is not null and reviewed_at is not null)
  ),

  constraint documents_expiry_after_creation check (
    expires_at is null or expires_at > created_at
  )
);

comment on table public.documents is
  'Searchable, auditable metadata for privately stored files. The bytes live in the private azura-documents / azura-evidence buckets and are reachable ONLY through a short-TTL signed URL (CONVENTIONS.md §4). There is no public bucket in this project and no migration may introduce one — see documents_bucket_is_private.';
comment on column public.documents.visibility is
  'private = staff review path only · company = any company member at staff level · unit = the unit''s residents as well. A resident''s read path requires visibility = ''unit'' AND review_status = ''approved''; an unreviewed document is not shown to the person it is about.';
comment on column public.documents.checksum_sha256 is
  'Lowercase hex SHA-256 of the stored bytes. The format CHECK exists because CONVENTIONS.md §5 requires validating the bytes, not the status line — a truncated or mis-cased digest silently disables that comparison.';

create index if not exists idx_documents_company_id on public.documents (company_id);
create index if not exists idx_documents_site_id on public.documents (site_id);
create index if not exists idx_documents_unit_id on public.documents (unit_id);
create index if not exists idx_documents_resident_id on public.documents (resident_id);
create index if not exists idx_documents_review_status on public.documents (review_status);
create index if not exists idx_documents_category on public.documents (category);
create index if not exists idx_documents_company_created on public.documents (company_id, created_at desc);
create index if not exists idx_documents_expires_at on public.documents (expires_at) where expires_at is not null;

drop trigger if exists set_documents_updated_at on public.documents;
create trigger set_documents_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

drop trigger if exists bump_documents_version on public.documents;
create trigger bump_documents_version
  before update on public.documents
  for each row execute function public.bump_row_version();

-- ---------------------------------------------------------------------------
-- 4. compliance_checks
-- ---------------------------------------------------------------------------

create table if not exists public.compliance_checks (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete restrict,
  site_id                 uuid references public.sites(id) on delete set null,
  subject_type            text not null check (subject_type in (
                            'company', 'site', 'block', 'unit', 'resident',
                            'document', 'thread', 'vendor', 'payment'
                          )),
  -- TEXT, not uuid: units.id is the business code 'AZW-B03-0412' (CONTRACTS.md §2), so a
  -- polymorphic subject reference cannot be typed uuid.
  subject_id              text not null,
  check_type              text not null check (check_type in (
                            'kyc_identity', 'aml_screening', 'sanctions_screening',
                            'title_deed', 'occupancy_permit', 'building_permit',
                            'fire_safety', 'earthquake_certificate', 'energy_certificate',
                            'tax_registration', 'residence_permit', 'insurance',
                            'gdpr_consent', 'contract_review', 'vendor_due_diligence'
                          )),
  status                  text not null default 'pending' check (status in (
                            'pending', 'in_review', 'passed', 'failed', 'waived'
                          )),
  risk_level              text not null default 'medium'
                            check (risk_level in ('low', 'medium', 'high', 'critical')),
  rationale               text check (rationale is null or char_length(rationale) <= 4000),
  evidence_document_id    uuid references public.documents(id) on delete restrict,

  -- Pinned to true by a CHECK, not merely defaulted to it. A default can be overridden by
  -- one INSERT; a nullable-or-false column can be flipped by one UPDATE or one
  -- `alter column … set default false` in a future migration. This constraint means
  -- turning off human review requires dropping a named constraint in a migration that a
  -- reviewer will see. SYSTEM-PROMPT.md §2.9: the model may recommend, a human approves.
  human_decision_required boolean not null default true check (human_decision_required),

  decided_by              uuid references public.profiles(id) on delete restrict,
  decided_at              timestamptz,
  due_at                  timestamptz,
  metadata                jsonb not null default '{}'::jsonb,
  version                 integer not null default 1,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- The other half of human_decision_required: a terminal status must name the human who
  -- decided and say why. Without this, "human review required" is satisfied by a column
  -- nobody reads.
  constraint compliance_checks_decision_recorded check (
    status in ('pending', 'in_review')
    or (decided_by is not null and decided_at is not null and rationale is not null)
  ),

  constraint compliance_checks_decided_pair check (
    (decided_by is null) = (decided_at is null)
  )
);

comment on table public.compliance_checks is
  'Regulatory and due-diligence checks over any subject in the system. Terminal outcomes are attributable to a named human by constraint, not by convention.';
comment on column public.compliance_checks.human_decision_required is
  'Immutably true. The CHECK pins the column so no migration or INSERT can quietly disable human review of a compliance outcome.';

create index if not exists idx_compliance_checks_company_id on public.compliance_checks (company_id);
create index if not exists idx_compliance_checks_site_id on public.compliance_checks (site_id);
create index if not exists idx_compliance_checks_subject on public.compliance_checks (subject_type, subject_id);
create index if not exists idx_compliance_checks_status on public.compliance_checks (status);
create index if not exists idx_compliance_checks_risk_level on public.compliance_checks (risk_level);
create index if not exists idx_compliance_checks_evidence_document_id on public.compliance_checks (evidence_document_id);
create index if not exists idx_compliance_checks_decided_by on public.compliance_checks (decided_by);
create index if not exists idx_compliance_checks_open
  on public.compliance_checks (company_id, due_at)
  where status in ('pending', 'in_review');

drop trigger if exists set_compliance_checks_updated_at on public.compliance_checks;
create trigger set_compliance_checks_updated_at
  before update on public.compliance_checks
  for each row execute function public.set_updated_at();

drop trigger if exists bump_compliance_checks_version on public.compliance_checks;
create trigger bump_compliance_checks_version
  before update on public.compliance_checks
  for each row execute function public.bump_row_version();

-- ---------------------------------------------------------------------------
-- 5. audit_events — append-only
-- ---------------------------------------------------------------------------

create table if not exists public.audit_events (
  id               uuid primary key default gen_random_uuid(),
  -- NULL for platform-level events that belong to no company. Those are admin-only to
  -- read, because the manager policy below matches on company equality and NULL never
  -- equals anything.
  company_id       uuid references public.companies(id) on delete restrict,
  actor_profile_id uuid references public.profiles(id) on delete restrict,
  action           text not null check (char_length(action) between 1 and 120),
  entity_table     text not null check (char_length(entity_table) between 1 and 120),
  -- TEXT, not uuid. units.id is the business code 'AZW-B03-0412', so a uuid column could
  -- not record an audit row about a unit at all — which is the single most audited entity
  -- in this schema.
  entity_id        text,
  before_data      jsonb,
  after_data       jsonb,
  ip_address       inet,
  user_agent       text,
  request_id       text,
  created_at       timestamptz not null default now()
);

comment on table public.audit_events is
  'Append-only ledger of every mutation. Written server-side with the service-role client or from a SECURITY DEFINER RPC — `authenticated` holds no INSERT privilege, because a client that can write this table can forge the record of its own actions.';
comment on column public.audit_events.actor_profile_id is
  'on delete restrict, deliberately. profiles cascades from auth.users, so this makes hard-deleting an account that has acted impossible — account removal is deactivation (profiles.is_active), and erasure redacts before_data/after_data through the append-only escape hatch. Losing the ledger is not an acceptable way to satisfy an erasure request.';
comment on column public.audit_events.before_data is
  'CONVENTIONS.md §4: do not log full request bodies or PII. Store the changed columns, not the whole payload.';

create index if not exists idx_audit_events_company_id on public.audit_events (company_id);
create index if not exists idx_audit_events_actor_profile_id on public.audit_events (actor_profile_id);
create index if not exists idx_audit_events_company_created on public.audit_events (company_id, created_at desc);
create index if not exists idx_audit_events_entity on public.audit_events (entity_table, entity_id, created_at desc);
create index if not exists idx_audit_events_action on public.audit_events (action);
create index if not exists idx_audit_events_request_id on public.audit_events (request_id) where request_id is not null;

drop trigger if exists reject_audit_events_mutation on public.audit_events;
create trigger reject_audit_events_mutation
  before update or delete on public.audit_events
  for each row execute function public.reject_append_only_mutation();

-- ---------------------------------------------------------------------------
-- 6. access_events — append-only
-- ---------------------------------------------------------------------------

create table if not exists public.access_events (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid references public.companies(id) on delete restrict,
  -- NULL on a failed login: at that point no authenticated identity exists. No email or
  -- other identifier is stored on failure — CONVENTIONS.md §4 forbids logging PII, and a
  -- table of "who typed which address and got it wrong" is exactly that.
  actor_profile_id uuid references public.profiles(id) on delete restrict,
  event_type       text not null check (event_type in (
                     'login_success', 'login_failure', 'logout', 'session_refresh',
                     'password_reset_requested', 'password_changed', 'mfa_challenge',
                     'permission_denied', 'signed_url_issued', 'export_generated',
                     'impersonation_started', 'impersonation_ended'
                   )),
  decision         text not null default 'allowed' check (decision in ('allowed', 'denied')),
  resource         text check (resource is null or char_length(resource) <= 200),
  reason           text check (reason is null or char_length(reason) <= 500),
  ip_address       inet,
  user_agent       text,
  request_id       text,
  session_id       text,
  created_at       timestamptz not null default now()
);

comment on table public.access_events is
  'Append-only ledger of authentication and authorisation outcomes, including denials. Denials are the useful half: a run of permission_denied against one company is what an intrusion looks like from here. Signed-URL issuance is recorded because a signed URL is the only read path to a private document, so issuing one IS the access event.';

create index if not exists idx_access_events_company_id on public.access_events (company_id);
create index if not exists idx_access_events_actor_profile_id on public.access_events (actor_profile_id);
create index if not exists idx_access_events_company_created on public.access_events (company_id, created_at desc);
create index if not exists idx_access_events_event_type on public.access_events (event_type, created_at desc);
create index if not exists idx_access_events_denied
  on public.access_events (created_at desc)
  where decision = 'denied';

drop trigger if exists reject_access_events_mutation on public.access_events;
create trigger reject_access_events_mutation
  before update or delete on public.access_events
  for each row execute function public.reject_append_only_mutation();

-- ---------------------------------------------------------------------------
-- 7. RLS
--
-- Read model:
--   admin (90)      → everything, both ledgers included
--   manager (70)+   → their company's audit_events and access_events
--   staff (40)+     → their company's documents and compliance_checks
--   owner/tenant    → documents for their own units (visibility 'unit', approved), plus
--                     documents attached to their own resident record
--   child_*         → exactly their guardian's set, via current_user_scope_profile_id()
--   guest / anon    → nothing. None of these four tables is public.
--
-- The audit ledgers are deliberately NOT staff-readable. Staff are the actors the ledger
-- describes; letting them read it turns an audit trail into a map of what has and has not
-- been noticed.
-- ---------------------------------------------------------------------------

alter table public.documents         enable row level security;
alter table public.compliance_checks enable row level security;
alter table public.audit_events      enable row level security;
alter table public.access_events     enable row level security;

-- documents ---------------------------------------------------------------

drop policy if exists documents_select_staff on public.documents;
create policy documents_select_staff on public.documents for select
  using (
    (select public.is_admin())
    or (
      (select public.has_role_level(40))
      and company_id = (select public.current_user_company_id())
    )
  );

drop policy if exists documents_select_own_unit on public.documents;
create policy documents_select_own_unit on public.documents for select
  using (
    visibility = 'unit'
    and review_status = 'approved'
    and unit_id is not null
    and unit_id in (select unit_id from public.current_user_unit_ids() u(unit_id))
  );

drop policy if exists documents_select_own_resident on public.documents;
create policy documents_select_own_resident on public.documents for select
  using (
    review_status = 'approved'
    and resident_id is not null
    and resident_id in (select resident_id from public.current_user_resident_ids() r(resident_id))
  );

drop policy if exists documents_staff_insert on public.documents;
create policy documents_staff_insert on public.documents for insert
  with check (
    (select public.is_admin())
    or (
      (select public.has_role_level(40))
      and company_id = (select public.current_user_company_id())
    )
  );

drop policy if exists documents_manager_write on public.documents;
create policy documents_manager_write on public.documents for all
  using (
    (select public.is_admin())
    or (
      (select public.has_role_level(70))
      and company_id = (select public.current_user_company_id())
    )
  )
  with check (
    (select public.is_admin())
    or (
      (select public.has_role_level(70))
      and company_id = (select public.current_user_company_id())
    )
  );

-- compliance_checks -------------------------------------------------------

drop policy if exists compliance_checks_select_staff on public.compliance_checks;
create policy compliance_checks_select_staff on public.compliance_checks for select
  using (
    (select public.is_admin())
    or (
      (select public.has_role_level(40))
      and company_id = (select public.current_user_company_id())
    )
  );

drop policy if exists compliance_checks_manager_write on public.compliance_checks;
create policy compliance_checks_manager_write on public.compliance_checks for all
  using (
    (select public.is_admin())
    or (
      (select public.has_role_level(70))
      and company_id = (select public.current_user_company_id())
    )
  )
  with check (
    (select public.is_admin())
    or (
      (select public.has_role_level(70))
      and company_id = (select public.current_user_company_id())
    )
  );

-- audit_events / access_events --------------------------------------------
--
-- SELECT only. There is deliberately no INSERT policy: writes arrive through the
-- service-role client, which bypasses RLS. W2-A — an audit write MUST use the server
-- client, not the caller's session client, or it will fail with 42501.

drop policy if exists audit_events_select_manager on public.audit_events;
create policy audit_events_select_manager on public.audit_events for select
  using (
    (select public.is_admin())
    or (
      (select public.has_role_level(70))
      and company_id = (select public.current_user_company_id())
    )
  );

drop policy if exists access_events_select_manager on public.access_events;
create policy access_events_select_manager on public.access_events for select
  using (
    (select public.is_admin())
    or (
      (select public.has_role_level(70))
      and company_id = (select public.current_user_company_id())
    )
  );

-- ---------------------------------------------------------------------------
-- 8. Grants
--
-- Posture matches migration 02 — browsers read, the server writes.
-- ---------------------------------------------------------------------------

grant select on public.documents to authenticated;
grant select on public.compliance_checks to authenticated;
grant select on public.audit_events to authenticated;
grant select on public.access_events to authenticated;

revoke all on public.documents from anon;
revoke all on public.compliance_checks from anon;
revoke all on public.audit_events from anon;
revoke all on public.access_events from anon;

revoke insert, update, delete on public.documents from authenticated;
revoke insert, update, delete on public.compliance_checks from authenticated;

-- The ledgers: no write privilege of any kind for a browser role. This — not the
-- append-only trigger — is what makes them append-only in practice.
revoke insert, update, delete, truncate on public.audit_events from authenticated;
revoke insert, update, delete, truncate on public.access_events from authenticated;

revoke all on function public.reject_append_only_mutation() from public, anon, authenticated;
revoke all on function public.current_user_resident_ids() from public, anon;
grant execute on function public.current_user_resident_ids() to authenticated;
