-- 05 · Portal listings — portal_listings, competing_prices (task W1-A)
--
-- The conflict register in table form. Both tables exist to PRESERVE disagreement, so both
-- deliberately lack the unique constraint a reviewer will instinctively reach for:
--
--   portal_listings HAS NO UNIQUE KEY ON url. The 47 harvested rows carry only 27 distinct
--   urls. One building-overview page yields many listings — cestate.net/building/AzuraWorld
--   alone produced 8 rows at different layouts and prices, seaside-alanya another 8, and
--   housearch 4 per locale. `unique (url)` would reject 20 of 47 rows on load. There is no
--   natural key here at all, so the loader must delete-then-insert per publisher.
--
--   competing_prices HAS NO UNIQUE KEY ON (unit_id, …). CONTRACTS.md §2 on
--   AzuraUnit.competingPrices: "Same unit priced differently by different portals. Always
--   keep all of them." One price per unit is the requirement this table exists to defeat.
--   The absence below is deliberate — do not add one to "clean up duplicates", because two
--   rows for one unit are the finding, not a defect.
--
-- Money follows migration 02: numeric(14,2) with its currency beside it, never a float and
-- never a bare amount. Portals quote EUR and USD for the same project, and CONVENTIONS.md §5
-- forbids silently converting between them.

-- ---------------------------------------------------------------------------
-- portal_listings
-- ---------------------------------------------------------------------------

create table if not exists public.portal_listings (
  id                   uuid primary key default gen_random_uuid(),
  site_id              uuid references public.sites(id) on delete set null,
  publisher            text not null,
  url                  text not null,
  fetched_at           timestamptz not null,
  layout               public.unit_layout,
  interior_m2          numeric(8, 2) check (interior_m2 is null or interior_m2 > 0),
  price_amount         numeric(14, 2),
  price_currency       public.currency_code,
  price_kind           text,
  claimed_block_count  integer check (claimed_block_count is null or claimed_block_count > 0),
  claimed_total_units  integer check (claimed_total_units is null or claimed_total_units > 0),
  claimed_build_status text,
  is_stale             boolean not null default false,
  note                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- CONVENTIONS.md §5: "a price of 0 is a bug; a price of null is an honest gap."
  constraint portal_listings_price_positive check (price_amount is null or price_amount > 0),

  -- Amount and currency are null together or present together.
  constraint portal_listings_price_needs_currency check (
    (price_amount is null and price_currency is null)
    or (price_amount is not null and price_currency is not null)
  ),

  -- Sale listings and monthly rents share this table. Without the distinction a
  -- EUR 2,100/month rental sits in the same column as a EUR 230,000 sale, and any average,
  -- minimum or "price from" computed across them is wrong by two orders of magnitude.
  constraint portal_listings_price_kind check (price_kind is null or price_kind in ('sale', 'rent'))
);

comment on table public.portal_listings is
  '47 rows across 7 publishers. NO UNIQUE CONSTRAINT ON url, BY DESIGN: only 27 of the 47 urls are distinct because a single building-overview page publishes many apartments. Adding unique (url) breaks the load. There is no natural key; reload by deleting a publisher''s rows and reinserting.';
comment on column public.portal_listings.site_id is
  'Nullable on purpose. A portal listing is a scraped external artefact whose identity is its url, not its position in our site hierarchy — and what the project even IS happens to be one of the disputed facts. Requiring a site before a listing can be recorded would mean resolving that dispute in order to store the evidence of it.';
comment on column public.portal_listings.layout is
  'public.unit_layout, because "1+1" is the Turkish notation itself and every portal writes it identically — normalising loses nothing. Contrast claimed_build_status, where normalising loses everything.';
comment on column public.portal_listings.claimed_build_status is
  'Free text, NOT public.build_status. This is the PORTAL''s claim in the portal''s own words. Mapping "ready to move" or "completed 2024" onto our three-value enum silently launders a portal''s wrong claim into our vocabulary and destroys the conflict register — the register only works if the claim survives verbatim.';
