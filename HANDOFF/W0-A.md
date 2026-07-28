# HANDOFF — W0-A Repository scaffold, tooling, contracts

STATUS: COMPLETE
Completed: 2026-07-27
Commit: `4f592ab` on branch `main`

---

## What was built

- **`apps/web/lib/contracts.ts`** — `CONTRACTS.md` as compiling TypeScript. Every type from §1–§7,
  the `roles` / `resources` / `actions` `as const` arrays in document order, `roleLevel`,
  `locales` / `defaultLocale`, `CONTRACT_VERSION = 1`, plus the frozen `apiErrorStatus` map from
  §5. Runtime guards: `isSourcedFact`, `assertFactInvariants`, `displayValue`, `tierWins`, and a
  `FactInvariantError` carrying `path` + `invariant` (1–6). Zero imports, so it is safe in the
  server bundle, the client bundle, and under `node --experimental-strip-types`.
- **`apps/web/lib/env.ts`** — Zod-validated env access over **exactly the 36 variables in
  `.env.example`** (6 public, 30 server; machine-diffed, 0 missing / 0 extra). `publicEnv` is
  browser-safe; `serverEnv` is a Proxy that **throws** rather than returning `undefined` when read
  client-side. Validated at module load. Blank tolerated, malformed fatal.
- **`apps/web/proxy.ts`** — Next 16 proxy. next-intl routing for `de|en|tr|ru`, default `de`,
  `localePrefix: "always"`, matcher exactly `["/", "/(de|en|tr|ru)/:path*"]`. Emits a
  **per-request nonce CSP** with no `unsafe-inline` for scripts in production. Supabase session
  refresh and the route guard are `TODO(W1-B)` seams with final signatures.
- **`apps/web/app/{layout,not-found,global-error}.tsx`** — shell layout (no styling, no
  providers) plus two zero-dependency error surfaces that render when everything else has failed.
- **`apps/web/lib/utils.ts`** — `nowIso`, `assertNever`, `hostOf`, `isNonEmptyString`,
  `clampText`, `collatorFor`. Deliberately **no `cn()`** — W1-D owns `lib/cn.ts`.
- **Pinned toolchain** — root `package.json` / `pnpm-workspace.yaml` / `turbo.json` / `.nvmrc` /
  `.gitattributes`, `apps/web/{package.json,tsconfig.json,next.config.ts,postcss.config.mjs,eslint.config.mjs,.prettierrc}`.
  `next` and `react`/`react-dom` are exact, not caret. Dev port **3200**.
- **`scripts/setup-supabase.mjs`** — the bucket creator W0-ENV requested. Zero dependencies, both
  buckets private, size + MIME limits, idempotent, re-reads every bucket instead of trusting its
  own create response, refuses to silently privatise an existing public bucket.
- **`scripts/smoke-contracts.mts`** — proves `assertFactInvariants` rejects each of the six §1
  invariants and accepts well-formed facts.
- **`CLAUDE.md` + `AGENTS.md`** — written against the tree as it actually is, with a
  "last verified" date and an explicit code-wins-over-docs note.

---

## Verification actually run

Every command below was run from `D:\Azura World`, exit code captured explicitly into a variable
(never behind a pipe), with `NO_COLOR=1` so the pasted output carries no escape sequences.

| Command                                         | Result   | Evidence                                                    |
| ----------------------------------------------- | -------- | ----------------------------------------------------------- |
| `pnpm install`                                  | **PASS** | exit 0, `Done in 1m 24s`, `pnpm-lock.yaml` written (238 KB) |
| `pnpm --dir apps/web typecheck`                 | **PASS** | exit 0, no diagnostics                                      |
| `pnpm --dir apps/web lint --max-warnings 0`     | **PASS** | exit 0, 0 errors 0 warnings                                 |
| `pnpm --dir apps/web build`                     | **PASS** | exit 0, `Compiled successfully in 3.7s`                     |
| `pnpm --dir apps/web dev`                       | **PASS** | `Ready in 1329ms` on `http://127.0.0.1:3200`                |
| `node … scripts/smoke-contracts.mts`            | **PASS** | exit 0, **33 pass · 0 fail**                                |
| smoke test against a _sabotaged_ `contracts.ts` | **PASS** | exit 1, **28 pass · 5 fail** — the test can fail            |
| `node scripts/verify-supabase.mjs`              | **PASS** | exit 0, 25 pass · 0 fail · 3 warn                           |
| `node scripts/setup-supabase.mjs --dry-run`     | **PASS** | exit 0, 5 pass · 0 fail · 0 warn · 2 skip                   |
| `git log --oneline`                             | **PASS** | `4f592ab INTERNAL-107 W0-A: repository scaffold…`           |

