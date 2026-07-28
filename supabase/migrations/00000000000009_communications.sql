-- 09 · communications — threads, messages, notifications, integration_outbox (task W1-A)
--
-- The one structural decision worth reading before the rest: threads and messages would
-- ordinarily produce a policy cycle — "you may read a message if you may read its thread"
-- and "you may read a thread if it is yours" are two policies over two RLS-protected
-- tables, and expressing either as a bare `exists (select … from …)` re-enters the other
-- table's policies and raises 42P17. This is the exact failure the reference project had to
-- retrofit in `…0037_fix_workforce_staff_rls_recursion`.
--
-- Both tables therefore route through ONE SECURITY DEFINER helper,
-- public.current_user_can_access_thread(uuid). It is the only place thread visibility is
-- decided. If message visibility ever diverges from thread visibility, that is a change to
-- this one function, not a second predicate that can drift out of step.

-- ---------------------------------------------------------------------------
-- 1. threads
-- ---------------------------------------------------------------------------

create table if not exists public.threads (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  site_id         uuid references public.sites(id) on delete set null,
  unit_id         text references public.units(id) on delete set null,
  resident_id     uuid references public.residents(id) on delete set null,
  subject         text collate "tr-TR-x-icu" not null
                    check (char_length(subject) between 1 and 200),
  status          text not null default 'open'
                    check (status in ('open', 'pending', 'resolved', 'closed', 'archived')),
  priority        text not null default 'normal'
                    check (priority in ('low', 'normal', 'high', 'urgent')),
  locale          text not null default 'de' check (locale in ('de', 'en', 'tr', 'ru')),
  channel         text not null default 'portal'
                    check (channel in ('portal', 'email', 'whatsapp', 'phone', 'walk_in', 'system')),
  created_by      uuid references public.profiles(id) on delete set null,
  assigned_to     uuid references public.profiles(id) on delete set null,
  last_message_at timestamptz,
  message_count   integer not null default 0 check (message_count >= 0),
  version         integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Target for the composite FK on messages. Declaring it makes "a message can never be
  -- filed under a different company than its thread" a referential-integrity fact rather
  -- than an application-layer promise.
  unique (id, company_id)
);

comment on table public.threads is
  'Conversation container, scoped to a company and optionally to a site, unit or resident. Visibility is decided exclusively by public.current_user_can_access_thread().';
comment on column public.threads.locale is
  'The resident''s language for this conversation. Constrained to the four project locales so a thread cannot be opened in a locale the UI cannot render.';
comment on column public.threads.version is
  'Optimistic concurrency. Bumped by a new message as well as by an edit: a new message changes the thread''s observable state, so a client holding the older version should refetch rather than overwrite.';

create index if not exists idx_threads_company_id on public.threads (company_id);
create index if not exists idx_threads_site_id on public.threads (site_id);
create index if not exists idx_threads_unit_id on public.threads (unit_id);
create index if not exists idx_threads_resident_id on public.threads (resident_id);
create index if not exists idx_threads_created_by on public.threads (created_by);
create index if not exists idx_threads_assigned_to on public.threads (assigned_to);
create index if not exists idx_threads_company_activity on public.threads (company_id, last_message_at desc nulls last);
create index if not exists idx_threads_open
  on public.threads (company_id, priority, created_at desc)
  where status in ('open', 'pending');

drop trigger if exists set_threads_updated_at on public.threads;
create trigger set_threads_updated_at
  before update on public.threads
  for each row execute function public.set_updated_at();

drop trigger if exists bump_threads_version on public.threads;
create trigger bump_threads_version
  before update on public.threads
  for each row execute function public.bump_row_version();

-- ---------------------------------------------------------------------------
-- 2. messages
-- ---------------------------------------------------------------------------

