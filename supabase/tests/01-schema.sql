-- pgTAP · 01 — schema shape (task W1-A)
--
-- Tables, columns, types, NOT NULLs and foreign keys. The point of this file is not that
-- the tables exist — a migration that applied proves that — but that the SHAPE W2-A is
-- about to write repositories against is the shape it thinks it is. A column renamed in a
-- later migration should break here, loudly, rather than in a repository at runtime.
--
-- Run:  psql "$SUPABASE_DB_URL" -f supabase/tests/01-schema.sql
-- The file is one transaction ending in rollback; it leaves no trace.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;

select plan(99);

-- --- core tables exist ------------------------------------------------------

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'guardianships', 'guardianships exists');
select has_table('public', 'companies', 'companies exists');
select has_table('public', 'sites', 'sites exists');
select has_table('public', 'site_blocks', 'site_blocks exists');
select has_table('public', 'site_floors', 'site_floors exists');
select has_table('public', 'units', 'units exists');
select has_table('public', 'residents', 'residents exists');
select has_table('public', 'unit_residents', 'unit_residents exists');

-- --- evidence tables --------------------------------------------------------

select has_table('public', 'sources', 'sources exists');
select has_table('public', 'source_snapshots', 'source_snapshots exists');
select has_table('public', 'sourced_facts', 'sourced_facts exists');
select has_table('public', 'fact_sources', 'fact_sources exists');
select has_table('public', 'fact_conflicts', 'fact_conflicts exists');
select has_table('public', 'findings', 'findings exists');
select has_table('public', 'finding_values', 'finding_values exists');

-- --- hotel / portal ---------------------------------------------------------

select has_table('public', 'hotels', 'hotels exists');
select has_table('public', 'hotel_rooms', 'hotel_rooms exists');
select has_table('public', 'review_sources', 'review_sources exists');
select has_table('public', 'review_quotes', 'review_quotes exists');
select has_table('public', 'portal_listings', 'portal_listings exists');
select has_table('public', 'competing_prices', 'competing_prices exists');

-- --- operations / finance / governance / comms / ai -------------------------

select has_table('public', 'service_tickets', 'service_tickets exists');
select has_table('public', 'ticket_events', 'ticket_events exists');
select has_table('public', 'activities', 'activities exists');
select has_table('public', 'workforce_tasks', 'workforce_tasks exists');
select has_table('public', 'media_reports', 'media_reports exists');
select has_table('public', 'finance_ledger_entries', 'finance_ledger_entries exists');
select has_table('public', 'payment_transactions', 'payment_transactions exists');
select has_table('public', 'wallets', 'wallets exists');
select has_table('public', 'vendor_invoices', 'vendor_invoices exists');
select has_table('public', 'documents', 'documents exists');
select has_table('public', 'compliance_checks', 'compliance_checks exists');
select has_table('public', 'audit_events', 'audit_events exists');
select has_table('public', 'access_events', 'access_events exists');
select has_table('public', 'threads', 'threads exists');
select has_table('public', 'messages', 'messages exists');
select has_table('public', 'notifications', 'notifications exists');
select has_table('public', 'integration_outbox', 'integration_outbox exists');
select has_table('public', 'operational_search_documents', 'operational_search_documents exists');
select has_table('public', 'ai_action_logs', 'ai_action_logs exists');
select has_table('public', 'ai_conversations', 'ai_conversations exists');
select has_table('public', 'ai_messages', 'ai_messages exists');
select has_table('public', 'ai_feedback', 'ai_feedback exists');

-- --- the identity decision W2-A most needs to be right ----------------------
--
-- units.id is TEXT ('AZW-B03-0412'), not uuid. Every FK pointing at a unit inherits
-- that, and a repository that assumed uuid would typecheck and fail at runtime.

select col_type_is('public', 'units', 'id', 'text', 'units.id is text, not uuid');
select col_is_pk('public', 'units', 'id', 'units.id is the primary key');
select col_type_is('public', 'service_tickets', 'unit_id', 'text', 'service_tickets.unit_id is text');
select col_type_is('public', 'finance_ledger_entries', 'unit_id', 'text', 'finance_ledger_entries.unit_id is text');
select col_type_is('public', 'unit_residents', 'unit_id', 'text', 'unit_residents.unit_id is text');
select col_type_is('public', 'audit_events', 'entity_id', 'text', 'audit_events.entity_id is text — it must be able to name a unit');
select col_type_is('public', 'competing_prices', 'unit_id', 'text', 'competing_prices.unit_id is text');

-- --- money is numeric(14,2) + a currency column, never float ----------------

select col_type_is('public', 'units', 'asking_price_amount', 'numeric(14,2)', 'unit price is numeric(14,2)');
select col_type_is('public', 'finance_ledger_entries', 'debit_amount', 'numeric(14,2)', 'ledger debit is numeric(14,2)');
select col_type_is('public', 'finance_ledger_entries', 'credit_amount', 'numeric(14,2)', 'ledger credit is numeric(14,2)');
select col_type_is('public', 'wallets', 'balance_amount', 'numeric(14,2)', 'wallet balance is numeric(14,2)');
select col_type_is('public', 'vendor_invoices', 'total_amount', 'numeric(14,2)', 'invoice total is numeric(14,2)');
select col_type_is('public', 'competing_prices', 'amount', 'numeric(14,2)', 'competing price is numeric(14,2)');
select has_column('public', 'units', 'asking_price_currency', 'a unit price carries its currency');
select has_column('public', 'finance_ledger_entries', 'currency', 'a ledger entry carries its currency');
select has_column('public', 'competing_prices', 'currency', 'a competing price carries its currency');

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and data_type in ('real', 'double precision')
      and (column_name like '%amount%' or column_name like '%price%' or column_name like '%balance%')
  ),
  'no money column anywhere in public is a float'
);

