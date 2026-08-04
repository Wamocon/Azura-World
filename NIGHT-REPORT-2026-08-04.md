# Overnight — 3/4 August 2026

Five commits on `main`. Everything below was verified in a browser against a
production build, signed in as the actual role — not inferred from a green
typecheck. Where a claim carries a number, the number was measured tonight.

The previous session's report is `NIGHT-REPORT.md` (29 July) and still stands.

Start the same build the checks ran against:

```bash
pnpm --dir apps/web build && pnpm --dir apps/web start
```

---

## 1. The chain the building runs on, joined end to end

`f102cfd`

The product had eight modules and no way to walk from one to the next. Measured
against the live database:

| link | rows linked |
| --- | --- |
| `workforce_tasks` → `service_tickets` | 26 of 26 |
| `payment_transactions` → `finance_ledger_entries` | 90 of 90 |
| `finance_ledger_entries` → `units` | 198 of 198 |
| `vendor_invoices` → `service_tickets` | **no such column** |

So *"what did that repair cost?"* — the question a building operator asks most
often — had no answer anywhere in the product, and the ticket page and the
invoice page had nothing to say to each other.

**Migration 25** adds `vendor_invoices.ticket_id`. Nullable, and staying
nullable: grounds, pool, cleaning, security and the lift service contract are
owed on a schedule whether or not anybody reports anything, so an invoice with
no job is the ordinary case. It renders as *"Not from a reported job"*, never as
an incomplete record.

What you can now do that you could not:

- open a ticket and see what it cost — invoice number, supplier, what is still
  owed
- **record an invoice from the ticket**, which posts to the existing
  `vendor_invoices` endpoint: same permission, same rate limit, same audit
  entry, no second write path to the same table
- open an invoice and click through to the job it billed
- do it in either direction with no database id in any URL

A `tenant` sees none of it. The section is absent, and the read never happens.

**Six seeded invoices now come from six resolved jobs**, of roughly twenty that
could have. Deliberately partial: a fixture where every closed ticket has an
invoice would teach the reader a rule the product does not have.

---

## 2. A unit page at all

`f102cfd`

656 apartments were a catalogue. There was no way to ask whether one had
anything open, owed anything, or had any paperwork — each of those lived on a
different page, filtered by nothing.

`/dashboard/units/AZW-B01-0003` answers all three, each behind its own
permission, each row linking onward. The URL is the apartment number because
that is the building's own designation, printed beside the door; wrapping it in
a cipher would hide nothing and make a link nobody could read or type.

Verified: a manager sees requests, account and documents; a tenant sees their
own and gets a **404 on a neighbour's**, not an empty page; `wp-admin` is a 404
from the route rather than a database round trip.

---

## 3. A resident's "Units" is their apartment

`420ef7e`

The worst finding of the audit. Across all eleven logins, a tenant's **largest**
page was the portal-price register at 12,608 characters and their **smallest**
was "Units" at 684 — the 656-unit sales inventory shrunk to a single cell, with
an availability legend, a provenance filter, and the sentence *"1 of the 1
apartments come from a real listing on a property portal"* about their own home.
Every control on it answers a question a seller asks.

The route now branches on the same predicate the inventory repository scopes by.
One holding redirects into it; several list them; staff and above are untouched.
The navigation calls it **"My apartment"** for the four roles it means that for.

Verified as six roles: tenant, owner and child_tenant land on an apartment with
no inventory furniture; staff, manager and guest still get the inventory.

---

## 4. The apartment and its statement know about each other

`5b53d6e`

Two pages about one flat with no way between them. The unit hub's Account
section linked to the company-wide ledger, where a reader had to find their own
row again; the statement knew exactly which apartment it was about and offered
no way to open it. Now both directions, with the apartment beside the back link
so the way out is where the way in already is.

Verified: apartment → its own statement → back to the apartment, 4 assertions.

---

## 5. The dashboard answers a click

`036679f`

There was **no `loading.tsx` anywhere in this application** — not one, for
twenty-four routes. Every dashboard route is dynamic by construction and each
does several scoped queries before it can render a character. Without a Suspense
fallback, Next holds the old page for all of that and then swaps it: clicking a
nav item produced no visible response whatsoever until the next page arrived
complete.

That is the difference between an application that feels considered and one that
feels dead, and it is not about speed — the same request with a skeleton in
front of it reads as fast.

