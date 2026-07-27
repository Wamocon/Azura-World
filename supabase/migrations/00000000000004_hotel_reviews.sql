-- 04 · Hotel and reviews — hotels, hotel_rooms, review_sources, review_quotes (task W1-A)
--
-- The hotel half of the showcase. Four decisions here are load-bearing and not obvious:
--
--   REVIEW IDENTITY IS THE URL, NOT THE PLATFORM. Finding F-016: OnTheBeach re-serves
--   Tripadvisor's 4.6/5 through an embedded widget carrying the same location id. The
--   harvest therefore holds TWO rows with platform='tripadvisor' whose urls are
--   tripadvisor.com and onthebeach.co.uk. A unique key on `platform` would collapse them
--   into one row and destroy the evidence that a reseller is recycling one number — which
--   is the entire point of recording it. The unique key is `url`.
--
--   CLOCK TIMES ARE `time`, NOT `timestamptz`. Check-in "14:00" is a wall-clock rule at the
--   property, not an instant. Stored as timestamptz it would acquire a date it does not
--   have and shift under UTC conversion; Türkiye is UTC+3, so a "14:00" check-in would
--   render as 11:00 to any client normalising to UTC.
--
--   NULL brand_affiliation IS AN ANSWER, NOT MISSING DATA. The hotel's own site (tier 3)
--   names no chain; Agoda and OnTheBeach both label the property "ex. Wyndham Alanya"; the
--   sole source asserting a chain is a press report of a Wyndham licence. Findings F-007 and
--   F-018 record the disagreement. The column is nullable so that "no current affiliation"
--   is storable — coercing it to '' or 'none' would make a researched conclusion
--   indistinguishable from an unharvested field.
--
--   HOTEL_ROOMS SHIPS EMPTY. See its table comment.
--
-- Provenance for every value below lives in public.sourced_facts (migration 03), keyed
-- entity_type in ('hotel','review') with entity_id = the uuid cast to text. This migration
-- declares NO foreign key into the evidence tables, so the join is by string and 04 stays
-- independent of 03's load order.

-- ---------------------------------------------------------------------------
-- hotels
-- ---------------------------------------------------------------------------

