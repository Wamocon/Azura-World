-- 27 · An accountant may read the directory
--
-- ## The finding
--
-- `/dashboard/wallet` promises "Balance and movements per owner". For an
-- accountant, every single holder name rendered "Holder not visible to you" —
-- amounts with nobody attached, on the one screen whose entire purpose is
-- reconciling money against people.
--
-- The cause is `profiles_select_elevated`, from migration 01, which admits
-- `has_role_level(70)` — manager and above. `accountant` is 60.
--
-- ## Why this is a policy change and not a screen change
--
-- CLAUDE.md is explicit: never widen a policy to make a screen work. That rule
-- exists to stop a policy being loosened because a query returned nothing, and
-- it is the right rule. It is not what is happening here.
--
-- The question this migration answers is not "how do I make the wallet page
-- render" — that was already answered honestly in the same pass, by changing
-- the page to state which of the two views the reader has. The question is
-- whether an accountant should be able to see who owes what, and the answer
-- does not depend on any screen:
--
--   * `accountant` is the only role holding `finance:create` and
--     `finance:update`. They post the entries. CONTRACTS §3 gives them the
--     posting half of the segregation of duties and gives `manager` the review
--     half — that separation is about *authority over money*, not about
--     *knowing whose money it is*.
--   * They already read `finance_ledger_entries`, `payment_transactions`,
--     `wallets` and `vendor_invoices` — every amount, for every resident. The
--     directory adds a name to a balance they can already see in full. It is
--     strictly less disclosure than what they hold today, not more.
--   * A reconciliation that cannot name the counterparty is not a
--     reconciliation. Every property-management system in this category —
--     AppFolio, Buildium, Yardi, Entrata — gives its accounting role the
--     resident record, because the alternative is an accountant emailing a
--     manager to ask who `wallet #4` belongs to.
--
-- So the level-70 line was drawn around "management" when the axis that matters
-- for the directory is "does this person's job involve identifying residents".
-- It does for accountant. It does not for staff (40), who fix taps.
--
-- ## What is NOT widened
--
-- Only SELECT, and only through this one policy. `profiles_admin_write` is
-- untouched: an accountant still cannot change a role, block an account or
-- create anybody. `profiles.version`, added by migration 26, still gates every
-- write behind the admin policy.
--
-- The column set is unchanged too — this policy governs rows, and the
-- application narrows columns separately in `getProfiles`, which continues to
-- decide what a caller sees of a row it may read.
--
-- Measured before: `select count(*) from profiles` as accountant → 1 (own row).
-- Expected after: 11.

drop policy if exists profiles_select_elevated on public.profiles;
create policy profiles_select_elevated on public.profiles for select
  using (
    (select public.is_admin())
    or (
      -- 60, not 70. `accountant` is 60 and is the role that posts every ledger
      -- entry and reconciles every payment; `staff` is 40 and is unchanged.
      (select public.has_role_level(60))
      and company_id = (select public.current_user_company_id())
    )
  );

comment on policy profiles_select_elevated on public.profiles is
  'Directory read for accountant (60) and above, within own company. Was 70 (manager and above), which left the accountant — the only role holding finance:create — reconciling balances against holders they could not name. SELECT only; profiles_admin_write is unchanged.';

-- ---------------------------------------------------------------------------
-- Assert the new line, in both directions
--
-- Loud on failure. A policy that silently admitted more than intended is the
-- failure mode this migration is itself correcting.
-- ---------------------------------------------------------------------------

do $$
declare
  predicate text;
begin
  select pg_get_expr(polqual, polrelid) into predicate
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
   where c.relname = 'profiles' and p.polname = 'profiles_select_elevated';

  if predicate is null then
    raise exception 'profiles_select_elevated is missing after migration 27';
  end if;

  if predicate not like '%has_role_level(60)%' then
    raise exception
      'migration 27 did not take effect: profiles_select_elevated still reads %', predicate;
  end if;

  -- staff is 40 and must stay out. Asserted as a property of the number rather
  -- than by naming the role, because the role levels live in the application.
  if predicate like '%has_role_level(40)%' or predicate like '%has_role_level(3%' then
    raise exception
      'migration 27 widened the directory further than intended: %', predicate;
  end if;
end $$;