-- --- timestamps are timestamptz, and clock times are time -------------------

select col_type_is('public', 'sourced_facts', 'created_at', 'timestamp with time zone', 'sourced_facts.created_at is timestamptz');
select col_type_is('public', 'source_snapshots', 'fetched_at', 'timestamp with time zone', 'source_snapshots.fetched_at is timestamptz');
select col_type_is('public', 'hotels', 'check_in', 'time without time zone', 'hotel check_in is a wall-clock time, not an instant');
select col_type_is('public', 'hotels', 'check_out', 'time without time zone', 'hotel check_out is a wall-clock time, not an instant');

-- --- NOT NULL where absence would be a lie ----------------------------------

select col_not_null('public', 'sourced_facts', 'confidence', 'a fact must state its confidence');
select col_not_null('public', 'sourced_facts', 'field_path', 'a fact must name the field it is about');
select col_not_null('public', 'sources', 'tier', 'a source must declare its tier');
select col_not_null('public', 'sources', 'host', 'a source must record its host — invariant 3 counts distinct hosts');
select col_not_null('public', 'findings', 'resolution', 'a finding must state how it was resolved, even if resolved_to is null');
select col_not_null('public', 'units', 'data_quality', 'a unit must declare whether it is a real listing or modelled');
select col_not_null('public', 'units', 'is_publicly_listed', 'public-catalogue membership is never unknown');
select col_not_null('public', 'competing_prices', 'observed_at', 'a competing price without an observation date cannot be aged');
select col_not_null('public', 'competing_prices', 'source_url', 'a price with no source URL cannot be displayed at all');

-- --- nullable where NULL is a real answer -----------------------------------

select col_is_null('public', 'sourced_facts', 'value', 'a fact value is nullable — "gap" requires it');
select col_is_null('public', 'hotels', 'brand_affiliation', 'no current chain affiliation is a researched answer, not missing data');
select col_is_null('public', 'units', 'asking_price_amount', 'an unpriced unit is an honest gap, not a zero');
select col_is_null('public', 'sites', 'plot_area_sqm', 'an unestablished site figure stays NULL rather than taking a plausible default');

-- --- foreign keys -----------------------------------------------------------

select fk_ok('public', 'units', 'block_id', 'public', 'site_blocks', 'id', 'units reference their block');
select fk_ok('public', 'units', 'site_id', 'public', 'sites', 'id', 'units reference their site');
select fk_ok('public', 'unit_residents', 'unit_id', 'public', 'units', 'id', 'unit_residents reference a unit');
select fk_ok('public', 'unit_residents', 'resident_id', 'public', 'residents', 'id', 'unit_residents reference a resident');
select fk_ok('public', 'fact_sources', 'fact_id', 'public', 'sourced_facts', 'id', 'a fact source belongs to a fact');
select fk_ok('public', 'fact_sources', 'source_id', 'public', 'sources', 'id', 'a fact source names a registered source');
select fk_ok('public', 'fact_conflicts', 'fact_id', 'public', 'sourced_facts', 'id', 'a conflict belongs to a fact');
select fk_ok('public', 'source_snapshots', 'source_id', 'public', 'sources', 'id', 'a snapshot belongs to a source');
select fk_ok('public', 'finding_values', 'finding_id', 'public', 'findings', 'id', 'a competing value belongs to a finding');
select fk_ok('public', 'guardianships', 'guardian_profile_id', 'public', 'profiles', 'id', 'a guardianship names a guardian profile');
select fk_ok('public', 'guardianships', 'child_profile_id', 'public', 'profiles', 'id', 'a guardianship names a child profile');

-- Invariant 6, the half a database can honestly enforce: a citation must point at a
-- snapshot that was actually stored.
select fk_ok('public', 'fact_sources', 'snapshot_sha256', 'public', 'source_snapshots', 'snapshot_sha256',
  'a citation must resolve to a stored snapshot hash');

-- --- unique constraints that carry meaning ----------------------------------

select col_is_unique('public', 'sourced_facts', array['entity_type', 'entity_id', 'field_path'],
  'one fact per entity field');
select col_is_unique('public', 'units', array['block_id', 'unit_no'],
  'unit_no is unique PER BLOCK, not globally');
select col_is_unique('public', 'site_blocks', array['site_id', 'code'],
  'block codes are unique within a site');
select col_is_unique('public', 'review_sources', array['url'],
  'review sources are keyed by url, NOT by platform — F-016 needs two tripadvisor-platform rows');

-- competing_prices must NOT be uniquely keyed on unit — CONTRACTS.md §2 says keep them all.
select ok(
  not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'competing_prices'
      and c.contype in ('u', 'p')
      and (
        select array_agg(a.attname::text order by a.attname::text)
        from unnest(c.conkey) k
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k
      ) @> array['unit_id']
  ),
  'competing_prices has NO unique key on unit_id — keeping every competing price is the requirement'
);

select ok(
  not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'portal_listings' and c.contype in ('u', 'p')
      and (
        select array_agg(a.attname::text order by a.attname::text)
        from unnest(c.conkey) k
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k
      ) = array['url']
  ),
  'portal_listings has NO unique key on url — one overview page publishes many listings'
);

-- --- RLS is on everywhere ---------------------------------------------------

select is(
  (select count(*)::integer
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'every table in public has row level security enabled'
);

-- --- extensions the schema depends on ---------------------------------------

select ok(
  exists (select 1 from pg_extension where extname = 'pg_trgm'),
  'pg_trgm is installed — migration 10 creates it, HANDOFF/W0-ENV.md flagged it as missing'
);
select ok(
  exists (select 1 from pg_extension where extname = 'pgcrypto'),
  'pgcrypto is installed'
);

select * from finish();
rollback;
