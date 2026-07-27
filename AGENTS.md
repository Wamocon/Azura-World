# AGENTS.md — how not to break this repository

> **Last verified: 2026-07-27**, immediately after W0-A completed.
> **Code wins over docs.** Where this file and the repository disagree, the repository is right.
> Read `CLAUDE.md` first for what the project *is*. This file is what you must not do.
> `SYSTEM-PROMPT.md` outranks both. A brief may make a rule stricter, never looser.

---

## 1. Non-negotiables (SYSTEM-PROMPT §2)

Refusal-level. Violating one fails the task regardless of what else works. Numbers are stable —
cite them (`§2.8`) in handoffs and reviews.

### Data integrity

- [ ] **1.** Every fact displayed to a user carries its source URL. `SourcedFact<T>` enforces it.
      Do not cast around the type.
- [ ] **2.** Never silently resolve a source conflict. Both values, both URLs, and a `Finding`.
      Official and developer sources win the *display* value; the losing value is still stored
      and still reachable on demand.
- [ ] **3.** Never invent a number. Not in a fetched source ⟹ `null` + `confidence: "gap"` + a
      `note`. A missing price is honest; a plausible made-up price is fraud.
- [ ] **4.** Generated files carry a header naming the generator and saying *do not hand-edit*.
      Wrong output ⟹ fix the parser, never the file.

### Security

- [ ] **5.** RLS on every table holding personal or financial data, **in the same migration that
      creates the table**. Never "add policies later".
- [ ] **6.** `lib/rbac.ts` and the SQL role helpers change together, in one commit. A TS-only role
      is a security hole.
- [ ] **7.** The service-role key never reaches the browser bundle. Check your imports — the flat
      ESLint config already bans `lib/supabase/admin` and `lib/supabase/service-role` patterns,
      and `serverEnv` from `lib/env.ts` throws if it is read in the browser.
- [ ] **8.** RBAC decision happens **before** the model call, never after. A denied user must
      cause no outbound request.
- [ ] **9.** The AI system prompt forbids the model from *executing* financial, access-control or
      permission changes. It recommends; a human approves. Never weaken the wording.
- [ ] **10.** No secrets in code. `.env.example` holds placeholders only. Read configuration
      through `lib/env.ts` — `process.env.X` is banned everywhere except `next.config.ts` (the
      bootstrap) and `proxy.ts`'s single `NODE_ENV` read.
- [ ] **11.** Validate every API input: type, length ceiling, shape. Return a typed `ApiError`,
      never an unhandled exception — exception text leaks internals.
- [ ] **12.** Access profiles are triple-gated (`ENABLE_ACCESS_PROFILES` **and**
      `AZURA_ALLOW_REMOTE_ACCESS_PROFILES` **and** `AZURA_DEMO_DATA_ISOLATED`), QA-only, and must
      be impossible to enable on a production build path. `accessProfilesEnabled()` already
      returns `false` unconditionally when `NODE_ENV === "production"`. Do not add a second path.

### Correctness

- [ ] **13.** TypeScript strict. No `any` without a one-line justification directly above it.
- [ ] **14.** Server Components by default. `"use client"` only for state, effects or browser APIs.
- [ ] **15.** Every repository function returns `source: "supabase" | "local-seed"`. Check that
      field before suspecting the database.
- [ ] **16.** Posted financial ledger entries are immutable — by trigger, not by convention.
- [ ] **17.** Date arithmetic in seeds and scripts is platform-portable. No shell date math.

---

## 2. Reporting: state only what you verified

This is the rule that matters most. The reference project records it as a repeated past failure
(`LESSONS-LEARNED.md`: *hiding test exit codes behind `tail`*).

Grade every factual claim you write into documentation or a handoff:

| Tag | Meaning |
|---|---|
| `[V]` | **Verified** — observed in code, command output, an HTTP response, or a primary source |
| `[I]` | **Inference** — your reasoning from verified facts, labelled as reasoning |
| `[GAP]` | **Not established** — verification did not happen. Leave it as a gap. |