### Gates

```
typecheck exit=0
lint      exit=0
build     exit=0
smoke     exit=0

--- typecheck ---
> azura-web@0.1.0 typecheck D:\Azura World\apps\web
> tsc --noEmit

--- lint ---
> azura-web@0.1.0 lint D:\Azura World\apps\web
> eslint "--max-warnings" "0"

--- build (tail) ---
  Creating an optimized production build ...
✓ Compiled successfully in 3.7s
  Running TypeScript ...
  Finished TypeScript in 7.6s ...
  Collecting page data using 2 workers ...
✓ Generating static pages using 2 workers (1/1) in 1561ms
  Finalizing page optimization ...
  Collecting build traces ...

Route (pages)
─ ○ /404

ƒ Proxy (Middleware)
```

`Route (pages) ─ ○ /404` is correct at this stage: there is no routable page until W3-A adds
`app/[locale]/page.tsx`. The proxy is registered (`ƒ Proxy (Middleware)`).

### `assertFactInvariants` rejects all six invariants

Required by the brief: _"a hand-written smoke test proving `assertFactInvariants` throws on each
of the six invariant violations… A validator that never rejects is not a validator."_

```
Azura World — contract invariant smoke test
Module under test: apps/web/lib/contracts.ts  (CONTRACTS.md §1, six invariants)

0. Contract version
  PASS  CONTRACT_VERSION is 1 — = 1

1. Rejection cases — assertFactInvariants MUST throw
  PASS  [inv 1] gap carrying a non-null value (an invented number) — FactInvariantError(invariant=1) cites "project.totalUnits"
  PASS  [inv 1] gap with an empty note (an unexplained absence) — FactInvariantError(invariant=1) cites "project.plotAreaSqm"
  PASS  [inv 2] conflicted with no conflictsWith — FactInvariantError(invariant=2) cites "project.residenceBlockCount"
  PASS  [inv 2] conflicted with an empty conflictsWith — FactInvariantError(invariant=2) cites "project.buildingCount"
  PASS  [inv 3] confirmed by two URLs on the SAME host (two pages is not two sources) — FactInvariantError(invariant=3) cites "hotel.roomCount"
  PASS  [inv 3] confirmed by a single source — FactInvariantError(invariant=3) cites "project.floorsPerBuilding"
  PASS  [inv 4] inferred with no note explaining the derivation — FactInvariantError(invariant=4) cites "project.buildingFootprintSqm"
  PASS  [inv 5] zero sources with confidence other than gap — FactInvariantError(invariant=5) cites "units[0].askingPrice"
  PASS  [inv 6] snapshotHash that does not resolve (a citation you cannot re-open) — FactInvariantError(invariant=6) cites "hotel.stars"
  PASS  [inv 6] snapshotHash that is not 64 hex characters — FactInvariantError(invariant=6) cites "hotel.floors"

2. Acceptance cases — assertFactInvariants MUST NOT throw
  PASS  well-formed official fact, one tier-1 source — accepted "project.developer" (confidence: official)
  PASS  well-formed confirmed fact, two DISTINCT hosts — accepted "project.totalUnits" (confidence: confirmed)
  PASS  well-formed gap — null value with a note — accepted "project.completionDate" (confidence: gap)
  PASS  well-formed conflicted fact with conflictsWith populated — accepted "project.residenceBlockCount" (confidence: conflicted)
  PASS  well-formed inferred fact with a note explaining the computation — accepted "project.buildingFootprintSqm" (confidence: inferred)
  PASS  single_source whose snapshotHash DOES resolve (inv 6, passing direction) — accepted "hotel.stars" (confidence: single_source)

3. displayValue — a gap never leaks a value
  PASS  displayValue(well-formed gap) is null — = null
  PASS  displayValue(malformed gap holding 656) is still null — = null
  PASS  displayValue(official) returns the value — = "Cebeci Group"

4. tierWins — lower tier wins, tie-break is documented
  PASS  tier 4 vs tier 1 → tier 1 — = Azura World (tier 1)
  PASS  tier 1 vs tier 4 → tier 1 (argument order irrelevant) — = Azura World (tier 1)
  PASS  tier 2 vs tier 4 → tier 2 — = Cebeci Group (tier 2)
  PASS  equal tier, TERRA_FRESHER newer → TERRA_FRESHER — = Terra (tier 4)
  PASS  equal tier, reversed → still TERRA_FRESHER (recency, not position) — = Terra (tier 4)
  PASS  equal tier and equal fetchedAt → first argument wins — = Seaside Alanya (tier 4)
  PASS  equal tier and equal fetchedAt, reversed → first argument wins — = Seaside Alanya (tier 4)
  PASS  tie-break is deterministic across calls — = Seaside Alanya (tier 4)

5. isSourcedFact — guards the boundary
  PASS  isSourcedFact(well-formed fact) — = true
  PASS  isSourcedFact(null) — = false
  PASS  isSourcedFact(bare number) — = false
  PASS  isSourcedFact({ value } only — no sources) — = false
  PASS  isSourcedFact({ confidence: "maybe" }) — not a Confidence — = false

Summary  33 pass · 0 fail

All six invariants reject; well-formed facts are accepted.
```

