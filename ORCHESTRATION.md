# ORCHESTRATION — waves, ownership, merge protocol

How to run 26 task briefs across parallel Claude Code windows without corrupting the build.

---

## 1. The rule that prevents every collision

**Exactly one window writes any given file.** Ownership is declared per task in §4 and repeated
at the top of each brief. Two windows writing `apps/web/lib/rbac.ts` will silently lose work —
the second write wins and the first vanishes.

If your task needs a change in a file you don't own: write the request into your handoff file
under `## Requests for other windows`. The owning window (or a follow-up pass) applies it.

---

## 2. Wave map

| Wave  | Windows | Tasks                  | Gate to next wave                                                  |
| ----- | ------- | ---------------------- | ------------------------------------------------------------------ |
| **0** | 4       | W0-A, W0-B, W0-C, W0-D | `node_modules` installed, `pnpm typecheck` runs, dataset generated |
| **1** | 4       | W1-A, W1-B, W1-C, W1-D | migrations apply cleanly, RBAC matrix compiles, 4 locales resolve  |
| **2** | 4       | W2-A, W2-B, W2-C, W2-D | every repository returns `source`, OpenAPI matches implementation  |
| **3** | 9       | W3-A … W3-I            | every route renders in 4 locales for every permitted role          |
| **4** | 4       | W4-A, W4-B, W4-C, W4-D | all gates green, security review has no unresolved High            |
| **5** | 1       | W5                     | human sign-off                                                     |

**Maximum useful parallelism is 9 (wave 3).** Beyond that you are contending for CPU on
Playwright and the Next build, not gaining throughput.

---

## 3. Dependency graph

```
W0-C market analysis ── documents only, parallel to everything, blocks nothing
W0-D media harvest  ── images/plans/video; blocks W3-A, W3-G, W3-I only

W0-A scaffold ─────┬──────────────────────────────────────────────┐
                   │                                              │
W0-B evidence ─────┼──────────────┐                               │
                   │              │                               │
       ┌───────────┴───┬──────────┼──────────┬────────────┐       │
       ▼               ▼          ▼          ▼            ▼       │
    W1-A DB        W1-B RBAC   W1-C i18n  W1-D design           │
       │               │          │          │                    │
       └───────┬───────┘          │          │                    │
               ▼                  │          │                    │
          W2-A repos ◄────────────┼──────────┘                    │
               │                  │                               │
       ┌───────┼──────────┬───────┘                               │
       ▼       ▼          ▼                                       │
   W2-B API  W2-C AI   W2-D sync                                  │
       │       │          │                                       │
       └───────┴────┬─────┘                                       │
                    ▼                                             │
      W3-A … W3-I  (9 parallel surfaces) ◄────────────────────────┘
                    │
       ┌────────┬───┴────┬─────────┐
       ▼        ▼        ▼         ▼
    W4-A     W4-B     W4-C      W4-D
       └────────┴────────┴─────────┘
                    ▼
                   W5
```

**Hard edges — these cannot be shortcut:**

- W1-A **must** finish before W2-A. Repositories cannot be written against a schema that
  doesn't exist; guessing column names produces code that typechecks and fails at runtime.
- W1-B and W1-A both touch RBAC (TS side / SQL side). They run in parallel but must agree.
  `CONTRACTS.md` §3 freezes the role list precisely so they can. Neither may change it.
- W0-B (dataset) blocks W3-C and W3-G — those render the data.
- W0-D (media) blocks W3-A, W3-G and W3-I — those render the imagery.
- W2-B (OpenAPI) blocks W4-D's contract test.

**Soft edges — start early with mocks if you must, but reconcile before wave close:**
W3-* against W2-*: surfaces may build against `CONTRACTS.md` types before the repository is
finished, since the interface is frozen.

---

## 4. File-ownership matrix

Paths are relative to `D:\Azura World`. `*` means the whole subtree.

