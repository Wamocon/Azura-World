-- 10 · Search — operational search documents, tsvector + trigram (task W1-A)
--
-- HANDOFF/W0-ENV.md, "Requests for other windows": pg_trgm is NOT installed on the
-- linked project and this migration must create it. That is the first statement below.
--
-- Mirrors 1Çatı's `operational_search_documents` (…0003 + the …0055 role hardening),
-- with one improvement carried over from that project's own hardening pass and one
-- addition of my own:
--
--   CARRIED OVER: the index table is revoked from `authenticated` entirely. RLS alone
--   was not enough there — a resident could query PostgREST directly and read the
--   projection. The only read path is the role-checked RPC.
--
--   ADDED: `min_role_level`. A single search index that spans tickets, documents,
--   finance and evidence cannot be gated by one role threshold, because the rows are
--   not equally sensitive. Each row declares the level required to see it and the RPC
--   filters per row. Without it, "staff can search" silently means "staff can search
--   finance summaries".

-- ---------------------------------------------------------------------------
-- Extension
-- ---------------------------------------------------------------------------

-- Supabase keeps extensions out of `public`; the operator class is therefore
-- referenced as `extensions.gin_trgm_ops` below, not the bare name.
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- operational_search_documents
-- ---------------------------------------------------------------------------

create table if not exists public.operational_search_documents (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  site_id        uuid references public.sites(id) on delete cascade,
  entity_table   text not null,
  -- TEXT, not uuid: public.units.id is the string code 'AZW-B03-0412'. A uuid column
  -- here would make the whole 656-unit inventory unindexable.
  entity_id      text not null,
  title          text not null,
  summary        text,
  language       text not null default 'de' check (language in ('de', 'en', 'tr', 'ru')),
  -- The minimum public.role_level() required to see this row. Defaults to staff.
  min_role_level smallint not null default 40 check (min_role_level between 0 and 90),
  metadata       jsonb not null default '{}'::jsonb,

  -- 'simple', deliberately, not 'turkish' or 'german'. The corpus is genuinely
  -- four-language (CONTRACTS.md §7) and a language-specific dictionary stems and
  -- strips stopwords for ONE of them while corrupting the other three. 'simple' does
  -- neither; the trigram indexes below carry the fuzzy matching that stemming would
  -- otherwise have provided.
  search_vector  tsvector generated always as (
                   to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, ''))
                 ) stored,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, entity_table, entity_id)
);

comment on table public.operational_search_documents is
  'Denormalised search projection. Never read directly by application code — public.search_operational_records() is the only sanctioned path, and the table grants enforce that.';
comment on column public.operational_search_documents.min_role_level is
  'Per-row authority floor. A finance row indexes at 60, a public unit at 0. The RPC compares this to the caller''s public.current_user_role_level().';

create index if not exists idx_search_documents_vector
  on public.operational_search_documents using gin (search_vector);
create index if not exists idx_search_documents_title_trgm
  on public.operational_search_documents using gin (title extensions.gin_trgm_ops);
create index if not exists idx_search_documents_summary_trgm
  on public.operational_search_documents using gin (summary extensions.gin_trgm_ops);
create index if not exists idx_search_documents_entity
  on public.operational_search_documents (entity_table, entity_id);
create index if not exists idx_search_documents_company
  on public.operational_search_documents (company_id, min_role_level);
create index if not exists idx_search_documents_site_id
  on public.operational_search_documents (site_id);

drop trigger if exists set_search_documents_updated_at on public.operational_search_documents;
create trigger set_search_documents_updated_at
  before update on public.operational_search_documents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The only read path
-- ---------------------------------------------------------------------------

create or replace function public.search_operational_records(
  p_query text,
  p_limit integer default 20
)
returns table (
  entity_table text,
  entity_id    text,
  title        text,
  summary      text,
  rank         real,
  metadata     jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query        text;
  v_tsquery      tsquery;
  v_like         text;
  v_company_id   uuid := public.current_user_company_id();
  v_role_level   integer := public.current_user_role_level();
begin
  -- Authority first, work second. A caller with no company context and no elevation
  -- must not reach the index at all.
  if v_role_level < 40 then
    raise exception 'Your role cannot search operational records.'
      using errcode = '42501';
  end if;

  if v_company_id is null and v_role_level < 90 then
    raise exception 'No company context for operational search.'
      using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_query, '')), '') is null then
    return;
  end if;

  v_query := btrim(p_query);

  -- CONVENTIONS.md §4: length ceiling on every string input, at the boundary.
  if char_length(v_query) > 120 then
    raise exception 'Operational search query is too long.'
      using errcode = '22023';
  end if;

  v_tsquery := websearch_to_tsquery('simple', v_query);

  -- LIKE metacharacters are treated as literal input. Without this a query of '%'
  -- becomes a company-wide sequential scan that any staff account can trigger.
  v_like := replace(replace(replace(v_query, e'\\', e'\\\\'), '%', e'\\%'), '_', e'\\_');

  return query
  with candidates as (
    select
      d.entity_table,
      d.entity_id,
      d.title,
      d.summary,
      case when d.search_vector @@ v_tsquery
        then ts_rank_cd(d.search_vector, v_tsquery)
        else 0
      end as full_text_rank,
      greatest(
        extensions.similarity(d.title, v_query),
        extensions.similarity(coalesce(d.summary, ''), v_query)
      ) as fuzzy_rank,
      d.metadata,
      d.updated_at
    from public.operational_search_documents d
    where (v_role_level >= 90 or d.company_id = v_company_id)
      and d.min_role_level <= v_role_level
      and (
        d.search_vector @@ v_tsquery
        or d.title ilike '%' || v_like || '%' escape e'\\'
        or d.summary ilike '%' || v_like || '%' escape e'\\'
      )
  )
  select
    c.entity_table,
    c.entity_id,
    c.title,
    c.summary,
    (c.full_text_rank + c.fuzzy_rank)::real as rank,
    c.metadata
  from candidates c
  order by c.full_text_rank desc, c.fuzzy_rank desc, c.updated_at desc
  -- W2-A's brief: never select unbounded. Default 20, hard ceiling 50.
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

comment on function public.search_operational_records(text, integer) is
  'The sanctioned operational search. Enforces role authority, company scope, a per-row authority floor, an input length ceiling and a bounded result set before it touches the index.';

-- ---------------------------------------------------------------------------
-- RLS and grants
--
-- RLS is enabled with no permissive policy at all: nothing reaches this table except
-- the SECURITY DEFINER RPC and service_role. That is intentional, and it is why the
-- grants below strip the table from `authenticated` as well.
-- ---------------------------------------------------------------------------

alter table public.operational_search_documents enable row level security;

drop policy if exists search_documents_admin_all on public.operational_search_documents;
create policy search_documents_admin_all
  on public.operational_search_documents for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on table public.operational_search_documents from public;
revoke all on table public.operational_search_documents from anon;
revoke all on table public.operational_search_documents from authenticated;
grant select, insert, update, delete on table public.operational_search_documents to service_role;

revoke all on function public.search_operational_records(text, integer) from public, anon;
grant execute on function public.search_operational_records(text, integer) to authenticated;