**A passing test suite proves nothing unless it can fail.** I copied `contracts.ts` into a
throwaway tree, disabled the distinct-host half of invariant 3, inverted `tierWins`, and made
`displayValue` leak a gap. The unmodified smoke test caught all three:

```
=== sabotaged run exit=1 ===
  FAIL  [inv 3] confirmed by two URLs on the SAME host (two pages is not two sources) — did NOT throw — this violation would reach a user
  FAIL  displayValue(malformed gap holding 656) — got 656, expected null
  FAIL  tier 4 vs tier 1 → tier 1 — got Seaside Alanya (tier 4), expected Azura World (tier 1)
  FAIL  tier 1 vs tier 4 → tier 1 (argument order irrelevant) — got Seaside Alanya (tier 4), expected Azura World (tier 1)
  FAIL  tier 2 vs tier 4 → tier 2 — got Terra (tier 4), expected Cebeci Group (tier 2)
Summary  28 pass · 5 fail
```

### Dev server binds 3200 and does not collide with 1Çatı

```
▲ Next.js 16.2.6 (Turbopack)
- Local:         http://127.0.0.1:3200
✓ Ready in 1329ms
```

```
=== GET / (expect 307 -> /de) ===
HTTP/1.1 307 Temporary Redirect
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()
content-security-policy: default-src 'self'; script-src 'self' 'nonce-ERQhT+IMmD40p78ej6RUWw==' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.supabase.co; font-src 'self' data:; media-src 'self' blob: https://*.supabase.co; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* https://*.supabase.co wss://*.supabase.co; worker-src 'self' blob:; manifest-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'
location: /de

=== nonce uniqueness (3 requests) ===
nonce-X9fUhGCVVPHWG1KvsfyaPA==
nonce-oekUvtk4RZn4xN2QLbJolg==
nonce-eiQzWZbWbA7opRwVd6BtDA==

=== /de body ===
Azura World Residence & Hotel 404 Diese Seite wurde nicht gefunden. This page could not be found. Zur Startseite · Back to start

=== 3100 (1Çatı) ===
3100 -> 307
```