**Never fill a `[GAP]` with a plausible guess.** Ran a command? Quote the real output, failures
included. Didn't run it? Write "NOT RUN" and the reason — never "should pass". A build that
emitted warnings did not "pass cleanly". Partial completion is reported as partial, with the
remaining items named.

### The exit code trap

`cmd | tail` reports **`tail`'s** status, not `cmd`'s. `tail` almost always succeeds, so a piped
failing test suite reads as a pass. Capture the code explicitly.

bash — the reliable patterns:

```bash
pnpm --dir apps/web lint; echo "lint exit=$?"

# keep the output AND the real status: redirect to a file, then read it back
pnpm --dir apps/web lint > .tmp/lint.log 2>&1; CODE=$?; echo "lint exit=$CODE"; cat .tmp/lint.log

# if you must pipe
set -o pipefail
pnpm --dir apps/web lint | tail -40; echo "lint exit=${PIPESTATUS[0]}"
```

PowerShell:

```powershell
pnpm --dir apps/web typecheck
$code = $LASTEXITCODE
"typecheck exit=$code"          # assert on $code, not on what the text looked like
```

Use `$LASTEXITCODE`, not `$?`, for native executables. Do not use `2>&1` on a native executable
in Windows PowerShell 5.1 — each stderr line comes back wrapped as a `NativeCommandError` and
`$?` goes `$false` even on exit code 0. Redirecting to a file and reading `$LASTEXITCODE` on the
very next line is the pattern to trust.

Scripts in this repo honour `NO_COLOR=1` — set it before capturing output for a handoff, or you
will paste ANSI escape sequences into the document.

---

## 3. File ownership

**Exactly one window writes any given file** (`ORCHESTRATION.md` §4).

1. Write only the files listed under "Files you own" in your brief. Everything else is read-only,
   including files it would be trivial and obviously correct to fix.
2. Need a change elsewhere? Put it under `## Requests for other windows` in your handoff, naming
   the file **and** the owning task. Do not reach across — the owner will overwrite you next wave
   and the loss is silent.
3. Never `git commit` another window's paths. All windows share one working tree and one branch,
   so `git add -A` will stage somebody else's half-finished work. Stage explicit paths.
4. Never run `pnpm install` concurrently. W0-A owns dependency installation and has already run
   it; `pnpm-lock.yaml` and `node_modules/` exist.
5. A prerequisite handoff missing ⟹ **stop and say so**. Do not stub the missing piece. A stub
   that compiles is worse than a clean block, because the next window builds on it.
6. `CONTRACTS.md`, `CONVENTIONS.md`, `SYSTEM-PROMPT.md`, `ORCHESTRATION.md` are frozen after
   wave 0. `HANDOFF/*.md` is append-only and you write only your own file.

Two W0-A-owned files carry a **marked seam** another window must fill. Touch only the marked
region, and say so in your handoff:

| File | Seam | Owner |
|---|---|---|
| `apps/web/proxy.ts` | `refreshSupabaseSession()` and `guardRoute()`, both `TODO(W1-B)` | W1-B |
| `apps/web/app/layout.tsx` | the commented `import "./globals.css"` line | W1-D |
| `apps/web/next.config.ts` | the commented `createNextIntlPlugin` seam | W1-C |

---

## 4. Subagent fan-out (ORCHESTRATION §7)

A window is one task, not one thread. Fan out where subtasks are independent, then integrate the
results yourself.

1. **You own the files, not your subagents.** They return content, analysis or a diff; *you*
   write it. Two subagents writing one file collide exactly like two windows. Have them draft
   into a scratchpad outside the repo.
2. **Fan out on research and generation, never on integration.** Six parsers in parallel is safe;
   three agents "finishing the schema" is not.
3. **Give every subagent the same non-negotiables** — point it at `SYSTEM-PROMPT.md` §2 and the
   relevant `CONTRACTS.md` section, or it invents its own conventions.
4. **Verify their output yourself.** A subagent reporting success is a claim, not evidence. Run
   the command. W0-A's subagents each reported a clean typecheck; the numbers in
   `HANDOFF/W0-A.md` are the parent's own re-runs, not theirs.
