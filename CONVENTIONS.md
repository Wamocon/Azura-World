# CONVENTIONS — stack, practice, edge cases

State of practice as of **July 2026**, pinned to what is already proven in the two reference
repos. Do not float versions; do not introduce a second way to do something that already has one.

---

## 1. Pinned versions

| Layer | Version | Why this one |
|---|---|---|
| Next.js | `16.2.6` | Matches 1Çatı. App Router + `proxy.ts` |
| React / ReactDOM | `19.2.4` | Matches 1Çatı |
| TypeScript | `^5` strict | `noUncheckedIndexedAccess` on — see §3 |
| Tailwind | `^4` + `@tailwindcss/postcss` | CSS-first. **No `tailwind.config.js`** |
| next-intl | `^4.13.0` | de·en·tr·ru |
| Supabase | `@supabase/ssr ^0.12.0`, `supabase-js ^2.108.2` | |
| Base UI | `@base-ui/react ^1.6.0` + `shadcn ^4.11.0` | 1Çatı's primitive layer |
| Framer Motion | `^12.40.0` | micro-interactions |
| GSAP | `^3.15.0` + `@gsap/react ^2.1.2` | ScrollTrigger, ScrambleText — free tier only |
| Lenis | `^1.3.25` | smooth scroll (from NLP repo) |
| three / R3F | `three ^0.185.1`, `@react-three/fiber ^9.6.1`, `drei ^10.7.7` | hero maquette only |
| Icons | `lucide-react ^1.21.0` | **only** icon library |
| Playwright | `@playwright/test ^1.61.0` | |
| Zod | `^4.4.3` | every API input boundary |
| pnpm / Node | `10.0.0` / `>= 20` | Corepack |

**Next.js 16 specifics:** `proxy.ts` replaces `middleware.ts` — do not create both.
`params` is a Promise: `const { locale } = await params`. Build with `next build --webpack`
(matches 1Çatı; Turbopack prod builds are not the validated path here).

**Tailwind v4:** tokens are CSS custom properties in `@theme inline` inside `globals.css`.
There is no JS config. Adding one breaks the build silently in dev and loudly in prod.

---

## 2. Architecture rules

**Supabase-first with labelled fallback.** Every repository:

```ts
export async function getX(): Promise<RepositoryResult<X>> {
  if (!isSupabaseConfigured()) {
    return { data: seedX(), source: "local-seed", fetchedAt: nowIso() }
  }
  const { data, error } = await client.from("x").select()
  if (error) throw toApiError(error)      // configured but failing ⟹ real error, not a fallback
  return { data: mapX(data), source: "supabase", fetchedAt: nowIso() }
}
```

The distinction matters: *unconfigured* falls back silently and labels itself; *configured but
broken* must surface. Collapsing the two hides outages behind plausible-looking seed data.

**Server Components by default.** `"use client"` only for state, effects, or browser APIs. A
client component that only renders props is a bundle-size bug.

**Data fetching lives in repositories**, not in components and not in route handlers. Route
handlers validate, authorise, call a repository, and map errors.

**RLS is the security boundary. RBAC is the UX boundary.** Never rely on hiding a nav item as
protection — assume the user types the URL. Every route handler re-checks permission
server-side even when the UI already hid the entry point.

---

## 3. TypeScript

```jsonc
{
  "strict": true,
  "noUncheckedIndexedAccess": true,   // arr[0] is T | undefined — handle it
  "exactOptionalPropertyTypes": true,
  "noImplicitOverride": true,
  "verbatimModuleSyntax": true
}
```

- No `any` without a justifying comment on the line above.
- No `as` casts to satisfy `SourcedFact` — fix the shape.
- Public function signatures explicitly typed; inference is fine internally.
- Discriminated unions over optional-field soup (`ApiResponse` in CONTRACTS §5 is the model).
- `satisfies` for config objects so excess-property checking stays on.

---

## 4. Security checklist — per API route

Every route handler, in this order:

1. **Method + content-type** check
2. **Rate limit** (`lib/public-rate-limit.ts`) on anything unauthenticated
3. **Parse + validate** with Zod. Length ceilings on every string. Reject unknown keys.
4. **Authenticate** — `getUserProfile()`
5. **Authorise** — `hasPermission(role, "resource:action")`, server-side, always
6. **Execute** via a repository
7. **Map errors** to `ApiError`. Never let a Postgres message reach the client.
8. **Audit** anything that mutates, into `audit_events`

Additional standing rules:

- Service-role client is server-only. Importing it into anything under `components/` is a fail.
- No user input concatenated into SQL. Parameterised or RPC, always.
- `dangerouslySetInnerHTML` is banned. Scraped competitor HTML is untrusted input — render text.
- CSP with no `unsafe-inline` for scripts. GSAP and R3F do not need it.
- Do not log PII or full request bodies. Log `requestId` and shape.
- Signed URLs for documents, short TTL. No public buckets.
- Idempotency keys on every public mutation (see 1Çatı migration `…0062`).

