-- 12 · Realtime — publication registration (task W1-A)
--
-- Registers the dashboard tables with the `supabase_realtime` publication so W2-D can
-- subscribe. Mirrors 1Çatı's `…0004_realtime_operational_dashboard.sql`, including its
-- triple guard, which exists for good reasons:
--
--   1. table-exists  — the loop names tables from several migrations; a partial apply must
--                      not abort here.
--   2. not-already-published — `alter publication … add table` errors if the table is
--                      already a member, which would make this migration non-idempotent.
--   3. exception handler — a database with no `supabase_realtime` publication at all (a
--                      plain PostgreSQL used for a pgTAP run, for example) should skip
--                      this quietly rather than fail the whole migration chain.
--
-- Realtime does NOT bypass RLS: a subscriber receives only the rows its policies already
-- allow it to SELECT. Publishing a table therefore does not widen access — but it does mean
-- that a table with a policy bug leaks continuously rather than on request, which is why
-- the list below is deliberately short. Finance, documents, audit and access events are NOT
-- published: nothing on a live dashboard needs them pushed, and they are the tables where a
-- policy mistake would cost the most.

do $$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'units',
    'service_tickets',
    'ticket_events',
    'workforce_tasks',
    'media_reports',
    'activities',
    'threads',
    'messages',
    'notifications',
    'ai_action_logs'
  ]
  loop
    if exists (
      select 1
      from information_schema.tables t
      where t.table_schema = 'public'
        and t.table_name = v_table_name
    )
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table_name);
    end if;
  end loop;
exception
  when undefined_object then
    raise notice 'Skipping realtime publication setup; supabase_realtime publication is unavailable.';
end;
$$;

-- REPLICA IDENTITY FULL on the tables whose UPDATE and DELETE events a subscriber needs to
-- reconcile against local state. Without it PostgreSQL sends only the primary key in the
-- OLD tuple, so a client cannot tell what changed and W2-D's optimistic UI has nothing to
-- diff against.
--
-- Applied narrowly. FULL writes the entire old row into the WAL on every update, which is a
-- real cost on a busy table; the three below are low-volume and are the ones the dashboard
-- reconciles.
do $$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'units',
    'service_tickets',
    'workforce_tasks'
  ]
  loop
    if exists (
      select 1
      from information_schema.tables t
      where t.table_schema = 'public'
        and t.table_name = v_table_name
    ) then
      execute format('alter table public.%I replica identity full', v_table_name);
    end if;
  end loop;
end;
$$;
