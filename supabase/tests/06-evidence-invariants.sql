-- pgTAP · 06 — evidence invariants (task W1-A)
--
-- CONTRACTS.md §1 lists six invariants on SourcedFact. This file proves the database
-- REJECTS each violation, not merely that the seeded data happens to satisfy them. Those
-- are different claims: data can be clean because nobody has tried to break it yet.
--
-- Invariants 1 and 4 are plain CHECK constraints and fail immediately. Invariants 2, 3 and
-- 5 depend on child rows, so they are DEFERRABLE INITIALLY DEFERRED constraint triggers
-- and fail at COMMIT — which in a test means after an explicit `set constraints all
-- immediate`. Each such case is wrapped in its own subtransaction so one expected failure
-- does not abort the file.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;

select plan(23);

-- Fixtures: two sources on DIFFERENT hosts, and two on the SAME host. The second pair is
-- what makes invariant 3 meaningful — finding F-016 records a real case where one
-- Tripadvisor score re-served by a reseller would otherwise have looked like two
-- independent hosts agreeing.
insert into public.sources (id, publisher, tier, url, host, kind) values
  ('tap-a',  'Host A',  4, 'https://a.example/1', 'a.example', 'portal'),
  ('tap-a2', 'Host A2', 4, 'https://a.example/2', 'a.example', 'portal'),
  ('tap-b',  'Host B',  4, 'https://b.example/1', 'b.example', 'portal');

insert into public.source_snapshots (source_id, fetched_at, http_status, snapshot_sha256, bytes, content_validated)
values ('tap-a', now(), '200', 'tap-sha-a', 10, true);

-- --- invariant 1: gap ⟹ value is null AND note is non-empty -----------------

select throws_ok(
  $sql$
    insert into public.sourced_facts (entity_type, entity_id, field_path, value, confidence, note)
    values ('project', 'TAP', 'tap.gap.value', '5'::jsonb, 'gap', 'explained')
  $sql$,
  '23514',
  null,
  'a "gap" fact carrying a value is rejected'
);

select throws_ok(
  $sql$
    insert into public.sourced_facts (entity_type, entity_id, field_path, value, confidence, note)
    values ('project', 'TAP', 'tap.gap.note', null, 'gap', null)
  $sql$,
  '23514',
  null,
  'a "gap" fact with no note is rejected'
);

select throws_ok(
  $sql$
    insert into public.sourced_facts (entity_type, entity_id, field_path, value, confidence, note)
    values ('project', 'TAP', 'tap.gap.blank', null, 'gap', '   ')
  $sql$,
  '23514',
  null,
  'a "gap" fact whose note is only whitespace is rejected — "" is not an explanation'
);

select lives_ok(
  $sql$
    insert into public.sourced_facts (entity_type, entity_id, field_path, value, confidence, note)
    values ('project', 'TAP', 'tap.gap.ok', null, 'gap', 'No source states this.')
  $sql$,
  'a well-formed "gap" fact is accepted'
);

-- --- invariant 4: inferred ⟹ note explains the derivation -------------------

select throws_ok(
  $sql$
    insert into public.sourced_facts (entity_type, entity_id, field_path, value, confidence, note)
    values ('project', 'TAP', 'tap.inferred.nonote', '5'::jsonb, 'inferred', null)
  $sql$,
  '23514',
  null,
  'an "inferred" fact with no note is rejected'
);

-- --- invariant 5: zero sources is legal only for a gap ----------------------

select is(
  (select count(*)::integer from (
     select 1 from public.sourced_facts f
     where f.confidence <> 'gap'
       and not exists (select 1 from public.fact_sources s where s.fact_id = f.id)
   ) x),
  0,
  'no seeded non-gap fact is sourceless'
);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.sourced_facts (entity_type, entity_id, field_path, value, confidence)
    values ('project', 'TAP', 'tap.inv5', '5'::jsonb, 'single_source');
    set constraints all immediate;
  exception when check_violation then v_ok := true;
  end;
  create temp table tap_inv5(passed boolean) on commit drop;
  insert into tap_inv5 values (v_ok);
end $$;

select ok((select passed from tap_inv5), 'a sourceless "single_source" fact is rejected at commit');

-- --- invariant 3: confirmed ⟹ ≥2 sources on DISTINCT hosts ------------------

do $$
declare v_id uuid; v_ok boolean := false;
begin
  begin
    set constraints all deferred;
    insert into public.sourced_facts (entity_type, entity_id, field_path, value, confidence)
    values ('project', 'TAP', 'tap.inv3.samehost', '5'::jsonb, 'confirmed') returning id into v_id;
    insert into public.fact_sources (fact_id, source_id) values (v_id, 'tap-a'), (v_id, 'tap-a2');
    set constraints all immediate;
  exception when check_violation then v_ok := true;
  end;
  create temp table tap_inv3a(passed boolean) on commit drop;
  insert into tap_inv3a values (v_ok);
end $$;

select ok((select passed from tap_inv3a),
  'a "confirmed" fact citing two URLs on the SAME host is rejected — that is one opinion, not corroboration');

do $$
declare v_id uuid; v_ok boolean := false;
begin
  begin
    set constraints all deferred;
    insert into public.sourced_facts (entity_type, entity_id, field_path, value, confidence)
    values ('project', 'TAP', 'tap.inv3.onesrc', '5'::jsonb, 'confirmed') returning id into v_id;
    insert into public.fact_sources (fact_id, source_id) values (v_id, 'tap-a');
    set constraints all immediate;
  exception when check_violation then v_ok := true;
  end;
  create temp table tap_inv3b(passed boolean) on commit drop;
  insert into tap_inv3b values (v_ok);
