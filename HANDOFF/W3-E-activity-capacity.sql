-- ===========================================================================
-- PROPOSED MIGRATION — activity bookings with capacity enforced in Postgres
--
--   Written by W3-E (night 2, N3). **NOT APPLIED.** `supabase/migrations/*` is
--   W1-A's exclusive path (ORCHESTRATION.md §4) and this window does not write
--   there. This file is the request, in the form it should land: as
--   `supabase/migrations/00000000000015_activity_bookings.sql`.
--
--   Why it exists: `tasks/W3-E-modules-operations.md` requires that "capacity is
--   enforced at the database, not in the UI. Two users booking the last slot
--   simultaneously must produce one success and one clean rejection." There is
--   today no table to book against — `public.activities` carries a `capacity`
--   column and nothing references it. Enforcing capacity in the page would be
--   enforcing it in the UI, which is the thing the brief names as wrong.
--
--   Proven before being proposed. `scripts/probe/activity-capacity-probe.mjs`
--   (pasted in HANDOFF/W3-E.md) applies this file to a real PostgreSQL server
--   and drives it with genuinely concurrent connections. Results are in the
--   handoff.
--
--   RLS ships in this file, with the table, per SYSTEM-PROMPT §2.5.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Booking state
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'activity_booking_state') then
    create type public.activity_booking_state as enum (
      'booked',
      'waitlisted',
      'cancelled'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. activity_bookings
--
-- `seat_no` is not decoration. It is the column the unique index enforces, and
-- the unique index is what makes this correct rather than merely careful: a
-- counted check can be raced, an index entry cannot.
-- ---------------------------------------------------------------------------

create table if not exists public.activity_bookings (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  activity_id   uuid not null references public.activities(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  state         public.activity_booking_state not null default 'booked',

  -- 1..capacity while booked; NULL otherwise. NULL is "holds no seat", which is
  -- a different fact from "holds seat 0" — CONVENTIONS §5, the same null-vs-zero
  -- distinction the `capacity` column itself is commented with.
  seat_no       integer,
  -- 1..n while waitlisted; NULL otherwise. Position, not priority.
  waitlist_no   integer,

  booked_at     timestamptz not null default now(),
  cancelled_at  timestamptz,
  -- Set when this row was promoted off the waitlist, so the promotion is
  -- visible on the row and not only in the audit table.
  promoted_at   timestamptz,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint activity_bookings_seat_positive
    check (seat_no is null or seat_no > 0),
  constraint activity_bookings_waitlist_positive
    check (waitlist_no is null or waitlist_no > 0),

  -- A row holds a seat or a waitlist place, never both, and a cancelled row
  -- holds neither. Without this a cancelled row could keep its seat_no and the
  -- partial unique index below would refuse to reissue the seat.
  constraint activity_bookings_state_shape check (
    (state = 'booked'     and seat_no is not null and waitlist_no is null) or
    (state = 'waitlisted' and seat_no is null     and waitlist_no is not null) or
    (state = 'cancelled'  and seat_no is null     and waitlist_no is null)
  ),
  constraint activity_bookings_cancelled_at_shape check (
    (state = 'cancelled') = (cancelled_at is not null)
  )
);

-- **This index is the enforcement.** Everything else is ergonomics.
--
-- Partial on `state = 'booked'`: a cancelled row stops occupying its seat the
-- moment it is cancelled, so the seat is immediately reissuable, and the
-- history of who held it is not deleted to achieve that.
create unique index if not exists activity_bookings_seat_unique
  on public.activity_bookings (activity_id, seat_no)
  where state = 'booked';

-- One live booking per person per activity. Also partial: somebody who cancels
-- may book again, and the cancelled row must not block them.
create unique index if not exists activity_bookings_one_live_per_profile
  on public.activity_bookings (activity_id, profile_id)
  where state in ('booked', 'waitlisted');

create unique index if not exists activity_bookings_waitlist_unique
  on public.activity_bookings (activity_id, waitlist_no)
  where state = 'waitlisted';

create index if not exists idx_activity_bookings_activity
  on public.activity_bookings (activity_id, state);
create index if not exists idx_activity_bookings_profile
  on public.activity_bookings (profile_id, state);
create index if not exists idx_activity_bookings_company
  on public.activity_bookings (company_id);

drop trigger if exists set_activity_bookings_updated_at on public.activity_bookings;
create trigger set_activity_bookings_updated_at
  before update on public.activity_bookings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. activity_booking_events — the audit trail
--
-- Append-only, like `ticket_events` and for the same reason: a promotion off
-- the waitlist reassigns a scarce thing, and the record of why has to outlive
-- the row it describes.
-- ---------------------------------------------------------------------------

create table if not exists public.activity_booking_events (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.activity_bookings(id) on delete cascade,
  activity_id  uuid not null references public.activities(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  kind         text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  note         text,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),

  constraint activity_booking_events_kind check (
    kind in ('booked', 'waitlisted', 'cancelled', 'promoted', 'rejected_full')
  )
);

create index if not exists idx_activity_booking_events_booking
  on public.activity_booking_events (booking_id, created_at);

create or replace function public.reject_activity_booking_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'activity_booking_events is append-only'
    using errcode = '42501';
end
$$;

drop trigger if exists reject_activity_booking_events_mutation on public.activity_booking_events;
create trigger reject_activity_booking_events_mutation
  before update or delete on public.activity_booking_events
  for each row execute function public.reject_activity_booking_event_mutation();

-- ---------------------------------------------------------------------------
-- 4. book_activity() — the only supported way in
--
-- ## The two mechanisms, and why both
--
-- **`pg_advisory_xact_lock` keyed on the activity** serialises seat allocation
-- for one activity and nothing else. Two people booking DIFFERENT activities
-- never wait on each other. It is what makes the failure mode *clean*: the
-- loser of a race for the last seat gets `activity_full`, which is a true
-- statement about the world, instead of `unique_violation`, which is a true
-- statement about an index and means nothing to the person holding the phone.
--
-- **The partial unique index** is what makes it *correct*. The advisory lock is
-- cooperative: it binds only callers who take it. Anyone who inserts directly —
-- a future repository function, a migration, a psql session — bypasses the lock
-- and still cannot double-issue a seat, because the index is not cooperative.
--
-- Dropping either one leaves a real hole. Dropping the lock reintroduces
-- spurious rejections when free seats remain; dropping the index means the
-- guarantee lasts exactly as long as everyone remembers to call this function.
--
-- ## Seat numbers fill gaps
--
-- `min(s) where not exists(...)` over `generate_series(1, capacity)`, not
-- `count(*) + 1`. After a cancellation, counting hands out a seat number that is
-- already taken, and the index then rejects a booking that should have
-- succeeded. That is a spurious rejection with free capacity, which is worse
-- than the race this whole function exists to close.
-- ---------------------------------------------------------------------------

create or replace function public.book_activity(
  p_activity_id    uuid,
  p_profile_id     uuid,
  p_allow_waitlist boolean default true,
  p_actor_profile_id uuid default null
)
returns public.activity_bookings
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_activity   public.activities%rowtype;
  v_capacity   integer;
  v_seat       integer;
  v_waitlist   integer;
  v_booking    public.activity_bookings%rowtype;
begin
  select * into v_activity from public.activities where id = p_activity_id;
  if not found then
    raise exception 'activity_not_found' using errcode = 'P0002';
  end if;

  if v_activity.status in ('cancelled', 'completed') then
    raise exception 'activity_closed' using errcode = 'P0001';
  end if;

  -- Serialise every booking for THIS activity. Transaction-scoped, so it is
  -- released on commit or rollback and cannot be leaked by a failing caller.
  perform pg_advisory_xact_lock(hashtextextended(p_activity_id::text, 0));

  v_capacity := v_activity.capacity;

  -- NULL capacity is uncapped, not zero. An uncapped activity issues no seat
  -- numbers at all: there is nothing scarce to number.
  if v_capacity is null then
    insert into public.activity_bookings
      (company_id, activity_id, profile_id, state, seat_no)
    values
      (v_activity.company_id, p_activity_id, p_profile_id, 'booked', null)
    returning * into v_booking;

    insert into public.activity_booking_events
      (booking_id, activity_id, company_id, kind, actor_profile_id)
    values
      (v_booking.id, p_activity_id, v_activity.company_id, 'booked',
       coalesce(p_actor_profile_id, p_profile_id));
    return v_booking;
  end if;

  select min(s) into v_seat
  from generate_series(1, v_capacity) as s
  where not exists (
    select 1 from public.activity_bookings b
    where b.activity_id = p_activity_id
      and b.state = 'booked'
      and b.seat_no = s
  );

  if v_seat is not null then
    insert into public.activity_bookings
      (company_id, activity_id, profile_id, state, seat_no)
    values
      (v_activity.company_id, p_activity_id, p_profile_id, 'booked', v_seat)
    returning * into v_booking;

    insert into public.activity_booking_events
      (booking_id, activity_id, company_id, kind, actor_profile_id, payload)
    values
      (v_booking.id, p_activity_id, v_activity.company_id, 'booked',
       coalesce(p_actor_profile_id, p_profile_id),
       jsonb_build_object('seat_no', v_seat));
    return v_booking;
  end if;

  -- Full.
  if not p_allow_waitlist then
    raise exception 'activity_full' using errcode = 'P0001';
  end if;

  select coalesce(max(waitlist_no), 0) + 1 into v_waitlist
  from public.activity_bookings
  where activity_id = p_activity_id and state = 'waitlisted';

  insert into public.activity_bookings
    (company_id, activity_id, profile_id, state, waitlist_no)
  values
    (v_activity.company_id, p_activity_id, p_profile_id, 'waitlisted', v_waitlist)
  returning * into v_booking;

  insert into public.activity_booking_events
    (booking_id, activity_id, company_id, kind, actor_profile_id, payload)
  values
    (v_booking.id, p_activity_id, v_activity.company_id, 'waitlisted',
     coalesce(p_actor_profile_id, p_profile_id),
     jsonb_build_object('waitlist_no', v_waitlist));
  return v_booking;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. cancel_activity_booking() — cancellation promotes, and says so
-- ---------------------------------------------------------------------------

create or replace function public.cancel_activity_booking(
  p_booking_id uuid,
  p_actor_profile_id uuid default null
)
returns public.activity_bookings
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_booking   public.activity_bookings%rowtype;
  v_freed     integer;
  v_next      public.activity_bookings%rowtype;
begin
  select * into v_booking from public.activity_bookings where id = p_booking_id;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if v_booking.state = 'cancelled' then
    return v_booking;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_booking.activity_id::text, 0));

  v_freed := v_booking.seat_no;

  update public.activity_bookings
     set state = 'cancelled',
         seat_no = null,
         waitlist_no = null,
         cancelled_at = now()
   where id = p_booking_id
  returning * into v_booking;

  insert into public.activity_booking_events
    (booking_id, activity_id, company_id, kind, actor_profile_id, payload)
  values
    (v_booking.id, v_booking.activity_id, v_booking.company_id, 'cancelled',
     p_actor_profile_id, jsonb_build_object('freed_seat_no', v_freed));

  -- Only a released SEAT promotes anyone. Someone leaving the waitlist frees
  -- nothing, and renumbering the queue behind them would rewrite an order
  -- people were told.
  if v_freed is null then
    return v_booking;
  end if;

  select * into v_next
  from public.activity_bookings
  where activity_id = v_booking.activity_id and state = 'waitlisted'
  order by waitlist_no asc
  limit 1;

  if found then
    update public.activity_bookings
       set state = 'booked',
           seat_no = v_freed,
           waitlist_no = null,
           promoted_at = now()
     where id = v_next.id
    returning * into v_next;

    insert into public.activity_booking_events
      (booking_id, activity_id, company_id, kind, actor_profile_id, payload)
    values
      (v_next.id, v_next.activity_id, v_next.company_id, 'promoted',
       p_actor_profile_id,
       jsonb_build_object('seat_no', v_freed, 'from_booking_id', p_booking_id));
  end if;

  return v_booking;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS — in this migration, with the tables (SYSTEM-PROMPT §2.5)
