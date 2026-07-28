-- 07 · Finance — ledger, payments, wallets, vendor invoices (task W1-A)
--
-- The money layer, and the one place in this schema where a convention is not enough.
-- SYSTEM-PROMPT.md §2.16: "Posted financial ledger entries are immutable — enforced by
-- trigger, not by convention." Everything below follows from taking that literally.
--
-- Three consequences worth stating up front, because they look like omissions otherwise:
--
--   1. THE LEDGER HAS NO SETTLEMENT STATUS. The reference project carries
--      open/partially_paid/paid/overdue on finance_ledger_entries. That cannot coexist
--      with immutability: marking a posted row "paid" is an UPDATE of a posted row. So
--      `status` here is only draft -> posted (or void, for a draft abandoned before
--      posting), settlement lives on public.vendor_invoices.paid_amount and in
--      public.payment_transactions, and "what is still open" is DERIVED. A mutable status
--      column on an immutable table is a lie that a trigger would have to either break or
--      permit.
--
--   2. A REVERSAL NEVER TOUCHES THE ORIGINAL. Correction is a new row with `reversal_of`
--      pointing at the entry it cancels. The original stays `posted` forever; "is this
--      reversed?" is `exists (… where reversal_of = id)`.
--
--   3. MONEY IS numeric(14,2) + public.currency_code, never *_cents. 1Çatı stores integer
--      minor units; tasks/W1-A overrides that for this project. numeric is exact, so this
--      is not the float error the rule guards against.
--
-- CONVENTIONS.md §5 — amounts in different currencies are NEVER summed. The double-entry
-- check below groups by currency for exactly this reason; a group that mixes EUR and TRY
-- must balance within each currency separately, and there is no FX leg in this schema.
--
-- RLS read model (finance is never public — no anon path exists on any table here):
--   admin (90) / manager (70) → every company
--   accountant (60)           → their own company
--   owner, tenant, child_owner, child_tenant → only rows for units they hold
--   service_provider (30)     → only vendor_invoices where they are the vendor
--   guest (5), child_guest (3), anon → nothing at all

