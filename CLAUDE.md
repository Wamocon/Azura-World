# CLAUDE.md — Azura World CATI

> **Last verified: 2026-07-27**, immediately after W0-A completed, against the tree at
> `D:\Azura World`.
> **Code wins over docs.** If this file and the repository disagree, the repository is right and
> this file is stale — fix the file, do not "correct" the tree to match it. The 1Çatı reference
> `CLAUDE.md` still claims 7 migrations while 64 exist on disk; that is the failure mode this
> line exists to prevent.
>
> Waves 0-B, 0-C and 0-D are running in parallel windows as this was written, so the "exists"
> lists below are a snapshot, not a contract. `ls` beats this file.

---

## 1. What this is

An evidence-backed property-management ERP and sales showcase for **Azura World Residence &
Hotel** (Türkler / Alanya / Antalya, developer Cebeci Group), built under Jira **INTERNAL-107**.
It is competitor intelligence: do not publish it, do not push it to a public remote, do not mix
it with client data in `D:\Real Estate CRM\Cati`.

What makes it unusual: **every fact shown to a user carries its source URL.** That is not a
convention you can forget — it is a type. `SourcedFact<T>` (CONTRACTS.md §1, implemented in
`apps/web/lib/contracts.ts`) has `value`, `sources[]`, and a `confidence` that constrains them:
`"gap"` forces `value === null`, `"confirmed"` demands two sources on **distinct hosts**,
`"conflicted"` demands the losing values be kept. Casting around it is a review failure, not a
shortcut. `assertFactInvariants()` enforces all six invariants at runtime;
`scripts/smoke-contracts.mts` proves it rejects each one.

---

## 2. Read order — mandatory, before any file is written

From `SYSTEM-PROMPT.md` §1:

1. `SYSTEM-PROMPT.md`
2. `CONVENTIONS.md` — stack versions, security rules, edge cases
3. `CONTRACTS.md` — frozen interfaces; never change these
4. your own `tasks/W?-?.md`
5. any `HANDOFF/` file your brief names as a prerequisite

Then read the reference implementation your brief points at (SYSTEM-PROMPT §1 has the table) and
mirror it. **`SYSTEM-PROMPT.md` wins over everything else**, including this file — a task brief
may only make a rule stricter, never looser.

---

## 3. How parallel windows work

One Claude Code window per brief in `tasks/` (26 briefs, six waves — `ORCHESTRATION.md` §2).

- **Exactly one window writes any given file.** The ownership matrix is `ORCHESTRATION.md` §4 and
  is repeated at the top of every brief. Two windows writing the same file silently lose work.
- Need a change in a file you do not own? Write it under `## Requests for other windows` in your
  handoff. Never reach across.
- Every task ends by writing `HANDOFF/<task-id>.md` (template: `ORCHESTRATION.md` §6). The wave
  is not complete until every handoff exists.
- **Only W0-A runs `pnpm install`.** It has been run — `pnpm-lock.yaml` and `node_modules/`
  exist. Do not run it again concurrently with another window.
- All windows share **one working tree and one git branch**. `git add` your own paths only;
  a bare `git add -A` will stage another window's work.

---

## 4. Pinned stack

Left column is what `package.json` / `apps/web/package.json` **declare**; right is what is
**installed** under `node_modules`. Both read 2026-07-27. They agree with `CONVENTIONS.md` §1.
Do not float them.

