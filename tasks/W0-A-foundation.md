# W0-A — Repository scaffold, tooling, contracts

**Wave:** 0 · **Depends on:** nothing · **Blocks:** everything · **Runs with:** W0-B

> Read `SYSTEM-PROMPT.md`, `CONVENTIONS.md`, `CONTRACTS.md` before writing anything.

---

## Mission

Stand up the repository so that eleven other windows can build in parallel without tripping over
each other. You produce the skeleton, the pinned toolchain, and — most importantly — the
**executable form of `CONTRACTS.md`**. Every other window compiles against your `contracts.ts`.
If it is wrong, eleven windows are wrong.

You are also the **only** window permitted to run `pnpm install`.

---

## Files you own

```
package.json · pnpm-workspace.yaml · turbo.json · .gitignore · .gitattributes
.env.example · .nvmrc
apps/web/package.json · apps/web/tsconfig.json · apps/web/next.config.ts
apps/web/postcss.config.mjs · apps/web/eslint.config.mjs · apps/web/.prettierrc
apps/web/proxy.ts · apps/web/app/layout.tsx · apps/web/app/not-found.tsx
apps/web/app/global-error.tsx · apps/web/lib/contracts.ts · apps/web/lib/utils.ts
apps/web/lib/env.ts
CLAUDE.md · AGENTS.md
HANDOFF/W0-A.md
```

## Read-only

`CONTRACTS.md`, `CONVENTIONS.md`, and the reference repos. Do **not** create
`apps/web/app/globals.css` (W1-D), `apps/web/i18n.ts` (W1-C), or anything under
`supabase/` (W1-A).

---

## Deliverables

**1. Monorepo skeleton.** Mirror `D:\Real Estate CRM\Cati` layout:

```
apps/web/          packages/ui/       supabase/         scripts/
sources/           docs/              quality/          HANDOFF/
```

Create `.gitkeep` in the empty ones so other windows have somewhere to write.
`git init` — this directory is not yet a repo. First commit: the scaffold.

**2. Pinned toolchain.** Exact versions from `CONVENTIONS.md` §1. No `^` drift on
`next`, `react`, `react-dom`. Root `package.json` scripts:

```json
{
  "dev": "turbo run dev",
  "build": "turbo run build",
  "lint": "turbo run lint",
  "typecheck": "turbo run typecheck",
  "test": "turbo run test",
  "test:contract": "node scripts/validate-openapi.mjs",
  "db:test": "npx supabase test db",
  "harvest": "node scripts/harvest-azura.mjs",
  "dataset": "python scripts/build-azura-dataset.py",
  "qa:evidence": "node scripts/verify-evidence.mjs",
  "qa:layout": "node scripts/layout-audit.mjs",
  "qa:perf": "node scripts/perf.mjs",
  "quality:gate": "node scripts/quality-gate.mjs"
}
```

Scripts referencing files other windows own are expected to fail until those land. That is
correct — do not stub them.

**3. `apps/web/lib/contracts.ts`** — the whole of `CONTRACTS.md` as compiling TypeScript.
Types, the `roles`/`resources`/`actions` const arrays, `roleLevel`, `locales`, `defaultLocale`,
`CONTRACT_VERSION = 1`. Plus runtime guards other windows will need:

```ts
export function isSourcedFact<T>(v: unknown): v is SourcedFact<T>;
export function assertFactInvariants<T>(f: SourcedFact<T>, path: string): void;
export function displayValue<T>(f: SourcedFact<T>): T | null;
export function tierWins(a: SourceRef, b: SourceRef): SourceRef;
```

`assertFactInvariants` enforces all six invariants in `CONTRACTS.md` §1 and throws with the
dotted path on violation. W0-B and W4-D both call it.

**4. `apps/web/lib/env.ts`** — Zod-validated env access. Never `process.env.X` anywhere else.
Separate `serverEnv` (throws if a server-only var is read client-side) from `publicEnv`.
Validate at module load so a misconfigured deploy fails at boot, not at first request.