---

## 5. Edge cases every window must handle

**Data / provenance**
- A source that returns HTTP 200 with a bot wall or soft-404 body → `contentValidated: false`.
  *Validate the bytes, not the status line* — Ataberg shipped 51 of 154 "downloads" as 404 pages
  wearing a `.jpg` extension.
- Mixed currency (portals quote EUR and USD for the same unit) → never convert silently. Store
  `Money` with its currency; convert only at display, labelled, with the rate's date.
- A price with no observation date → `confidence: "single_source"` and a `Finding`; a stale price
  presented as current is the most damaging error this project can make.
- Turkish characters (`ı İ ş Ş ğ Ğ ç ö ü`) in slugs, filenames, and sort order. Use
  locale-aware `Intl.Collator("tr")`. `"I".toLowerCase()` is **not** `"ı"` in Turkish.
- German compounds overflow buttons — German copy runs ~30% longer than English.
- Russian Cyrillic needs a font subset that actually covers it.
- 656 units in one table → virtualise or paginate; never render 656 DOM rows.
- `null` vs `0`: a price of `0` is a bug; a price of `null` is an honest gap. Never coerce.

**Auth / RBAC**
- Session expires mid-form → preserve input, re-auth, resume. Do not discard typed data.
- A role with zero permitted resources must land on a coherent empty state, not a broken shell.
- Deep link to a forbidden route → 403 page, not a redirect loop.
- `child_*` roles inherit a *subset* — test that they cannot escalate via a guardian relation.

**UI**
- `prefers-reduced-motion` → GSAP timelines and R3F must degrade to static, not just "less".
- No WebGL (older devices, headless CI) → the 3D hero needs a poster fallback, not a blank box.
- RTL is **not** required (no Arabic/Hebrew locale) — do not build for it.
- Empty, loading, error, and partial states for every data surface. Four states, not one.
- Tap targets ≥ 24px. Ataberg's layout harness caught real violations under this.

**Runtime**
- Supabase Realtime disconnects → fall back to 30s polling and *show* the degraded state.
- Concurrent edits → optimistic concurrency with a version column; last-write-wins is a bug.
- Long-running report generation → job + poll, not a blocking request.

---

## 6. Naming

- Files `kebab-case.ts`; React components `PascalCase`; hooks `use-thing.ts` → `useThing`.
- Repositories `<domain>-repository.ts`; seed `<domain>-data.ts`.
- Migrations `000000000000NN_snake_case_description.sql`, sequential, **never renumbered**.
- i18n keys English, dotted, grouped by surface: `dashboard.units.filters.layout`.
- Unit ids `AZW-B{block:02}-{seq:04}`.
- Findings `F-001` upward, never reused.
- Branches `feature/INTERNAL-107-<slug>`; commits prefixed `INTERNAL-107`.

---

## 7. Accessibility & performance budgets

WCAG 2.2 AA. Semantic landmarks, one `<h1>` per page, visible focus, `aria-live` on async
regions, keyboard path through every workflow, contrast ≥ 4.5:1 in **both** themes.

| Budget | Target |
|---|---|
| LCP (throttled mobile) | ≤ 2.5s |
| CLS | ≤ 0.1 |
| INP | ≤ 200ms |
| JS on landing route | ≤ 250KB gzipped |
| Lighthouse a11y | ≥ 95 |

R3F is lazy-loaded behind an intersection observer and never blocks LCP.

---

## 8. Commands

```bash
# setup — W0-A only, never concurrently
corepack enable && corepack prepare pnpm@10.0.0 --activate && pnpm install

# dev
pnpm --dir apps/web dev            # 127.0.0.1:3200  (3100 is 1Çatı — do not collide)

# gates
pnpm --dir apps/web typecheck
pnpm --dir apps/web lint
pnpm --dir apps/web build
pnpm test:contract
pnpm db:test
pnpm --dir apps/web test:e2e -- --project=chromium
pnpm qa:layout && pnpm qa:evidence && pnpm qa:perf

# evidence
pnpm harvest        # Playwright-driven, writes sources/raw/
pnpm dataset        # raw → lib/azura-world-data.ts + supabase/imports/
```

**Windows:** set `PLAYWRIGHT_BROWSERS_PATH`, `TEMP`, `TMP` into `.tmp` before Playwright runs.
Capture exit codes explicitly — `cmd | tail` reports `tail`'s status, not the command's, and
that exact mistake is recorded in the reference project's `LESSONS-LEARNED.md`.