| Package                                   | Declared                          | Installed                |
| ----------------------------------------- | --------------------------------- | ------------------------ |
| `next`                                    | `16.2.6` (exact)                  | 16.2.6                   |
| `react` / `react-dom`                     | `19.2.4` (exact)                  | 19.2.4                   |
| `typescript`                              | `^5`                              | 5.9.3                    |
| `tailwindcss` + `@tailwindcss/postcss`    | `^4`                              | 4.3.3                    |
| `next-intl`                               | `^4.13.0`                         | 4.13.4                   |
| `@supabase/ssr` / `@supabase/supabase-js` | `^0.12.0` / `^2.108.2`            | 0.12.3 / 2.110.8         |
| `@base-ui/react` / `shadcn`               | `^1.6.0` / `^4.11.0`              | 1.6.0 / 4.15.0           |
| `framer-motion`                           | `^12.40.0`                        | 12.42.2                  |
| `gsap` / `@gsap/react`                    | `^3.15.0` / `^2.1.2`              | 3.15.0 / 2.1.2           |
| `lenis`                                   | `^1.3.25`                         | 1.3.25                   |
| `three` / `@react-three/fiber` / `drei`   | `^0.185.1` / `^9.6.1` / `^10.7.7` | 0.185.1 / 9.6.1 / 10.7.7 |
| `lucide-react` (the only icon library)    | `^1.21.0`                         | 1.27.0                   |
| `@playwright/test`                        | `^1.61.0`                         | 1.62.0                   |
| `zod`                                     | `^4.4.3`                          | 4.4.3                    |
| pnpm / Node                               | `pnpm@10.0.0` / `>=20.0.0`        | `.nvmrc` = 22.14.0       |

Declared but not listed in CONVENTIONS §1: `next-themes`, `clsx`, `tailwind-merge`,
`class-variance-authority`, `tw-animate-css`, `prettier` + `prettier-plugin-tailwindcss`,
`eslint ^9` + `eslint-config-next 16.2.6`; root dev deps `turbo ^2.5.0`, `pg ^8.13.1`.

---

## 5. Commands

**Target exists and has been run at least once:**

| Command                         | Target                                      | Last observed                         |
| ------------------------------- | ------------------------------------------- | ------------------------------------- |
| `pnpm --dir apps/web dev`       | `next dev --hostname 127.0.0.1 --port 3200` | ready in 1.3s                         |
| `pnpm --dir apps/web build`     | `next build --webpack`                      | exit 0                                |
| `pnpm --dir apps/web typecheck` | `tsc --noEmit`                              | exit 0                                |
| `pnpm --dir apps/web lint`      | `eslint`                                    | exit 0, `--max-warnings 0`            |
| `pnpm smoke:contracts`          | `scripts/smoke-contracts.mts`               | 33 pass · 0 fail                      |
| `pnpm verify:supabase`          | `scripts/verify-supabase.mjs`               | 25 pass · 0 fail · 3 warn             |
| `pnpm setup:supabase`           | `scripts/setup-supabase.mjs`                | `--dry-run` only; buckets NOT created |

Pasted output for all of these is in `HANDOFF/W0-A.md`, not here.

**Target exists but has not been run from this window:** `pnpm harvest`
(`scripts/harvest-azura.mjs`), `pnpm dataset` (`scripts/build-azura-dataset.py`), `pnpm
qa:evidence` (`scripts/verify-evidence.mjs`) — all W0-B's, which was still running.

**Command defined, target does not exist yet — it will fail, and that is correct:**

| Command                           | Missing target                                  | Written by |
| --------------------------------- | ----------------------------------------------- | ---------- |
| `pnpm test:contract`              | `scripts/validate-openapi.mjs`                  | W2-B       |
| `pnpm qa:layout` / `pnpm qa:perf` | `scripts/layout-audit.mjs` / `scripts/perf.mjs` | W4-B       |
| `pnpm quality:gate`               | `scripts/quality-gate.mjs`                      | W4-D       |
| `pnpm db:test`                    | no `supabase/config.toml`, no migrations        | W1-A       |
| `pnpm --dir apps/web test:e2e`    | `apps/web/playwright.config.ts`                 | W4-A       |

Do not stub a missing target to make a script "pass". A failing script that names its owner is
information; a stub is a lie the next window builds on.

**Port 3200.** 1Çatı runs on **3100** and both may run at once — verified simultaneously on
2026-07-27. Never collide. `NEXT_PUBLIC_APP_URL` in `.env.example` matches 3200.