--
-- Mirrors the activities policies in migration 06: staff and above see their
-- company; a resident sees their own bookings and nothing else. A resident must
-- not be able to enumerate who else is attending, so there is no "same activity"
-- read path below staff level.
-- ---------------------------------------------------------------------------

alter table public.activity_bookings enable row level security;
alter table public.activity_booking_events enable row level security;

drop policy if exists activity_bookings_select_staff on public.activity_bookings;
create policy activity_bookings_select_staff
  on public.activity_bookings for select
  using (public.has_role_level(40));

drop policy if exists activity_bookings_select_own on public.activity_bookings;
create policy activity_bookings_select_own
  on public.activity_bookings for select
  using (profile_id = public.current_user_scope_profile_id());

drop policy if exists activity_bookings_insert_own on public.activity_bookings;
create policy activity_bookings_insert_own
  on public.activity_bookings for insert
  with check (
    public.has_role_level(40)
    or profile_id = public.current_user_scope_profile_id()
  );

drop policy if exists activity_bookings_update_own on public.activity_bookings;
create policy activity_bookings_update_own
  on public.activity_bookings for update
  using (
    public.has_role_level(40)
    or profile_id = public.current_user_scope_profile_id()
  )
  with check (
    public.has_role_level(40)
    or profile_id = public.current_user_scope_profile_id()
  );

drop policy if exists activity_booking_events_select on public.activity_booking_events;
create policy activity_booking_events_select
  on public.activity_booking_events for select
  using (
    public.has_role_level(40)
    or exists (
      select 1 from public.activity_bookings b
      where b.id = booking_id
        and b.profile_id = public.current_user_scope_profile_id()
    )
  );

drop policy if exists activity_booking_events_insert on public.activity_booking_events;
create policy activity_booking_events_insert
  on public.activity_booking_events for insert
  with check (
    public.has_role_level(40)
    or exists (
      select 1 from public.activity_bookings b
      where b.id = booking_id
        and b.profile_id = public.current_user_scope_profile_id()
    )
  );

-- No DELETE policy on either table, at any level. A booking is cancelled, never
-- erased: the seat it held is part of the audit trail for who got the last place.
