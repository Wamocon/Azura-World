# HANDOFF — W1-B Auth, RBAC, Supabase clients

STATUS: COMPLETE
Completed: 2026-07-27
Window: 2 · Branch: `feature/INTERNAL-107-w1b-w2c-auth-ai` · Commit: `2f4615f`

---

## What was built

- **`apps/web/lib/rbac.ts`** — the permission matrix over the 21 frozen resources, with the
  additive-authority rule proved **at compile time**: each added role's list is declared
  `as const satisfies readonly ParentPermission[]`, so giving `child_owner` a permission `owner`
  lacks is a `tsc` error. `verifyAdditiveAuthority()` re-proves it at runtime.
- **`apps/web/lib/auth-resolution.ts`** _(new file, see Decisions)_ — every auth **decision** as a
  pure function: `resolveSupabaseProfile`, `buildAccessProfileFor`, `normalizeRoleList`,
  `ANONYMOUS_PROFILE`, `profileCan`, `profileScope`. No I/O, no `next/headers`, no `zod`.
- **`apps/web/lib/auth.ts`** — the **reads**: `getUserProfile()`, `isAccessProfileEnabled()`,
  `requireProfile()`, and a re-export of the resolution surface so `@/lib/auth` stays the single
  import path.
- **`apps/web/lib/access-profile-policy.ts`** — the triple gate, plus
  `assertAccessProfileSafety()` which **throws at module load** in a misconfigured production
  process, plus `resolveAccessProfileRole()` (cookie → env → `manager`).
- **`apps/web/lib/supabase/{client,server,middleware}.ts`** — browser (anon only), server
  (request-scoped + `createServiceRoleClient()`), and the proxy session-refresh helper.
- **`apps/web/app/api/access-profile/route.ts`** — GET/POST/DELETE for the QA role picker.
  **404 when disabled**, origin-checked, byte-bounded body, Zod-validated, `ApiResponse` envelope.
- **`apps/web/components/user-provider.tsx`** — client context `{ profile, role, can(), canAny(),
accessibleResources, hasAnyAccess, readOnly }`.
- **`apps/web/app/[locale]/login/actions.ts`** — `signIn` / `signOut` server actions with an
  open-redirect-safe `next` and locale-preserving destinations.
- **`apps/web/proxy.ts`** — both W0-A seams filled (exact lines below).
- **`scripts/rbac-probe.mts`** + **`scripts/{ts-resolve-hooks,register-ts-resolve}.mjs`** — the
  acceptance suite and the loader that lets plain Node import the app's TypeScript.

---

## Verification actually run

| Command                                                                                             | Result   | Evidence                                                                     |
| --------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| `pnpm --dir apps/web typecheck`                                                                     | **PASS** | `tsc --noEmit`, no output, `TYPECHECK_EXIT=0`                                |
| `pnpm --dir apps/web lint`                                                                          | **PASS** | `eslint`, no output, `LINT_EXIT=0` (0 errors, 0 warnings)                    |
| `node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs scripts/rbac-probe.mts` | **PASS** | `OK  157 pass · 0 fail`, `PROBE_EXIT=0`                                      |
| SQL enum diff vs `lib/rbac.ts`                                                                      | **PASS** | `supabase/migrations/…0001_rbac.sql:30-42` — identical list, identical order |
| SQL `role_level()` diff vs `roleLevel`                                                              | **PASS** | `…0001_rbac.sql:74-86` — all 11 values identical                             |
| SQL `guardian_role_for()` vs `additiveParent`                                                       | **PASS** | `…0001_rbac.sql:120-125` — identical for all three `child_*`                 |
| `git status --porcelain`                                                                            | **PASS** | only my 14 paths staged; see the commit's `--name-status`                    |

| `pnpm --dir apps/web build` | **PASS** _(re-run at 20:05, see below)_ | exit 0; `/api/access-profile` and `ƒ Proxy (Middleware)` both in the route table |

`build` was deliberately not run at commit time — three other windows were mid-write in the shared
tree and the result would have described their work, not this task's. It was re-run once the tree
settled and passes; the route table confirms this task's route and proxy seams actually compile
into the production output rather than only typechecking.