| Task     | Owns (exclusive write)                                                                                                                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **W0-A** | `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.gitignore`, `.gitattributes`, `.env.example`, `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/eslint.config.mjs`, `apps/web/proxy.ts`, `apps/web/app/layout.tsx`, `CLAUDE.md`, `AGENTS.md` |
| **W0-B** | `scripts/harvest-azura.mjs`, `scripts/build-azura-dataset.py`, `scripts/verify-evidence.mjs`, `sources/*`, `apps/web/lib/azura-world-data.ts`, `supabase/imports/*`, `SOURCES.md` (append only), `ANALYSIS.md`                                                                                                           |
| **W0-C** | `docs/market/*` — documents only, no code, blocks nothing                                                                                                                                                                                                                                                                |
| **W0-D** | `scripts/harvest-media.mjs`, `scripts/encode-images.mjs`, `scripts/media-manifest.mjs`, `sources/media/*`, `apps/web/public/media/*`, `apps/web/lib/media-manifest.ts`, `apps/web/lib/lqip.json`, `MEDIA-LICENSE.md`                                                                                                     |
| **W1-A** | `supabase/migrations/*`, `supabase/seed.sql`, `supabase/config.toml`, `supabase/tests/*`                                                                                                                                                                                                                                 |
| **W1-B** | `apps/web/lib/rbac.ts`, `apps/web/lib/auth.ts`, `apps/web/lib/access-profile-policy.ts`, `apps/web/lib/supabase/*`, `apps/web/app/api/access-profile/*`, `apps/web/components/user-provider.tsx`                                                                                                                         |
| **W1-C** | `apps/web/i18n.ts`, `apps/web/messages/*`, `apps/web/app/navigation.ts`, `apps/web/components/locale-switcher.tsx`, `apps/web/lib/language-detection.ts`                                                                                                                                                                 |
| **W1-D** | `apps/web/app/globals.css`, `apps/web/components/ui/*`, `apps/web/components/anim/*`, `apps/web/components/three/*`, `apps/web/components/providers/*`, `apps/web/lib/motion.ts`, `DESIGN.md`                                                                                                                            |
| **W2-A** | `apps/web/lib/*-repository.ts`, `apps/web/lib/*-data.ts` _(except `azura-world-data.ts`)_, `apps/web/lib/seed-data.ts`                                                                                                                                                                                                   |
| **W2-B** | `apps/web/app/api/site-management/*`, `apps/web/app/api/calendar/*`, `docs/api/openapi.yaml`, `scripts/validate-openapi.mjs`                                                                                                                                                                                             |
| **W2-C** | `apps/web/app/api/ai/*`, `apps/web/lib/ai-*.ts`, `apps/web/lib/local-ai.ts`, `apps/web/lib/public-ai-*.ts`                                                                                                                                                                                                               |
| **W2-D** | `apps/web/hooks/*`, `apps/web/components/sync-badge.tsx`, `apps/web/lib/realtime.ts`                                                                                                                                                                                                                                     |
| **W3-I** | `apps/web/components/immersion/*`, `apps/web/app/sections/azura-immersion.tsx`, `apps/web/lib/simulation-clock.ts`                                                                                                                                                                                                       |
| **W3-A** | `apps/web/app/[locale]/page.tsx`, `apps/web/app/sections/*`, `apps/web/components/azura/*`                                                                                                                                                                                                                               |
| **W3-B** | `apps/web/app/[locale]/dashboard/layout.tsx`, `dashboard/page.tsx`, `dashboard/dashboard-*.tsx`, `apps/web/lib/dashboard-*.ts`                                                                                                                                                                                           |
| **W3-C** | `apps/web/app/[locale]/dashboard/{listings,units,leads,buyer-pipeline}/*`, `apps/web/components/inventory/*`                                                                                                                                                                                                             |
| **W3-D** | `apps/web/app/[locale]/dashboard/{finance,wallet,vendor-invoices}/*`, `apps/web/components/finance/*`                                                                                                                                                                                                                    |
| **W3-E** | `apps/web/app/[locale]/dashboard/{tickets,activities,calendar,communications}/*`, `apps/web/components/operations/*`                                                                                                                                                                                                     |
| **W3-F** | `apps/web/app/[locale]/dashboard/{documents,compliance,reports,users,admin,settings}/*`, `apps/web/components/governance/*`                                                                                                                                                                                              |
| **W3-G** | `apps/web/app/[locale]/hotel/*`, `apps/web/app/[locale]/dashboard/hotel/*`, `apps/web/components/hotel/*`                                                                                                                                                                                                                |
| **W3-H** | `apps/web/app/[locale]/{report,login,signup}/*`, `apps/web/components/site-concierge.tsx`, `apps/web/components/public-*.tsx`                                                                                                                                                                                            |
| **W4-A** | `apps/web/e2e/*`, `apps/web/playwright.config.ts`                                                                                                                                                                                                                                                                        |
| **W4-B** | `scripts/phase-harness.mjs`, `scripts/layout-audit.mjs`, `scripts/perf.mjs`, `scripts/browser-audit.mjs`, `quality/*`                                                                                                                                                                                                    |
| **W4-C** | `SECURITY-REVIEW.md`, `docs/security/*`                                                                                                                                                                                                                                                                                  |
| **W4-D** | `.github/workflows/*`, `scripts/quality-gate.mjs`, `QUALITY-REPORT.md`                                                                                                                                                                                                                                                   |
| **W5**   | `MANUAL-TEST-REPORT.md`, `quality/manual/*`                                                                                                                                                                                                                                                                              |