comment on column public.portal_listings.is_stale is
  'CONTRACTS.md §2: the listing contradicts a tier <=3 source. NOT NULL with a false default because an unevaluated listing must not be presented as verified-current; a stale price shown as current is the most damaging error this project can make (CONVENTIONS.md §5).';

create index if not exists idx_portal_listings_site_id on public.portal_listings (site_id);
create index if not exists idx_portal_listings_publisher on public.portal_listings (publisher);
create index if not exists idx_portal_listings_url on public.portal_listings (url);
create index if not exists idx_portal_listings_layout on public.portal_listings (layout);
create index if not exists idx_portal_listings_stale on public.portal_listings (is_stale) where is_stale;

drop trigger if exists set_portal_listings_updated_at on public.portal_listings;
create trigger set_portal_listings_updated_at
  before update on public.portal_listings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- competing_prices
-- ---------------------------------------------------------------------------

create table if not exists public.competing_prices (
  id          uuid primary key default gen_random_uuid(),
  unit_id     text not null references public.units(id) on delete cascade,
  amount      numeric(14, 2) not null check (amount > 0),
  currency    public.currency_code not null,
  source_url  text not null,
  publisher   text,
  observed_at timestamptz not null,
  created_at  timestamptz not null default now()
);

comment on table public.competing_prices is
  'The same unit priced differently by different portals. THERE IS DELIBERATELY NO UNIQUE CONSTRAINT: CONTRACTS.md §2 says of AzuraUnit.competingPrices "Always keep all of them", and any unique key on unit_id, on (unit_id, source_url) or on (unit_id, observed_at) would force a resolution the contract forbids. Two rows for one unit are the finding, not a duplicate to clean up. Never resolve a conflict here by deleting a row; a losing value stays visible on demand (SYSTEM-PROMPT.md §2.2).';
comment on column public.competing_prices.amount is
  'numeric(14,2) with `currency` beside it, matching public.units. Never float, never a bare amount: portals quote EUR and USD for the same unit and CONVENTIONS.md §5 forbids converting silently. Convert at display only, labelled, with the rate''s date.';
comment on column public.competing_prices.observed_at is
  'When the price was actually seen. NOT NULL because a price with no observation date cannot be aged, and presenting a stale price as current is the worst error available to this project.';
comment on column public.competing_prices.source_url is
  'The citation. Required — a price with no source URL cannot be displayed at all (SYSTEM-PROMPT.md §2.1). Joins to public.sources.url in migration 03; no FK, so this migration applies independently of it.';

create index if not exists idx_competing_prices_unit_id on public.competing_prices (unit_id);
create index if not exists idx_competing_prices_source_url on public.competing_prices (source_url);
create index if not exists idx_competing_prices_observed_at on public.competing_prices (observed_at desc);

-- ---------------------------------------------------------------------------
-- RLS
--
-- Both tables are public showcase / evidence data, read by unauthenticated visitors on the
-- landing and evidence surfaces through the anon key. Writes are manager+ (level 70).
-- Neither policy reads another table, so neither can recurse (42P17). ENABLE, never FORCE.
-- ---------------------------------------------------------------------------

alter table public.portal_listings  enable row level security;
alter table public.competing_prices enable row level security;

drop policy if exists portal_listings_select_all on public.portal_listings;
create policy portal_listings_select_all on public.portal_listings for select using (true);

drop policy if exists portal_listings_manager_write on public.portal_listings;
create policy portal_listings_manager_write on public.portal_listings for all
  using ((select public.has_role_level(70))) with check ((select public.has_role_level(70)));

drop policy if exists competing_prices_select_all on public.competing_prices;
create policy competing_prices_select_all on public.competing_prices for select using (true);

drop policy if exists competing_prices_manager_write on public.competing_prices;
create policy competing_prices_manager_write on public.competing_prices for all
  using ((select public.has_role_level(70))) with check ((select public.has_role_level(70)));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select on public.portal_listings, public.competing_prices to anon, authenticated;

revoke insert, update, delete on public.portal_listings, public.competing_prices
  from anon, authenticated;
