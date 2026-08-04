# Repair plan — 53 findings from the 4 August audit

Six auditors produced 53 candidate findings; 26 survived three skeptics each and
27 lost their skeptics to a session limit, so those are **unadjudicated, not
cleared**. This plan treats all 53 and records what was measured for each.

Measured against the live database, 4 August:

| fact | value |
| --- | --- |
| `profiles` columns | no `version` — migration 15 was never applied |
| `profiles` grants (authenticated) | SELECT, UPDATE — no INSERT, no DELETE |
| `documents` grants (authenticated) | SELECT only |
| `storage.objects` | RLS on, **0 policies**, **0 rows** |
| `hotel_rooms` | 6 rows, all German names, **`source_url` null on every one** |
| `review_sources` | 3 rows, **2 distinct platforms** (tripadvisor twice, same 4.60) |
| `sources` | 56 total, 51 with a stored snapshot, 25 distinct hosts |
| conflicted `sourced_facts` | 13 |

---

## Wave 1 — The database (unblocks most of Wave 2)

Migration 26.

1. **`profiles.version`** — migration 15 declares it, the live database has never
   had it, and every user-administration write faults on 42703 before any check.
   Add the column, default 1, plus the same optimistic-concurrency trigger the
   other versioned tables use.
2. **`grant insert on documents`** — the INSERT policies
   (`documents_staff_insert`, `documents_manager_write`) already exist; migration
   21 lists `documents` among the tables whose grant was revoked and then never
   grants it. Postgres raises 42501 before a policy is evaluated.
3. **`storage.objects` policies** — RLS is on with zero policies, which denies
   everything. Two policies, scoped to the two buckets, keyed on the same
   `can_write_documents()` predicate the table policy uses.
4. **NOT granted: `profiles` INSERT and DELETE.** Those two API operations are
   removed instead — see Wave 2.6. The product's own governance copy says
   accounts are blocked, never deleted, and `audit_events.actor_profile_id`
   references `profiles`.

## Wave 2 — Controls that look alive and cannot work

| # | thing | fix |
| --- | --- | --- |
| 2.1 | Document upload form (5 roles) | unblocked by 1.2 + 1.3; verify a real upload |
| 2.2 | "Save role" / "Block account" | unblocked by 1.1; verify both |
| 2.3 | Evidence "Stored copy" — 19 links, all 404 | write `app/api/evidence/snapshot/[hash]/route.ts` |
| 2.4 | Calendar ICS URL — 404 for the correct token | the token *is* the authorisation; read with the service-role client, not `anon` |
| 2.5 | Public "Report damage" and "Request access" | declared write gaps — say so **above** the form, not after submit |
| 2.6 | `POST`/`DELETE /api/site-management/users` | remove from the manifest and the OpenAPI document; neither can work and DELETE contradicts stated policy |
| 2.7 | Finance ledger "Edit draft" | a `<span>` with no edit path anywhere — remove it |
| 2.8 | `createActivity` API with no interface | `activities` already has INSERT; wire the create form the page lacks |
| 2.9 | `vendorInvoice.settle` | verify against the restored grants; fix or state |

## Wave 3 — Truth. The claim this product exists to make

| # | thing | fix |
| --- | --- | --- |
| 3.1 | Hotel room mix — 6 invented types with sizes and occupancies, `source_url` null on all, under "What the sources state" | the table already records that nothing sourced it; stop presenting it as sourced |
| 3.2 | `/dashboard/hotel` shows `roomCount 188` and `aquaparkSlides 13` flat; both are `conflicted` and the **public** page renders them honestly | render the conflict on the dashboard too |
| 3.3 | **Mine.** `units/[ref]` renders a modelled price as "Price" with cents, discarding a note that forbids exactly that | render the modelled treatment the matrix already uses |
| 3.4 | Landing "56 SOURCES VERIFIED" is a hardcoded literal | derive it, and say what "verified" means |
| 3.5 | "…marked as sample data throughout the system" — no dashboard surface marks it | make the claim true, or narrow it to what is true |
| 3.6 | Landing shows 11 conflicted facts as settled values, beside a chart declaring 13 conflicts | give them the provenance affordance the rest of the page has |
| 3.7 | KPI "Review platforms 3" — 3 rows, 2 platforms, the third a duplicate score the product itself calls not a second opinion | count distinct platforms |
| 3.8 | "OPENED 2,025" — a year through the number formatter | `format="year"`, which exists and is used correctly on the landing |

## Wave 4 — Turkish is the primary language

| # | thing | fix |
| --- | --- | --- |
| 4.1 | 42/43 tickets, 198/198 ledger lines, 24/24 documents, 30/30 activities, 24/24 lead notes are **German** | rewrite the operational fixture in Turkish |
| 4.2 | Home subtitle and the access-denied page print the raw enum (`manager olarak görünümünüz`) | use `dashboard.users.roles.*`, which already exists in all four |
| 4.3 | Blocks render "Block 01"…"Block 07" in every locale | "Blok" is the Turkish word and the catalogue already has it |
| 4.4 | 404 and global-error are German-only under `lang="tr"`, recovery link hardcodes `/de` | four languages, and keep the reader's locale |
| 4.5 | Footer `Konu iletişim` — a calque of a mistranslation of "Objekt" | translate from the German sense, not through English |
| 4.6 | Lead "desired layout" prints `penthouse` / `villa` beside `1+1` | label them, and reconcile with the five plan types the inventory publishes |
| 4.7 | Russian home subtitle is ungrammatical | fix the phrasing |
| 4.8 | `check-plain-language` has no Turkish or Russian vocabulary | extend, or state the gap in the script |

## Wave 5 — Each role's product making sense

`listings` off `tenant`/`guest`/`child_tenant`/`child_guest` · `wallet:view`
corrected (held by three roles with no wallet, withheld from two that have one)
· `guest`/`child_guest` offered Activities and Calendar that RLS makes
permanently empty · Reports unavailable for six of the eight roles that get the
nav entry · `staff` vendor-invoices can hold no row and links to a page they
cannot open · accountant's wallet redacts every holder name on a page claiming
to show all balances · `service_provider`'s documents empty state addresses a
resident · `guest`/`child_guest`/`service_provider` messages empty with the
explanation that exists never firing · `child_owner` and `child_tenant`
indistinguishable · owner's home KPI permanently refuses · `/dashboard/admin`
reachable by no navigation entry for anybody · users page shows a "restricted
view" notice while displaying all eleven accounts.

## Wave 6 — What crosses the wire

Tenant and owner receive internal staff `profiles.id` uuids in the documents RSC
payload · `vendor_invoices.id` rendered as `<option value="invoice:<uuid>">` ·
finance and vendor-invoice CSV exports lead with raw primary keys · every list
ships row primary keys as React keys in the flight payload, on pages whose links
are deliberately opaque · the API forwards `metadata` and `idempotencyKey` that
its own spec says must never be forwarded.

## Wave 7 — Documents that lie about the tree

`CLAUDE.md` §5 and §7 are wrong on every row — the exact drift its own header
warns about · the OpenAPI document describes two user operations that cannot
work · `communications-repository.ts` says the staff-note boundary is
application-side when migration 22 moved it into RLS · the admin panel tells
administrators the storage bucket does not exist (it was created 3 August) ·
a failed payment blames a write path restored by migration 21.
