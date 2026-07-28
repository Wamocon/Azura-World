# Security checklist for the next dashboard module

Ten items. Every one of them exists because something in this repository got it wrong, and the
finding id is given so you can read what happened rather than take the rule on trust. Written by
W4-C after reviewing waves 0–3; see `SECURITY-REVIEW.md`.

This is not a general checklist. It is the specific list for **this codebase**, for a window
building a surface under `app/[locale]/dashboard/`.

---

### 1. Assert your own permission, on the server, before you read anything

```ts
const profile = await getUserProfile()
if (!hasPermission(profile.role, "yourmodule:view")) forbidden()
```

`dashboard/layout.tsx` checks `dashboard:view` and nothing else. `DashboardRouteGuard` is a **client**
component; by the time it runs, whatever your Server Component rendered is already in the flight
payload and already on the user's machine. Nine of eleven roles hold `dashboard:view`.

→ **SEC-003.** A `tenant` retrieved the whole evidence cockpit with one `curl`, while the visible
DOM showed a correct 403. Probe check `SEC-D01` fails the build if your module's permission is
narrower than `dashboard:view` and you do not assert it.

### 2. Verify with `curl`, not with a screenshot

W3-C's evidence page passed a 100-assertion Chromium review. The review asserted on the rendered
page; the leak was in the payload beside it. For any surface with a permission:

```bash
curl -s -H "Cookie: access_profile_role=tenant" http://127.0.0.1:3200/de/dashboard/yours \
  | grep -c "<a string only your module renders>"
```

Expect `0`. A screenshot cannot see this class of defect and never will.

### 3. Do not import `@/lib/env` — or any server module — from a client component

One `import { isSupabaseConfigured } from "@/lib/env"` in a `"use client"` hook put the entire
server environment schema, including every server variable name, into a public chunk. Pass the
boolean down as a prop, or put it in a module that holds nothing else.

→ **SEC-010.** Probe check `SEC-C02`.

### 4. Every figure goes through `ProvenanceValue`, and check what the formatter does to it

A bare numeric literal in JSX is a defect (`azura-ui-ux` §6). But going through the component is not
sufficient: `format="number"` currently rounds `4.6` to `"5"` and `0.4` to `"0"`.

→ **SEC-005.** Until it is fixed, use `format="stars"` / `format="kilometres"` for anything
fractional, or pass your own formatting. Probe check `SEC-H01`.

### 5. A `gap` is "—", never `0`, never blank — and check the near-miss too

`0` and `—` mean different things and the difference is the product. Watch for the inverse as well:
a real `0.4` rendering as `"0"` puts a genuine value into the notation reserved for *no value*.

→ Probe check `SEC-H02`.

### 6. Read `result.source` and say so

Every repository function returns `source: "supabase" | "local-seed"`. An empty result from a
configured Supabase is `source: "supabase"` — that is a fact about the caller's permissions, not a
reason to substitute seed data. If your surface can render seed data, it must say that it is seed
data.

→ Probe check `SEC-H06`.

### 7. A modelled record must be distinguishable in the list, not only on the detail page

631 of 656 units are modelled. This is the honesty control for the entire product, and a table that
badges the detail view and not the row breaks it for every reader who only skims. Row tinting, not
a chip you have to open something to see.

### 8. Harvested text is hostile input on every path

Render it as a text child. No `dangerouslySetInnerHTML` — there is currently exactly one match in
the tree and it is a comment saying there are none. If your surface feeds harvested text into AI
retrieval context, that is a second injection path and W2-C's guardrails are what stand in it.

Harvested text also carries **personal data**. Three hotel staff are named in the committed dataset
today (**SEC-004**). If your surface renders review or listing free text, assume it contains a name
until someone has read it.

### 9. Do not add a currency conversion, an average, or a midpoint

Not to tidy a chart, not behind a toggle, not "just for the summary". No source in this dataset
publishes a rate or a rate date. `conflictRange()` returns `null` across currencies on purpose, and
`fxDisplayRate()` in `lib/env.ts` is a discriminated union that cannot yield a number without a date
— it has no callers and should keep having none until a source provides both.

→ **SEC-007** is what happens when the rule is broken once: the flagship finding's headline `2.1x`
is a USD ÷ EUR division, and it is now quoted in three places.

### 10. Run the probe before you write your handoff

```bash
AZURA_PROBE_BASE_URL=http://127.0.0.1:3200 \
node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs scripts/security-probe.mjs
```

Exit 0 = clean. Exit 1 = a Critical or High reproduces. Exit 2 = a gate could not run, which is not
a pass. If your module adds a check that belongs here, add it — the probe is meant to grow with the
surfaces, and a rule that is only written down is a rule the next window will not follow.
