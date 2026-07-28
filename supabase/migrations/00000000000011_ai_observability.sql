-- 11 · AI observability (task W1-A)
--
-- Storage for the concierge that W2-C builds. The column set is dictated by
-- CONTRACTS.md §6 `AiResponse`: `source`, `citations`, `model`, `refused` and
-- `refusalReason` are all persisted, because the only way to prove rule 1 — "RBAC
-- decision BEFORE the gateway call" — after the fact is to have recorded which of the
-- three sources answered.
--
-- `ai_action_logs` is the human-in-the-loop queue. SYSTEM-PROMPT.md §2.9: the model may
-- RECOMMEND a financial, access-control or permission change; a human approves it. The
-- CHECK on `requires_human_approval` pins that to true at the schema level so no later
-- migration can quietly relax it.

do $$ begin
  create type public.ai_source as enum ('gateway', 'deterministic-fallback', 'rbac-guard');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ai_refusal_reason as enum (
    'out_of_scope', 'insufficient_permission', 'no_grounding', 'unsafe_request'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- ai_action_logs — recommendations awaiting a human
-- ---------------------------------------------------------------------------

create table if not exists public.ai_action_logs (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,
  site_id                 uuid references public.sites(id) on delete set null,
  module                  text not null,
  entity_table            text,
  entity_id               text,
  recommendation          text not null,
  rationale               text,
  confidence              numeric(5, 4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status                  text not null default 'suggested'
                            check (status in ('suggested', 'approved', 'rejected', 'applied', 'expired')),
  requires_human_approval boolean not null default true check (requires_human_approval),
  requested_by            uuid references public.profiles(id) on delete set null,
  approved_by             uuid references public.profiles(id) on delete set null,
  approved_at             timestamptz,
  -- CONTRACTS.md §6: every factual claim traced to dataset provenance.
  citations               jsonb not null default '[]'::jsonb,
  created_at              timestamptz not null default now(),
  constraint ai_action_logs_approval_shape check (
    (status in ('approved', 'applied') and approved_by is not null and approved_at is not null)
    or (status not in ('approved', 'applied'))
  )
);

comment on constraint ai_action_logs_approval_shape on public.ai_action_logs is
  'An approved or applied recommendation must name the human who approved it and when. An audit trail with an anonymous approver is not an audit trail.';

create index if not exists idx_ai_action_logs_company_status on public.ai_action_logs (company_id, status);
create index if not exists idx_ai_action_logs_site_id on public.ai_action_logs (site_id);
create index if not exists idx_ai_action_logs_requested_by on public.ai_action_logs (requested_by);

-- ---------------------------------------------------------------------------
-- ai_conversations / ai_messages
-- ---------------------------------------------------------------------------

create table if not exists public.ai_conversations (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid references public.profiles(id) on delete cascade,
  company_id     uuid references public.companies(id) on delete set null,
  -- The role AT THE TIME. A role change starts a new thread: context gathered as
  -- `manager` must never be replayed into a `tenant` session.
  role_at_time   public.app_role,
  surface        text not null default 'dashboard' check (surface in ('dashboard', 'public')),
  locale         text not null default 'de' check (locale in ('de', 'en', 'tr', 'ru')),
  running_summary text,
  created_at     timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  expires_at     timestamptz not null default (now() + interval '90 days')
);

comment on column public.ai_conversations.profile_id is
  'Nullable: the public concierge on the landing page has no authenticated user. Those rows carry surface = ''public'' and are unreadable by anyone but an administrator.';
comment on column public.ai_conversations.expires_at is
  'Retention horizon. Conversation transcripts are personal data; they do not live forever by default.';

create index if not exists idx_ai_conversations_profile on public.ai_conversations (profile_id, last_active_at desc);
create index if not exists idx_ai_conversations_company on public.ai_conversations (company_id, last_active_at desc);
create index if not exists idx_ai_conversations_expires on public.ai_conversations (expires_at);

create table if not exists public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  sender          text not null check (sender in ('user', 'assistant')),
  -- CONTRACTS.md §6 rule 4: input ceiling 2000 chars, validated before anything else.
  -- Enforced here too, so a bypassed route handler still cannot store an oversized turn.
  content         text not null check (char_length(content) between 1 and 8000),
  source          public.ai_source,
  model           text,
  refused         boolean not null default false,
  refusal_reason  public.ai_refusal_reason,
  citations       jsonb not null default '[]'::jsonb,
  tokens          integer check (tokens is null or tokens >= 0),
  latency_ms      integer check (latency_ms is null or latency_ms >= 0),
  created_at      timestamptz not null default now(),
  constraint ai_messages_user_turn_limit check (
    sender <> 'user' or char_length(content) <= 2000
  ),
  constraint ai_messages_refusal_shape check (
    (refused and refusal_reason is not null) or (not refused and refusal_reason is null)
  ),
  constraint ai_messages_assistant_has_source check (
    sender <> 'assistant' or source is not null
  )
);

comment on constraint ai_messages_assistant_has_source on public.ai_messages is
  'Every assistant turn records WHICH path answered — gateway, deterministic fallback, or the RBAC guard. Without it there is no way to audit CONTRACTS.md §6 rule 1 (the RBAC decision happens before the model call).';

create index if not exists idx_ai_messages_conversation on public.ai_messages (conversation_id, created_at);
create index if not exists idx_ai_messages_refused on public.ai_messages (refused) where refused;

-- ---------------------------------------------------------------------------
-- ai_feedback
-- ---------------------------------------------------------------------------

create table if not exists public.ai_feedback (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.ai_messages(id) on delete cascade,
  profile_id      uuid references public.profiles(id) on delete set null,
  rating          smallint not null check (rating between -1 and 1),
  reason          text check (reason is null or char_length(reason) <= 1000),
  created_at      timestamptz not null default now(),
  unique (message_id, profile_id)
);

create index if not exists idx_ai_feedback_message on public.ai_feedback (message_id);
create index if not exists idx_ai_feedback_profile on public.ai_feedback (profile_id);

-- ---------------------------------------------------------------------------
-- Scope helper — one choke point for conversation ownership
-- ---------------------------------------------------------------------------

create or replace function public.current_user_can_access_ai_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ai_conversations c
    where c.id = p_conversation_id
      and (
        c.profile_id = (select public.current_user_scope_profile_id())
        or (
          public.has_role_level(70)
          and c.company_id is not null
          and c.company_id = public.current_user_company_id()
        )
      )
  );