**3200 and 3100 answered simultaneously**, from the same shell, seconds apart. No collision.
`/de` correctly renders our own `app/not-found.tsx` (German copy, root-layout title) with a 404,
because no route exists yet. A fresh nonce per request confirms the CSP is per-request, not
cached. `'unsafe-eval'`/`'unsafe-inline'` in `script-src` above is the **dev** branch (React
Refresh needs it); production emits `'self' 'nonce-…' 'strict-dynamic'`.

### Supabase environment (re-verified now that `pnpm install` provides `pg`)

W0-ENV left the direct-Postgres check as SKIP pending dependency install. It now runs:

```
  PASS  DB_URL port suitable for migrations — direct host on 5432 (IPv6-only — verified reachable)
  PASS  REST reachable with anon key — HTTP 404
  PASS  REST reachable with service-role key — HTTP 200
  PASS  Auth service responding — HTTP 200
  PASS  Storage service responding — 0 bucket(s)
  WARN  bucket "azura-documents" — missing — run scripts/setup-supabase.mjs
  WARN  bucket "azura-evidence" — missing — run scripts/setup-supabase.mjs
  PASS  Schema introspection — 0 table(s) exposed
  PASS  Database state — empty — ready for W1-A migrations
  PASS  Direct connection — PostgreSQL 17.6
  PASS  Extensions — pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp
  PASS  extension pgcrypto — installed
  WARN  extension pg_trgm — W1-A migration 00 will enable it

Summary  25 pass · 0 fail · 3 warn · 0 skip
```

### NOT RUN — stated as such, not as "should pass"

| Not run                                                                             | Why                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm setup:supabase` **without** `--dry-run`                                       | Creates two buckets in the live cloud project. That is an outward-facing change to the user's Supabase project and is not in W0-A's definition of done. Dry-run verified the script end to end against the live Storage API. **Awaiting an explicit go-ahead.** |
| `pnpm test:contract`, `qa:layout`, `qa:perf`, `quality:gate`, `db:test`, `test:e2e` | Their target scripts belong to W2-B / W4-B / W4-D / W1-A / W4-A and do not exist. Correct per the brief: "Scripts referencing files other windows own are expected to fail until those land. That is correct — do not stub them."                               |
| `pnpm --dir apps/web format` (prettier)                                             | Not a gate. `.prettierrc` points `tailwindStylesheet` at `app/globals.css`, which W1-D has not created; the plugin's behaviour with a missing stylesheet is unverified here.                                                                                    |
| Real-browser CSP evaluation, especially the production `'strict-dynamic'` path      | Headers were verified over HTTP; no browser has executed the page. W4-C / W5 should load a production build once. `[GAP]`                                                                                                                                       |
| `corepack enable`                                                                   | `EPERM: … C:\Program Files\nodejs\pnpx` — needs an elevated shell. `corepack prepare pnpm@10.0.0 --activate` succeeded and pinned pnpm to 10.0.0, which is sufficient.                                                                                          |

---

## Installed versions (`pnpm --dir apps/web list --depth=0`)

```
dependencies:
@base-ui/react 1.6.0        @gsap/react 2.1.2           @react-three/drei 10.7.7
@react-three/fiber 9.6.1    @supabase/ssr 0.12.3        @supabase/supabase-js 2.110.8
class-variance-authority 0.7.1   clsx 2.1.1             framer-motion 12.42.2
gsap 3.15.0                 lenis 1.3.25                lucide-react 1.27.0
next 16.2.6                 next-intl 4.13.4            next-themes 0.4.6
react 19.2.4                react-dom 19.2.4            shadcn 4.15.0
tailwind-merge 3.6.0        three 0.185.1               tw-animate-css 1.4.0
zod 4.4.3

