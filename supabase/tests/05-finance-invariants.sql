-- pgTAP · 05 — finance invariants (task W1-A)
--
-- SYSTEM-PROMPT.md §2.16: "Posted financial ledger entries are immutable — enforced by
-- trigger, not by convention." This file proves the trigger fires, for UPDATE and for
-- DELETE, and that the other three money rules are constraints rather than intentions:
-- no unflagged negative wallet balance, no payment exceeding its invoice, and a
-- double-entry group that sums to zero per currency.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;

select plan(25);

-- Fixtures. The company and site already exist from the seed.
create temp table tap_fin(entry_draft uuid, entry_posted uuid, wallet uuid, invoice uuid)
  on commit drop;

insert into public.finance_ledger_entries
  (company_id, site_id, entry_type, status, debit_amount, credit_amount, currency, description)
values
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
   'dues', 'draft', 100.00, 0, 'EUR', 'tap draft');

insert into tap_fin(entry_draft)
select id from public.finance_ledger_entries where description = 'tap draft';

insert into public.finance_ledger_entries
  (company_id, site_id, entry_type, status, posted_at, debit_amount, credit_amount, currency, description)
values
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
   'dues', 'posted', now(), 250.00, 0, 'EUR', 'tap posted');

update tap_fin set entry_posted =
  (select id from public.finance_ledger_entries where description = 'tap posted');

-- --- posted entries are immutable ------------------------------------------

select throws_ok(
  format($f$update public.finance_ledger_entries set debit_amount = 999 where id = %L$f$,
         (select entry_posted from tap_fin)),
  '23514',
  null,
  'a posted ledger entry cannot have its amount changed'
);

select throws_ok(
  format($f$update public.finance_ledger_entries set description = 'edited' where id = %L$f$,
         (select entry_posted from tap_fin)),
  '23514',
  null,
  'a posted ledger entry cannot have its description changed'
);

select throws_ok(
  format($f$delete from public.finance_ledger_entries where id = %L$f$,
         (select entry_posted from tap_fin)),
  '23514',
  null,
  'a posted ledger entry cannot be deleted — DELETE is covered, not only UPDATE'
);

select lives_ok(
  format($f$update public.finance_ledger_entries set description = 'still a draft' where id = %L$f$,
         (select entry_draft from tap_fin)),
  'an UNPOSTED draft remains fully mutable'
);

select lives_ok(
  format($f$update public.finance_ledger_entries set status = 'posted', posted_at = now() where id = %L$f$,
         (select entry_draft from tap_fin)),
  'a draft may transition to posted — that is the one legal move into the frozen state'
);

select throws_ok(
  format($f$update public.finance_ledger_entries set debit_amount = 1 where id = %L$f$,
         (select entry_draft from tap_fin)),
  '23514',
  null,
  'the entry just posted is now immutable too'
);

-- The correction path exists and works.
select lives_ok(
  format($f$
    insert into public.finance_ledger_entries
      (company_id, site_id, entry_type, status, posted_at, debit_amount, credit_amount, currency, reversal_of)
    values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
            'reversal', 'posted', now(), 0, 250.00, 'EUR', %L)
  $f$, (select entry_posted from tap_fin)),
  'a posted entry is corrected by a reversal row, which is accepted'
);

select is(
  (select count(*)::integer from public.finance_ledger_entries
   where reversal_of = (select entry_posted from tap_fin)),
  1,
  'the reversal is recorded against the original, which itself is untouched'
);

select is(
  (select status::text from public.finance_ledger_entries where id = (select entry_posted from tap_fin)),
  'posted',
  'the reversed entry is still posted — a reversal never mutates the original'
);

-- --- posted/posted_at cannot diverge ---------------------------------------

select throws_ok(
  $f$insert into public.finance_ledger_entries
       (company_id, site_id, entry_type, status, debit_amount, currency)
     values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
             'dues', 'posted', 10, 'EUR')$f$,
  '23514',
  null,
  'status posted without posted_at is rejected — a half-frozen row is not representable'
);

-- --- one side of a leg carries value ---------------------------------------

select throws_ok(
  $f$insert into public.finance_ledger_entries
       (company_id, site_id, entry_type, debit_amount, credit_amount, currency)
     values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
             'dues', 0, 0, 'EUR')$f$,
  '23514',
  null,
  'a zero/zero ledger leg is rejected'
);

select throws_ok(
  $f$insert into public.finance_ledger_entries
       (company_id, site_id, entry_type, debit_amount, credit_amount, currency)
     values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
             'dues', 10, 10, 'EUR')$f$,
  '23514',
  null,
  'a leg carrying both a debit and a credit is rejected'
);

-- --- double-entry: a named group sums to zero per currency ------------------

do $$
declare v_group uuid := gen_random_uuid(); v_ok boolean := false;
begin
  begin
    set constraints all deferred;
    insert into public.finance_ledger_entries
      (company_id, site_id, entry_type, transaction_group_id, debit_amount, credit_amount, currency)
    values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
            'dues', v_group, 100.00, 0, 'EUR');
    set constraints all immediate;
  exception when check_violation then v_ok := true;
  end;
  create temp table tap_de1(passed boolean) on commit drop;
  insert into tap_de1 values (v_ok);
end $$;

select ok((select passed from tap_de1),
  'a transaction group with only one leg is rejected at commit');

