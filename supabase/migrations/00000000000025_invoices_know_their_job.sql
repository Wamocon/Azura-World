-- 25 · A vendor invoice can name the job it came from
--
-- The chain this product exists to make legible is:
--
--   resident reports → manager triages → contractor works → vendor invoices →
--   finance pays → the ledger records it
--
-- Every link in it was already in the schema except one. Measured on the live
-- database, 2026-08-04:
--
--   workforce_tasks  → service_tickets     26 of 26 rows linked
--   payment_txn      → finance_ledger      90 of 90 rows linked
--   ledger           → units              198 of 198 rows linked
--   vendor_invoices  → service_tickets     NO SUCH COLUMN
--
-- So "what did that repair cost?" — the single question a building operator asks
-- most — could not be answered by this database at all, and the invoice page and
-- the ticket page had no way to reference each other. That is the gap.
--
-- ## Nullable, and it stays nullable
--
-- Most of what a residence pays for is not a repair. Garden care, pool
-- chemistry, cleaning, security and the lift service contract are recurring
-- obligations that exist whether or not anybody reports anything, and eighteen
-- of the eighteen seeded invoices are of exactly that kind. An invoice with no
-- ticket is the normal case, not a missing value, and the UI must say "not from
-- a reported job" rather than treat it as incomplete data.
--
-- ## on delete set null, not cascade
--
-- Deleting a ticket must never delete money. The invoice outlives the job it
-- came from — that is what an invoice is — and losing the link is the correct
-- degradation. `service_tickets` has no delete path in the product today, so
-- this is a guard against a future one rather than a live behaviour.

alter table public.vendor_invoices
  add column if not exists ticket_id uuid
    references public.service_tickets (id) on delete set null;

comment on column public.vendor_invoices.ticket_id is
  'The service ticket whose work this invoice bills, when there is one. Null for recurring contract work, which is the majority.';

-- Both directions are read: "the invoices for this ticket" from the ticket page
-- (few rows, high selectivity) and "the ticket for this invoice" by primary key.
-- Only the first needs an index.
create index if not exists vendor_invoices_ticket_id_idx
  on public.vendor_invoices (ticket_id)
  where ticket_id is not null;

-- The grants on this table are table-level rather than column-scoped, so the new
-- column inherits them. Asserted rather than assumed: if a later migration ever
-- narrows these to a column list, this block fails loudly instead of leaving a
-- column that RLS permits and GRANT silently withholds — which is the exact
-- failure mode that disabled ten write paths in this project before.
do $$
declare
  missing text;
begin
  select string_agg(p.privilege, ', ')
    into missing
    from (values ('SELECT'), ('INSERT'), ('UPDATE')) as p(privilege)
   where not exists (
     select 1
       from information_schema.column_privileges cp
      where cp.table_schema = 'public'
        and cp.table_name = 'vendor_invoices'
        and cp.column_name = 'ticket_id'
        and cp.grantee = 'authenticated'
        and cp.privilege_type = p.privilege
   );

  if missing is not null then
    raise exception
      'vendor_invoices.ticket_id is not granted to authenticated (%). Add an explicit column grant.',
      missing;
  end if;
end $$;
