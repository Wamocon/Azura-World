# HANDOFF — W3-D Finance, wallet, vendor invoices

STATUS: COMPLETE
Completed: 2026-07-28 · Window: N2 · Branch: `feature/INTERNAL-107-n2-finance` · Worktree: `D:\azura-n2`

Three routes, six route files, nine components. `/dashboard/finance`,
`/dashboard/wallet` and `/dashboard/vendor-invoices` render, plus a unit statement
at `/dashboard/finance/statement/[unitId]` and a CSV export under each of the two
list surfaces.

---

## 1. The four questions the brief asks the handoff to answer

### How money is represented in JS, and where conversion happens

**Integer minor units, end to end, through one branded type.**

```
numeric(14,2) in Postgres
  → PostgREST string "8400.00"
  → number | null            (W2-A's lib/finance-repository.ts)
  → toMinor()                ← THE ONLY CONVERSION IN. components/finance/money.ts
  → Minor (branded integer)  ← every sum, difference and comparison happens here
  → formatMinor()            ← THE ONLY CONVERSION OUT
```

`Minor` is `number & { readonly [MINOR_BRAND]: true }`, so a decimal is not
assignable where minor units are expected and the compiler rejects the mistake
rather than a reviewer having to catch it. There is no `+` on a decimal anywhere
in `components/finance/**`.

**`formatMinor` never constructs a double.** It builds the exact decimal
**string** (`"1234.56"`) and hands that to `Intl.NumberFormat.format()`, which
accepts a string as an exact decimal (ES2023; verified on Node 22.14 —
`format("999999999999.99")` → `999.999.999.999,99 €`). The one type assertion in
the module is on that string, discharged by construction, and documented at the
line.

Two things measured rather than asserted from folklore:

- **`Math.round(value * 100)` is not broken over this input domain.** Scanned all
  3,000,000 values `0.01 … 30000.00`: it agrees with the `toFixed` route on every
  one. The comment in `money.ts` says so, because the usual claim that the naive
  multiply loses cents is not true here and writing it would be cargo cult. The
  string route is kept because its correctness does not depend on the input range
  staying inside what was scanned.
- **`toMinor(1.005)` is `100`, not `101`,** and no rounding strategy can fix it:
  the nearest double to 1.005 is `1.0049999999999998934`, so the cent was gone
  before this module was called. That is the whole argument for crossing into
  integers once, early.

**Negative zero.** `Intl.NumberFormat("de-DE", …).format(-0)` really does emit
`-0,00 €` on Node 22.14 — asserted in the test suite against the raw platform
call, so the guard cannot be deleted as superstition. `toMinor` collapses `-0` to
`0` and `minorToDecimalString` emits no sign for zero, so `-0,00` cannot reach a
screen from any path. The browser run scans the whole rendered page for it.

### The approval thresholds implemented, and who can approve

`components/finance/approval-threshold.ts`. **One threshold per currency, and no
fallback that converts** — a single figure compared against a TRY amount and a
EUR amount is two different policies wearing one number.

| Currency | Threshold | Minor units |
| -------- | --------- | ----------- |
| EUR      | 5.000,00  | 500 000     |
| USD      | 5.000,00  | 500 000     |
| GBP      | 5.000,00  | 500 000     |
| TRY      | 200.000,00| 20 000 000  |

`>` not `>=`: a payment of exactly the threshold is the last one that does not
need approval.

**`[I]` These values are an inference, not a source.** No harvested document
states Azura World's own approval policy. They are labelled `[I]` in the module
and live in one place so a real policy replaces one constant. Inventing a
precise-looking figure and presenting it as researched is what SYSTEM-PROMPT §2.3
forbids.

Who holds what, read from `lib/rbac.ts` rather than restated:

| | `finance:create` | `finance:approve` | `finance:export` | `vendor_invoices:approve` |
|---|---|---|---|---|
| `admin` | yes | yes | yes | yes |
| `accountant` | yes | yes | yes | yes |
| `manager` | **no** | **no** | yes | yes |
| everyone else | no | no | no | no |

`manager` reviewing but not posting is deliberate and is `lib/rbac.ts`'s own
comment: a manager who could post makes the segregation of duties in CONTRACTS §3
decorative. It does mean the "accountant posts, manager approves" split in the
brief is **not** what the frozen matrix encodes — `accountant` holds both. The
matrix is frozen, so the code follows it; flagged below as a question for the
contract owner rather than resolved locally.