do $$
declare v_group uuid := gen_random_uuid(); v_ok boolean := true;
begin
  begin
    set constraints all deferred;
    insert into public.finance_ledger_entries
      (company_id, site_id, entry_type, transaction_group_id, debit_amount, credit_amount, currency)
    values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
            'dues', v_group, 100.00, 0, 'EUR'),
           ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
            'payment', v_group, 0, 100.00, 'EUR');
    set constraints all immediate;
  exception when check_violation then v_ok := false;
  end;
  create temp table tap_de2(passed boolean) on commit drop;
  insert into tap_de2 values (v_ok);
end $$;

select ok((select passed from tap_de2), 'a balanced two-leg transaction group is accepted');

do $$
declare v_group uuid := gen_random_uuid(); v_ok boolean := false;
begin
  begin
    set constraints all deferred;
    insert into public.finance_ledger_entries
      (company_id, site_id, entry_type, transaction_group_id, debit_amount, credit_amount, currency)
    values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
            'dues', v_group, 100.00, 0, 'EUR'),
           ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
            'payment', v_group, 0, 60.00, 'EUR');
    set constraints all immediate;
  exception when check_violation then v_ok := true;
  end;
  create temp table tap_de3(passed boolean) on commit drop;
  insert into tap_de3 values (v_ok);
end $$;

select ok((select passed from tap_de3), 'an unbalanced transaction group is rejected at commit');

-- Currencies are never netted against each other. A group holding 100 EUR debit and
-- 100 TRY credit is NOT balanced, because there is no FX leg in this schema.
do $$
declare v_group uuid := gen_random_uuid(); v_ok boolean := false;
begin
  begin
    set constraints all deferred;
    insert into public.finance_ledger_entries
      (company_id, site_id, entry_type, transaction_group_id, debit_amount, credit_amount, currency)
    values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
            'dues', v_group, 100.00, 0, 'EUR'),
           ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
            'payment', v_group, 0, 100.00, 'TRY');
    set constraints all immediate;
  exception when check_violation then v_ok := true;
  end;
  create temp table tap_de4(passed boolean) on commit drop;
  insert into tap_de4 values (v_ok);
end $$;

select ok((select passed from tap_de4),
  'a group balancing EUR against TRY is rejected — currencies are never netted');

select lives_ok(
  $f$insert into public.finance_ledger_entries
       (company_id, site_id, entry_type, debit_amount, currency)
     values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
             'adjustment', 42.00, 'EUR')$f$,
  'a single-sided entry with NO transaction group is still allowed — grouping is opt-in'
);

-- --- wallets: no unflagged overdraft ---------------------------------------

select throws_ok(
  $f$insert into public.wallets (company_id, owner_profile_id, kind, currency, balance_amount)
     values ('11111111-1111-4111-8111-111111111111',
             'b0000000-0000-4000-8000-000000000004', 'resident', 'EUR', -1.00)$f$,
  '23514',
  null,
  'a wallet cannot go negative without an explicit overdraft flag'
);

select lives_ok(
  $f$insert into public.wallets
       (company_id, owner_profile_id, kind, currency, balance_amount, allows_overdraft, overdraft_limit_amount)
     values ('11111111-1111-4111-8111-111111111111',
             'b0000000-0000-4000-8000-000000000004', 'resident', 'EUR', -50.00, true, 100.00)$f$,
  'a wallet with an explicit overdraft flag and limit may go negative'
);

select throws_ok(
  $f$insert into public.wallets
       (company_id, owner_profile_id, kind, currency, balance_amount, allows_overdraft, overdraft_limit_amount)
     values ('11111111-1111-4111-8111-111111111111',
             'b0000000-0000-4000-8000-000000000003', 'resident', 'EUR', -500.00, true, 100.00)$f$,
  '23514',
  null,
  'an overdraft beyond the declared limit is rejected — a flag without a ceiling is not a policy'
);

select throws_ok(
  $f$insert into public.wallets
       (company_id, owner_profile_id, kind, currency, allows_overdraft, overdraft_limit_amount)
     values ('11111111-1111-4111-8111-111111111111',
             'b0000000-0000-4000-8000-000000000003', 'resident', 'EUR', false, 100.00)$f$,
  '23514',
  null,
  'an overdraft limit without the flag is rejected'
);

-- --- vendor invoices: a payment cannot exceed its invoice -------------------

select throws_ok(
  $f$insert into public.vendor_invoices
       (company_id, vendor_name, invoice_no, total_amount, paid_amount, currency)
     values ('11111111-1111-4111-8111-111111111111', 'TAP Vendor', 'TAP-001', 100.00, 150.00, 'EUR')$f$,
  '23514',
  null,
  'a vendor invoice cannot be paid more than its total'
);

select throws_ok(
  $f$insert into public.vendor_invoices
       (company_id, vendor_name, invoice_no, total_amount, paid_amount, currency)
     values ('11111111-1111-4111-8111-111111111111', 'TAP Vendor', 'TAP-002', 100.00, -1.00, 'EUR')$f$,
  '23514',
  null,
  'a vendor invoice cannot be paid a negative amount'
);

select throws_ok(
  $f$insert into public.vendor_invoices
       (company_id, vendor_name, invoice_no, status, total_amount, paid_amount, currency)
     values ('11111111-1111-4111-8111-111111111111', 'TAP Vendor', 'TAP-003', 'paid', 100.00, 40.00, 'EUR')$f$,
  '23514',
  null,
  'an invoice marked paid whose paid_amount is short of the total is rejected'
);

select lives_ok(
  $f$insert into public.vendor_invoices
       (company_id, vendor_name, invoice_no, status, total_amount, paid_amount, currency)
     values ('11111111-1111-4111-8111-111111111111', 'TAP Vendor', 'TAP-004', 'paid', 100.00, 100.00, 'EUR')$f$,
  'a fully settled invoice marked paid is accepted'
);

select * from finish();
rollback;
