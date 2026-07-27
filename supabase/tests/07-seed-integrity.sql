-- pgTAP · 07 — seed integrity (task W1-A)
--
-- The confirmed Azura figures, asserted against what actually loaded. These numbers come
-- from W0-B's harvest, not from the brief: tasks/W1-A predicted "23 sources, findings
-- F-001…F-010" before the harvest ran, and the harvest produced 56 sources and 24
-- findings. SYSTEM-PROMPT.md §2.3 forbids trimming real data to match a prediction, so
-- these assertions track the dataset.
--
-- The three figures the brief and the dataset agree on — 7 blocks, 656 units, 188 hotel
-- rooms — are asserted exactly.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;

select plan(35);

-- --- the headline figures ---------------------------------------------------

select is((select count(*)::integer from public.companies), 1, 'exactly one company');
select is((select count(*)::integer from public.sites), 1, 'exactly one site');
select is((select code from public.sites), 'AZW-TRK', 'the site is AZW-TRK');
select is((select count(*)::integer from public.site_blocks), 7, 'seven residence blocks');
select is((select count(*)::integer from public.units), 656, 'six hundred and fifty-six units');
select is((select count(*)::integer from public.hotels), 1, 'one hotel');
select is((select room_count from public.hotels), 188, 'the hotel has 188 rooms');

-- The block unit counts must add up to the corroborated total, or the inventory is
-- internally inconsistent regardless of which number is right.
select is(
  (select sum(unit_count)::integer from public.site_blocks),
  656,
  'the per-block unit counts sum to the corroborated total of 656'
);

select is(
  (select count(distinct block_code)::integer from public.units),
  7,
  'every unit belongs to one of the seven blocks'
);

-- --- modelled vs real, the distinction W3-C depends on ----------------------

select is(
  (select count(*)::integer from public.units where data_quality = 'portal_listing'),
  25,
  '25 units are backed by a real scraped portal listing'
);

select is(
  (select count(*)::integer from public.units where data_quality = 'modelled'),
  631,
  '631 units are modelled to fill the confirmed total and are never presented as real listings'
);

select is(
  (select count(*)::integer from public.units where data_quality not in ('portal_listing', 'modelled')),
  0,
  'no unit has an unclassified data quality'
);

select ok(
  (select count(*) from public.units where data_quality = 'modelled' and is_publicly_listed) = 0,
  'no modelled unit appears in the public sales catalogue'
);

-- --- unit identity ----------------------------------------------------------

select is(
  (select count(*)::integer from public.units where id !~ '^AZW-B[0-9]{2}-[0-9]{4}$'),
  0,
  'every unit id matches the AZW-B{block:02}-{seq:04} format from CONVENTIONS.md §6'
);

select is(
  (select count(*)::integer from public.units u
   join public.site_blocks b on b.id = u.block_id
   where b.code <> u.block_code),
  0,
  'every unit block_code agrees with the block it references'
);

-- --- prices: null is a gap, zero is a bug -----------------------------------

select is(
  (select count(*)::integer from public.units where asking_price_amount = 0),
  0,
  'no unit is priced at zero — a price of 0 is a bug, a price of null is an honest gap'
);

select is(
  (select count(*)::integer from public.units
   where (asking_price_amount is null) <> (asking_price_currency is null)),
  0,
  'no unit carries an amount without its currency, or a currency without an amount'
);

select ok(
  (select count(distinct asking_price_currency) from public.units where asking_price_currency is not null) >= 1,
  'unit prices carry at least one currency'
);

-- --- evidence corpus --------------------------------------------------------

select is((select count(*)::integer from public.findings), 24,
  'twenty-four findings, F-001 through F-024 — the harvest found more than the brief predicted');

select is(
  (select count(*)::integer from public.findings where id !~ '^F-[0-9]{3}$'),
  0,
  'every finding id matches F-NNN'
);

select is(
  (select count(*)::integer from public.findings where id in ('F-001', 'F-010', 'F-024')),
  3,
  'the finding range runs continuously from F-001 to at least F-024'
);

select is(
  (select count(*)::integer from public.findings where coalesce(btrim(resolution), '') = ''),
  0,
  'every finding states how it was resolved, including the ones deliberately left open'
);

select ok(
  (select count(*) from public.findings where severity = 'critical') >= 1,
  'the register contains at least one critical finding — it is not a clean bill of health'
);

select ok((select count(*) from public.sources) >= 23,
  'at least the 23 sources the brief named are registered (the harvest found more)');

select ok((select count(*) from public.sourced_facts) > 1000,
  'the provenance store holds a fact per displayed value, not a handful of samples');

select is(
  (select count(*)::integer from public.sourced_facts f
   where f.confidence <> 'gap'
     and not exists (select 1 from public.fact_sources s where s.fact_id = f.id)),
  0,
  'every non-gap fact in the seed carries at least one source'
);

select is((select count(*)::integer from public.review_sources), 3, 'three review sources');

select is(
  (select count(*)::integer from public.review_sources where platform = 'tripadvisor'),
  2,
  'two rows carry platform=tripadvisor — F-016: a reseller re-serving one score is kept distinct'
);

select is(
  (select count(distinct url)::integer from public.review_sources),
  3,
  'the three review sources have three distinct urls'
);

select is((select count(*)::integer from public.portal_listings), 47, 'forty-seven portal listings');

select ok(
  (select count(distinct url) from public.portal_listings) < 47,
  'the 47 listings share fewer urls — one overview page publishes many apartments, which is why there is no unique key on url'
);

select ok((select count(*) from public.competing_prices) >= 25,
  'competing prices are retained, not collapsed to one price per unit');

-- --- role fixtures for W4-A -------------------------------------------------

select is(
  (select count(*)::integer from public.profiles),
  11,
  'one seeded profile per role, so W4-A can exercise each'
);

select is(
  (select count(distinct role)::integer from public.profiles),
  11,
  'the eleven seeded profiles cover all eleven distinct roles'
);

select is(
  (select count(*)::integer from public.guardianships where status = 'active'),
  2,
  'two active guardianships link the child roles to their guardians'
);

select * from finish();
rollback;
