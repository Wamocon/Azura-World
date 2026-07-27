# W4-D — Quality gates, traceability, release report

**Wave:** 4 · **Depends on:** all of wave 3 · **Runs with:** W4-A, W4-B, W4-C

> Read `SYSTEM-PROMPT.md` §3 (how you report) and every handoff written so far. Then read
> `D:\Real Estate CRM\Cati\docs\PROJECT-STATUS-2026-07-24.md` — that document is the model for
> the honesty register you are producing.

---

## Mission

Aggregate every check into one gate, map every acceptance criterion to a passing test, and write
the release status document.

Your output is the thing someone will read to decide whether this can be shown to a client. That
makes **honesty the deliverable**, not greenness. The reference status document is exemplary
here: it distinguishes "326 assertions planned" from "139 executed and passed", says plainly
that a full Playwright result is "ausstehend", and lists what synthetic QA cannot prove. Match
that register exactly.

---

## Files you own

```
scripts/quality-gate.mjs · scripts/traceability.mjs
.github/workflows/*.yml
QUALITY-REPORT.md · TRACEABILITY.md · RELEASE-STATUS.md
HANDOFF/W4-D.md
```

---

## Deliverables

### 1. `scripts/quality-gate.mjs`

Runs everything, in dependency order, **capturing real exit codes**:

| # | Gate | Command | Blocking |
|---|---|---|---|
| 1 | Typecheck | `pnpm --dir apps/web typecheck` | yes |
| 2 | Lint | `pnpm --dir apps/web lint` | yes |
| 3 | Format | `prettier --check` | yes |
| 4 | Build | `pnpm --dir apps/web build` | yes |
| 5 | i18n parity | `node scripts/check-i18n.mjs` | yes |
| 6 | Evidence integrity | `pnpm qa:evidence` | yes |
| 7 | OpenAPI contract | `pnpm test:contract` | yes |
| 8 | Unit tests | `node --test` | yes |
| 9 | pgTAP | `npx supabase test db` | yes (or NOT RUN, stated) |
| 10 | e2e chromium | `test:e2e --project=chromium` | yes |
| 11 | e2e mobile | `test:e2e --project=mobile-chrome` | yes |
| 12 | Layout | `pnpm qa:layout` | yes |
| 13 | a11y | `pnpm qa:a11y` | yes |
| 14 | Performance | `pnpm qa:perf` | yes |
| 15 | Security probe | `node scripts/security-probe.mjs` | yes |
| 16 | Bundle budget | size check | yes |
| 17 | Secret scan | `gitleaks` or equivalent | yes |
| 18 | Dependency audit | `pnpm audit --audit-level=high` | yes |
| 19 | Evidence drift | `evidence-drift.mjs --report-only` | no |

Rules that make this a gate rather than a formality:

- **Never pipe a command through `tail` or `head`.** Capture `$?` / `$LASTEXITCODE` explicitly.
  The reference project's `LESSONS-LEARNED.md` records this exact failure — a suite hidden behind
  a pipe reports the pipe's success.
- A gate that **cannot** run (no Docker for pgTAP) is reported **NOT RUN**, never PASS. This will
  probably happen — the reference project hit exactly this.
- `--fast` runs 1–8 only, for wave gates. Full run for release.
- Machine-readable JSON output plus a human summary.

### 2. `TRACEABILITY.md`

Every acceptance criterion → the tests that prove it. This is what makes the ticket closeable.

| AC | Requirement | Implemented in | Proven by | Status |
|---|---|---|---|---|
| 1 | Ein CATI für Azura World erstellen | all waves | full gate | |
| 2 | Die wichtigsten Quellen und Links berücksichtigen | W0-B, W3-C | `qa:evidence`, `e2e/evidence/sources.spec.ts` | |
| 3 | Informationen aus Immobilien-Portalen einbeziehen | W0-B, W3-C | `e2e/inventory/listings.spec.ts` | |
| 4 | Bewertungen und Hotel-Buchungsquellen einbeziehen | W0-B, W3-G | `e2e/hotel/reviews.spec.ts` | |

**An AC with no passing test is not met.** Say so.

### 3. `RELEASE-STATUS.md` — the honesty register

Structure it after the reference status document:

1. **Kurzfassung** — what is genuinely ready, in two paragraphs
2. **Verified technical state** — a table with a column that says *what the evidence actually is*
3. **Functional limits of synthetic QA** — per feature, the honest current proof. Where the
   reference says *"Seed- oder Prozessdaten sind kein Persistenznachweis"*, say the equivalent.
4. **What is NOT proven** — persistence, real auth, provider integrations, production UAT,
   backup/restore, live AI provider. Name each explicitly.
5. **Open decisions** — the things code cannot resolve
6. **Source authority gap** — if W0-B could not recover the developer sites, this belongs here as
   a first-class limitation, because every structural figure then rests on tier-4 portals
7. **Recommendation** — ready for demo / ready for UAT / not ready, with reasoning

Rules:
- Distinguish **planned** from **executed** for every test count.
- Never write "should pass" or "expected to work".
- If the full e2e matrix did not complete, the status is "outstanding", not "passed".

### 4. CI workflow

`.github/workflows/quality.yml` — gates 1–8 on every PR, full gate on `main`.
Note in the handoff whether CI actually runs anywhere yet; the reference repo has **no** PR CI
and requires manual gates, so do not imply automation that does not exist.

### 5. Documentation refresh

Update `CLAUDE.md` and `AGENTS.md` to reflect the built system, with a **last-verified date** and
measured numbers. The reference `CLAUDE.md` drifted to claiming 7 migrations when 64 existed —
that is the failure mode to avoid. Include an explicit note that code wins over documentation.

---

## Edge cases

- **Docker unavailable** → pgTAP NOT RUN. Say it. Do not infer a pass from static SQL review.
- **A gate passing for the wrong reason** — e.g. e2e green because every test was skipped.
  Assert on the *executed* count, not just the exit code.
- **Flaky test hidden by a retry** → report flakes by name; retries do not make a suite stable.
- **Windows path with a space** (`D:\Azura World`) → quote everything, everywhere.
- **A gate that hangs** → per-gate timeout, and a hang is a failure, not a wait.
- **Partial handoffs** — if a wave-3 window is PARTIAL, the gate must reflect the missing surface
  rather than passing because the tests for it were never written.
- **Secret scan false positives** on `.env.example` placeholders → allowlist precisely, never
  disable the scan.

---

## Definition of done

```bash
node scripts/quality-gate.mjs --full ; echo "exit=$LASTEXITCODE"
```

Paste the complete gate table with real results and real exit codes. Then:

- `TRACEABILITY.md` — every AC mapped, status honest
- `RELEASE-STATUS.md` — complete, in the register described above
- `QUALITY-REPORT.md` — full output archive

---

## Handoff must state

- The gate table: PASS / FAIL / **NOT RUN** for all 19
- Test counts: **defined vs executed vs passed**, for every suite
- Which acceptance criteria are genuinely met, with the proving test named
- The single-sentence honest answer to: *can this be shown to a client on 29 July?*