---

## 6. Next 16 specifics that bite

- **`proxy.ts`, not `middleware.ts`.** Next 16 replaced it. Having both is undefined behaviour.
  Do not create `apps/web/middleware.ts` for any reason.
- **`params` is a Promise.** `const { locale } = await params` — likewise `searchParams`.
- **Production build is `next build --webpack`.** Turbopack is fine for `dev` (and is what `next
dev` uses); Turbopack production builds are not the validated path here.
- **Tailwind v4 has no `tailwind.config.js`.** Tokens are CSS custom properties in
  `@theme inline` inside `app/globals.css` (W1-D owns that file). Adding a JS config breaks the
  build silently in dev and loudly in prod.
- `verbatimModuleSyntax` is on: type-only imports must be written `import type`.
- `noUncheckedIndexedAccess` is on: `arr[0]` is `T | undefined`. Handle it; do not `!` it away.
- `exactOptionalPropertyTypes` is on: `{ x?: string }` will not accept `x: undefined`.
- `next build` **rewrites `tsconfig.json`** — it forced `"jsx": "react-jsx"` and reformatted the
  file on the first build. Expected; do not fight it.
- The CSP is emitted **per request from `proxy.ts`** with a fresh nonce, not statically from
  `next.config.ts`. Adding a static `Content-Security-Policy` header to `next.config.ts` would
  override the nonce and break every script tag in production.

---

## 7. Current state — after W0-A, 2026-07-27

**Written by W0-A:**

```
package.json · pnpm-workspace.yaml · turbo.json · .nvmrc · .gitattributes
.gitignore (extended) · .env.example (comment only)
apps/web/package.json · tsconfig.json · next.config.ts · postcss.config.mjs
apps/web/eslint.config.mjs · .prettierrc · proxy.ts
apps/web/app/{layout,not-found,global-error}.tsx
apps/web/lib/{contracts,env,utils}.ts
scripts/{setup-supabase.mjs,smoke-contracts.mts}
CLAUDE.md · AGENTS.md · HANDOFF/W0-A.md
```

**Does not exist yet — do not assume it:**

| Missing                                                    | Owner                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| `apps/web/app/globals.css`                                 | W1-D (plus the one-line import seam in `app/layout.tsx`)    |
| `apps/web/lib/cn.ts`                                       | W1-D — class merging lives there, **not** in `lib/utils.ts` |
| `apps/web/i18n*.ts`, `apps/web/messages/*.json`            | W1-C (plus the plugin seam in `next.config.ts`)             |
| the Supabase and route-guard bodies in `apps/web/proxy.ts` | W1-B — two marked `TODO(W1-B)` seams                        |
| `apps/web/lib/rbac.ts`, `auth.ts`, `lib/supabase/*`        | W1-B                                                        |
| migrations, `seed.sql`, `config.toml`, pgTAP tests         | W1-A                                                        |
| `docs/api/openapi.yaml`                                    | W2-B                                                        |
| any `app/[locale]/**` route                                | W1-C / W3-*                                                 |

There is **no routable page yet**: `/` redirects to `/de` and `/de` renders `app/not-found.tsx`
with a 404. That is the correct state until W3-A adds `app/[locale]/page.tsx`.

`packages/ui/` holds only `.gitkeep` and has no `package.json`, so pnpm resolves no workspace
package there — the same as the 1Çatı reference. `supabase/` is W1-A's; W0-A created the bare
directory and nothing inside it.

**Two known contract gaps.** `CONTRACTS.md` §2 references `AzuraBlock` and `Amenity` but never
defines either. `lib/contracts.ts` declares both as `Record<string, unknown>`, tagged
`CONTRACT-GAP-01` / `CONTRACT-GAP-02`. Grep those ids. Reading a named property off one requires
a central amendment to `CONTRACTS.md` and a `CONTRACT_VERSION` bump first — see
`HANDOFF/W0-A.md`.