**5. `apps/web/proxy.ts`** — Next 16 proxy. Mirror 1Çatı's structure but locales are
`de|en|tr|ru`, default `de`, `localePrefix: "always"`, matcher `["/", "/(de|en|tr|ru)/:path*"]`.
Compose in this order: intl routing → Supabase session refresh → route guard.
**Leave the Supabase and guard sections as clearly-marked TODO stubs that W1-B fills** — you own
the file, so write the skeleton with the seams; do not implement auth.

**6. Root layout + error boundaries.** `app/layout.tsx` shell only — no styling (W1-D), no
providers (W1-D). `global-error.tsx` and `not-found.tsx` must render with zero dependencies:
they run when everything else has failed.

**7. `.env.example`** — every var, placeholder values, one-line comment each. Real secrets never
land here.

**Already created at the repo root — do not recreate or rename any variable.** Read the existing
`.env.example` and make `lib/env.ts` validate exactly that set. `.gitignore` and `.env.local`
also already exist; all five server secrets are generated. `SUPABASE-SETUP.md` records which
values are live and which are still placeholders.

If the Supabase values are still blank, that is expected and not a blocker — the app runs on the
seed fallback until W1-A applies migrations.

Note the access-profile gate is **three server-side flags**, not one `NEXT_PUBLIC_*` flag:
`ENABLE_ACCESS_PROFILES`, `AZURA_ALLOW_REMOTE_ACCESS_PROFILES`, `AZURA_DEMO_DATA_ISOLATED`.

**8. `CLAUDE.md` + `AGENTS.md`** — project documentation for future agents. Write what is
**actually true after your task**, not what the finished project will look like. The reference
repo's `CLAUDE.md` drifted to claiming 7 migrations when 64 existed; do not repeat that. Include
a "last verified" date and a note that code wins over docs.

---

## Contracts you must honour

All of `CONTRACTS.md`. You are transcribing it, not interpreting it. If a type genuinely cannot
be expressed as written, **stop and report** — do not adjust it. Eleven windows are downstream.

---

## Edge cases

- **Port 3200**, not 3100. 1Çatı runs on 3100 and both may run at once.
- `noUncheckedIndexedAccess` makes `arr[0]` be `T | undefined`. This will surface in every
  window. Get the tsconfig right now — changing it in wave 3 breaks eight windows at once.
- `verbatimModuleSyntax` requires `import type` for type-only imports. Set it now.
- Turbopack is fine for dev; production build is `next build --webpack`.
- Do not create `middleware.ts`. Next 16 uses `proxy.ts` and having both is undefined behaviour.
- `.gitignore` must cover `.env*.local`, `sources/raw/`, `node_modules/`, `.next/`,
  `test-results/`, `playwright-report/`, `.tmp/`, `quality/results/`.
- `.gitattributes`: `*.sql text eol=lf`, `*.sh text eol=lf` — CRLF breaks Supabase migrations.
- Windows: set `PLAYWRIGHT_BROWSERS_PATH=.tmp/pw` in `.env.example`.

---

## Definition of done

```bash
pnpm install                                  # completes, lockfile written
pnpm --dir apps/web typecheck                 # 0 errors
pnpm --dir apps/web lint                      # 0 errors 0 warnings
pnpm --dir apps/web build                     # succeeds
pnpm --dir apps/web dev                       # serves 127.0.0.1:3200
node -e "import('./apps/web/lib/contracts.ts')"  # or a tsx smoke check
git log --oneline                             # scaffold commit exists
```

Plus: a hand-written smoke test proving `assertFactInvariants` **throws** on each of the six
invariant violations. Paste the output. A validator that never rejects is not a validator.

---

## Handoff must state

- Exact installed versions of next/react/typescript/tailwind (`pnpm list --depth=0`)
- Any place `CONTRACTS.md` did not translate cleanly, and what you did
- The proxy.ts seam signatures W1-B must fill
- Confirmation that dev server binds 3200 and does not collide with 1Çatı