- one skeleton on the dashboard segment, shaped like what every page beneath it
  shares. Twenty-four bespoke ones is twenty-four things to keep in step, and
  the one that drifts is worse than a generic shape
- an arrival: 200 ms, `--ease-out`, opacity and transform only, keyed by
  pathname so it replays per navigation rather than once per session
- reduced motion runs **nothing** — by not declaring the animation rather than
  by overriding it, which is the inversion `globals.css` already argues for

Measured: the server streams 17 skeletons and exactly one `aria-busy` region
ahead of a 456 kB finance response.

---

## Also fixed, found on the way

- **`seed:demo` could not write notifications at all.** Since migration 19 a
  locale-prefixed link fails a CHECK, and the seeder still wrote `/de/` into
  every one — it printed `FAIL notifications` and carried on, leaving six roles
  with a German notification list regardless of their language. Now seeds 37
  rows carrying the `payload.template` migration 20 introduced.
- **`Intl.NumberFormat` took a raw URL segment** in the evidence formatter, so
  every request for `/favicon.ico` or `/robots.txt` threw inside whichever
  landing section rendered a fact — hundreds in the dev log. The guard for
  exactly this already existed in `lib/format.ts`; this module was missed.
- **Settings showed a company uuid** under "Identifier". It now shows the
  company, legal name, country, currency, founding year and website.
- **Compliance showed a site uuid** in the Subject column, on every row.
- **Settings said notifications were "not possible yet"** long after they
  worked. It now names what is actually absent — delivery outside the app, and
  per-event choice — and links to where they arrive.
- **Documents said the same thing three times** to a role with none: the section
  count, the empty-state title and its body. A contractor's whole documents page
  was that fact in triplicate. Said once now, and it says what would fill it,
  which differs for a role that can upload.
- **`next dev` and `next build` shared `.next`.** Building while dev ran
  replaced the chunks under the running session and every open page died with
  `ChunkLoadError`, which reads exactly like a code defect and is not one. Dev
  now writes to `.next-dev`.
  **Still true:** `next start` shares `.next` with `next build`. Restart the
  server after a build.

---

## What I did not do, and why

- **`listings` is still in every resident's navigation.** It is the portal-price
  register — who advertises our apartments, at what, and is it current — and for
  a `tenant`, `guest` or `child_guest` it answers nothing they asked. Removing a
  permission changes what eleven accounts can reach, and I would rather you
  decided that than found it gone. Recommendation: keep it for `owner`, whose
  asset is the thing being advertised; drop it from the other three.
- **`vendor-invoices` for `staff`** renders 1,168 characters — a supplier-invoice
  page with almost nothing on it. Same question, same reason.
- **`communications` for `guest`, `service_provider` and the child accounts** is
  a working page with no conversations in it, because the fixture seeds threads
  only against the tenant's and owner's units. A seed gap, not a code gap — one
  block of scenario data once you say those roles should have conversations.

---

## Gates

| gate | result |
| --- | --- |
| `pnpm --dir apps/web typecheck` | clean |
| `pnpm --dir apps/web lint` | 0 errors, 5 warnings (all pre-existing `<img>`) |
| `pnpm --dir apps/web build` | clean |
| `node scripts/check-i18n.mjs` | 2530 keys × 4 languages, identical sets |
| `node scripts/seed-demo-operations.mjs` | 705 rows across 17/17 tables |
| `pnpm qa:ux` — 11 roles, 130 pages | 0 thin · 0 text defects · 0 client errors |

Browser probes, all against the production build, in the session scratchpad:

| probe | assertions |
| --- | --- |
| `chain-probe.mjs` — ticket ↔ invoice both ways, and the tenant boundary | 11 pass |
| `unit-hub-probe.mjs` — the unit page across roles, and its 404s | 10 pass |
| `units-route-probe.mjs` — one route, two products, six roles | 15 pass |
| `motion-probe.mjs` — streamed skeleton, entrance, reduced motion | 7 pass |
| `loop-probe.mjs` — apartment ↔ statement, both ways | 4 pass |

Two of those probes were wrong before they were right, and both corrections are
worth keeping:

- the first chain probe asserted that a closed ticket names an invoice. Six of
  forty-three do. It was asserting a rule the product deliberately does not have.
- the first motion probe clicked a link and counted skeletons. It reported 17 on
  a cold run and 0 on a warm one from identical code, because Next had
  prefetched the link and transitioned with no request at all. It now asserts on
  the streamed document, which cannot be prefetched away.