**NOT RUN**, with reasons:

- `pnpm --dir apps/web test:e2e` — no `playwright.config.ts` yet (W4-A).
- `safeNextPath()` is **not covered by the probe.** It lives in a `"use server"` module that
  imports `next/navigation` and `@/lib/supabase/server`, so plain Node cannot load it. Its logic
  is deliberately small and total; if W4-A or W4-C wants it proved, the cheapest route is an e2e
  case hitting `/de/login?next=https://evil.example`.

### Probe coverage against the brief's eight required tests

| #   | Required                                                   | Where                             | Result                                           |
| --- | ---------------------------------------------------------- | --------------------------------- | ------------------------------------------------ |
| 1   | All 11 roles, in CONTRACTS §3 order                        | `[DoD 1]`                         | PASS (5 assertions)                              |
| 2   | `roleLevel` strictly ordered                               | `[DoD 2]`                         | PASS (13 assertions)                             |
| 3   | Subset proof, every added role ⊆ parent                    | `[DoD 3]`                         | PASS (13 assertions + a non-vacuity control)     |
| 4   | `admin` has everything; `guest` writes nothing             | `[DoD 4]`, `[DoD 4b]`             | PASS (20 assertions)                             |
| 5   | Malformed permission string rejected                       | `[DoD 5]`                         | PASS (27 assertions)                             |
| 6   | Production + flag + no escape hatch → **throws**           | `[DoD 6]`, `[DoD 6b]`, `[DoD 6c]` | PASS (17 assertions, incl. a real child process) |
| 7   | No Supabase → local profile; unknown cookie → `manager`    | `[DoD 7]`                         | PASS (13 assertions)                             |
| 8   | Authenticated, no `profiles` row → `tenant`, never `admin` | `[DoD 8]`, `[DoD 8b]`             | PASS (20 assertions)                             |

Every fail-closed case is paired with a **positive control** — `control: a valid admin row
resolves to admin`, `control: tenant ⊄ guest`, `control: the same import succeeds in
development`. Without those, a resolver that returned `"tenant"` for everything would pass test 8
while being completely broken. The suite also fails itself if it drops below 120 assertions.

---

## The permission matrix

`V`iew · `C`reate · `U`pdate · `D`elete · `M`anage · e`X`port · `A`pprove · a`S`sign · `·` = none.

| Resource        | admin   | manager | accountant | staff | owner | tenant | guest | service_provider | child_owner | child_tenant | child_guest |
| --------------- | ------- | ------- | ---------- | ----- | ----- | ------ | ----- | ---------------- | ----------- | ------------ | ----------- |
| dashboard       | **all** | V       | V          | V     | V     | V      | V     | V                | V           | V            | V           |
| listings        | **all** | VCUDXAS | ·          | V     | V     | V      | V     | ·                | ·           | ·            | ·           |
| units           | **all** | VCUDXS  | V          | V     | V     | V      | V     | V                | V           | V            | V           |
| leads           | **all** | VCUDXS  | ·          | ·     | ·     | ·      | ·     | ·                | ·           | ·            | ·           |
| buyer_pipeline  | **all** | VCUDXS  | ·          | ·     | ·     | ·      | ·     | ·                | ·           | ·            | ·           |
| deals           | **all** | VCUDXA  | VX         | ·     | ·     | ·      | ·     | ·                | ·           | ·            | ·           |
| tickets         | **all** | VCUDAS  | V          | VCU   | VCA   | VC     | ·     | VU               | ·           | ·            | ·           |
| activities      | **all** | VCUDX   | ·          | VCU   | VC    | VC     | V     | VC               | VC          | VC           | V           |
| calendar        | **all** | VCUDA   | ·          | VCU   | VC    | VC     | V     | V                | V           | V            | V           |
| documents       | **all** | VCUDX   | VCUX       | VC    | VC    | V      | ·     | V                | ·           | ·            | ·           |
| compliance      | **all** | VUXA    | VX         | ·     | ·     | ·      | ·     | ·                | ·           | ·            | ·           |
| finance         | **all** | VX      | VCUXA      | ·     | V     | ·      | ·     | ·                | ·           | ·            | ·           |
| wallet          | **all** | V       | VCUXA      | V     | VC    | V      | ·     | ·                | V           | V            | ·           |
| vendor_invoices | **all** | VA      | VCUXA      | VC    | ·     | ·      | ·     | VC               | ·           | ·            | ·           |
| reports         | **all** | VCX     | VCX        | V     | V     | V      | ·     | ·                | V           | V            | ·           |
| users           | **all** | V       | ·          | ·     | ·     | ·      | ·     | ·                | ·           | ·            | ·           |
| settings        | **all** | V       | ·          | ·     | ·     | ·      | ·     | ·                | ·           | ·            | ·           |
| communications  | **all** | VCUD    | VC         | VC    | VC    | VC     | V     | VC               | V           | V            | V           |
| hotel           | **all** | VCUX    | V          | V     | V     | V      | V     | ·                | V           | V            | V           |
| reviews         | **all** | VCUX    | ·          | V     | V     | V      | V     | ·                | V           | V            | V           |
| evidence        | **all** | VX      | ·          | ·     | ·     | ·      | ·     | ·                | ·           | ·            | ·           |

