# Azura World CATI — Execution Kit

**Jira:** [INTERNAL-107](https://wamocon.atlassian.net/browse/INTERNAL-107) · Wamocon · project `INTERNAL` · priority Highest · due **2026-07-29**

A competitor-intelligence CATI (property-management ERP + sales showcase) for **Azura World
Residence & Hotel**, Türkler / Alanya / Antalya, developed by **Cebeci Group A.Ş.** — built to
the same standard as the existing 1Çatı system for Ataberk Estate, with its own identity.

> **Confidentiality:** competitor intelligence. Do not publish, do not push to a public remote,
> do not mix with Ataberk client data. This repository is separate from `D:\Real Estate CRM\Cati`
> deliberately and must stay that way.

---

## How to use this kit

Every file under `tasks/` is a **self-contained brief for one Claude Code window**. Open a
window, and give it exactly this:

```
Read D:\Azura World\SYSTEM-PROMPT.md, then D:\Azura World\CONVENTIONS.md,
then D:\Azura World\CONTRACTS.md, then D:\Azura World\tasks\<TASK-FILE>.md
and execute that task completely.
```

Nothing else. The brief carries its own context, its own file ownership, its own acceptance
criteria, and its own verification commands.

**Read [ORCHESTRATION.md](ORCHESTRATION.md) first.** It says which tasks may run at the same
time, which must wait, and who owns which files. Running two windows that write the same file
will corrupt the build.

---

## Reading order (for you, once)

| File                                   | What it is                                                      |
| -------------------------------------- | --------------------------------------------------------------- |
| [ORCHESTRATION.md](ORCHESTRATION.md)   | Waves, dependency graph, file-ownership matrix, merge protocol  |
| [SYSTEM-PROMPT.md](SYSTEM-PROMPT.md)   | Paste-in system prompt for every window — non-negotiables       |
| [CONTRACTS.md](CONTRACTS.md)           | Frozen TypeScript interfaces every window codes against         |
| [CONVENTIONS.md](CONVENTIONS.md)       | Stack versions, security rules, edge cases, July-2026 practice  |
| [SOURCES.md](SOURCES.md)               | Evidence register: 23 sources, what each yields, every conflict |
| [SUPABASE-SETUP.md](SUPABASE-SETUP.md) | The five values needed in `.env.local`, and how to verify them  |

---

## The waves

```
WAVE 0  foundation ─┬─ W0-A scaffold + tooling
   (4 windows)      ├─ W0-B evidence layer (harvest → dataset)
                    ├─ W0-C market analysis (documents only, optional)
                    └─ W0-D media harvest (images, plans, video)
                            │
WAVE 1  platform ───┬─ W1-A database schema + RLS
   (4 windows)      ├─ W1-B auth + RBAC
                    ├─ W1-C i18n (de·en·tr·ru)
                    └─ W1-D design system + motion
                            │
WAVE 2  services ───┬─ W2-A repository layer
   (4 windows)      ├─ W2-B API routes + OpenAPI
                    ├─ W2-C AI layer (guardrailed)
                    └─ W2-D realtime + sync
                            │
WAVE 3  surfaces ───┬─ W3-A landing (AISDALSLove)
   (9 windows)      ├─ W3-B dashboard shell
                    ├─ W3-C inventory modules
                    ├─ W3-D finance modules
                    ├─ W3-E operations modules
                    ├─ W3-F governance modules
                    ├─ W3-G hotel + reviews
                    ├─ W3-H public intake + concierge
                    └─ W3-I live simulation + immersion
                            │
WAVE 4  quality ────┬─ W4-A e2e suite
   (4 windows)      ├─ W4-B harness
                    ├─ W4-C security review
                    └─ W4-D quality gates
                            │
WAVE 5  sign-off ───── W5 manual Playwright walkthrough (1 window, human-in-loop)
```

**Do not start a wave until every task in the previous wave has written its handoff file.**
See ORCHESTRATION.md §5.

---

## Acceptance criteria (from the ticket, German original)

1. Ein CATI für Azura World erstellen. → the whole build
2. Die wichtigsten Quellen und Links berücksichtigen. → W0-B, SOURCES.md
3. Informationen aus Immobilien-Portalen einbeziehen. → W0-B, W3-C
4. Bewertungen und Hotel-Buchungsquellen einbeziehen. → W0-B, W3-G

Traceability is enforced in W4-D: every criterion maps to a passing test.

---

## Stack

Next.js 16.2.x (App Router, `proxy.ts`) · React 19.2 · TypeScript 5 strict · Tailwind v4
CSS-first · Base UI + shadcn · next-intl 4 (**de** default, + en·tr·ru) · Supabase (Postgres,
RLS-first) · GSAP 3.15 + Lenis + Framer Motion 12 · React Three Fiber 9 / three 0.185 ·
Playwright 1.61 · pnpm 10 · Node ≥ 20.

Versions are pinned in [CONVENTIONS.md](CONVENTIONS.md) §1. They match what is already proven in
`D:\Real Estate CRM\Cati` and `D:\Real Estate CRM\New Level Premium` — do not float them.

---

## Quality gates (all must pass before sign-off)

```bash
pnpm --dir apps/web typecheck      # tsc --noEmit, zero errors
pnpm --dir apps/web lint           # eslint, zero warnings
pnpm --dir apps/web build          # production build
pnpm test:contract                 # OpenAPI ↔ implementation exact match
pnpm db:test                       # pgTAP
pnpm --dir apps/web test:e2e       # Playwright, chromium + mobile-chrome
pnpm qa:layout                     # overflow/overlap audit, 8 widths × 4 locales
pnpm qa:evidence                   # every displayed fact resolves to a live source URL
pnpm qa:perf                       # LCP / CLS / bytes budget
```

Then **W5**: a human drives the app with Playwright in headed mode against the checklist.
Synthetic QA is not sign-off. See [tasks/W5-manual-playwright.md](tasks/W5-manual-playwright.md).