5. Cap at ~4–6 concurrent. Beyond that you contend for CPU, not gain speed.

Never fan out anything with a global invariant: migration numbering, the OpenAPI spec,
`contracts.ts`, the i18n key structure, final integration.

---

## 5. Definition of done (SYSTEM-PROMPT §5)

- [ ] Every deliverable in the brief exists and does what the brief says
- [ ] `pnpm --dir apps/web typecheck` → 0 errors *(paste the output)*
- [ ] `pnpm --dir apps/web lint` → 0 errors, 0 warnings *(paste the output)*
- [ ] The brief's task-specific verification commands pass *(paste the output)*
- [ ] No file outside your ownership list was modified — verify with `git status`
- [ ] `HANDOFF/<task-id>.md` written
- [ ] Every edge case in your brief is handled, or listed as deliberately deferred with a reason

Cannot reach done? Write the handoff anyway as `STATUS: BLOCKED`, naming the exact blocker. A
clear blocker is a useful deliverable; a silent partial is not.

---

## 6. Edge cases that catch people out (CONVENTIONS §5)

- **Turkish casing.** `"I".toLowerCase()` is **not** `"ı"` in Turkish, and `"i".toUpperCase()` is
  not `"I"`. Slugs, filenames and sort order all go through locale-aware
  `Intl.Collator("tr")` / `toLocaleLowerCase("tr")`. `lib/utils.ts` exports `collatorFor(locale)`
  for exactly this. Characters in play: `ı İ ş Ş ğ Ğ ç ö ü`.
- **German copy runs ~30% longer than English.** German is the default locale. Compounds overflow
  buttons and nav items — test `de` first, not last.
- **`null` vs `0`.** A price of `0` is a bug; a price of `null` is an honest gap. Never coerce,
  never `?? 0`, never `|| 0`. The same applies to the FX rates: `0` means "not configured", which
  is why `lib/env.ts` returns a discriminated `FxDisplayRate` instead of a bare number.
- **Validate the bytes, not the HTTP status.** A 200 carrying a bot wall or a soft-404 is
  `contentValidated: false`. Ataberg shipped 51 of 154 "downloads" as 404 pages wearing a `.jpg`
  extension because the first pass trusted `response.ok`.
- **Mixed currency is never silently converted.** Portals quote EUR and USD for the same unit.
  Store `Money` with its currency; convert only at display, labelled, with the rate's date.
- **A price with no observation date** ⟹ `confidence: "single_source"` plus a `Finding`. A stale
  price presented as current is the most damaging error this project can make.
- **Two URLs on one host are not two sources.** Invariant 3 requires *distinct hosts* for
  `"confirmed"`. `assertFactInvariants()` rejects same-host pairs; do not work around it.
- **656 units in one table** ⟹ virtualise or paginate. Never render 656 DOM rows.
- **`prefers-reduced-motion`** ⟹ GSAP timelines and R3F degrade to *static*, not to "less".
- **No WebGL** (older devices, headless CI) ⟹ poster fallback, not a blank box.
- **RTL is not required** — no Arabic or Hebrew locale. Do not build for it.
- Four states for every data surface: empty, loading, error, partial. Not one.

---

## 7. Windows

Before any Playwright run, point the browser cache and the temp dirs into `.tmp` (which is
git-ignored) so downloads do not land in a roaming profile or a locked system temp:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = ".tmp\pw"
$env:TEMP = ".tmp"
$env:TMP  = ".tmp"
```

`.env.example` already sets `PLAYWRIGHT_BROWSERS_PATH=.tmp/pw`; `TEMP` and `TMP` are process
environment and must be set in the shell.

`corepack enable` needs an elevated shell on this machine (`EPERM` on
`C:\Program Files\nodejs\pnpx`). `corepack prepare pnpm@10.0.0 --activate` does not, and is
sufficient — it is what pinned pnpm to 10.0.0 here.

Line endings: `.gitattributes` forces LF repo-wide. CRLF breaks Supabase migrations and
exact-match source-inspection tests — do not override it per-editor.