create table if not exists public.messages (
  id                     uuid primary key default gen_random_uuid(),
  thread_id              uuid not null,
  company_id             uuid not null references public.companies(id) on delete cascade,
  sender_profile_id      uuid references public.profiles(id) on delete set null,
  sender_kind            text not null default 'user'
                           check (sender_kind in ('user', 'system', 'automation')),
  -- Ceiling as well as floor. An unbounded text column on a write path reachable from a
  -- browser is a denial-of-service surface, and CONVENTIONS.md §4 requires a length ceiling
  -- on every string that crosses an API boundary — enforced here too, so the ceiling
  -- survives a route handler that forgets it.
  body                   text not null check (char_length(body) between 1 and 10000),
  channel                text not null default 'portal'
                           check (channel in ('portal', 'email', 'whatsapp', 'phone', 'walk_in', 'system')),
  locale                 text check (locale is null or locale in ('de', 'en', 'tr', 'ru')),
  is_internal_note       boolean not null default false,
  idempotency_key        text check (idempotency_key is null or char_length(idempotency_key) between 8 and 200),
  attachment_document_id uuid references public.documents(id) on delete set null,
  delivered_at           timestamptz,
  read_at                timestamptz,
  created_at             timestamptz not null default now(),

  -- CONVENTIONS.md §4: idempotency keys on every public mutation. Scoped per company so one
  -- tenant cannot burn another tenant's key namespace. NULL is allowed and NULLs are
  -- distinct in a unique constraint, so system- and automation-generated messages need no
  -- key.
  unique (company_id, idempotency_key),

  -- Composite FK: enforces both "the thread exists" and "the message's company is the
  -- thread's company". A single-column thread_id FK would allow the second to drift, and
  -- the drifted row would then be invisible to the thread's own readers.
  constraint messages_thread_company_fkey
    foreign key (thread_id, company_id)
    references public.threads (id, company_id) on delete cascade
);

comment on table public.messages is
  'Individual messages within a thread. Read access is delegated wholesale to public.current_user_can_access_thread(thread_id) — messages carry no visibility rule of their own, by design.';
comment on column public.messages.is_internal_note is
  'Staff-only annotation. Note that the thread-level access helper does NOT filter these: a route handler serving a resident must exclude is_internal_note itself. Recorded here so the gap is known rather than assumed closed.';

create index if not exists idx_messages_thread_id on public.messages (thread_id, created_at desc);
create index if not exists idx_messages_thread_company on public.messages (thread_id, company_id);
create index if not exists idx_messages_company_id on public.messages (company_id);
create index if not exists idx_messages_sender_profile_id on public.messages (sender_profile_id);
create index if not exists idx_messages_attachment_document_id on public.messages (attachment_document_id);

-- ---------------------------------------------------------------------------
-- 3. The single access choke point for threads AND messages
--
-- SECURITY DEFINER + a non-FORCEd table means the read of public.threads inside this
-- function runs as the table owner and does not re-enter threads' own policies. That is
-- what breaks the thread/message cycle.
-- ---------------------------------------------------------------------------

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
        or (
          t.unit_id is not null
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
  'The ONLY thread/message visibility decision in the schema. Both public.threads and public.messages route their SELECT policies through it, which is what prevents the two tables'' policies from referencing each other and raising 42P17.';

-- ---------------------------------------------------------------------------
-- 4. Thread activity denormalisation
--
-- last_message_at and message_count drive the inbox list. Maintained by trigger rather than
-- by the writing repository, because an unmaintained denormalised column rots silently and
-- an inbox sorted on a stale timestamp looks like a data-loss bug.
-- ---------------------------------------------------------------------------

create or replace function public.sync_thread_message_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.threads t
     set last_message_at = greatest(coalesce(t.last_message_at, new.created_at), new.created_at),
         message_count   = t.message_count + 1
   where t.id = new.thread_id;

  return new;
end;
$$;

comment on function public.sync_thread_message_stats() is
  'AFTER INSERT on messages. SECURITY DEFINER so the write to public.threads is not blocked by threads'' own policies — the inserting session may legitimately be able to post to a thread it cannot UPDATE.';

drop trigger if exists sync_thread_message_stats on public.messages;
create trigger sync_thread_message_stats
  after insert on public.messages
  for each row execute function public.sync_thread_message_stats();

-- ---------------------------------------------------------------------------
-- 5. notifications
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  category   text not null check (category in (
               'system', 'finance', 'service', 'compliance',
               'document', 'message', 'announcement'
             )),
  severity   text not null default 'info'
               check (severity in ('info', 'success', 'warning', 'critical')),
  title      text collate "tr-TR-x-icu" not null
               check (char_length(title) between 1 and 200),
  body       text check (body is null or char_length(body) <= 2000),
  payload    jsonb not null default '{}'::jsonb,
  link       text,
  locale     text not null default 'de' check (locale in ('de', 'en', 'tr', 'ru')),
  is_read    boolean not null default false,
  read_at    timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),

  -- Site-relative paths only. '//evil.example' is a protocol-relative URL that a browser
  -- resolves off-site, so `^/` alone is not sufficient — a notification is a server-authored
  -- link the user is invited to click, which makes it an open-redirect surface if it can
  -- point anywhere.
  constraint notifications_link_is_relative check (
    link is null or (link ~ '^/' and link !~ '^//')
  ),

  constraint notifications_read_at_consistent check (
    (is_read and read_at is not null) or (not is_read and read_at is null)
  )
);