| Role               | Level | Scope       | Permissions | Resources | Additive parent |
| ------------------ | ----- | ----------- | ----------- | --------- | --------------- |
| `admin`            | 90    | company     | 168         | 21        | —               |
| `manager`          | 70    | site        | 81          | 21        | —               |
| `accountant`       | 60    | finance     | 32          | 12        | —               |
| `staff`            | 40    | field       | 22          | 13        | —               |
| `owner`            | 20    | owned_unit  | 20          | 13        | —               |
| `tenant`           | 10    | rented_unit | 16          | 12        | —               |
| `guest`            | 5     | public      | 8           | 8         | `tenant`        |
| `service_provider` | 30    | field       | 12          | 8         | `staff`         |
| `child_owner`      | 15    | owned_unit  | 10          | 9         | `owner`         |
| `child_tenant`     | 8     | rented_unit | 10          | 9         | `tenant`        |
| `child_guest`      | 3     | public      | 7           | 7         | `guest`         |

_*Reading it for a W3-* surface:_* call `hasPermission(role, "units:view")`, never
`role === "manager" || role === "admin"` (CONTRACTS §8). Server-side, always, even when the UI
already hid the entry point.

Three cells that will be asked about:

- **`evidence`** is `manager`+ for `view` and `admin`-only for `manage`, exactly as CONTRACTS §3
  requires. `accountant` is level 60, below manager's 70, so it has **no** evidence access. The
  probe asserts `isManagerOrAbove(role) === hasPermission(role, "evidence:view")` for all eleven.
- **`manager` cannot post finance entries** (`finance:view` + `finance:export` only). Posting is
  `accountant`'s. Segregation of duties, mirroring the 1Çatı role definitions.
- **`staff` holds `vendor_invoices:view`/`:create`** so `service_provider ⊆ staff` holds. Internal
  staff raise and check invoices for work they coordinate; the vendor sees the same verbs on a
  strictly narrower row set, which is RLS's job, not RBAC's.

---

## Role-list agreement with W1-A — **verified, not assumed**

`HANDOFF/W1-A.md` did not exist when this was written, so the migrations themselves were diffed:

| Thing             | `apps/web/lib/rbac.ts` / `lib/contracts.ts` | `supabase/migrations/…0001_rbac.sql`   | Match                 |
| ----------------- | ------------------------------------------- | -------------------------------------- | --------------------- |
| Role list + order | `roles` (contracts.ts:266-278)              | `create type public.app_role` (L30-42) | **identical**         |
| `roleLevel`       | contracts.ts:337-349                        | `role_level()` (L74-86)                | **identical**, all 11 |
| Guardian mapping  | `additiveParent` child rows                 | `guardian_role_for()` (L120-125)       | **identical**         |