### Confirmation that no aggregate mixes currencies, and where that was checked

**`CurrencyTotals` has no method that returns one combined number.** Not a rule to
remember: there is nothing to call. The whole public surface is asserted in
`money.test.ts`, so adding a `total()` is a deliberate reviewed change and not an
accident:

```
add · constructor · currencies · forCurrency · isEmpty · lines ·
overflowedCurrencies · unreadable
```

Checked in five places, all with real output below:

1. **Type level** — every total on every page is a `CurrencyTotals`; the pages
   never hold a bare number to add.
2. **`money.test.ts`** — the surface assertion above, plus a rejection of
   `total`, `grandTotal`, `sum`, `valueOf`, `toNumber`, `combined`, `all`.
3. **`finance-scope-probe.mts`** — all nine `*ByCurrency` records the repository
   returns are asserted to be keyed by a real currency code, and the seed is
   asserted to hold **more than one** currency in posted entries (TRY + EUR), so
   "kept apart" is doing work rather than describing a single-currency dataset.
4. **Cross-check** — the page's own integer totals are compared against the
   repository's independently-computed ones, per currency: `EUR page 26000 vs
   repository 26000`, `TRY page -1250000 vs repository -1250000`.
5. **Browser** — 15 rendered totals, 0 without a currency label, across EUR, TRY
   and USD simultaneously on one screen.

The CSV carries the same rule into the file: currency is its own column, amounts
are plain decimals, and a comment row says *"Do not sum across currencies."*

**Where a conversion could have crept in and did not:** `lib/env.ts` ships
`fxDisplayRate()` for labelled, dated conversion. It is not imported anywhere in
`components/finance/**`. Ageing, thresholds and totals are all per currency
instead.

### Which finance writes return 503 in seed mode

**Every one of them, and also when Supabase *is* configured**, because
`authenticated` holds SELECT only on all four finance tables (migration 07
revokes INSERT/UPDATE/DELETE; the service-role RPCs are W1-A's and do not exist —
`HANDOFF/W2-A.md` records the same).

| Write | Seed mode | Supabase configured |
| ----- | --------- | ------------------- |
| `recordPayment` (payment console) | 503 `no_database` | 503 `no_write_path` |
| `reverseLedgerEntry` (W2-A) | simulates, stores nothing | `forbidden` 42501 |
| `settleVendorInvoice` (W2-A) | simulates, stores nothing | `forbidden` 42501 |

The two states are **kept apart deliberately**: "there is no database" and "the
database is there and the write path is missing" are different facts, and the
console renders different sentences for them. Neither claims success. Browser
evidence: *"Ohne Datenbank kann nichts gespeichert werden. Es wurde nichts
gebucht."*

**Reads serve badged seed data.** Every finance page renders a visible
`Beispieldaten` notice when any repository result is `local-seed`, and the CSV
carries the same signal in three places (filename, `X-Azura-Data-Source` header,
comment row) because a file outlives the page that produced it.

---

## 2. Verification actually run

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm --dir apps/web typecheck` | **PASS** exit 0 | `tsc --noEmit`, whole tree, no output |
| `pnpm --dir apps/web lint` | **PASS** exit 0 | `eslint`, 0 errors 0 warnings |
| `pnpm --dir apps/web build` | **PASS** exit 0 | all six new routes emit **ƒ (Dynamic)** |
| `pnpm qa:dashboard` | **PASS** — **647 pass · 0 fail** | 11 roles × 21 routes = 231 cells |
| `node scripts/csp-probe.mjs --port 3272` | **PASS** — **30 pass · 0 fail** | production build + `next start` + Chromium |
| `money.test.ts` (43 assertions) | **PASS** — **43 pass · 0 fail** | command below |
| `finance-scope-probe.mts` | **PASS** — **27 pass · 0 fail** | command below |
| Browser acceptance, 11 roles | **PASS** — **52 pass · 0 fail** | command below |

### The three harnesses, and where they live

They are in the **scratchpad, not in `scripts/`**, because `scripts/` is not this
task's to write (ORCHESTRATION §4). Commands and real output are here; adopting
them as gates is a request for W4-D (§5).

```bash
node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs \
     --test apps/web/components/finance/money.test.ts
```

```
# tests 43   # pass 43   # fail 0   # duration_ms 272.142
```

```bash
node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs \
     <scratchpad>/finance-scope-probe.mts
```

```
1. The non-vacuity control: owner A CAN see its own unit
  PASS  owner A sees entries for its own unit  — 2 entries, source=local-seed
  PASS  every entry returned really belongs to that unit  — 2 checked
2. The denial: owner A CANNOT see owner B's unit
  PASS  owner A sees NOTHING for owner B's unit  — 0 entries
  PASS  owner B's unit DOES have entries (so the zero above is authority)  — 2 entries visible to admin
  PASS  an UNFILTERED read still returns only owner A's units  — units: AZW-B01-0001
3. A child role is a strict SUBSET of its guardian, never wider
  PASS  child_owner sees a subset of owner's entries  — child 2 / guardian 2
  PASS  and it is not empty, so the subset claim is not vacuous  — 2 entries
  PASS  child_tenant reaches the tenant's unit and not the owner's  — units: AZW-B01-0003
4. Roles with no finance horizon see nothing at all
  PASS  guest sees no ledger, no wallet, no invoice  — 0/0/0
  PASS  child_guest sees no ledger, no wallet, no invoice  — 0/0/0
  PASS  an omitted role fails CLOSED  — 0 entries
5. A wallet holder reaches its own wallet and no other
  PASS  tenant reads its own wallet  — 1 wallets
  PASS  tenant CANNOT read the owner's wallet  — 0 wallets
  PASS  the owner's wallet exists (so the zero above is authority)  — 1 wallets visible to manager
6. No total anywhere mixes currencies
  PASS  postedSignedByCurrency is keyed by currency  — TRY, EUR
  … 8 more records, all keyed …
  PASS  the seed holds more than one currency in POSTED entries  — TRY, EUR
  PASS  page total for EUR equals the repository's  — page 26000 vs repository 26000
  PASS  page total for TRY equals the repository's  — page -1250000 vs repository -1250000

27 pass · 0 fail
```

```bash
node <scratchpad>/finance-acceptance.mjs --port 3273
```

Output in §3, item by item against the brief's Definition of Done.

**It runs against `next dev --webpack`, and that is forced, not lazy.** Switching
roles needs W1-B's QA access-profile cookie, and
`accessProfilesEnabledForEnvironment()` returns `false` for any production
runtime **before it reads a flag** — the security control working as designed.
W3-B recorded the identical constraint. Production behaviour is covered by
`qa:csp`, which drives a real `next start` (30/0). `--webpack` rather than
Turbopack because this worktree's `node_modules` is a junction to the main
checkout and Turbopack refuses a symlink leaving the project root.

---

## 3. The brief's Definition of Done, item by item

| # | Required | Result |
| - | -------- | ------ |
| 1 | Ledger with mixed EUR/USD → **separate totals** | **PASS** — EUR, TRY and USD as separate lines on one screen; 15 totals, 0 without a currency |
| 2 | Edit a posted entry → blocked in UI, 409/403 from API | **PARTIAL** — UI proven (9 disabled controls, 0 enabled on posted rows); the API half is **NOT RUN**, see §4 |
| 3 | Double-submit same idempotency key → posted once | **NOT PROVEN** — enforced by a DB unique index that no write can reach yet, see §4 |
| 4 | Concurrent posting → second gets 409 | **NOT PROVEN** — same reason, see §4 |
| 5 | `1.234,56` in a German field → stored as `1234.56` | **PASS** — round-trip proven in the test suite AND through the real server action in a browser |
| 6 | `owner` A requests `owner` B's statement → 403 + access event | **PASS** for the 403, **PARTIAL** for the event, see §4 |
| 7 | Overdraft without the flag → rejected by the database | **PARTIAL** — the rule is surfaced and the violation case is detected; the DB rejection is untestable without Supabase, see §4 |
| 8 | Supabase unconfigured → badged demo read, 503 write | **PASS** — both halves observed in the browser |
| 9 | Permission matrix, all 11 roles, every finance route | **PASS** — 647/0 in the decision probe, plus all 11 roles driven in a browser |
| 10 | Money formatting in all four locales | **PASS** — four distinct renderings of one stored value |

### Item 1 — mixed currencies

```
  PASS  /de/dashboard/finance renders for accountant  — status 200
  PASS  at least two currencies are shown as separate lines  — found EUR, TRY, USD
  PASS  the page says currencies are not added together  — German copy present
  PASS  no total is rendered without its currency  — 15 totals, 0 bare
  PASS  no exponential notation in any amount  — scanned full page text
  PASS  no negative zero rendered  — scanned full page text
```

### Item 2 — the immutability affordance

```
  PASS  posted rows render a disabled control  — 9 locked controls
  PASS  no posted row offers an ENABLED edit control  — 0 enabled controls on posted rows
  PASS  the explanation exists and is visible  — Gebuchte Positionen lassen sich nicht ändern Sobald eine Po…
  PASS  draft rows exist and are visually distinct from posted  — 2 draft rows
```

The control is `disabled` and **present**, not absent, and it carries
`aria-describedby` pointing at a visible panel above the table. Three states have
to be distinguishable — "you may do this", "this cannot be done to this row",
"you lack the permission" — and an absent control collapses the last two. The
reason is visible page text rather than a `title` tooltip, which is invisible to
touch and to screen readers.

### Item 5 — the German round trip, the bug the brief names

Both directions, in the test suite:

| typed (de) | result |
| ---------- | ------ |
| `1.234,56` | 123456 minor → `"1234.56"` → `1.234,56 €` |
| `1234,56` | identical to the above |
| `1 234,56` | 123456 (spaces are never content) |
| `1.234,56 €` · `€1.234,56` · `1.234,56 EUR` | 123456 |
| `1.234` | 123400 — valid German grouping |
| `1.23` | **rejected** `malformed_grouping` |
| `1234.56` | **rejected** `malformed_grouping` |
| `1234,567` | **rejected** `too_many_decimals` |
| `-1.234,56` · `−1.234,56` · `(1.234,56)` | -123456 |
| `,56` | 56 |

**The two rejections are the point.** `1234.56` in a German field is either
1234.56 typed from muscle memory or 123456 with a slipped separator, a 100x
difference, and guessing is how a wrong number gets posted. The field names the
expected format instead. Separators come from `Intl.formatToParts` per locale,
not from a hardcoded table, so an ICU change cannot silently break the field.

And through the real server action, in a browser:

```
  PASS  the payment console is offered to accountant  — 1 amount fields
  PASS  the amount field is not type=number  — type=text
  PASS  the server echoes what it read  — Format: 1.234,56 | Gelesen als 1.234,56 €.
  PASS  nothing was claimed to be saved (seed mode, 503 path)  — Ohne Datenbank kann nichts
        gespeichert werden. Es wurde nichts gebucht.
  PASS  '1234.56' in a German field is REFUSED, not guessed  — Format: 1.234,56
```

`type="text"` with `inputMode="decimal"`, **not** `type="number"`: a number input
silently discards `1.234,56` in a German browser, so the user watches their own
keystrokes vanish with no message. Asserted, so nobody "tidies" it later.

The amount is parsed **on the server**, in the writer's locale. The client sends
raw text. A client-side parse would be a convenience; trusting one would mean the
number reaching the database is whatever the browser decided.

### Item 6 — owner isolation, and why the browser check alone is not evidence

```
  PASS  owner is REFUSED another owner's statement  — Kein Zugriff auf diesen Kontoauszug.
  PASS  the refusal leaks no ledger content  — no entry description or amount in the response
  PASS  the refusal is announced to assistive tech  — 2 alert regions
```

**That pass is vacuous on its own and is not reported as proof.**
`buildAccessProfileFor()` hands every QA role one synthetic `ACCESS_PROFILE_ID`,
and that id appears in no `unit_residents` fixture — so a browser-driven `owner`
holds **zero units** and refuses every statement. A role that can see nothing
trivially cannot see owner B.

The predicate is proved in `finance-scope-probe.mts` with the positive control
that makes the denial mean something: owner A **does** see 2 entries for
`AZW-B01-0001`; owner B's `AZW-B01-0002` returns **0 to owner A and 2 to admin**.
Same shape as W1-A's negative suite, and for the same reason.

Three independent boundaries have to fail before owner A reads owner B:

1. **RLS** — `finance_ledger_entries` admits a residency role only through
   `current_user_unit_ids()`. Covered by W1-A's `04-rls-negative.sql`, 77/77.
2. **The repository** — `financeScope()` mirrors that predicate in TypeScript,
   and is the **only** boundary in seed mode, where no RLS runs at all. This is
   what the scope probe exercises.
3. **The page** — the unit is checked against the rows the repository actually
   returned, before anything renders.

**Absent and forbidden are the same response** for a residency role.
Distinguishing them would leak whether `AZW-B01-0002` exists and has activity,
which is the disclosure the route guards. An internal reader (admin · manager ·
accountant) does get "no entries", because for them a unit's existence is not a
secret.

### Item 8 — seed badge and the export

```
  PASS  the page badges demo data  — Diese Seite zeigt Beispieldaten aus dem lokalen Datensatz, keine Live-Buchungen.
  PASS  CSV export returns 200 for accountant  — status 200
  PASS  the filename names the FILTER  — attachment; filename="azura-ledger_status-posted_demo-data_2026-07-28.csv"
  PASS  the filename names the data source  — …_demo-data_…
  PASS  the response declares its data source  — local-seed
  PASS  the CSV warns against summing across currencies
  PASS  the CSV holds only the filtered rows  — 8 data rows, all posted
  PASS  the currency is its own CSV column, amounts are plain decimals  — header row
  PASS  owner (finance:view, no finance:export) gets 403 on the export  — status 403
  PASS  the 403 body leaks no ledger content
```

An `owner` can read its own statement on screen and **cannot** pull a file. A
file leaves the building.

Every CSV cell is quoted and a leading `=`, `+`, `-` or `@` is prefixed with a
quote: vendor names come from a database a vendor can influence, and Excel
executes those as formulas.

### Item 9 — the matrix, in a browser, all 11 roles

```
  PASS  admin: finance=true wallet=true invoices=true            — matches rbac.ts
  PASS  manager: finance=true wallet=true invoices=true          — matches rbac.ts
  PASS  accountant: finance=true wallet=true invoices=true       — matches rbac.ts
  PASS  staff: finance=false wallet=true invoices=true           — matches rbac.ts
  PASS  owner: finance=true wallet=true invoices=false           — matches rbac.ts
  PASS  tenant: finance=false wallet=true invoices=false         — matches rbac.ts
  PASS  guest: finance=false wallet=false invoices=false         — matches rbac.ts
  PASS  service_provider: finance=false wallet=false invoices=true — matches rbac.ts
  PASS  child_owner: finance=false wallet=true invoices=false    — matches rbac.ts
  PASS  child_tenant: finance=false wallet=true invoices=false   — matches rbac.ts
  PASS  child_guest: finance=false wallet=false invoices=false   — matches rbac.ts
```

**This also closes W3-B's `[GAP]` on the end-to-end 403.** Its handoff says the
gap "closes by itself the moment any module ships a `page.tsx`" — these three
did, and the 403 is now observed in a browser for the seven roles that lack each
permission.

### Item 10 — four locales

```
     de: 9.110,00 €      en: €9,110.00      tr: €9.110,00      ru: 9 110,00 €
```

One stored value, four renderings. TRY renders as the code `TRY` rather than `₺`
in de-DE — there is no lira glyph in the German CLDR data, and the first version
of this assertion wrongly reported five correctly-labelled totals as "bare"
because it only accepted glyphs. The assertion was fixed, not the code.

---

## 4. What is NOT proven, and why

Four items on the brief's list cannot be demonstrated tonight. Each is blocked on
something outside this task's ownership, and none is papered over.

### `[GAP]` Items 2 (API half), 3 and 4 — idempotency and concurrency

The write path does not exist. `authenticated` holds SELECT only on all four
finance tables; migration 07 revokes the rest and expects service-role RPCs that
W1-A has not written. So there is no request that reaches an INSERT, and
therefore no second request to collide with it.

**What is built and would work the moment the RPC lands:**

- **Idempotency is a database constraint.**
  `ux_payment_transactions_idempotency` is a partial unique index on
  `(company_id, idempotency_key)` — migration 07, line 407. The key is minted
  **server-side per rendered form** and carried in a hidden field, so a
  double-clicked button and a resubmitted form arrive with the same key and
  Postgres collapses them. Deliberately **not** an in-process `Set`: that looks
  right in a single-window demo and fails the moment there are two instances,
  which is the failure mode that costs money rather than a test.
- **Optimistic concurrency** is `settleVendorInvoice`'s `.eq("version", …)`
  (W2-A), with `bump_vendor_invoices_version` making the guard real. Two clerks
  who both read version 4 cannot both win.
- **The 409 for a posted entry** is `prevent_posted_ledger_mutation` raising
  23514 on UPDATE and DELETE, for every role including the service key.

Everything upstream of the write **is** exercised and does refuse for real:
authentication, authorisation, German parsing, the approval threshold and the
over-payment guard. An `accountant` reaches the write path and is told the store
is missing; a `manager` is refused before the repository is consulted; the two
answers are observably different.

### `[GAP]` Item 6 — the access event is logged but not persisted

`logDeniedFinanceAccess()` emits one structured JSON line to the server log and
records `persisted: false` with the reason inside the record itself. It does not
write `access_events`, because there is no write path (same revocation as above)
and reaching one would need a service-role client inside a request path — which
bypasses RLS from exactly where it must not be bypassed. That is not a trade
worth making for a log line.

**The refusal does not depend on the logging.** The 403 is unconditional; the log
is a side effect. That is the property that actually protects owner B.

### `[GAP]` Item 7 — the overdraft rejection is not exercised

`wallets_no_unflagged_overdraft`, `wallets_overdraft_limit_requires_flag` and
`wallets_overdraft_within_limit` are CHECK constraints (migration 07). Provoking
one needs a write, and there is none. W1-A's `05-finance-invariants.sql` covers
them at 25/25 against the live database.

What this task adds is the surfacing, observed in a browser:

```
  PASS  a negative balance is shown with its overdraft permission  — …EUR -180,00€…  Erlaubt bis…
  PASS  the rule that the database enforces is stated  — overdraft description present
```

A balance below zero **with** the flag is legal and is styled as ordinary, not as
an alarm. A balance below zero **without** the flag would mean a CHECK was
bypassed; that case is computed rather than assumed impossible, and renders as a
conflict with an explanation. No such row exists today, and the panel says so
rather than showing an empty warning box.

### `[GAP]` The payment console loses its input after a submit

React 19 resets an uncontrolled form once a form action resolves. Observed and
asserted rather than assumed:

```
  PASS  React resets the form after a submit (observed, not assumed)  — allocation is "" after submit
```

So a clerk who types a large amount and gets "needs approval" retypes it. Not a
correctness defect and not named in the brief, but it will annoy the first person
who uses this for real. **The fix:** return the submitted raw values in
`PaymentPostState` and feed them back as `defaultValue`, or make the four fields
controlled. Roughly twenty lines; left undone deliberately rather than rushed
into a money form at the end of a night.

### `[GAP]` Not done

- **No screen-reader pass.** Semantics are correct by construction —
  `role="alert"` on every refusal, `aria-describedby` from each locked control to
  a visible explanation, `<caption>` on every table, `aria-current` on active
  filters — but nothing was driven with NVDA or VoiceOver.
- **No `pnpm qa:layout` / `qa:perf`.** Those scripts are W4-B's and did not exist
  in this worktree at the time of writing.
- **Summary panels read one 500-row page.** W2-A's `getFinanceSummary` aggregates
  in TypeScript over one page because PostgREST cannot `GROUP BY`, and reports
  `truncated` rather than a confident wrong number. Beyond 500 rows in scope the
  totals under-count and say so. An exact aggregate at volume needs a SQL view
  or RPC — W2-A already recorded this as a request for W1-A.

---

## 5. Requests for other windows

| File | Owner | What is needed |
| ---- | ----- | -------------- |
| `apps/web/app/sections/hero.tsx`, `evidence-band.tsx`, `chrome.tsx` | **W3-A** | **`RangeError: Incorrect locale information provided`** from `new Intl.DateTimeFormat(locale, …)` and `new Intl.NumberFormat(locale)`, thrown repeatedly during the dev run. Files are **byte-identical to `main`**, so this is pre-existing and not introduced here. The likely cause is `locale` arriving as `""` on some path (`new Intl.DateTimeFormat("")` throws; `undefined` does not). `lib/format.ts` already owns the app-locale → BCP-47 mapping — `intlLocale(locale)` rather than the raw string would fix it and remove three hand-rolled formatters. |
| `scripts/` + `package.json` | **W4-D** | Three harnesses are in the scratchpad because `scripts/` is not this task's to write. Worth adopting as gates: `money.test.ts` (43 assertions, the German round trip and the cross-currency surface lock), `finance-scope-probe.mts` (27, owner isolation with non-vacuity controls), `finance-acceptance.mjs` (52, browser, 11 roles). All three are self-contained and exit non-zero on failure. |
| `supabase/migrations/*` | **W1-A** | The service-role RPCs for `payment_transactions` INSERT and `finance_ledger_entries` INSERT. Until they exist, items 2–4 of this brief's Definition of Done cannot be demonstrated by anyone. The client side is written and waiting: the idempotency key is minted and carried, and the action's `duplicate` branch needs only the 23505 mapping. |
| `CONTRACTS.md` §3 / `lib/rbac.ts` | **contract owner** | The brief says *"`accountant` posts; `manager`/`admin` approve above a threshold"*, but the frozen matrix gives `accountant` **both** `finance:create` and `finance:approve`, and `manager` **neither**. The code follows the matrix, so today an `accountant` self-approves above the threshold. Not amended locally — four windows compile against that file. Either the brief or the matrix is wrong and someone with the authority should say which. |
| `apps/web/lib/finance-repository.ts` | **W2-A** | Consider re-exporting the enum ARRAYS (`ledgerEntryStatuses`, `vendorInvoiceStatuses`, `walletKinds`, …) alongside the types. The types and `currencyCodes` are re-exported but the arrays are not, so three files here import them from `@/lib/finance-data` — reaching past the repository into its data module, which is not the seam the repository intends. |
| `supabase/seed.sql` | **W1-A** | `lib/finance-data.ts` has rich fixtures (11 ledger entries across EUR/USD/TRY, 6 invoices, 5 wallets, 6 payments) but `seed.sql` still inserts **zero** finance rows. So these three pages are full in seed mode and empty against a locally-seeded database — the divergence W2-A's own bug #1 was about. The fixtures already exist in TypeScript; they need a SQL twin. |

---

## 6. Files written

```
apps/web/components/finance/
  money.ts                  the branded integer, German parsing, CurrencyTotals
  money.test.ts             43 assertions
  currency-total-list.tsx   per-currency rendering, the "no combined row" surface
  ledger-analysis.ts        balance check, debtors, reconciliation, duplicates, ageing
  ledger-table.tsx          the ledger, the disabled control, the visible reason
  finance-scope.ts          server-only scope resolution + denial logging
  approval-threshold.ts     per-currency thresholds
  payment-console.tsx       the one client component
  access-refused.tsx        the shared 403 panel
  finance-csv.ts            export, filter-in-filename, formula-injection guard

apps/web/app/[locale]/dashboard/
  finance/page.tsx · finance/actions.ts · finance/export/route.ts
  finance/statement/[unitId]/page.tsx
  wallet/page.tsx
  vendor-invoices/page.tsx · vendor-invoices/export/route.ts

apps/web/messages/{de,en,tr,ru}.json   +228 keys each, identical key sets
apps/web/lib/dashboard-routing.ts      three `pending` flags deleted (W3-B's contract)
HANDOFF/W3-D.md
```

Nothing outside that list was modified. `git status` was clean of foreign paths at
both commits.

**On the message catalogue.** All 228 keys sit inside `dashboard.finance.*`,
`dashboard.payments.*`, `dashboard.wallet.*` and `dashboard.vendorInvoices.*` as
contiguous blocks at the same position in all four files, per OVERNIGHT-2 §2. The
merge script refuses to write an em dash into any user-visible string and asserts
that all four locales gain the identical key set before it writes. Four stale
labels were **removed** — `vendorInvoices.status.{submitted,approved,rejected}`
and `payments.status.settled` name states the SQL enums cannot produce, so they
were four strings for translators to maintain that no user could ever see.

---

## 7. Three defects found by running, not by reading

Recorded because each passed a gate that a reasonable person would expect to
catch it.

1. **Functions passed from a Server Component to a Client Component.** The
   payment console's labels were closures (`exceedsInvoice: (r) => t(…)`). `tsc`
   passed. `next build` passed. The first page load returned **500**: *"Functions
   cannot be passed directly to Client Components."* Labels are now raw templates
   with `{placeholder}`s that the client substitutes, so the text stays
   translator-owned.

2. **A synchronous export in a `"use server"` file.** `approvalThresholdFor` sat
   beside the action. `tsc` passed; `next build` failed with *"Server Actions must
   be async functions"* — Next turns every export in such a file into a callable
   endpoint. Moved to its own module.

3. **A missing section heading.** The vendor-invoice totals rendered as three
   labelled cards with nothing above them, in the one section where "per
   currency" has to be said out loud. Found because the acceptance harness looked
   for the heading and did not find it.

The first two are the argument for `next build` and a real page load being
separate gates from `typecheck`. The third is the argument for asserting on
rendered text rather than on component structure.