comment on table public.notifications is
  'Per-profile inbox. No staff or manager read path exists through RLS: a notification is addressed to one person. Support access goes through the service-role client, where it is itself auditable.';

create index if not exists idx_notifications_profile_id on public.notifications (profile_id);
create index if not exists idx_notifications_company_id on public.notifications (company_id);
create index if not exists idx_notifications_inbox on public.notifications (profile_id, created_at desc);
create index if not exists idx_notifications_unread
  on public.notifications (profile_id, created_at desc)
  where not is_read;

-- ---------------------------------------------------------------------------
-- 6. integration_outbox — durable queue, service-role only
--
-- An outbound side effect is a row first and a network call second, so a crash between the
-- two loses nothing.
-- ---------------------------------------------------------------------------

create table if not exists public.integration_outbox (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  topic         text not null check (char_length(topic) between 1 and 120),
  status        text not null default 'queued' check (status in (
                  'queued', 'processing', 'retry_wait', 'succeeded', 'dead_letter', 'cancelled'
                )),
  payload       jsonb not null default '{}'::jsonb,
  dedupe_key    text check (dedupe_key is null or char_length(dedupe_key) between 8 and 200),
  retry_count   integer not null default 0 check (retry_count >= 0),
  max_retries   integer not null default 8 check (max_retries >= 0),
  next_retry_at timestamptz,
  locked_at     timestamptz,
  locked_by     text,
  claim_token   uuid,
  last_error    text check (last_error is null or char_length(last_error) <= 4000),
  succeeded_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Per-company idempotency. NULLs are distinct in a unique constraint, so a job with no
  -- natural dedupe identity simply omits the key rather than inventing one.
  unique (company_id, dedupe_key),

  -- The claim triple is all-or-nothing. A row marked 'processing' with a NULL claim_token
  -- is a lease nobody can prove they hold and nobody can safely reclaim: either it is
  -- picked up twice or it is stranded forever. Both are the classic outbox failure, and
  -- both are unrepresentable here.
  constraint integration_outbox_claim_coherent check (
    (status = 'processing'
      and locked_at is not null and locked_by is not null and claim_token is not null)
    or (status <> 'processing'
      and locked_at is null and locked_by is null and claim_token is null)
  ),

  -- A row waiting to retry with no scheduled time never runs again and never reports as
  -- failed. It just disappears from operations.
  constraint integration_outbox_retry_wait_has_time check (
    status <> 'retry_wait' or next_retry_at is not null
  ),

  constraint integration_outbox_retry_within_max check (retry_count <= max_retries),

  constraint integration_outbox_succeeded_at check (
    (status = 'succeeded') = (succeeded_at is not null)
  )
);

comment on table public.integration_outbox is
  'Durable outbound command queue. Service-role only: anon and authenticated hold no privilege at all, not even SELECT, because payload carries whatever the outbound integration needs — frequently including contact details.';
comment on column public.integration_outbox.claim_token is
  'Per-attempt lease token. A worker completing a job must present the token it claimed with, so a slow worker whose lease was reclaimed cannot mark someone else''s attempt as succeeded.';

