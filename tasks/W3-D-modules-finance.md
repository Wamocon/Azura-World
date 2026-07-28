# W3-D — Finance, wallet, vendor invoices

**Wave:** 3 · **Depends on:** W1-A, W2-A, W2-B, W3-B · **Runs with:** all other W3-*

> Read `SYSTEM-PROMPT.md`, `HANDOFF/W3-B.md` (module contract), `HANDOFF/W2-A.md`
> (`finance-repository` signatures), `HANDOFF/W1-A.md` (ledger tables + immutability trigger).
> Then read `D:\Real Estate CRM\Cati\apps\web\components\finance-live-ledger.tsx`,
> `accountant-finance-panel.tsx`, `manual-payment-console.tsx`.

---

## Mission

Money. The module where a bug is not a cosmetic defect but a wrong number in front of an
accountant. Two rules govern everything here:

1. **Posted ledger entries are immutable.** Enforced by trigger (W1-A). The UI must never offer
   an edit affordance that the database will reject — a disabled control that explains itself
   beats an enabled one that fails.
2. **Never aggregate across currencies.** This project's data has EUR and USD in it. `sum(EUR) +
sum(USD)` is a meaningless number that will look authoritative on a dashboard.

---

## Files you own

```
apps/web/app/[locale]/dashboard/{finance,wallet,vendor-invoices}/**
apps/web/components/finance/*
HANDOFF/W3-D.md
```

Messages: `dashboard.finance.*`, `dashboard.wallet.*`, `dashboard.invoices.*` only.

---

## Deliverables

### 1. Finance — `/dashboard/finance`

- **Ledger**: entries with date, account, description, debit, credit, balance, currency, status.
  Posted rows are visually distinct and non-editable. Draft rows may be edited or posted.
- **Per-currency totals.** Separate summary rows per currency, never a combined figure.
- **Double-entry integrity**: each transaction group sums to zero; show the check, and flag any
  group that does not.
- **Reconciliation**: match payments to ledger entries; unmatched items surfaced, not hidden.
- **Debtor view**: outstanding balances by unit and by resident, ageing buckets.
- Drill-through: ledger entry → payment → unit → resident.
- Export: CSV and a printable statement, filter-respecting.

### 2. Payments

Manual payment posting console (mirror `manual-payment-console.tsx`): amount, currency, method,
reference, allocation to invoice or unit, evidence attachment.

- **Idempotency key on submit.** A double-clicked payment button must not post twice.
- **Optimistic concurrency**: posting against a stale view returns 409 and re-renders, never
  overwrites.
- Approval workflow where the permission matrix requires it. `accountant` posts;
  `manager`/`admin` approve above a threshold.
- **Every action audited** with actor, timestamp, before/after.

### 3. Wallet — `/dashboard/wallet`

Per-resident balance, transaction history, top-ups, deductions. Negative balance only with an
explicit overdraft flag — otherwise rejected at the database (W1-A).

### 4. Owner finance projection

For `owner` role: their units' income, costs, net position, distribution history. **Scoped by the
repository _and_ by RLS** — an owner seeing another owner's finances is the worst possible
failure in this module. Test it adversarially.

### 5. Vendor invoices — `/dashboard/vendor-invoices`

Vendor invoice intake, approval chain, payment status, linkage to service orders. Duplicate
detection on vendor + invoice number + amount.

---

## Edge cases

- **Currency**: never mix in an aggregate. Per-currency subtotals, always labelled.
- **Rounding**: `numeric(14,2)` in the database, integer minor units in JS if you compute.
  **Never floating-point arithmetic on money.** `0.1 + 0.2 !== 0.3` will eventually cost someone
  a reconciliation afternoon.
- **Negative zero**: `-0.00` must render as `0,00`.
- **A posted entry someone tries to edit** → the affordance is absent or disabled with an
  explanation. If the request reaches the API anyway it must 403/409, not 500.
- **Concurrent payment posting** on the same invoice → second gets 409 with a clear message.
- **Payment exceeding invoice** → rejected with the remaining amount named.
- **Refund / negative payment** → allowed only where the permission matrix says so, always audited.
- **Ageing buckets across a month boundary** → compute from a server timestamp, not client time.
- **German number format in inputs**: a user typing `1.234,56` must parse to `1234.56`. This is
  the single most likely data-entry bug in a German-default finance UI. Test it explicitly.
- **Very large amounts** → no exponential notation, no overflow in table cells.
- **Export while filtered** → exports the filter, and the file names the filter.
- **`owner` deep-links to another owner's statement** → 403, and it is logged as an access event.
- **Supabase unconfigured** → finance reads may serve seed data clearly badged "Demo-Daten";
  **writes must return 503.** Never fake a successful posting.

---

## Definition of done

```bash
pnpm --dir apps/web typecheck && pnpm --dir apps/web lint && pnpm --dir apps/web build
```

Plus, evidence pasted:

1. Ledger with mixed EUR/USD → **separate totals**, screenshot
2. Attempt to edit a posted entry → blocked in UI, and 409/403 from the API
3. Double-submit a payment with the same idempotency key → posted **once**; show both responses
4. Concurrent posting from two sessions → second gets 409
5. Enter `1.234,56` in a German-locale amount field → stored as `1234.56`; show the round-trip
6. `owner` A requests `owner` B's statement → 403 + access-event row
7. Overdraft without the flag → rejected by the database; show the error surfaced sanely
8. Supabase unconfigured → read shows badged demo data, write returns 503
9. Permission matrix across all 11 roles for every finance route
10. Money formatting in all four locales

---

## Handoff must state

- How money is represented in JS (minor units vs decimal) and where conversion happens
- The approval thresholds implemented and who can approve
- Confirmation that no aggregate mixes currencies anywhere — say where you checked
- Which finance writes return 503 in seed mode