**Shared, append-only (never rewrite another window's section):**
`HANDOFF/*.md` — one file per task, you write only your own.

**Frozen after W0 — nobody writes these again:**
`CONTRACTS.md`, `CONVENTIONS.md`, `SYSTEM-PROMPT.md`, `ORCHESTRATION.md`.

---

## 5. Wave gate procedure

Before opening any window in wave N+1:

```bash
# 1. every handoff for wave N exists
ls HANDOFF/

# 2. none is blocked
grep -l "STATUS: BLOCKED" HANDOFF/*.md     # must return nothing

# 3. the tree still compiles
pnpm --dir apps/web typecheck
pnpm --dir apps/web lint

# 4. nothing was written outside ownership
git status --porcelain
```

If step 3 fails, **fix it before fanning out**. Eight windows building on a broken tree produce
eight broken branches and one very long afternoon.

---

## 6. Handoff template

Every task writes `HANDOFF/<task-id>.md` as its final act:

```markdown
# HANDOFF — <task-id> <title>

STATUS: COMPLETE | PARTIAL | BLOCKED
Completed: <ISO date>

## What was built

<3–8 bullets, concrete. Name the files.>

## Verification actually run

| Command                       | Result      | Evidence             |
| ----------------------------- | ----------- | -------------------- |
| pnpm --dir apps/web typecheck | PASS / FAIL | <pasted output tail> |

Anything not run is listed here as NOT RUN with the reason. Do not write "should pass".

## Contracts I consumed

<which CONTRACTS.md interfaces, and whether they fitted>

## Decisions I made

<judgement calls the next window needs to know about, with the reason>

## Requests for other windows

<file changes you needed but do not own — name the file and the owning task>

## Known gaps

<[GAP] items, deferred edge cases, anything a later wave must pick up>
```

---

## 7. Internal subagent fan-out

Each window is one _task_, but a task is not one _thread_. Fan out inside your window with
subagents wherever subtasks are independent — then integrate the results yourself.

**Rules for fan-out:**

1. **You own the files, not your subagents.** Have them return content, analysis or a diff; you
   write it. Two subagents writing the same file collides exactly like two windows do.
2. **Fan out on research and generation, never on integration.** Parsing 6 hosts in parallel is
   safe; three agents "finishing the schema" is not.
3. **Give each subagent the same non-negotiables** — point it at `SYSTEM-PROMPT.md` §2 and the
   relevant `CONTRACTS.md` section, or it will invent its own conventions.
4. **Verify their output yourself.** A subagent reporting success is a claim, not evidence. Run
   the command.
5. Cap at ~4–6 concurrent. Beyond that you are contending for CPU, not gaining speed.

**Where fan-out actually pays, per task:**

| Task | Fan out on                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------ |
| W0-A | contracts transcription · env+proxy+layout · docs+setup script _(after `pnpm install`, which is serial and first)_ |
| W0-B | **one agent per source-host parser group** · harvest script · validator · `ANALYSIS.md`                            |
| W0-C | market+developer · competitive set · price positioning+buyers · source register                                    |
| W1-A | one agent per migration group, then **you** sequence and number them                                               |
| W1-C | one agent per locale, on a key structure you froze first                                                           |
| W1-D | primitives · provenance components · motion · 3D                                                                   |
| W2-A | one agent per repository, against W1-A's verified column names                                                     |
| W2-B | route groups; **you** own the OpenAPI spec so it cannot drift                                                      |
| W0-D | one agent per source-host media scrape · encoder · rights review                                                   |
| W3-* | sections/modules within your own group                                                                             |
| W4-A | one agent per spec directory                                                                                       |
| W4-C | one agent per attack surface — this is the best fan-out in the whole build                                         |

**Where fan-out hurts:** anything with a global invariant — migration numbering, the OpenAPI
spec, `contracts.ts`, the i18n key structure, final integration. Do those yourself.

---

## 8. Recovery

**A window wrote outside its ownership.** `git diff` the offending paths, revert them, re-apply
the intent through the owning window. Do not "leave it, it works" — the owning window will
overwrite it in the next wave and the loss will be silent.

**Two windows edited the same file anyway.** Take the version from the owning window per §4.
Re-derive the other window's intent from its handoff. This is why handoffs are mandatory.

**A wave-1 contract turns out to be wrong.** Stop the wave. Amend `CONTRACTS.md` centrally in a
single window, bump the `CONTRACT_VERSION` constant, then restart the affected tasks. Never let
two windows hold different beliefs about a shared type.

**Running out of time before the 29th.** Ship order is W0 → W1 → W2 → W3-A/B/C/G → W4-D → W5.
That yields a defensible, evidence-backed CATI with the landing page, inventory, hotel/reviews
and passing gates — all four acceptance criteria met. W3-D/E/F and the deeper ERP modules are
the honest cut line. **Cut whole modules, never cut verification.** A demo that works on three
screens beats one that half-works on twelve.