Both sides also independently rejected the 1Çatı reference's different level values
(`service_provider 25, guest 15, child_owner 7, …`) in favour of CONTRACTS §3. That is the
agreement the brief asks for, and it is not a BLOCKED handoff.

**One divergence, non-blocking, recorded below under "Requests for other windows":**
`roleScope()` (TS) and `public.role_scope()` (SQL) return different labels for four roles.

---

## Exactly which lines of `proxy.ts` I touched

`apps/web/proxy.ts` is W0-A's file. Diff against `0f892fb`: **79 insertions, 15 deletions**, all
inside the two marked seams plus one import block. Nothing was restructured; the proxy's
composition order, CSP, nonce handling, header absorption and matcher are byte-identical.

| Region (new line numbers) | Change                                                                                                                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22-27                     | **Added** two imports: `accessProfilesEnabledForEnvironment` and `updateSession`. Both modules are proxy-runtime safe — neither reaches `next/headers`, neither can build a service-role client. `lib/auth.ts` is deliberately _not_ imported for that reason. |
| 134, 138                  | Section headers `— TODO(W1-B)` → `— filled by W1-B`. Comment text only.                                                                                                                                                                                        |
| 158-176                   | `refreshSupabaseSession` doc + body. The body is one line: `return updateSession(request, response)`.                                                                                                                                                          |
| 180-188                   | New `PROTECTED_PREFIXES` constant, inside section 3.                                                                                                                                                                                                           |
| 209-264                   | `guardRoute` doc + body.                                                                                                                                                                                                                                       |

No other line of the file changed.

**Two deviations from W0-A's seam notes, both documented in the file itself:**

1. The relaxation gate is `accessProfilesEnabledForEnvironment()` from
   `lib/access-profile-policy.ts`, **not** `accessProfilesEnabled()` from `lib/env.ts`. The W1-B
   brief §3 defines the gate as `!isSupabaseConfigured() || (all three flags)`; `lib/env.ts`
   implements only the second clause. With the first clause missing, an unconfigured deployment
   redirects every `/dashboard/*` request to a login page that cannot authenticate anyone —
   the app is unusable without a database, which CONVENTIONS §2 requires to work. The two
   functions agree exactly in production (both hard `false`), and the policy module additionally
   _throws at module load_ if a production process is configured otherwise. This is not a second
   bypass; it is the same one, specified completely.
2. The **403-not-redirect** rule for a forbidden route is not enforced in the proxy. This seam
   knows only whether a session exists, not which role it carries — resolving the role needs
   `cookies()` and a `profiles` read, neither available in the proxy runtime. Per-role 403s belong
   in the route segments and handlers, where the profile _is_ resolvable. What the seam does
   guarantee is the property that rule protects: an authenticated user is never redirected to
   login, so the loop cannot form.

---

## How the production access-profile guard is enforced, and how I proved it fires

Three layers, in `apps/web/lib/access-profile-policy.ts`:

1. **Runtime gate** — `accessProfilesEnabledForEnvironment()` returns `false` for any production
   runtime (`NODE_ENV`) _or_ production deployment (`VERCEL_ENV`, `AZURA_ENV`) **before it reads a
   single flag**. Below production: Supabase unconfigured ⟹ enabled (the supported seed-fallback
   mode); Supabase configured ⟹ all three of `ENABLE_ACCESS_PROFILES`,
   `AZURA_ALLOW_REMOTE_ACCESS_PROFILES`, `AZURA_DEMO_DATA_ISOLATED` must be `"true"`. None is
   `NEXT_PUBLIC_*` — a public flag could be flipped by anyone reading the bundle.