create index if not exists idx_integration_outbox_company_id on public.integration_outbox (company_id);
create index if not exists idx_integration_outbox_dedupe on public.integration_outbox (company_id, dedupe_key)
  where dedupe_key is not null;

-- The claim query, and the reason this table performs. Partial, so the index holds only
-- runnable work: succeeded and dead_letter rows accumulate forever and would otherwise
-- dominate an index that is read on every poll.
create index if not exists idx_integration_outbox_due
  on public.integration_outbox (status, next_retry_at, created_at)
  where status in ('queued', 'retry_wait');

create index if not exists idx_integration_outbox_stuck
  on public.integration_outbox (locked_at)
  where status = 'processing';

drop trigger if exists set_integration_outbox_updated_at on public.integration_outbox;
create trigger set_integration_outbox_updated_at
  before update on public.integration_outbox
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. RLS
--
-- Read model:
--   admin (90)       → everything
--   staff (40)+      → their company's threads and messages
--   service_provider → threads assigned to them, and those threads' messages
--   owner / tenant   → threads for their own units, and threads they opened
--   child_*          → their guardian's set, never wider
--   every profile    → its own notifications, plus its guardian's
--   guest / anon     → nothing. None of these four tables is public.
-- ---------------------------------------------------------------------------

alter table public.threads            enable row level security;
alter table public.messages           enable row level security;
alter table public.notifications      enable row level security;
alter table public.integration_outbox enable row level security;

-- threads / messages: one predicate, called with the row's own key. Not wrapped in
-- `(select …)` — that idiom caches a no-arg STABLE call as an initplan, and this call is
-- correlated, so the wrapper would add a subplan for nothing.

drop policy if exists threads_select on public.threads;
create policy threads_select on public.threads for select
  using (public.current_user_can_access_thread(id));

drop policy if exists threads_manager_write on public.threads;
create policy threads_manager_write on public.threads for all
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

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select
  using (public.current_user_can_access_thread(thread_id));

drop policy if exists messages_manager_write on public.messages;
create policy messages_manager_write on public.messages for all
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

-- notifications ------------------------------------------------------------

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select
  using (
    profile_id = (select auth.uid())
    or profile_id = (select public.current_user_scope_profile_id())
  );

-- Marking as read is scoped to auth.uid() alone, NOT to the guardian scope. A child may see
-- its guardian's notification through the SELECT policy above; letting it clear the
-- guardian's unread state would be a child widening its authority.
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- integration_outbox -------------------------------------------------------
--
-- Deliberately unsatisfiable from a browser session: is_service_context() is false for
-- `authenticated` and `anon`, and service_role bypasses RLS anyway. The policy exists so
-- the table is not "RLS enabled, zero policies" — a state a linter flags and a reader
-- cannot distinguish from an oversight.
drop policy if exists integration_outbox_service_only on public.integration_outbox;
create policy integration_outbox_service_only on public.integration_outbox for all
  using ((select public.is_service_context()))
  with check ((select public.is_service_context()));

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------

grant select on public.threads to authenticated;
grant select on public.messages to authenticated;
grant select on public.notifications to authenticated;

-- Column-level UPDATE: the read flag is the one thing a browser is allowed to write
-- anywhere in this migration. Granting UPDATE on the whole row would let a recipient
-- rewrite the title, body and link of a notification the server authored.
grant update (is_read, read_at) on public.notifications to authenticated;

revoke all on public.threads from anon;
revoke all on public.messages from anon;
revoke all on public.notifications from anon;

revoke insert, update, delete on public.threads from authenticated;
revoke insert, update, delete on public.messages from authenticated;
revoke insert, delete on public.notifications from authenticated;

-- Service-role only, stated twice: no privilege and no reachable policy.
revoke all on public.integration_outbox from anon, authenticated;

revoke all on function public.current_user_can_access_thread(uuid) from public, anon;
grant execute on function public.current_user_can_access_thread(uuid) to authenticated;

revoke all on function public.sync_thread_message_stats() from public, anon, authenticated;
