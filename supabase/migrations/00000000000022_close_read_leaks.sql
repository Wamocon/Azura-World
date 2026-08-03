-- 00000000000022_close_read_leaks.sql
--
-- Two reads that the database allowed and only the application refused.
--
-- Both were found by an adversarial audit of the RLS policies, and both are
-- latent rather than currently exploited: the tables that hold the data are
-- empty today. That is exactly why they are worth fixing now — the first staff
-- internal note and the first AI conversation would each have been a disclosure
-- with nothing in the schema to stop it.
--
-- ---------------------------------------------------------------------------
-- 1. Staff internal notes were readable by the resident they are written about
-- ---------------------------------------------------------------------------
--
-- `messages.is_internal_note` is a staff-only annotation. The SELECT policy was:
--
--     create policy messages_select on public.messages for select
--       using (public.current_user_can_access_thread(thread_id));
--
-- and that is the whole of it — no predicate on `is_internal_note` at all. So
-- every participant in a thread could read every note written on it. Migration
-- 09 knew: its own column comment says
--
--     'Staff-only annotation. Note that the thread-level access helper does NOT
--      filter these: a route handler serving a resident must exclude
--      is_internal_note itself. Recorded here so the gap is known rather than
--      assumed closed.'
--
-- The gap was known and left open, with `getMessages()` in
-- `lib/communications-repository.ts` as the only thing standing in it. That was
-- defensible while nothing could write a note. It is not defensible now:
-- migration 17 opened the INSERT path and `createMessage()` accepts
-- `isInternalNote` for staff, so the product can now produce exactly the data
-- the boundary does not protect. One export, one report, one new endpoint that
-- reads `messages` without remembering the filter, and a tenant reads what
-- staff wrote about them.
--
-- Level 40 is `staff`, the same threshold `mayReadInternalNotes()` uses in the
-- repository. The application filter stays: two independent checks that agree is
-- the intent, not redundancy to remove.
drop policy if exists messages_select on public.messages;

create policy messages_select on public.messages for select
  using (
    public.current_user_can_access_thread(thread_id)
    and (
      is_internal_note = false
      or (select public.has_role_level(40))
    )
  );

comment on column public.messages.is_internal_note is
  'Staff-only annotation. Filtered in BOTH places since migration 22: the messages_select policy requires has_role_level(40) to return one, and getMessages() drops them for callers below staff. The migration-09 comment saying RLS does not filter this column is no longer true.';

-- ---------------------------------------------------------------------------
-- 2. A child account could read its guardian's private AI conversations
-- ---------------------------------------------------------------------------
--
--     create policy ai_conversations_select_own on public.ai_conversations
--       for select using (profile_id = (select public.current_user_scope_profile_id()));
--
-- `current_user_scope_profile_id()` deliberately resolves a `child_*` role to
-- its GUARDIAN's profile id — that is right for shared property: the flat, the
-- ledger, the tickets are the household's. An AI conversation is not shared
-- property. It is a transcript of what one person typed, and a supervised minor
-- reading their guardian's is the same category of wrong as reading their email.
--
-- Note the asymmetry that gave it away: the UPDATE policy beside it already used
-- `auth.uid()`. So a child could READ the guardian's conversations and not
-- modify them — which is not a coherent boundary, and is the shape a mistake
-- leaves rather than a decision.
--
-- `auth.uid()` for a non-child caller is their own profile, so this narrows the
-- `child_*` roles and changes nothing for anybody else. Manager oversight is
-- unaffected: `ai_conversations_select_manager` is a separate policy and is not
-- touched.
drop policy if exists ai_conversations_select_own on public.ai_conversations;

create policy ai_conversations_select_own on public.ai_conversations for select
  using (profile_id = (select auth.uid()));

comment on policy ai_conversations_select_own on public.ai_conversations is
  'The author, personally — auth.uid(), never current_user_scope_profile_id(). A transcript of what one person typed is not household property, so a child_* role does not inherit its guardian''s. Matches ai_conversations_update_own, which was already personal.';