end $$;

select ok((select passed from tap_inv3b), 'a "confirmed" fact citing only one source is rejected');

do $$
declare v_id uuid; v_ok boolean := true;
begin
  begin
    set constraints all deferred;
    insert into public.sourced_facts (entity_type, entity_id, field_path, value, confidence)
    values ('project', 'TAP', 'tap.inv3.twohost', '5'::jsonb, 'confirmed') returning id into v_id;
    insert into public.fact_sources (fact_id, source_id) values (v_id, 'tap-a'), (v_id, 'tap-b');
    set constraints all immediate;
  exception when check_violation then v_ok := false;
  end;
  create temp table tap_inv3c(passed boolean) on commit drop;
  insert into tap_inv3c values (v_ok);
end $$;

select ok((select passed from tap_inv3c), 'a "confirmed" fact citing two DISTINCT hosts is accepted');

-- --- invariant 2: conflicted ⟹ at least one competing value kept ------------

do $$
declare v_id uuid; v_ok boolean := false;
begin
  begin
    set constraints all deferred;
    insert into public.sourced_facts (entity_type, entity_id, field_path, value, confidence)
    values ('project', 'TAP', 'tap.inv2.none', '5'::jsonb, 'conflicted') returning id into v_id;
    insert into public.fact_sources (fact_id, source_id) values (v_id, 'tap-a');
    set constraints all immediate;
  exception when check_violation then v_ok := true;
  end;
  create temp table tap_inv2a(passed boolean) on commit drop;
  insert into tap_inv2a values (v_ok);
end $$;

select ok((select passed from tap_inv2a),
  'a "conflicted" fact that records no competing value is rejected — the losing value must be kept');

do $$
declare v_id uuid; v_ok boolean := true;
begin
  begin
    set constraints all deferred;
    insert into public.sourced_facts (entity_type, entity_id, field_path, value, confidence)
    values ('project', 'TAP', 'tap.inv2.ok', '5'::jsonb, 'conflicted') returning id into v_id;
    insert into public.fact_sources (fact_id, source_id) values (v_id, 'tap-a');
    insert into public.fact_conflicts (fact_id, value, source_id) values (v_id, '7'::jsonb, 'tap-b');
    set constraints all immediate;
  exception when check_violation then v_ok := false;
  end;
  create temp table tap_inv2b(passed boolean) on commit drop;
  insert into tap_inv2b values (v_ok);
end $$;

select ok((select passed from tap_inv2b), 'a "conflicted" fact that keeps its competing value is accepted');

-- --- invariant 6, database half: a citation must resolve to a stored snapshot

select throws_ok(
  $sql$
    insert into public.fact_sources (fact_id, source_id, snapshot_sha256)
    select id, 'tap-a', 'no-such-snapshot-hash'
    from public.sourced_facts limit 1
  $sql$,
  '23503',
  null,
  'a citation naming a snapshot hash that was never stored is rejected by foreign key'
);

-- --- the seeded corpus actually satisfies the invariants --------------------

select is(
  (select count(*)::integer from public.sourced_facts where confidence = 'gap' and value is not null),
  0,
  'no seeded gap fact carries a value'
);

select is(
  (select count(*)::integer from public.sourced_facts
   where confidence = 'gap' and coalesce(btrim(note), '') = ''),
  0,
  'every seeded gap fact explains itself'
);

select is(
  (select count(*)::integer from public.sourced_facts f
   where f.confidence = 'conflicted'
     and not exists (select 1 from public.fact_conflicts c where c.fact_id = f.id)),
  0,
  'every seeded conflicted fact keeps at least one competing value'
);

select is(
  (select count(*)::integer from (
     select f.id
     from public.sourced_facts f
     join public.fact_sources fs on fs.fact_id = f.id
     join public.sources s on s.id = fs.source_id
     where f.confidence = 'confirmed'
     group by f.id
     having count(distinct s.host) < 2
   ) x),
  0,
  'every seeded confirmed fact cites at least two distinct hosts'
);

select is(
  (select count(*)::integer from public.sourced_facts
   where confidence = 'inferred' and coalesce(btrim(note), '') = ''),
  0,
  'every seeded inferred fact explains its derivation'
);

select ok(
  (select count(*) from public.sourced_facts where confidence = 'confirmed') > 0,
  'the corpus actually contains confirmed facts — the invariant above is not vacuous'
);

select ok(
  (select count(*) from public.sourced_facts where confidence = 'conflicted') > 0,
  'the corpus actually contains conflicted facts'
);

-- --- source registry shape --------------------------------------------------

select is(
  (select count(*)::integer from public.sources where tier not between 1 and 6),
  0,
  'every source tier is within CONTRACTS.md §1 SourceTier 1-6'
);

select is(
  (select count(*)::integer from public.sources where coalesce(btrim(host), '') = ''),
  0,
  'every source records a host'
);

select is(
  (select count(*)::integer from public.source_snapshots
   where content_validated and (snapshot_sha256 is null or bytes = 0)),
  0,
  'a snapshot that claims validation has the bytes to prove it'
);

select * from finish();
rollback;
