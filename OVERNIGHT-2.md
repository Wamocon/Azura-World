# OVERNIGHT RUN 2 — 2026-07-28 → 29

Second unattended night. The evidence half of this product is deep and proven. **The ERP half is
18 modules short.** Tonight closes that gap.

Read `OVERNIGHT.md` first — its rules still apply. This file only records what changed.

---

## 1. Starting state

`main` at 136 commits. Gates: typecheck 0 · lint 0 · evidence 0 · **format FAIL** (prettier).

**Routable today:** `/` · `/login` · `/concierge` · `/hotel` · `/dashboard` · `/kitchen-sink`
**Dashboard modules built:** `evidence`, `units` — **2 of 20.**
**Unmerged:** `w3g-dashboard` (2 commits).
**Still PARTIAL:** W3-H (`report/` and `signup/` unbuilt).

## 2. What changed since night 1 — read this, it cost us a day

**Every window gets its own `git worktree`.** Night 1 shared one checkout; a `git checkout -b`
moved the shared HEAD and landed one window's commit on another's branch. Worktrees are already
the pattern in use — keep it.

```bash
git worktree add ../azura-<id> -b feature/INTERNAL-107-<id> origin/main
```

**Push with the switch and push in ONE command.** The Windows credential manager caches the wrong
account, and a concurrent window can flip the active `gh` account between two commands:

```bash
gh auth switch --user Maanik-WMC
export TK="$(gh auth token)"
git -c credential.helper= \
    -c credential."https://github.com".helper='!f() { echo username=x-access-token; echo "password=$TK"; }; f' \
    push -u origin <branch>
unset TK
```

**Message catalogues.** Four windows will append to `messages/{de,en,tr,ru}.json`. Keep every key
inside your own **sub-namespace** (`dashboard.finance.*`, not a new top-level key) as one
contiguous block at the same position in all four files. `dashboard.*` has six claimants, so
top-level allocation does not work. `check-i18n` rules 1 and 2 fail non-zero if a merge drops a
side, so a lost namespace cannot reach `main` quietly.

**A demo harness is not a deliverable.** W3-B shipped a state-toggle table demo onto the dashboard
home and it reached a client screenshot. Proofs live at `/kitchen-sink`, which 404s in production.

## 3. Tonight's windows

Five windows, file-disjoint per `ORCHESTRATION.md` §4. All five start now, in parallel.

| Window | Branch | Modules |
|---|---|---|
| **N1** | `n1-listings` | `listings` **(AC3)** · `leads` · `buyer-pipeline` |
| **N2** | `n2-finance` | `finance` · `wallet` · `vendor-invoices` |
| **N3** | `n3-operations` | `tickets` · `activities` · `calendar` · `communications` |
| **N4** | `n4-governance` | `documents` · `compliance` · `reports` · `users` · `admin` · `settings` |
| **N5** | `n5-public` | `report/` · `signup/` · admin capability matrix |

**N1 first if anything must be cut.** `/dashboard/listings` is acceptance criterion 3; the rest
is depth.

## 4. The rules that outrank finishing

Every module here reads real data with real provenance. Speed must not cost honesty.

1. **Every displayed fact carries its source.** No bare numbers in JSX. Grep your own output.
2. **Never resolve a source conflict silently.** Both values, both publishers, both URLs.
3. **A missing value is `Keine Angabe`**, never `0`, never blank, never an em dash.
4. **Modelled units stay visibly modelled.** 25 of 656 are real listings.
5. **Never mix currencies in an aggregate.** Per-currency subtotals only.
6. **Writes return 503 when Supabase is unconfigured.** Never a fake success.
7. **RLS ships in the same migration as the table.** Never "policies later".
8. **No em dashes in user-visible strings.** Plain German a property manager reads without help.
9. **Verify under `next start`, never `next dev`.** `pnpm qa:csp` must stay green.

## 5. Stop conditions

Halt, write `STATUS: BLOCKED` with the exact blocker, and stop:

- A prerequisite file your brief names does not exist
- `CONTRACTS.md` does not fit — **do not amend it**, four windows compile against it
- The same test fails three times with three different fixes — you are guessing
- You need a file another window owns (`ORCHESTRATION.md` §4)
- A destructive database operation looks necessary

**A clear blocker at 03:00 is a good deliverable. Eight hours of plausible-looking wrong work is
not.**

## 6. Never, unattended

`supabase db reset` against the linked cloud project · dropping any table holding data ·
`git push --force` · `--no-verify` · rotating credentials · `jira:sync` without `--dry-run` ·
editing `CONTRACTS.md` / `CONVENTIONS.md` / `SYSTEM-PROMPT.md` · committing anything under
`sources/` · disabling a failing test to make a gate pass.

## 7. Reporting

Commit every 30–45 minutes, only when `typecheck` and `lint` are green. Push your branch.

**Write `HANDOFF/<id>.md` when your task ends, not at 06:00 for everything at once.** If you crash
mid-chain, the handoff for the finished part is what survives. Every window on night 1 skipped
this on the first pass.

Append one line per hour to `HANDOFF/NIGHT-LOG-2.md`:

```
HH:MM  N<n>  <module>  <what happened>  <gates: green|red>
```

State only what you verified. Paste real output. Capture exit codes explicitly — `cmd | tail`
reports `tail`'s status, so a failing suite looks green. Anything not run is **NOT RUN**, with the
reason. Never "should pass".

## 8. Morning

The orchestrator merges all five, re-runs the 19 gates, and re-runs **W5** — whose verdict
("the dashboard is not demonstrable") was measured before `/login` existed and is now obsolete.
Passes 4, 5 and 7 have never actually run.