devDependencies:
@playwright/test 1.62.0     @tailwindcss/postcss 4.3.3  @types/node 20.19.43
@types/react 19.2.17        @types/react-dom 19.2.3     @types/three 0.185.1
eslint 9.39.5               eslint-config-next 16.2.6   prettier 3.9.6
prettier-plugin-tailwindcss 0.8.1                       tailwindcss 4.3.3
typescript 5.9.3
```

Root: `turbo 2.10.7`, `pg 8.22.0`. Package manager `pnpm@10.0.0` (activated via corepack).
**`next 16.2.6` and `react`/`react-dom` 19.2.4 are pinned exactly**, no caret, per the brief.
Every row of CONVENTIONS §1 is satisfied; nothing floated.

---

## Contracts I consumed

All of `CONTRACTS.md` §1–§7, transcribed rather than interpreted. Two places did not translate
cleanly, and one of them needs a central decision.

### 1. `AzuraBlock` and `Amenity` are referenced but never defined — **needs an amendment**

`CONTRACTS.md` §2 types `AzuraWorldDataset.blocks: AzuraBlock[]` and `amenities: Amenity[]`.
Neither interface appears anywhere in the document.

I did **not** invent fields. Both are declared as `Record<string, unknown>`, tagged
**`CONTRACT-GAP-01`** and **`CONTRACT-GAP-02`** in `lib/contracts.ts` so they are greppable.

Consequence: a window can carry these values around, but cannot read `block.code` or
`amenity.name` without a cast — and casting around the contract is a review failure. **Before
W0-B emits blocks/amenities and before W2-A/W3-C read them, `CONTRACTS.md` must be amended
centrally and `CONTRACT_VERSION` bumped** (ORCHESTRATION §8). This is the single item from W0-A
that a later wave cannot route around.

I did not stop the wave for it, because two undefined types out of fifteen do not block the
other eleven windows, and blocking W0-A blocks everything. Flagging it here is the honest middle.

### 2. `Finding.resolvedTo: unknown | null`

That union reduces to exactly `unknown` in TypeScript (`null` is already assignable to
`unknown`). Written as `resolvedTo: unknown` with the documented meaning preserved in a comment.
Identical semantics; avoids a redundant-constituent lint error.

### 3. `roleLevel` differs from the 1Çatı reference — CONTRACTS.md wins

| Role               | CONTRACTS.md §3 (transcribed) | `Cati/apps/web/lib/rbac.ts` |
| ------------------ | ----------------------------- | --------------------------- |
| `guest`            | 5                             | 15                          |
| `service_provider` | 30                            | 25                          |
| `child_owner`      | 15                            | 7                           |
| `child_tenant`     | 8                             | 6                           |
| `child_guest`      | 3                             | 5                           |

**W1-A and W1-B: import `roleLevel` from `lib/contracts.ts`. Do not copy the 1Çatı numbers.**
Divergence here is a security hole that typechecks.

### 4. Invariant 6 is split, deliberately

"Every `snapshotHash` resolves to a real file under `sources/raw/`" cannot be checked from a
browser-safe, filesystem-free module. So:

- the **shape** of every hash (64 lower-case hex) is always enforced;
- **existence** is enforced only when the caller passes
  `assertFactInvariants(fact, path, { snapshotExists })`.

**W0-B's `verify-evidence.mjs` and W4-D's contract suite must supply a real fs-backed resolver**,
or invariant 6 is only half-enforced. The two-argument call site still compiles unchanged.

---

## The `proxy.ts` seams W1-B must fill

Both are marked `// TODO(W1-B):` with a full spec in the doc comment above them. The signatures
are final — build against them, and do not restructure the file.

```ts
async function refreshSupabaseSession(
  request: NextRequest,
  response: NextResponse,
): Promise<{ response: NextResponse; isAuthenticated: boolean }>;

function guardRoute(
  request: NextRequest,
  ctx: { locale: Locale; pathWithoutLocale: string; isAuthenticated: boolean },
): NextResponse | null;
```

Today they are no-ops that let the app run unauthenticated: nothing redirects. Points W1-B should
read in the seam comments before writing:

- `isSupabaseConfigured() === false` must **not** redirect anyone — that is the supported
  seed-fallback state (CONVENTIONS §2).
- A forbidden deep link yields a **403 page, not a redirect** (CONVENTIONS §5 — redirect loops).
- `accessProfilesEnabled()` is the only permitted relaxation, and it is already hard-`false` in
  any production build. Do not add a second bypass.