-- ---------------------------------------------------------------------------
-- 3. Deactivating an account did not revoke assignment-derived access
-- ---------------------------------------------------------------------------
--
-- `current_user_scope_profile_id()` is careful about this and says so in its own
-- comment: a deactivated caller resolves NO scope, because otherwise
-- "deactivation would revoke role authority but silently leave residency
-- authority intact. That is a real hole, and it is the reason this case is
-- first."
--
-- Assignment authority never got the same treatment. Five places resolve the
-- caller with a bare `auth.uid()`, which is unaffected by `is_active`:
--
--     service_tickets_select_assignee          policy
--     workforce_tasks_select_assignee          policy
--     workforce_tasks_update_assignee          policy
--     current_user_assigned_ticket_ids()       helper
--     current_user_can_view_ticket()           helper
--
-- So an admin presses Deactivate on a contractor, every role-derived policy
-- correctly collapses — and the contractor keeps reading the tickets and tasks
-- assigned to them, and keeps UPDATE on those tasks, for as long as their token
-- refreshes. The Next.js UI locks them out (`auth-resolution.ts` returns the
-- anonymous profile), but PostgREST does not: RLS is evaluated from the token,
-- and the anon key is public.
--
-- `current_user_active_id()` is `auth.uid()` with the activity check the rest of
-- the schema already applies. Replacing the five sites with it makes
-- deactivation mean the same thing everywhere.
--
-- This does NOT end the session — the token stays valid until it expires, and
-- killing it needs `auth.admin.signOut` from the service-role client on the
-- deactivation path. That is an application change and is tracked separately;
-- this migration removes the authority the token carries, which is the half that
-- can be enforced by the database.

create or replace function public.current_user_active_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active
  limit 1;
$$;

comment on function public.current_user_active_id() is
  'auth.uid(), but only while the profile is active. Use this instead of a bare auth.uid() in any policy that grants authority, so deactivation revokes it. Personal, unlike current_user_scope_profile_id(): it never resolves a child_* to its guardian.';

revoke all on function public.current_user_active_id() from public, anon;
grant execute on function public.current_user_active_id() to authenticated;

-- --- the three assignment policies ------------------------------------------

drop policy if exists service_tickets_select_assignee on public.service_tickets;
create policy service_tickets_select_assignee on public.service_tickets for select
  using (assignee_profile_id = (select public.current_user_active_id()));

drop policy if exists workforce_tasks_select_assignee on public.workforce_tasks;
create policy workforce_tasks_select_assignee on public.workforce_tasks for select
  using (assignee_profile_id = (select public.current_user_active_id()));

drop policy if exists workforce_tasks_update_assignee on public.workforce_tasks;
create policy workforce_tasks_update_assignee on public.workforce_tasks for update
  using (assignee_profile_id = (select public.current_user_active_id()))
  with check (assignee_profile_id = (select public.current_user_active_id()));

-- --- the two helpers --------------------------------------------------------
-- Rewritten with the same bodies and the identity swapped, so the recursion
-- properties migration 06 §7 documents are unchanged.

create or replace function public.current_user_assigned_ticket_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct wt.ticket_id
  from public.workforce_tasks wt
  where wt.assignee_profile_id = (select public.current_user_active_id())
    and wt.ticket_id is not null
    and wt.status <> 'cancelled'::public.workforce_task_status;
$$;

-- Same body as migration 06's, with the one assignment branch swapped. The
-- SECURITY DEFINER + no-FORCE arrangement that breaks the ticket/task policy
-- cycle (migration 06 §7) is unchanged.
create or replace function public.current_user_can_view_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.service_tickets t
    where t.id = p_ticket_id
      and (
        public.is_admin()
        or (public.has_role_level(40) and t.company_id = public.current_user_company_id())
        -- Residency is inherited: scope_profile_id resolves a child_* role to its guardian
        -- and never wider (migration 01).
        or (public.has_role_level(8) and t.requester_profile_id = public.current_user_scope_profile_id())
        or (public.has_role_level(8) and t.unit_id is not null
            and t.unit_id in (select u.unit_id from public.current_user_unit_ids() u(unit_id)))
        -- Assignment is personal, not inherited — and no longer survives
        -- deactivation. Was `(select auth.uid())`.
        or t.assignee_profile_id = (select public.current_user_active_id())
        or t.id in (select a.ticket_id from public.current_user_assigned_ticket_ids() a(ticket_id))
      )
  );
$$;