$$;

comment on function public.current_user_can_access_ai_conversation(uuid) is
  'The single predicate behind every ai_messages and ai_feedback read policy. Routing both child tables through one SECURITY DEFINER helper is what keeps the conversation/message policy pair from recursing.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.ai_action_logs   enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages      enable row level security;
alter table public.ai_feedback      enable row level security;

drop policy if exists ai_action_logs_select_manager on public.ai_action_logs;
create policy ai_action_logs_select_manager on public.ai_action_logs for select
  using ((select public.has_role_level(70)));

drop policy if exists ai_action_logs_select_own on public.ai_action_logs;
create policy ai_action_logs_select_own on public.ai_action_logs for select
  using (requested_by = (select auth.uid()));

drop policy if exists ai_action_logs_admin_write on public.ai_action_logs;
create policy ai_action_logs_admin_write on public.ai_action_logs for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists ai_conversations_select_own on public.ai_conversations;
create policy ai_conversations_select_own on public.ai_conversations for select
  using (profile_id = (select public.current_user_scope_profile_id()));

drop policy if exists ai_conversations_select_manager on public.ai_conversations;
create policy ai_conversations_select_manager on public.ai_conversations for select
  using (
    (select public.has_role_level(70))
    and company_id is not null
    and company_id = (select public.current_user_company_id())
  );

drop policy if exists ai_conversations_insert_own on public.ai_conversations;
create policy ai_conversations_insert_own on public.ai_conversations for insert
  with check (profile_id = (select auth.uid()));

drop policy if exists ai_conversations_update_own on public.ai_conversations;
create policy ai_conversations_update_own on public.ai_conversations for update
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists ai_messages_select_scoped on public.ai_messages;
create policy ai_messages_select_scoped on public.ai_messages for select
  using (public.current_user_can_access_ai_conversation(conversation_id));

drop policy if exists ai_messages_insert_scoped on public.ai_messages;
create policy ai_messages_insert_scoped on public.ai_messages for insert
  with check (public.current_user_can_access_ai_conversation(conversation_id));

drop policy if exists ai_feedback_select_scoped on public.ai_feedback;
create policy ai_feedback_select_scoped on public.ai_feedback for select
  using (profile_id = (select auth.uid()) or (select public.has_role_level(70)));

drop policy if exists ai_feedback_insert_own on public.ai_feedback;
create policy ai_feedback_insert_own on public.ai_feedback for insert
  with check (profile_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.ai_action_logs from anon;
revoke all on public.ai_conversations from anon;
revoke all on public.ai_messages from anon;
revoke all on public.ai_feedback from anon;

revoke insert, update, delete on public.ai_action_logs from authenticated;
grant select on public.ai_action_logs to authenticated;

revoke insert, update, delete on public.ai_conversations from authenticated;
grant select, insert on public.ai_conversations to authenticated;
-- Column-level UPDATE: the policy decides WHICH rows, the grant decides WHICH columns.
-- A user may keep their own thread's summary current; they may not rewrite its role or
-- retention horizon.
grant update (running_summary, last_active_at) on public.ai_conversations to authenticated;

revoke insert, update, delete on public.ai_messages from authenticated;
grant select, insert on public.ai_messages to authenticated;

revoke insert, update, delete on public.ai_feedback from authenticated;
grant select, insert on public.ai_feedback to authenticated;

revoke all on function public.current_user_can_access_ai_conversation(uuid) from public, anon;
grant execute on function public.current_user_can_access_ai_conversation(uuid) to authenticated;