- Never import the service-role key here; the proxy bundle runs on every matched request.

---

## Decisions I made

**CSP is emitted per request from `proxy.ts`, not statically from `next.config.ts`.**
CONVENTIONS §4 requires a CSP with no `unsafe-inline` for scripts. That is only achievable with a
per-request nonce, which a static header cannot carry. `next.config.ts` therefore holds every
_other_ security header and deliberately omits `Content-Security-Policy`. **Adding a static CSP
header to `next.config.ts` would override the nonce and break every script tag in production.**

**`proxy.ts` does not match `/api/…`.** The brief specifies the matcher exactly
(`["/", "/(de|en|tr|ru)/:path*"]`); the 1Çatı reference also matches API paths for a central
origin check. W2-B must therefore do the origin check **inside each route handler**, next to the
Zod validation and the RBAC call — where it returns a typed `ApiError` rather than a bare 403 and
cannot be silently skipped by a matcher edit.

**`lib/utils.ts` deliberately has no `cn()`.** W1-D owns `lib/cn.ts` per ORCHESTRATION §4; two
`cn` implementations is exactly the duplicate-mechanism CONVENTIONS forbids. `utils.ts` holds
`nowIso`, `assertNever`, `hostOf`, `isNonEmptyString`, `clampText`, `collatorFor`.

