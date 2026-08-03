-- 00000000000017_participant_write_paths.sql
--
-- Let a resident say something.
--
-- ## What was wrong
--
-- Two write paths in this product were declared "not implemented" in the API
-- manifest (`createTicket`, `createMessage`, both 503) and the reason given was
-- that no repository write existed. That was true, but it was not the whole
-- truth: even with a repository written, both would have failed at the database.
--
--   messages          `grant select … to authenticated` and nothing more (09:428)
--   service_tickets   `grant select … to authenticated` (06:765); migration 16
--                     added UPDATE, never INSERT
--
-- and the only write policies on either table are manager-and-above:
--
--   messages_manager_write        ALL   is_admin() OR has_role_level(70)
--   service_tickets_staff_write   ALL   is_admin() OR has_role_level(40)
--
-- So there were two separate walls. Migration 16 documented the first one for
-- tickets — a policy is unreachable text until the table privilege exists, and
-- the request is refused as 42501 before the row check runs. The second wall is
-- new here: even granted, *no policy admits a resident at all*. A tenant could
-- read the thread about their own leaking tap and could not answer it, and could
-- not open a ticket to report it in the first place.
--
-- ## What this migration does, and what it deliberately does not
--
-- It adds exactly two participant-scoped INSERT policies plus the grants that
-- make them reachable. Nothing here widens an existing policy, and nothing here
-- touches UPDATE or DELETE:
--
--   * a resident may POST a message into a thread they can already read, as
--     themselves, and it can never be an internal note;
--   * a resident may OPEN a ticket about their own unit (or about the common
--     areas), as themselves, in a genuinely initial state.
--
-- A resident still cannot edit or delete a message once sent, cannot move a
-- ticket's status, cannot assign anyone, and cannot attach a cost. Those remain
-- staff privileges under the untouched policies above. A message is a statement
-- of record: the correction is another message, for the same reason ticket
-- history is append-only.

-- ---------------------------------------------------------------------------
-- 1. Messages — a participant may reply
-- ---------------------------------------------------------------------------

-- Row scope is `messages_insert_participant` below, plus the pre-existing
-- `messages_manager_write` for manager-and-above. INSERT only: UPDATE and DELETE
-- stay ungranted, so an authenticated caller cannot rewrite what was said.
grant insert on public.messages to authenticated;

-- Visibility and the right to reply are the same question, so they resolve
-- through the same function. Re-stating the participant predicate here instead
-- would be a second copy free to drift from the one the SELECT policy uses —
-- exactly the drift `current_user_can_access_thread` was created to prevent
-- (see the header of migration 09).
--
-- The three conjuncts after it are each doing real work:
--
--   sender_profile_id = auth.uid()
--       You post as yourself. `auth.uid()` and NOT
--       `current_user_scope_profile_id()`: authorship is personal, and a child_*
--       account must sign its own words rather than its guardian's.
--
--   sender_kind = 'user'
--       Without this a resident could post a message that renders as 'system'
--       and reads, in the UI, as if the building itself said it.
--
--   is_internal_note = false, unless staff
--       An internal note is hidden from the resident by `getMessages()`. A
--       resident who could set the flag would be writing into a channel they
--       cannot read; staff (level 40, the same threshold
--       `mayReadInternalNotes()` uses in lib/communications-repository.ts) may.
--
-- company_id needs no clause: the composite FK (thread_id, company_id) ->
-- threads (id, company_id) already makes a mismatched company impossible.
drop policy if exists messages_insert_participant on public.messages;
create policy messages_insert_participant on public.messages for insert
  with check (
    public.current_user_can_access_thread(thread_id)
    and sender_profile_id = (select auth.uid())
    and sender_kind = 'user'
    and (is_internal_note = false or (select public.has_role_level(40)))
  );

comment on policy messages_insert_participant on public.messages is
  'A participant may reply in a thread they can read, as themselves, never as system and never as an internal note unless they are staff. Reply rights are deliberately delegated to the same helper as read rights so the two cannot drift.';

-- ---------------------------------------------------------------------------
-- 2. Service tickets — a resident may report a problem
-- ---------------------------------------------------------------------------

-- Row scope is `service_tickets_insert_requester` below plus the pre-existing
-- `service_tickets_staff_write`. Note that staff could not create a ticket
-- either before this line: `service_tickets_staff_write` is `for all`, but
-- migration 16 granted only UPDATE.
grant insert on public.service_tickets to authenticated;

-- Level 8 is `child_tenant`, the same floor the three residency SELECT policies
-- use. It excludes guest (5) and child_guest (3), who can hold a
-- `unit_residents` row with relation 'guest' but have no standing to open work
-- against the building.
--
-- The state clauses are the substance of this policy. A ticket a resident opens
-- must be one that has not yet been triaged by anyone:
--
--   status = 'open', assignee is null      Nobody has picked it up. Without
--                                          this, a tenant could file a ticket
--                                          pre-assigned to a contractor, or
--                                          insert one already 'resolved' —
--                                          a fabricated work record.
--   resolved_at / closed_at null           Consistent with the above; the CHECK
--                                          constraints do not forbid a row that
--                                          is born closed.
--   estimated_cost / currency null,        Spend is a staff decision. A resident
--   requires_finance_approval = false      who could set a cost would be
--                                          committing the company's money.
--
-- unit_id: their own unit, or NULL for the common areas — a broken lobby light
-- belongs to no unit, and refusing to let anyone report it would be the wrong
-- kind of strictness.
drop policy if exists service_tickets_insert_requester on public.service_tickets;
create policy service_tickets_insert_requester on public.service_tickets for insert
  with check (
    (select public.has_role_level(8))
    and company_id = (select public.current_user_company_id())
    and requester_profile_id = (select public.current_user_scope_profile_id())
    and (
      unit_id is null
      or unit_id in (select unit_id from public.current_user_unit_ids() u(unit_id))
    )
    and status = 'open'::public.ticket_status
    and assignee_profile_id is null
    and resolved_at is null
    and closed_at is null
    and estimated_cost is null
    and currency is null
    and requires_finance_approval = false
  );

comment on policy service_tickets_insert_requester on public.service_tickets is
  'A resident may open a ticket about their own unit or the common areas, as themselves, in an untriaged state. They cannot pre-assign it, cannot open it already resolved, and cannot attach a cost — triage and spend stay with staff under service_tickets_staff_write.';