create table if not exists public.hotels (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  site_id             uuid not null references public.sites(id) on delete cascade,
  code                text not null unique,
  name                text not null,
  former_name         text,
  stars               smallint check (stars is null or stars between 1 and 5),
  room_count          integer check (room_count is null or room_count > 0),
  floors              integer check (floors is null or floors > 0),
  opened_year         integer check (opened_year is null or opened_year between 1800 and 2100),
  board               text,
  aquapark_slides     integer check (aquapark_slides is null or aquapark_slides >= 0),
  distance_to_beach_m integer check (distance_to_beach_m is null or distance_to_beach_m >= 0),
  check_in            time,
  check_out           time,
  brand_affiliation   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.hotels is
  'One row: the Azura World Hotel on site AZW-TRK. Twelve sourced fields, all nullable except name and code — CONTRACTS.md §1 invariant 1 says an unestablished figure is NULL, never a plausible default. Same rule as public.sites in migration 02.';
comment on column public.hotels.former_name is
  '"Wyndham Alanya". The rebrand is itself a finding, not trivia: booking platforms still index the property under the old name, which is how the same hotel appears twice in a search result.';
comment on column public.hotels.room_count is
  '188 (conflicted). The Wyndham-era antalyacoast page says 112 — the losing value is retained in public.fact_conflicts, never overwritten here.';
comment on column public.hotels.aquapark_slides is
  '13 (conflicted). OnTheBeach and the Wyndham page both say 16. Kept as the tier-resolved display value only; both competing values survive in the evidence store.';
comment on column public.hotels.check_in is
  'Wall-clock time at the property, hence `time` and not `timestamptz`. A check-in rule has no date, and giving it one would shift it by the UTC+3 offset.';
comment on column public.hotels.brand_affiliation is
  'NULL is the researched answer, backed by findings F-007 and F-018 — not an unharvested field. Do not coerce to '''' or ''none'': that would erase the distinction between "we established there is no current chain" and "we never looked".';

create index if not exists idx_hotels_company_id on public.hotels (company_id);
create index if not exists idx_hotels_site_id on public.hotels (site_id);

drop trigger if exists set_hotels_updated_at on public.hotels;
create trigger set_hotels_updated_at
  before update on public.hotels
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- hotel_rooms
-- ---------------------------------------------------------------------------

create table if not exists public.hotel_rooms (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references public.hotels(id) on delete cascade,
  code          text not null,
  name          text,
  room_type     text,
  room_count    integer check (room_count is null or room_count > 0),
  interior_m2   numeric(8, 2) check (interior_m2 is null or interior_m2 > 0),
  max_occupancy smallint check (max_occupancy is null or max_occupancy > 0),
  has_sea_view  boolean,
  source_url    text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (hotel_id, code)
);

comment on table public.hotel_rooms is
  'Room-type breakdown of hotels.room_count. THIS TABLE SHIPS EMPTY AND THAT IS CORRECT: the harvest establishes 188 rooms in total and nothing whatsoever about how they divide. An empty table is the honest representation of that gap. Populating it with four plausible-looking room types to make a UI panel render is precisely the fabrication SYSTEM-PROMPT.md §2.3 forbids — a made-up room mix is as much an invented number as a made-up price.';
comment on column public.hotel_rooms.has_sea_view is
  'Three-valued on purpose. NULL means unknown; false means a source states there is no sea view. Defaulting to false would publish an unresearched claim.';
comment on column public.hotel_rooms.source_url is
  'The row''s own citation. Every fact reaching a user carries its source (SYSTEM-PROMPT.md §2.1), and a room-type row would be displayed.';

create index if not exists idx_hotel_rooms_hotel_id on public.hotel_rooms (hotel_id);

drop trigger if exists set_hotel_rooms_updated_at on public.hotel_rooms;
create trigger set_hotel_rooms_updated_at
  before update on public.hotel_rooms
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- review_sources
-- ---------------------------------------------------------------------------

create table if not exists public.review_sources (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references public.hotels(id) on delete cascade,
  platform     text not null check (platform in
                 ('tripadvisor', 'booking', 'agoda', 'onthebeach', 'google')),
  url          text not null unique,
  publisher    text,
  score        numeric(4, 2) check (score is null or score >= 0),
  score_scale  smallint not null check (score_scale in (5, 10)),
  review_count integer check (review_count is null or review_count >= 0),
  ranking      text,
  sentiment    jsonb check (sentiment is null or jsonb_typeof(sentiment) = 'object'),
  fetched_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- 4.6 on a 5-scale and 6.7 on a 10-scale are both valid; 6.7 on a 5-scale is a
  -- scale-mixing bug, and mixing the scales is how an aggregate score gets silently
  -- halved or doubled.
  constraint review_sources_score_within_scale check (score is null or score <= score_scale)
);

comment on table public.review_sources is
  'Three rows. THE UNIQUE KEY IS `url`, NOT `platform`, AND MUST STAY THAT WAY. Two of the three rows carry platform=''tripadvisor'': one is tripadvisor.com itself (4.6/5, 359 reviews, ranked #10 of 33 in Türkler), the other is onthebeach.co.uk re-serving the identical Tripadvisor score through an embedded widget on the same location id (4.6/5, 357 reviews). Finding F-016. A unique constraint on platform would merge them and delete the only record that a "second, independent" score is the first one wearing a different logo — and had they been filed under the serving host they would have satisfied invariant 3 (two distinct hosts) and been wrongly promoted to "confirmed".';
comment on column public.review_sources.platform is
  'The platform that ORIGINATED the score. Deliberately allowed to disagree with the host of `url` — that disagreement IS finding F-016, so the schema must be able to express it.';
comment on column public.review_sources.publisher is
  'The publisher actually serving `url` ("OnTheBeach"), which is what a citation must name. Keeping it beside `platform` makes the F-016 divergence visible in the row itself rather than only in a join.';
comment on column public.review_sources.score_scale is
  'CONTRACTS.md §2 ReviewSource.scoreScale — 5 or 10, nothing else. Stored rather than derived from the platform, because a single platform can serve either.';
comment on column public.review_sources.sentiment is
  'jsonb, not three columns. Tripadvisor publishes a five-bucket histogram (excellent/good/average/poor/terrible) while CONTRACTS.md §2 types only the positive/mixed/negative triple; the harvested row carries both. Flattening to three integer columns would discard the raw buckets, and the raw buckets are the evidence the triple was derived from. NULL where the platform publishes no breakdown at all.';

create index if not exists idx_review_sources_hotel_id on public.review_sources (hotel_id);
create index if not exists idx_review_sources_platform on public.review_sources (platform);

drop trigger if exists set_review_sources_updated_at on public.review_sources;
create trigger set_review_sources_updated_at
  before update on public.review_sources
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- review_quotes
-- ---------------------------------------------------------------------------

create table if not exists public.review_quotes (
  id               uuid primary key default gen_random_uuid(),
  review_source_id uuid not null references public.review_sources(id) on delete cascade,
  url              text not null unique,
  quote_text       text not null check (length(quote_text) > 0),
  rating           smallint check (rating is null or rating between 1 and 5),
  quoted_at_label  text,
  quoted_on        date,
  created_at       timestamptz not null default now(),

  -- A parsed ISO date may exist only where a label was actually observed. Without this,
  -- a quoted_on with no quoted_at_label is indistinguishable from a fabricated date.
  constraint review_quotes_parsed_date_needs_label
    check (quoted_on is null or quoted_at_label is not null)
);

comment on table public.review_quotes is
  'Verbatim guest quotes with permalinks. Never paraphrase a review (CONTRACTS.md §2) — quote_text is stored exactly as harvested, including its typography.';
comment on column public.review_quotes.url is
  'Permalink to the individual review, and the natural key. A quote you cannot re-open is not a citation.';
comment on column public.review_quotes.quoted_at_label is
  'The date EXACTLY as the platform printed it: "Jul 21", "May 2026", "Jul 9". Tripadvisor omits the year on recent reviews, so these strings are not ISO and several are genuinely ambiguous.';
comment on column public.review_quotes.quoted_on is
  'Set only where quoted_at_label parses unambiguously to a real date; NULL otherwise. Guessing a year for "Jul 21" would be inventing a date, and a review misdated by a year is exactly the staleness error CONVENTIONS.md §5 warns about.';

create index if not exists idx_review_quotes_review_source_id
  on public.review_quotes (review_source_id);
create index if not exists idx_review_quotes_rating on public.review_quotes (rating);

-- ---------------------------------------------------------------------------
-- RLS
--
-- All four tables are public showcase / evidence data: the hotel panel and the review
-- cockpit are read by unauthenticated visitors through the anon key, so a select path for
-- anon is required, not a convenience. Writes are manager+ (level 70).
--
-- No policy below reads another table, so none can recurse (42P17) and none needs a
-- SECURITY DEFINER helper. ENABLE, never FORCE — migration 00 documents why.
-- ---------------------------------------------------------------------------

alter table public.hotels         enable row level security;
alter table public.hotel_rooms    enable row level security;
alter table public.review_sources enable row level security;
alter table public.review_quotes  enable row level security;

drop policy if exists hotels_select_all on public.hotels;
create policy hotels_select_all on public.hotels for select using (true);

drop policy if exists hotels_manager_write on public.hotels;
create policy hotels_manager_write on public.hotels for all
  using ((select public.has_role_level(70))) with check ((select public.has_role_level(70)));

drop policy if exists hotel_rooms_select_all on public.hotel_rooms;
create policy hotel_rooms_select_all on public.hotel_rooms for select using (true);

drop policy if exists hotel_rooms_manager_write on public.hotel_rooms;
create policy hotel_rooms_manager_write on public.hotel_rooms for all
  using ((select public.has_role_level(70))) with check ((select public.has_role_level(70)));

drop policy if exists review_sources_select_all on public.review_sources;
create policy review_sources_select_all on public.review_sources for select using (true);

drop policy if exists review_sources_manager_write on public.review_sources;
create policy review_sources_manager_write on public.review_sources for all
  using ((select public.has_role_level(70))) with check ((select public.has_role_level(70)));

drop policy if exists review_quotes_select_all on public.review_quotes;
create policy review_quotes_select_all on public.review_quotes for select using (true);

drop policy if exists review_quotes_manager_write on public.review_quotes;
create policy review_quotes_manager_write on public.review_quotes for all
  using ((select public.has_role_level(70))) with check ((select public.has_role_level(70)));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select on public.hotels, public.hotel_rooms, public.review_sources, public.review_quotes
  to anon, authenticated;

revoke insert, update, delete on public.hotels, public.hotel_rooms, public.review_sources,
  public.review_quotes from anon, authenticated;