-- ---------------------------------------------------------------------------
-- Domain enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.ledger_entry_type as enum (
    'dues', 'service_charge', 'utility', 'deposit', 'refund',
    'penalty', 'adjustment', 'payment', 'vendor_bill', 'reversal'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ledger_entry_status as enum ('draft', 'posted', 'void');
exception when duplicate_object then null; end $$;

comment on type public.ledger_entry_status is
  'Three states only. "posted" is terminal: the immutability trigger rejects every further UPDATE and DELETE, and a correction is a separate reversal row. "void" is a draft abandoned before posting — it is NOT a way to cancel a posted entry.';

do $$ begin
  create type public.payment_status as enum (
    'pending', 'authorized', 'captured', 'failed', 'refunded', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_direction as enum ('inbound', 'outbound');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.wallet_kind as enum ('resident', 'vendor', 'company');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.wallet_status as enum ('active', 'frozen', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.vendor_invoice_status as enum (
    'draft', 'open', 'partially_paid', 'paid', 'disputed', 'void'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- finance_ledger_entries
--
-- Every FK here is ON DELETE RESTRICT. tasks/W1-A: "Cascade deletes: never on financial or
-- audit tables." A unit, a resident or the profile that posted an entry cannot be deleted
-- out from under the books — deactivate the profile instead. That is the point.
-- ---------------------------------------------------------------------------

create table if not exists public.finance_ledger_entries (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete restrict,
  site_id              uuid references public.sites(id) on delete restrict,
  unit_id              text references public.units(id) on delete restrict,
  resident_id          uuid references public.residents(id) on delete restrict,

  -- The double-entry grouping key. NULL is legal and meaningful — see the constraint
  -- trigger at the bottom of this file.
  transaction_group_id uuid,

  entry_type           public.ledger_entry_type not null,
  status               public.ledger_entry_status not null default 'draft',
  period               text check (period is null or period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  due_date             date,
  posted_at            timestamptz,

  debit_amount         numeric(14, 2) not null default 0 check (debit_amount >= 0),
  credit_amount        numeric(14, 2) not null default 0 check (credit_amount >= 0),
  currency             public.currency_code not null default 'EUR',
  signed_amount        numeric(14, 2)
                         generated always as (debit_amount - credit_amount) stored,

  description          text,
  reference            text,
  idempotency_key      text,
  reversal_of          uuid references public.finance_ledger_entries(id) on delete restrict,
  created_by           uuid references public.profiles(id) on delete restrict,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Exactly one side of a leg carries value. A zero-zero entry is not a neutral record,
  -- it is a row somebody forgot to fill in.
  constraint finance_ledger_entries_single_sided check (
    (debit_amount > 0 and credit_amount = 0)
    or (debit_amount = 0 and credit_amount > 0)
  ),

  -- The two definitions of "posted" must never diverge, because the immutability trigger
  -- honours BOTH and a row that satisfied one but not the other would be half-frozen.
  constraint finance_ledger_entries_posted_state check (
    (status = 'posted') = (posted_at is not null)
  ),

  constraint finance_ledger_entries_no_self_reversal check (
    reversal_of is null or reversal_of <> id
  ),

  constraint finance_ledger_entries_due_after_period check (
    due_date is null or period is null or due_date >= to_date(period || '-01', 'YYYY-MM-DD')
  )
);

comment on table public.finance_ledger_entries is
  'Append-only double-entry ledger. Drafts are fully mutable; posting freezes a row permanently (trigger prevent_posted_ledger_mutation). Corrections are reversal rows, never edits.';
comment on column public.finance_ledger_entries.transaction_group_id is
  'Groups the legs of one accounting transaction. NULL on purpose for single-sided operational entries (an accrual, an imported opening balance) — the balance check skips those rather than forcing a fake counter-leg.';
comment on column public.finance_ledger_entries.currency is
  'CONVENTIONS.md §5: amounts are never summed across currencies. Any aggregate over this table must GROUP BY currency; there is no FX leg and no implicit conversion anywhere in this schema.';
comment on column public.finance_ledger_entries.signed_amount is
  'Generated: debit positive, credit negative. A balanced transaction group therefore sums to exactly 0 per currency — that identity is what the constraint trigger asserts.';
comment on column public.finance_ledger_entries.created_by is
  'ON DELETE RESTRICT, deliberately. An account that touched the books cannot be deleted, only deactivated. Losing the actor is losing the audit trail.';

create index if not exists idx_finance_ledger_entries_company_id
  on public.finance_ledger_entries (company_id);
create index if not exists idx_finance_ledger_entries_site_id
  on public.finance_ledger_entries (site_id);
create index if not exists idx_finance_ledger_entries_resident_id
  on public.finance_ledger_entries (resident_id);
create index if not exists idx_finance_ledger_entries_created_by
  on public.finance_ledger_entries (created_by);

-- unit_id and company_id are RLS policy predicates. tasks/W1-A: an unindexed policy
-- predicate makes a 656-row table behave like a 656,000-row one, because it runs per row.
create index if not exists idx_finance_ledger_entries_unit_id
  on public.finance_ledger_entries (unit_id)
  where unit_id is not null;

create index if not exists idx_finance_ledger_entries_company_status
  on public.finance_ledger_entries (company_id, status);
create index if not exists idx_finance_ledger_entries_company_posted
  on public.finance_ledger_entries (company_id, posted_at desc)
  where posted_at is not null;
create index if not exists idx_finance_ledger_entries_company_period
  on public.finance_ledger_entries (company_id, period)
  where period is not null;

-- The balance trigger re-reads the whole group on every write to a grouped row.
create index if not exists idx_finance_ledger_entries_group
  on public.finance_ledger_entries (transaction_group_id)
  where transaction_group_id is not null;

create unique index if not exists ux_finance_ledger_entries_idempotency
  on public.finance_ledger_entries (company_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists ux_finance_ledger_entries_reversal
  on public.finance_ledger_entries (reversal_of)
  where reversal_of is not null;

drop trigger if exists set_finance_ledger_entries_updated_at on public.finance_ledger_entries;
create trigger set_finance_ledger_entries_updated_at
  before update on public.finance_ledger_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- wallets
-- ---------------------------------------------------------------------------

create table if not exists public.wallets (
  id                           uuid primary key default gen_random_uuid(),
  company_id                   uuid not null references public.companies(id) on delete restrict,
  owner_profile_id             uuid references public.profiles(id) on delete restrict,
  kind                         public.wallet_kind not null default 'resident',
  currency                     public.currency_code not null default 'EUR',
  balance_amount               numeric(14, 2) not null default 0,
  allows_overdraft             boolean not null default false,
  overdraft_limit_amount       numeric(14, 2) not null default 0
                                 check (overdraft_limit_amount >= 0),
  low_balance_threshold_amount numeric(14, 2) not null default 0
                                 check (low_balance_threshold_amount >= 0),
  status                       public.wallet_status not null default 'active',
  version                      integer not null default 1,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),

  -- REQUIRED INVARIANT: no negative balance without an explicit overdraft flag. Written as
  -- a table CHECK rather than trigger logic so that no code path — RPC, migration, seed or
  -- psql session — can route around it.
  constraint wallets_no_unflagged_overdraft check (
    balance_amount >= 0 or allows_overdraft
  ),

  -- A flag without a ceiling is an unbounded overdraft. These two keep the flag honest in
  -- both directions.
  constraint wallets_overdraft_limit_requires_flag check (
    allows_overdraft or overdraft_limit_amount = 0
  ),
  constraint wallets_overdraft_within_limit check (
    balance_amount >= -overdraft_limit_amount
  ),

  -- A person or vendor holds a wallet; a company-level wallet holds none.
  constraint wallets_owner_kind check (
    (kind in ('resident', 'vendor') and owner_profile_id is not null)
    or (kind = 'company' and owner_profile_id is null)
  ),

  -- One wallet per holder per currency. NULLs are distinct, so this leaves the
  -- company-level wallets to the partial unique index below.
  unique (owner_profile_id, currency)
);

comment on table public.wallets is
  'Stored-value account per holder per currency. balance_amount is a cached total: the authoritative history is public.finance_ledger_entries, and a repair job recomputes rather than trusting this column.';
comment on column public.wallets.balance_amount is
  'Cached balance. May go negative ONLY when allows_overdraft is true, and then never past overdraft_limit_amount — both enforced by CHECK, not by application code.';
comment on column public.wallets.version is
  'Optimistic concurrency. Two concurrent debits that both read the same balance must not both win; last-write-wins is a bug (CONVENTIONS.md §5).';

create unique index if not exists ux_wallets_company_level
  on public.wallets (company_id, kind, currency)
  where owner_profile_id is null;

create index if not exists idx_wallets_company_id on public.wallets (company_id);
create index if not exists idx_wallets_owner_profile_id on public.wallets (owner_profile_id);
create index if not exists idx_wallets_status on public.wallets (status);

drop trigger if exists set_wallets_updated_at on public.wallets;
create trigger set_wallets_updated_at
  before update on public.wallets
  for each row execute function public.set_updated_at();

drop trigger if exists bump_wallets_version on public.wallets;
create trigger bump_wallets_version
  before update on public.wallets
  for each row execute function public.bump_row_version();

-- ---------------------------------------------------------------------------
-- vendor_invoices
-- ---------------------------------------------------------------------------

create table if not exists public.vendor_invoices (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete restrict,
  site_id           uuid references public.sites(id) on delete restrict,
  vendor_profile_id uuid references public.profiles(id) on delete restrict,
  vendor_name       text not null collate "tr-TR-x-icu",
  invoice_no        text not null,
  status            public.vendor_invoice_status not null default 'draft',
  total_amount      numeric(14, 2) not null check (total_amount > 0),
  tax_amount        numeric(14, 2) not null default 0 check (tax_amount >= 0),
  paid_amount       numeric(14, 2) not null default 0,
  currency          public.currency_code not null default 'EUR',
  issued_on         date not null default current_date,
  due_on            date,
  ledger_entry_id   uuid references public.finance_ledger_entries(id) on delete restrict,
  document_path     text,
  notes             text,
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- REQUIRED INVARIANT: a payment cannot exceed its invoice.
  constraint vendor_invoices_paid_within_total check (
    paid_amount >= 0 and paid_amount <= total_amount
  ),

  constraint vendor_invoices_tax_within_total check (tax_amount <= total_amount),

  -- "paid" is not a label somebody applies, it is a fact about paid_amount.
  constraint vendor_invoices_paid_status_agrees check (
    status <> 'paid' or paid_amount = total_amount
  ),

  constraint vendor_invoices_due_after_issue check (
    due_on is null or due_on >= issued_on
  ),

  unique (company_id, invoice_no)
);

comment on table public.vendor_invoices is
  'Payable owed to a service provider. total_amount > 0 on purpose: a zero invoice is a data-entry error, and a credit note is a ledger reversal, not an invoice worth nothing.';
comment on column public.vendor_invoices.paid_amount is
  'Settlement to date. CHECK-bounded to [0, total_amount] — overpayment is refused at the storage layer, not caught in review.';
comment on column public.vendor_invoices.vendor_profile_id is
  'The service_provider who may read this row. It is an RLS predicate, hence the index below.';

create index if not exists idx_vendor_invoices_company_id on public.vendor_invoices (company_id);
create index if not exists idx_vendor_invoices_site_id on public.vendor_invoices (site_id);
create index if not exists idx_vendor_invoices_vendor_profile_id
  on public.vendor_invoices (vendor_profile_id);
create index if not exists idx_vendor_invoices_ledger_entry_id
  on public.vendor_invoices (ledger_entry_id);
create index if not exists idx_vendor_invoices_company_status
  on public.vendor_invoices (company_id, status);
create index if not exists idx_vendor_invoices_due_on
  on public.vendor_invoices (due_on)
  where status in ('open', 'partially_paid');

drop trigger if exists set_vendor_invoices_updated_at on public.vendor_invoices;
create trigger set_vendor_invoices_updated_at
  before update on public.vendor_invoices
  for each row execute function public.set_updated_at();

drop trigger if exists bump_vendor_invoices_version on public.vendor_invoices;
create trigger bump_vendor_invoices_version
  before update on public.vendor_invoices
  for each row execute function public.bump_row_version();

-- ---------------------------------------------------------------------------
-- payment_transactions
-- ---------------------------------------------------------------------------

create table if not exists public.payment_transactions (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete restrict,
  ledger_entry_id    uuid references public.finance_ledger_entries(id) on delete restrict,
  vendor_invoice_id  uuid references public.vendor_invoices(id) on delete restrict,
  wallet_id          uuid references public.wallets(id) on delete restrict,
  unit_id            text references public.units(id) on delete restrict,
  resident_id        uuid references public.residents(id) on delete restrict,
  provider           text not null,
  provider_reference text,
  direction          public.payment_direction not null default 'inbound',
  status             public.payment_status not null default 'pending',
  amount             numeric(14, 2) not null check (amount > 0),
  currency           public.currency_code not null default 'EUR',
  paid_at            timestamptz,
  failure_reason     text,
  idempotency_key    text,
  provider_payload   jsonb not null default '{}'::jsonb,
  created_by         uuid references public.profiles(id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- A captured payment that cannot say when it settled is not evidence of anything.
  constraint payment_transactions_captured_has_time check (
    status <> 'captured' or paid_at is not null
  ),
  constraint payment_transactions_failure_reason check (
    status <> 'failed' or failure_reason is not null
  )
);

comment on table public.payment_transactions is
  'Provider-side money movement. Distinct from the ledger on purpose: a payment can fail, be retried and be refunded, none of which may edit a posted ledger entry.';
comment on column public.payment_transactions.provider_payload is
  'Provider metadata only. NEVER a card number, IBAN, CVV or full request body — CONVENTIONS.md §4 forbids storing or logging PII and full bodies, and this column is the obvious place someone would break that rule.';
comment on column public.payment_transactions.amount is
  'Always positive. Direction is carried by the direction column, not by the sign, so that a sum without a direction filter is obviously wrong rather than quietly wrong.';

create index if not exists idx_payment_transactions_company_id
  on public.payment_transactions (company_id);
create index if not exists idx_payment_transactions_ledger_entry_id
  on public.payment_transactions (ledger_entry_id);
create index if not exists idx_payment_transactions_vendor_invoice_id
  on public.payment_transactions (vendor_invoice_id);
create index if not exists idx_payment_transactions_resident_id
  on public.payment_transactions (resident_id);
create index if not exists idx_payment_transactions_created_by
  on public.payment_transactions (created_by);

-- wallet_id and unit_id are RLS policy predicates.
create index if not exists idx_payment_transactions_wallet_id
  on public.payment_transactions (wallet_id)
  where wallet_id is not null;
create index if not exists idx_payment_transactions_unit_id
  on public.payment_transactions (unit_id)
  where unit_id is not null;

create index if not exists idx_payment_transactions_company_status
  on public.payment_transactions (company_id, status);
create index if not exists idx_payment_transactions_company_paid
  on public.payment_transactions (company_id, paid_at desc)
  where paid_at is not null;

create unique index if not exists ux_payment_transactions_idempotency
  on public.payment_transactions (company_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists ux_payment_transactions_provider_reference
  on public.payment_transactions (provider, provider_reference)
  where provider_reference is not null;

drop trigger if exists set_payment_transactions_updated_at on public.payment_transactions;
create trigger set_payment_transactions_updated_at
  before update on public.payment_transactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Invariant — posted ledger entries are immutable
--
-- BOTH update and delete. A delete-only or update-only guard is not immutability:
-- whichever half you leave open is the one that gets used.
--
-- The errcode is 23514 (check_violation), not 42501 (insufficient_privilege), and the
-- distinction is deliberate: no role — not admin, not the service key — can lift this.
-- Returning 42501 would tell the caller "get more privileges and retry", which is false.
-- ---------------------------------------------------------------------------

create or replace function public.reject_posted_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' or old.posted_at is not null then
      raise exception
        'Ledger entry % is posted and cannot be deleted. Post a reversal entry instead.',
        old.id
        using errcode = '23514';
    end if;
    return old;
  end if;

  -- OLD is what matters, not NEW: a draft becoming posted is the one legal transition into
  -- this state, and at that moment OLD.status is still 'draft'.
  if old.status = 'posted' or old.posted_at is not null then
    raise exception
      'Ledger entry % is posted and immutable. Post a reversal entry instead.',
      old.id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.reject_posted_mutation() is
  'SYSTEM-PROMPT.md §2.16. Freezes a ledger row the instant it is posted, for UPDATE and DELETE alike. Unposted drafts stay fully mutable; the sanctioned correction path for a posted row is a reversal.';

drop trigger if exists prevent_posted_ledger_mutation on public.finance_ledger_entries;
create trigger prevent_posted_ledger_mutation
  before update or delete on public.finance_ledger_entries
  for each row execute function public.reject_posted_mutation();

-- ---------------------------------------------------------------------------
-- Invariant — double-entry sums to zero per transaction group
--
-- DEFERRABLE INITIALLY DEFERRED, because a balanced transaction is written one leg at a
-- time: an immediate check would reject the first INSERT of every legitimate pair. The
-- check therefore runs once at COMMIT, when the group is whole.
--
-- SCOPE, deliberately narrow: rows with transaction_group_id IS NULL are exempt. Not every
-- ledger row is half of a pair — an accrual, an imported opening balance or a one-sided
-- operational adjustment has no counter-leg, and forcing one would mean inventing a contra
-- entry that never happened. Grouping is opt-in; once a row names a group, the whole group
-- must balance.
--
-- SECURITY DEFINER so the check sees EVERY leg of the group, including legs the writing
-- user cannot read under RLS. A balance check that only sums the visible rows always
-- passes, which makes it worse than no check at all.
-- ---------------------------------------------------------------------------

create or replace function public.assert_ledger_group_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_groups uuid[] := '{}'::uuid[];
  v_group  uuid;
  v_rows   bigint;
  v_leg    record;
begin
  -- NEW is unassigned on DELETE and OLD is unassigned on INSERT; touching the wrong one
  -- raises "record is not assigned yet". Hence the explicit tg_op guards rather than a
  -- coalesce() over both.
  if tg_op <> 'DELETE' and new.transaction_group_id is not null then
    v_groups := v_groups || new.transaction_group_id;
  end if;

  -- On UPDATE this also re-checks the group the row LEFT, which would otherwise be
  -- silently unbalanced by the move.
  if tg_op <> 'INSERT' and old.transaction_group_id is not null then
    v_groups := v_groups || old.transaction_group_id;
  end if;

  foreach v_group in array v_groups loop
    select count(*) into v_rows
    from public.finance_ledger_entries e
    where e.transaction_group_id = v_group;

    if v_rows = 0 then
      -- Dissolving a whole draft group is legal. Removing ONE leg of it is not, and that
      -- case never reaches here — it leaves rows behind and fails the sum below.
      if tg_op = 'DELETE' then
        continue;
      end if;
      raise exception 'Ledger transaction group % has no entries.', v_group
        using errcode = '23514';
    end if;

    -- GROUP BY currency, not a single total. CONVENTIONS.md §5 forbids summing across
    -- currencies; a group that spans EUR and TRY must balance within each separately, and
    -- there is no exchange-rate leg anywhere in this schema to reconcile them.
    for v_leg in
      select e.currency           as currency,
             sum(e.debit_amount)  as debit_total,
             sum(e.credit_amount) as credit_total
      from public.finance_ledger_entries e
      where e.transaction_group_id = v_group
      group by e.currency
    loop
      if v_leg.debit_total <> v_leg.credit_total then
        raise exception
          'Ledger transaction group % is unbalanced in %: debit %, credit %.',
          v_group, v_leg.currency, v_leg.debit_total, v_leg.credit_total
          using errcode = '23514';
      end if;
    end loop;
  end loop;

  return null;
end;
$$;

comment on function public.assert_ledger_group_balanced() is
  'Deferred double-entry check: per (transaction_group_id, currency), sum(debit_amount) must equal sum(credit_amount) and the group must be non-empty. Rows with a NULL group are exempt so single-sided operational entries remain possible.';

drop trigger if exists assert_ledger_group_balanced on public.finance_ledger_entries;
create constraint trigger assert_ledger_group_balanced
  after insert or update or delete on public.finance_ledger_entries
  deferrable initially deferred
  for each row execute function public.assert_ledger_group_balanced();

-- ---------------------------------------------------------------------------
-- RLS helpers
--
-- These exist so that no policy below contains a bare
-- `exists (select … from <another RLS-protected table>)`. SECURITY DEFINER on a table that
-- is ENABLE (never FORCE) row level security means the nested read runs as the owner and
-- does not re-enter the other table's policies — the structural fix for the 42P17 cycle
-- the reference project shipped and later had to undo.
-- ---------------------------------------------------------------------------

create or replace function public.is_finance_visible_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.current_user_role() not in ('guest', 'child_guest'),
    false
  );
$$;

comment on function public.is_finance_visible_role() is
  'The single chokepoint for "finance is never public". FALSE for anon (no role resolves), for guest and for child_guest. Every finance read policy is AND-ed with it, so no future policy can accidentally open a guest path.';

create or replace function public.can_read_company_finance(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_finance_visible_role()
     and (
       -- manager (70) and admin (90) read across companies
       public.has_role_level(70)
       -- accountant (60) is confined to its own company
       or (public.has_role_level(60)
           and p_company_id is not null
           and p_company_id = public.current_user_company_id())
     );
$$;

create or replace function public.can_write_company_finance(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or (public.is_finance_visible_role()
          and public.has_role_level(60)
          and p_company_id is not null
          and p_company_id = public.current_user_company_id());
$$;

comment on function public.can_write_company_finance(uuid) is
  'Write gate for the finance tables. Note that `authenticated` holds no INSERT/UPDATE/DELETE grant on any of them (see the grants block), so this is the second lock, not the first — mutation is expected to arrive through service-role RPCs.';

create or replace function public.can_read_unit_finance(p_unit_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_unit_id is not null
     -- Enumerated rather than levelled on purpose. unit_residents also carries
     -- relation='guest', so a level threshold alone would hand a guest the finance history
     -- of the flat they are staying in.
     and coalesce(
           public.current_user_role() in (
             'owner', 'tenant', 'child_owner', 'child_tenant'
           ),
           false
         )
     and exists (
       select 1
       from public.current_user_unit_ids() u(unit_id)
       where u.unit_id = p_unit_id
     );
$$;

comment on function public.can_read_unit_finance(text) is
  'Residency read path. Resolves through public.current_user_unit_ids(), so a child_* role transparently receives its GUARDIAN''s unit set and never more.';

create or replace function public.can_read_own_wallet(p_owner_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner_profile_id is not null
     and public.is_finance_visible_role()
     and p_owner_profile_id = public.current_user_scope_profile_id();
$$;

create or replace function public.current_user_wallet_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.id
  from public.wallets w
  where public.is_finance_visible_role()
    and w.owner_profile_id = public.current_user_scope_profile_id();
$$;

create or replace function public.is_invoice_vendor(p_vendor_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_vendor_profile_id is not null
     and coalesce(public.current_user_role() = 'service_provider', false)
     and p_vendor_profile_id = public.current_user_scope_profile_id();
$$;

comment on function public.is_invoice_vendor(uuid) is
  'A service_provider reads its own invoices and nothing else — not the ledger, not wallets, not payments. Restricted to the service_provider role itself so that an owner named as a vendor does not gain a second read path.';

-- ---------------------------------------------------------------------------
-- RLS
--
-- SELECT policies are written per read path and OR-ed by PostgreSQL. Write policies are
-- stated separately from reads rather than as `for all`, so that granting a write path can
-- never widen the read model by accident.
-- ---------------------------------------------------------------------------

alter table public.finance_ledger_entries enable row level security;
alter table public.payment_transactions   enable row level security;
alter table public.wallets                enable row level security;
alter table public.vendor_invoices        enable row level security;

-- finance_ledger_entries
drop policy if exists finance_ledger_entries_select_finance on public.finance_ledger_entries;
create policy finance_ledger_entries_select_finance
  on public.finance_ledger_entries for select
  using (public.can_read_company_finance(company_id));

drop policy if exists finance_ledger_entries_select_own_unit on public.finance_ledger_entries;
create policy finance_ledger_entries_select_own_unit
  on public.finance_ledger_entries for select
  using (public.can_read_unit_finance(unit_id));

drop policy if exists finance_ledger_entries_insert_finance on public.finance_ledger_entries;
create policy finance_ledger_entries_insert_finance
  on public.finance_ledger_entries for insert
  with check (public.can_write_company_finance(company_id));

drop policy if exists finance_ledger_entries_update_finance on public.finance_ledger_entries;
create policy finance_ledger_entries_update_finance
  on public.finance_ledger_entries for update
  using (public.can_write_company_finance(company_id))
  with check (public.can_write_company_finance(company_id));

-- Admin-only, and even then the immutability trigger still refuses any posted row. In
-- practice this deletes abandoned drafts and nothing else.
drop policy if exists finance_ledger_entries_delete_admin on public.finance_ledger_entries;
create policy finance_ledger_entries_delete_admin
  on public.finance_ledger_entries for delete
  using ((select public.is_admin()));

-- payment_transactions
drop policy if exists payment_transactions_select_finance on public.payment_transactions;
create policy payment_transactions_select_finance
  on public.payment_transactions for select
  using (public.can_read_company_finance(company_id));

drop policy if exists payment_transactions_select_own_unit on public.payment_transactions;
create policy payment_transactions_select_own_unit
  on public.payment_transactions for select
  using (public.can_read_unit_finance(unit_id));

drop policy if exists payment_transactions_select_own_wallet on public.payment_transactions;
create policy payment_transactions_select_own_wallet
  on public.payment_transactions for select
  using (wallet_id in (select wallet_id from public.current_user_wallet_ids() w(wallet_id)));

drop policy if exists payment_transactions_insert_finance on public.payment_transactions;
create policy payment_transactions_insert_finance
  on public.payment_transactions for insert
  with check (public.can_write_company_finance(company_id));

drop policy if exists payment_transactions_update_finance on public.payment_transactions;
create policy payment_transactions_update_finance
  on public.payment_transactions for update
  using (public.can_write_company_finance(company_id))
  with check (public.can_write_company_finance(company_id));

drop policy if exists payment_transactions_delete_admin on public.payment_transactions;
create policy payment_transactions_delete_admin
  on public.payment_transactions for delete
  using ((select public.is_admin()));

-- wallets
drop policy if exists wallets_select_finance on public.wallets;
create policy wallets_select_finance
  on public.wallets for select
  using (public.can_read_company_finance(company_id));

drop policy if exists wallets_select_own on public.wallets;
create policy wallets_select_own
  on public.wallets for select
  using (public.can_read_own_wallet(owner_profile_id));

drop policy if exists wallets_insert_finance on public.wallets;
create policy wallets_insert_finance
  on public.wallets for insert
  with check (public.can_write_company_finance(company_id));

drop policy if exists wallets_update_finance on public.wallets;
create policy wallets_update_finance
  on public.wallets for update
  using (public.can_write_company_finance(company_id))
  with check (public.can_write_company_finance(company_id));

drop policy if exists wallets_delete_admin on public.wallets;
create policy wallets_delete_admin
  on public.wallets for delete
  using ((select public.is_admin()));

-- vendor_invoices
drop policy if exists vendor_invoices_select_finance on public.vendor_invoices;
create policy vendor_invoices_select_finance
  on public.vendor_invoices for select
  using (public.can_read_company_finance(company_id));

drop policy if exists vendor_invoices_select_vendor on public.vendor_invoices;
create policy vendor_invoices_select_vendor
  on public.vendor_invoices for select
  using (public.is_invoice_vendor(vendor_profile_id));

drop policy if exists vendor_invoices_insert_finance on public.vendor_invoices;
create policy vendor_invoices_insert_finance
  on public.vendor_invoices for insert
  with check (public.can_write_company_finance(company_id));

drop policy if exists vendor_invoices_update_finance on public.vendor_invoices;
create policy vendor_invoices_update_finance
  on public.vendor_invoices for update
  using (public.can_write_company_finance(company_id))
  with check (public.can_write_company_finance(company_id));

drop policy if exists vendor_invoices_delete_admin on public.vendor_invoices;
create policy vendor_invoices_delete_admin
  on public.vendor_invoices for delete
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Grants
--
-- anon gets nothing on any of these four tables. There is no public finance surface, and
-- this is the layer that makes that true even if a policy is ever mis-written.
-- ---------------------------------------------------------------------------

revoke all on public.finance_ledger_entries from anon;
revoke all on public.payment_transactions from anon;
revoke all on public.wallets from anon;
revoke all on public.vendor_invoices from anon;

revoke insert, update, delete on public.finance_ledger_entries from authenticated;
revoke insert, update, delete on public.payment_transactions from authenticated;
revoke insert, update, delete on public.wallets from authenticated;
revoke insert, update, delete on public.vendor_invoices from authenticated;

grant select on public.finance_ledger_entries to authenticated;
grant select on public.payment_transactions to authenticated;
grant select on public.wallets to authenticated;
grant select on public.vendor_invoices to authenticated;

revoke all on function public.is_finance_visible_role() from public, anon;
revoke all on function public.can_read_company_finance(uuid) from public, anon;
revoke all on function public.can_write_company_finance(uuid) from public, anon;
revoke all on function public.can_read_unit_finance(text) from public, anon;
revoke all on function public.can_read_own_wallet(uuid) from public, anon;
revoke all on function public.current_user_wallet_ids() from public, anon;
revoke all on function public.is_invoice_vendor(uuid) from public, anon;

grant execute on function public.is_finance_visible_role() to authenticated;
grant execute on function public.can_read_company_finance(uuid) to authenticated;
grant execute on function public.can_write_company_finance(uuid) to authenticated;
grant execute on function public.can_read_unit_finance(text) to authenticated;
grant execute on function public.can_read_own_wallet(uuid) to authenticated;
grant execute on function public.current_user_wallet_ids() to authenticated;
grant execute on function public.is_invoice_vendor(uuid) to authenticated;

-- The two trigger functions get NO execute grant to any client role. A trigger fires on its
-- own authority and can never be called directly, so a grant here would be surface with no
-- purpose.
revoke all on function public.reject_posted_mutation() from public, anon, authenticated;
revoke all on function public.assert_ledger_group_balanced() from public, anon, authenticated;
