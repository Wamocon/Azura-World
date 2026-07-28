# W1-B — Auth, RBAC, Supabase clients

**Wave:** 1 · **Depends on:** W0-A · **Blocks:** W2-_, W3-_ · **Runs with:** W1-A, W1-C, W1-D

> Read `SYSTEM-PROMPT.md`, `CONVENTIONS.md`, `CONTRACTS.md` §3 first. Then read
> `D:\Real Estate CRM\Cati\apps\web\lib\rbac.ts` and `lib\auth.ts` in full.

---

## Mission

The TypeScript half of the security boundary. W1-A owns the SQL half. You are building against
the same frozen role list in `CONTRACTS.md` §3 — **neither of you may change it**, because you
are both compiling against it simultaneously and a divergence is a security hole that typechecks.

The rule to keep in front of you: **RLS is the security boundary; RBAC is the UX boundary.**
Hiding a nav item is not protection. Assume the user types the URL.

---

## Files you own

```
apps/web/lib/rbac.ts · apps/web/lib/auth.ts · apps/web/lib/access-profile-policy.ts
apps/web/lib/supabase/{client,server,middleware}.ts
apps/web/app/api/access-profile/route.ts
apps/web/components/user-provider.tsx
apps/web/app/[locale]/login/actions.ts
HANDOFF/W1-B.md
```

You also fill the two **TODO seams W0-A left in `apps/web/proxy.ts`** — Supabase session refresh
and the route guard. That file is W0-A's, so touch only those marked regions and say so in your
handoff. Do not restructure it.

---

## Deliverables

### 1. `lib/rbac.ts` — the permission matrix

Import `roles`, `resources`, `actions`, `roleLevel` from `lib/contracts.ts`. **Do not redeclare
them.** One source of truth.

```ts
export const permissionMatrix: Record<Role, readonly Permission[]>;

export function hasPermission(role: Role, permission: Permission): boolean;
export function hasAnyPermission(
  role: Role,
  permissions: Permission[],
): boolean;
export function getAccessibleResources(role: Role): Resource[];
export function isAdmin(role: Role): boolean;
export function isManagerOrAbove(role: Role): boolean;
export function roleScope(
  role: Role,
):
  | "company"
  | "site"
  | "finance"
  | "field"
  | "owned_unit"
  | "rented_unit"
  | "public";
```

**Additive-authority rule.** The five added roles (`guest`, `service_provider`, `child_*`) sit
strictly below the canonical six and may never widen an existing role's permissions. Write a
**compile-time or unit-tested proof** of this: for every added role, its permission set is a
subset of its parent's. Do not merely assert it in a comment.

**`evidence` resource:** `manager`+ may `view`; only `admin` may `manage`. This is the
Azura-specific one — the source/conflict cockpit.

### 2. `lib/auth.ts`

```ts
export async function getUserProfile(): Promise<UserProfile>;
export function isSupabaseConfigured(): boolean;
export function isAccessProfileEnabled(): boolean;
```

`getUserProfile()` resolution order, mirroring 1Çatı:

1. Supabase unconfigured → local access profile (cookie `access_profile_role` → env → `manager`)
2. Supabase configured → `auth.getUser()` + `profiles` read
3. Authenticated but no profile row → minimal `tenant`. **Fail closed, never open.**

### 3. Access profiles — QA only, hard-gated

The login page shows a role picker in controlled environments. This is a deliberate backdoor for
QA and it must be impossible to ship.

**Triple-gated**, mirroring the reference project — all three must be true, and none is
`NEXT_PUBLIC_*` because the decision is server-side:

```ts
isAccessProfileEnabled() =
  !isSupabaseConfigured() ||
  (env.ENABLE_ACCESS_PROFILES === "true" &&
    env.AZURA_ALLOW_REMOTE_ACCESS_PROFILES === "true" &&
    env.AZURA_DEMO_DATA_ISOLATED === "true");
```

Add a **build-time guard**: if `NODE_ENV === "production"` **and** the three flags are set **and**
the deployment is not provably isolated from every Supabase data plane, **throw at module load**. A deployed
build with an open role picker is a total compromise, and a runtime check that only warns will be
ignored. W4-C will try to defeat this — make it hold.

### 4. Supabase clients

- `client.ts` — browser, anon key only
- `server.ts` — server client + `createServiceRoleClient()`
- `middleware.ts` — session refresh helper for `proxy.ts`

`createServiceRoleClient` must carry `import "server-only"` at the top. If it ever reaches a
client bundle the build must break, not warn.

### 5. `proxy.ts` seams

Fill W0-A's TODOs, in this order:

1. next-intl locale routing (already there)
2. Supabase session refresh — cookies written to **both** request and response
3. Route guard: `/dashboard/*` protected; unauthenticated → `/{locale}/login`; authenticated
   hitting `/login` → `/{locale}/dashboard`

### 6. `components/user-provider.tsx`

Client context exposing `{ profile, role, can(permission) }`. The sidebar and every KPI card
filter through `can()`. **This is UX only** — never the sole protection for anything.

---

## Edge cases

- **Session expires mid-form.** Preserve input, re-auth, resume. Discarding a half-filled form is
  a real bug users will hit.
- **Cookie write in a Server Component** throws in Next 16. Refresh belongs in `proxy.ts`.
- **Redirect loop**: unauthenticated user deep-links to a protected route, guard redirects to
  login, login redirects to dashboard, repeat. Test this explicitly with a `?next=` param.
- **Role with no accessible resources** (`guest` on a locked site) → coherent empty state with an
  explanation, not a blank shell or a crash.
- **403 vs redirect**: authenticated-but-forbidden gets a 403 page. Redirecting an authenticated
  user to login is confusing and looks broken.
- **Role changed while logged in** → next request must reflect it. Do not cache the role for the
  session lifetime.
- **`child_*` escalation**: a child role must not reach its guardian's data through a relation
  join. Test it adversarially.
- **Concurrent sessions** in two tabs with different access profiles → cookie is shared, last
  write wins. Document it; do not attempt per-tab roles.
- **Locale in redirects**: never drop it. `/dashboard` must become `/de/dashboard`.

---

## Definition of done

```bash
pnpm --dir apps/web typecheck
pnpm --dir apps/web lint
node --test apps/web/lib/rbac.test.ts     # or the project's runner
```

Required unit tests, all passing, output pasted:

1. All 11 roles present, in `CONTRACTS.md` order
2. `roleLevel` strictly ordered as specified
3. **Subset proof**: every added role's permissions ⊆ its parent's
4. `admin` has every permission; `guest` has no write permission anywhere
5. `hasPermission` rejects a malformed permission string
6. Production build + `ENABLE_ACCESS_PROFILES=true` + no escape hatch → **throws**
7. `getUserProfile` with no Supabase → local profile; unknown cookie value → `manager`, not a crash
8. Authenticated user with no `profiles` row → `tenant`, never `admin`

Test 6 and test 8 are the ones that matter. Both are fail-closed proofs.

---

## Handoff must state

- The full permission matrix as a table (W3-* windows will read this constantly)
- Confirmation the role list matches `CONTRACTS.md` §3 **and** W1-A's SQL enum — check W1-A's
  handoff and diff them. If they differ, that is a BLOCKED handoff, not a note.
- Exactly which lines of `proxy.ts` you touched
- How the production access-profile guard is enforced, and how you proved it fires