2. **Build-time guard** — `assertAccessProfileSafety(process.env)` runs at **module load** and
   throws `AccessProfileSafetyError` when a production environment sets `ENABLE_ACCESS_PROFILES`
   without proving isolation. "Provably isolated" needs all three of: the two Azura flags true
   **and** no Supabase data plane variable present at all (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_DB_URL`, `SUPABASE_PROJECT_REF`). Claiming isolation while a URL sits in the
   environment is precisely the misconfiguration this catches. Even when isolation _is_ proven,
   layer 1 still returns `false` — the escape hatch downgrades the crash to a no-op, it never
   opens the picker.
3. **Role resolution** — an unparseable or unknown role resolves to `manager`, never `admin`.

**Proof it actually fires** — `[DoD 6c]` spawns a real child process:

```
node --experimental-strip-types --import <register-ts-resolve.mjs> \
     --input-type=module -e "await import('…/access-profile-policy.ts')"
  env: NODE_ENV=production ENABLE_ACCESS_PROFILES=true
       AZURA_ALLOW_REMOTE_ACCESS_PROFILES=false AZURA_DEMO_DATA_ISOLATED=false
       NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=…

  PASS  importing the module in NODE_ENV=production with the flag exits non-zero — exit status 1
  PASS  the failure is an AccessProfileSafetyError — throw new AccessProfileSafetyError(
  PASS  the error names the variable and never a value
  PASS  control: the same import succeeds in development — exit status 0
```

The control matters: without it, a resolver hook that failed to load _anything_ would make the
first three assertions pass for the wrong reason.

**W4-C, the attack surface to aim at:** the guard fires on `process.env` at import time, and
`lib/auth.ts` → `lib/access-profile-policy.ts` is on the import path of every auth-touching
module. The interesting questions are (a) whether a route exists that resolves a profile without
transitively importing the policy module, and (b) whether Next's bundler can evaluate
`accessProfilesEnabledForEnvironment` in a context where `process.env.NODE_ENV` is not yet
`"production"`.

---

## Contracts I consumed

| Contract                                         | Fitted?                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3 `roles`, `resources`, `actions`, `roleLevel`  | Yes. Imported from `lib/contracts.ts`, never redeclared.                                                                                                                                                                                                                                                                                                          |
| §3 additive-authority rule                       | Yes — and the `roleLevel` numbers turned out to _encode_ the parent map: every parent's level is strictly greater than its child's (`tenant 10 > guest 5`, `staff 40 > service_provider 30`, `owner 20 > child_owner 15`, `tenant 10 > child_tenant 8`, `guest 5 > child_guest 3`). That is not a coincidence and it is what made the subset design self-evident. |
| §3 `evidence` gating                             | Yes.                                                                                                                                                                                                                                                                                                                                                              |
| §5 `ApiResponse` / `ApiError` / `apiErrorStatus` | Yes, in the access-profile route.                                                                                                                                                                                                                                                                                                                                 |
| §7 `locales`, `defaultLocale`                    | Yes, in `login/actions.ts` and the proxy guard.                                                                                                                                                                                                                                                                                                                   |
| §4 `RepositoryResult`                            | Not consumed — no repository here. `ProfileSource` plays the analogous "where did this come from" role for auth.                                                                                                                                                                                                                                                  |

**No contract needed amending. `CONTRACT_VERSION` stays 1.**

---

## Decisions I made

**`UserProfile` is a discriminated union, not nullable.** The brief specifies
`Promise<UserProfile>`. A nullable return invites `profile?.role !== "admin"` at call sites, which
silently evaluates to `true` for a missing profile — the wrong direction. So there is always a
profile, and the unauthenticated arm carries `authenticated: false` and role `guest`.
`lib/rbac.ts` proves at compile time that `guest` holds no write permission anywhere, so a caller
that forgets to check `authenticated` still cannot mutate anything. The fail-closed property is
structural rather than a rule someone has to remember. The probe asserts `profileCan(anonymous, p)`
is false for all 168 permissions.

**`lib/auth-resolution.ts` is a new file not named in the ownership matrix.** ORCHESTRATION §4
lists `apps/web/lib/auth.ts` for W1-B; this is a split of that module, in W1-B's own scope, and no
other window claims it (W2-A owns `lib/*-repository.ts` and `lib/*-data.ts`). The reason is
testability, and it is the reason the brief's two most important tests exist as executable proofs
rather than prose: `resolveSupabaseProfile` and `buildAccessProfileFor` cannot be exercised from
plain Node if they sit in a module that statically imports `next/headers`. `@/lib/auth`
re-exports the whole surface, so no other window needs to know the file exists.

**A `profiles` read error and a missing row both resolve to `tenant`.** They are different
situations — the first is usually "migrations not applied yet", the second is incomplete
onboarding — and `degradedReason` keeps them distinguishable at the call site. But neither may
widen authority, so the safe _role_ is the same for both. Throwing instead would 500 every
dashboard page until W1-A's migrations land, trading a fail-closed outcome for an outage and
buying nothing.

**No memoisation in `getUserProfile()`.** The brief requires a role change to be visible on the
next request. React `cache()` would be per-request and therefore safe, but it only pays off once
a page issues several profile reads, and an unnecessary cache around an authorisation decision is
a bad default. Noted here so a later window adds it deliberately rather than by accident.

**The access-profile route 404s when disabled, rather than 403.** A 403 confirms the endpoint
exists and invites a search for the flag that opens it.

**The proxy never honours `?next=` on the authenticated→`/login` redirect.** It always goes to
`/{locale}/dashboard`. Honouring a caller-supplied destination there would put an open-redirect
surface in the proxy; `login/actions.ts` handles `next` after a successful sign-in, where it is
validated.

**`scripts/ts-resolve-hooks.mjs` + `register-ts-resolve.mjs`.** Node's `--experimental-strip-types`
executes `.ts` but will not _resolve_ an extensionless relative specifier, which is what
`moduleResolution: "bundler"` requires the source to write. W0-A's `smoke-contracts.mts` avoids
this only because `lib/contracts.ts` has no imports at all. The alternatives were: edit
`apps/web/tsconfig.json` (W0-A's file), write `./contracts.ts` in application source (a compile
error under the current config), or `pnpm install tsx` (W0-A only, and forbidden concurrently).
A 40-line loader used exclusively by test harnesses was the smallest honest option. Nothing in
`apps/web` goes through it. `scripts/ai-probe.mjs` (W2-C) will reuse it.

**Shared working tree.** All four windows share `D:\Azura World`, so `git checkout` is global —
HEAD was on W1-D's branch throughout. Commits were made to `feature/INTERNAL-107-w1b-w2c-auth-ai`
via a private `GIT_INDEX_FILE` + `write-tree`/`commit-tree`/`update-ref`, which never touches HEAD
or the working tree. W1-A independently reached the same technique (NIGHT-LOG 19:05). Anyone
auditing this branch should know its commits were never checked out.

---

## Requests for other windows

| File                                              | Owner              | What is needed                                                                                                          | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/package.json`                           | **W0-A**           | add `"server-only"` to `dependencies`                                                                                   | `lib/supabase/server.ts` should carry `import "server-only"` so a client-bundle import is a **build** failure. The package is not installed and only W0-A may run `pnpm install`. The seam is marked `TODO(W0-A)` in that file's header with the exact line. Until then the guarantee rests on two live runtime mechanisms: `serverEnv`'s Proxy throws on any read in a browser, and the module throws at load if `typeof window !== "undefined"`. **The service-role key cannot leak today** — but the failure is at runtime, not at build.                          |
| `package.json`                                    | **W0-A**           | add `"smoke:rbac": "node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs scripts/rbac-probe.mts"` | so the probe joins `pnpm smoke:contracts` as a named gate. W4-D's `quality-gate.mjs` should call it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `.env.example` + `apps/web/lib/env.ts`            | **W0-A**           | add `ACCESS_PROFILE_ROLE` (optional, one of the 11 roles)                                                               | the brief's chain is cookie → **env** → `manager`. The env layer is implemented in `lib/access-profile-policy.ts`, which reads raw `process.env` by design (it must inspect an _unvalidated_ environment — a guard that only fires after validation succeeds can be skipped by supplying something malformed). Documenting the variable in `.env.example` closes the loop.                                                                                                                                                                                            |
| `apps/web/lib/database.types.ts`                  | **W1-A** (or W2-A) | generate it                                                                                                             | all three Supabase clients are currently untyped. Once it exists, add the `<Database>` generic to `client.ts`, `server.ts` and `middleware.ts` **together, in one commit**.                                                                                                                                                                                                                                                                                                                                                                                           |
| `supabase/migrations/…0001_rbac.sql`              | **W1-A**           | reconcile `public.role_scope()` labels with `roleScope()` in `lib/rbac.ts`, **or** confirm the divergence is intended   | SQL returns `vendor` for `service_provider` and `managed_minor` for the three `child_*`; TS returns `field` / the guardian's scope. The TS union is frozen by the W1-B brief and does not contain those two labels, so I could not change my side. **Not a security issue today**: `public.role_scope()` is defined but referenced by **no policy in any migration** (grepped all 10) — RLS uses `role_level()`, `guardian_role_for()` and `current_user_scope_profile_id()`, all of which agree with the TS side. It is a label mismatch waiting to mislead someone. |
| `apps/web/app/layout.tsx` or the dashboard layout | **W0-A / W3-B**    | wrap `{children}` in `<UserProvider profile={await getUserProfile()}>`                                                  | the client `can()` gate needs the profile injected from a Server Component. It is not wired anywhere yet, so `useUser()` currently throws by design.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/web/app/[locale]/login/page.tsx`            | **W3-H**           | build the form against `signIn` / `initialLoginFormState` from `./actions`                                              | `useActionState(signIn, initialLoginFormState)`; pass hidden `locale` and `next` inputs. When `isAccessProfileEnabled()`, also render the role picker against `POST /api/access-profile`.                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/web/app/[locale]/**` 403 page               | **W3-B / W3-F**    | render a 403, not a redirect, for an authenticated-but-forbidden route                                                  | the proxy deliberately cannot do this (see the proxy section above).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

---

## Known gaps

- **`[GAP]` `import "server-only"` is not present** in `lib/supabase/server.ts`. Covered by two
  runtime mechanisms; the build-time break needs W0-A's dependency. This is the single most
  important follow-up in this handoff.
- **`[GAP]` No `Database` generic** on the Supabase clients — every `.from("profiles")` result is
  `unknown`-shaped and narrowed by hand in `auth-resolution.ts`. The narrowing is real (`ProfileRow`
  with `unknown` fields plus `asString`/`asLocale`/`isValidRole`), so this is a loss of compile-time
  help, not of runtime safety.
- **`[GAP]` `getUserProfile()` has not been exercised against the live Supabase project.** Its
  decision table is proved by 20 probe assertions, but the `auth.getUser()` + `profiles` read path
  itself has never run — there is no user in the project and no route that calls it yet. First
  real exercise will be W3-H's login page.
- **`[GAP]` `safeNextPath()` is not unit-tested** (`"use server"` module, see above).
- **Deferred edge case — session expires mid-form.** The proxy preserves the _destination_
  (`?next=<path><search>`), so the user returns to the right URL. Preserving _typed form values_
  across a re-auth needs client-side draft persistence in the form component, which belongs to the
  window that owns the form (W3-*). Named here so it is not lost.
- **Deferred edge case — concurrent tabs with different access profiles.** The cookie is shared;
  last write wins. Documented, not fixed; per-tab roles are not attempted, per the brief.
- **Deferred edge case — role with no accessible resources.** `hasAnyAccess` is exposed on the
  user context for exactly this, but the empty-state _UI_ is W3-B's. No role in the current matrix
  reaches zero resources (the minimum is `child_guest` at 7), so this only bites if a future matrix
  edit empties one.
- **`child_*` escalation was tested adversarially at the RBAC layer only** — 21 assertions that the
  three child roles cannot reach `documents`, `finance`, `tickets:create`, `users`, `settings`,
  `evidence` or `vendor_invoices`. Escalation _through a guardian relation join_ is an RLS property
  and belongs to W1-A's pgTAP suite; `guardian_role_for()` exists there and agrees with
  `additiveParent`.
- The suite asserts the **TS** matrix. It does not compare the TS matrix against SQL RLS policy
  bodies, because there is no machine-readable permission table on the SQL side to diff against —
  W1-A expresses authorisation as policies, not as a matrix. W4-C should treat "does an RLS policy
  actually match the row in this table?" as an open question per resource.