**`DOCUMENT_STORAGE_MODE` accepts only `"supabase"`.** `.env.example` documents one value. A
subagent proposed also accepting `"demo"` (mirroring 1Çatı's `demo-object-store`); I rejected it
as invented — no Azura document says it. If a later window needs a second mode, amend
`.env.example` and `lib/env.ts` together in one change.

**An unfilled `.env.example` placeholder counts as _absent_, not as a fatal error.** A fresh
`cp .env.example .env.local` leaves `your-project-ref` / `:PASSWORD@` in the Supabase values.
Treating those as configured would make `isSupabaseConfigured()` lie and every query fail;
treating them as fatal would break the supported seed-fallback path the brief requires. They
normalise to `undefined`, so the app runs on seed data and reports the truth.

**`tierWins` tie-break.** Lower tier wins. Equal tier → the more recent `fetchedAt` wins. Equal
or unparseable `fetchedAt` → the first argument wins, so the function is a stable reducer. Both
rules are exercised by the smoke test.

**Committed on `main`, not a `feature/INTERNAL-107-*` branch.** CONVENTIONS §6 asks for a feature
branch, but all windows share **one working tree**; switching branches would move every other
window's files underneath them. Deviation recorded here rather than taken silently.

**Committed only W0-A-owned paths.** By the time I committed, another window had already run
`git init`, made the initial commit, and staged files belonging to W0-B and W0-D. I used
`git commit --only -- <paths>` so commit `4f592ab` contains only my files; everything else stays
staged or untracked for its owner (SYSTEM-PROMPT §4.2).

**Created the bare `supabase/` directory but nothing inside it.** The brief's skeleton lists
`supabase/`, while its read-only section says do not create _anything under_ `supabase/`. A
directory with no file in it satisfies both and is invisible to git.

---

## Requests for other windows

| File                                                                        | Owning task                  | What is needed                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/layout.tsx`                                                   | **W1-D**                     | Enable the one commented line `import "./globals.css"` at the marked `W1-D SEAM`. It is commented because importing a file that does not exist fails the build. Touch **only** that line.                                                                                                |
| `apps/web/next.config.ts`                                                   | **W1-C**                     | Enable the commented `createNextIntlPlugin("./i18n/request.ts")` seam and change the final export to `withNextIntl(nextConfig)`. Locale _routing_ is already live in `proxy.ts` and does not need the plugin; the plugin is only for `getRequestConfig`. Touch **only** the marked seam. |
| `apps/web/proxy.ts`                                                         | **W1-B**                     | Fill the two `TODO(W1-B)` seams above. Do not restructure the file.                                                                                                                                                                                                                      |
| `CONTRACTS.md`                                                              | **central / whoever amends** | Define `AzuraBlock` and `Amenity` (`CONTRACT-GAP-01`, `CONTRACT-GAP-02`) and bump `CONTRACT_VERSION`.                                                                                                                                                                                    |
| `scripts/verify-evidence.mjs`                                               | **W0-B**                     | Pass a real fs-backed `snapshotExists` into `assertFactInvariants`, or invariant 6 is only half-checked.                                                                                                                                                                                 |
| migrations `…0000` / `…0010`                                                | **W1-A**                     | `pgcrypto` present (keep the `if not exists` guard); **`pg_trgm` NOT installed** — must be created. Re-confirmed against the live database today.                                                                                                                                        |
| `apps/web/lib/rbac.ts` + role SQL                                           | **W1-B / W1-A**              | Import `roles` / `roleLevel` from `lib/contracts.ts`. Do not redeclare, and do not copy the 1Çatı numbers (table above).                                                                                                                                                                 |
| `.editorconfig`, `.githooks/`, `.github/`, `CONTRIBUTING.md`, `SECURITY.md` | **unowned**                  | These appeared in the tree during W0-A from another window. They are in nobody's ownership list in ORCHESTRATION §4. Someone should claim them — W4-D is the natural owner of `.github/workflows/`.                                                                                      |
| `scripts/azura_parsers/__pycache__/*.pyc`                                   | **W0-B**                     | A compiled Python artifact is currently tracked in git. It should be ignored, not committed.                                                                                                                                                                                             |
| `sources/.gitkeep`                                                          | **W0-B**                     | I created it as part of the skeleton before `sources/` had real content. Now redundant — delete or keep, your call; I did not touch it after `sources/*` became yours.                                                                                                                   |

---

## Known gaps

- **`[GAP]` The production CSP has never been evaluated by a browser.** Headers were verified over
  HTTP and the nonce is fresh per request, but `'strict-dynamic'` in a real production build is
  unverified. One manual load before W5 signs off.
- **`[GAP]` Storage buckets do not exist.** `setup-supabase.mjs` is written and dry-run-verified
  against the live project; it has not been run for real. Command, when authorised:
  `node scripts/setup-supabase.mjs`.
- **`[GAP]` pgTAP / Docker availability still unchecked.** W0-ENV flagged it; W0-A did not test it
  either. W1-A must report **NOT RUN** rather than infer a pass.
- **`[GAP]` The AI gateway endpoint has not been probed.** Credentials are present in `.env.local`;
  `isAiGatewayConfigured()` only checks presence. W2-C verifies reachability.
- **`[I]` `proxy.ts` folds next-intl's request-header override using Next's internal
  `x-middleware-override-headers` encoding.** Read out of Next 16.2.6's source and exercised at
  runtime, but it is not a documented public API. If a Next upgrade breaks W1-C's locale header,
  this is the first place to look. The documented alternative (`new NextRequest(request, …)`)
  re-wraps the request body and would break server-action POSTs, so it was rejected.
- **`next build` rewrote `apps/web/tsconfig.json`**, forcing `"jsx": "react-jsx"` and reformatting
  the file. Expected Next behaviour and it matches the 1Çatı reference; typecheck, lint and build
  were all re-run afterwards and stayed green. The file was renormalised to LF before committing.
- **`.env.example`'s `SUPABASE_DB_URL` comment was corrected**, not the variable. It recommended
  the session pooler while W0-ENV verified and chose the direct host. The comment now records
  both, the IPv6-only caveat, and that port 6543 is never acceptable. No variable was renamed and
  no value changed.
- **`apps/web/lib/env.ts` pulls `zod` into any client bundle that imports it.** Acceptable — zod
  is already required at every API boundary — but W4-B should watch the 250 KB landing-route
  budget once W3-A lands.
- **Ownership check is imperfect.** ORCHESTRATION §5's `git status --porcelain` cannot cleanly
  prove "nothing outside my ownership was modified" while three other windows write into the same
  tree concurrently. What I can state: every path in commit `4f592ab` is on my ownership list, and
  I verified afterwards that no W0-A-owned path is left dirty.
