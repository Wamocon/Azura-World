# HANDOFF — W-INT2  Second integration: eight branches into main

STATUS: COMPLETE
Completed: 2026-07-28
`main`: `bb9bf87` → **`b5a0c83`**, pushed

> **One sentence:** all eight branches merged with zero conflicts and `main` now runs every gate
> it previously could not, which is why the failure count went **up** — 8 of 19 blocking gates
> fail, and that is the first honest picture this project has had.

---

## 1. The merge

Simulated first with `git merge-tree --write-tree`, chaining throwaway `commit-tree` objects so
the cumulative result was predicted without touching the working tree. **All eight CLEAN.**

| # | Branch | Simulated | Actual |
|---|---|---|---|
| 1 | `w1c-w0d-i18n-media` | CLEAN | exit 0 |
| 2 | `w2b-api` | CLEAN | exit 0 |
| 3 | `w3c-inventory` | CLEAN | exit 0 |
| 4 | `w4b-harness` | CLEAN | exit 0 |
| 5 | `w4c-security` | CLEAN | exit 0 |
| 6 | `w4d-gates` | CLEAN | exit 0 |
| 7 | `wux-plain-language` | CLEAN | exit 0 |
| 8 | `w4a-e2e` | CLEAN | exit 0 |

**Zero conflicts, including the two that were expected.** `messages/*.json` did not conflict
because the windows genuinely wrote disjoint regions: W3-C added one contiguous block inside
`dashboard.units.*`, W-UX rewrote scattered values elsewhere, and both kept 2-space formatting so
no reflow was introduced. `HANDOFF/NIGHT-LOG.md` did not conflict because nothing appended to it
after the first integration.

**`w4a-e2e` was local-only.** It had never been pushed and exists only as a branch in the
`D:\azura-w4a` worktree. It is now in `main`; the branch should still be pushed so the commits
have a remote home.

---

## 2. Every gate, exit code read directly from the process

None of these was piped. Each ran as its own command and `$?` was captured on the next line.

| Gate | Exit | Result |
|---|---|---|
| `typecheck` | **0** | PASS |
| `lint` | **0** | PASS, 0 errors 0 warnings |
| `build` | **0** | PASS, 43 routes, compiled in 15.6s |
| `verify-evidence` | **0** | PASS, 1,354 facts · **25 portal_listing + 631 modelled = 656** · no violations |
| `check-i18n` | **0** | PASS, **831 keys × 4**, identical key sets |
| `qa:csp` | **0** | PASS, **30 pass · 0 fail** |
| `validate-openapi` | **0** | PASS, **13 pass · 0 fail · 23 exempt** over 33 paths / 49 operations |
| `layout-audit` | **1** | FAIL, **50 pass · 149 fail · 1,822 findings**, 192 page loads |
| `a11y-audit` | **1** | FAIL, **6 pass · 18 fail** |
| `perf` | **1** | FAIL, **9 pass · 3 fail** |
| `security-probe` | **1** | FAIL, **1 critical · 3 high** |
| `e2e` chromium | **1** | FAIL, **270 passed · 13 failed** |

**7 pass, 5 fail.**

### `qa:csp` — a false alarm worth recording

It first reported **26 pass · 4 fail**, three of them *"NOT a production policy — is
NODE_ENV=production?"*. Not a merge regression: a stray `next dev` (PID 37592, started 14:01) held
port 3200, the probe's default, so it attached to a dev server and correctly **refused to pass
itself** against a dev policy — exactly the self-protection W-INT built into it. Re-run with
`--port 3220`: **30 pass · 0 fail, exit 0**. The gate runner now pins its own ports (3230–3233) so
this cannot recur.

---

## 3. W4-D's 19-gate suite, re-run — and why its old table was stale

`node scripts/quality-gate.mjs` on `b5a0c83`: **10 PASS · 8 FAIL · 1 NOT RUN**, exit 1.

| | previous run | merged `main` |
|---|---|---|
| blocking PASS | 9 | **10** |
| blocking FAIL | 2 | **8** |
| blocking NOT RUN | **8** | **1** |

**NOT RUN fell from 8 to 1.** The only survivor is gate 9, pgTAP: `docker info` still exits 1.
W1-A's cloud substitute stands at **366 defined / 366 executed / 366 passed** and is still recorded
as a substitute rather than as the gate it stands in for.

Two causes of the staleness, and only one was "they hadn't pushed yet":

1. W4-A, W4-B and W4-C had not pushed when the table was produced, so their targets genuinely did
   not exist.
2. **One entry was wrong on its own terms.** The gate looked for `scripts/a11y.mjs`; W4-B shipped
   `scripts/a11y-audit.mjs`. That gate would have reported NOT RUN forever, against a filename
   that never existed. Fixed, along with the port pinning above.

**Six gates moved NOT RUN → FAIL. That is the point of running them**, not a regression: e2e
chromium, e2e mobile-chrome, layout, a11y, performance, security. Two moved NOT RUN → PASS: the
OpenAPI contract and evidence drift.

`Format` still fails (159 files) and `Dependency audit` still fails (8 high + 7 moderate, all nine
`next` advisories patched in `>=16.2.11` against a pin of exactly `16.2.6`).

---

## 4. What the newly-running gates found

### `security-probe` — one critical

**SEC-A03 [critical]** — `lib/auth.ts` selects `roles` and `anonymized_at` from `public.profiles`
and **no migration creates either column**. PostgREST answers `42703`, the read fails, and **every
authenticated user degrades to the minimal tenant**. Owner: **W1-B / W1-A**. This is a correctness
and access-control fault that no other gate could see, because typecheck cannot know what the
database contains.

Three highs, all **W0-B**, all in committed data:
- **SEC-H03** F-002's narrative claims *"across four publishers"* while carrying **three**
  `competingValues`.
- **SEC-H04** F-002 states a ratio computed across **EUR and USD** — only possible via a conversion
  this product forbids.
- **SEC-H05** **Four identifiable staff names** are present in `lib/azura-world-data.ts` and
  `lib/hotel-data.ts`. **This repository is public.** Treat as the most urgent of the three.

### `perf` — two real budget breaches

- **CLS 0.1244 > 0.1** on `landing:desktop`, across 4 layout shifts.
- **Landing JS 264.7 KB gz > 250 KB** (excluding the 3D chunk, which is separately within its
  260 KB budget at 227.4 KB).
- LCP is comfortable everywhere measured: 740 ms desktop cold, 1,200 ms mobile cold, against a
  2,500 ms budget.

### `a11y-audit` — 18 of 24 route×theme combinations fail

At least one serious/critical issue on **every locale** of `/`, `/hotel` and `/kitchen-sink`. Note
W4-B's own caveat: this is **not axe-core** (not an installed dependency), it checks the underlying
rules directly, and the CONVENTIONS §7 *"Lighthouse a11y ≥ 95"* budget is **not** checked at all.

### `layout-audit` — 1,822 findings

50 pass · 149 fail over 192 page loads. Categories include contrast (6 of 42 gradient-backed styles
below threshold), truncation, tap targets and clipping.

### `e2e` — 270 passed, 13 failed

Failures cluster on routes that do not exist yet (`/dashboard/reports`, `/dashboard/units` marked
*"route not built"* by the matrix itself), one landmark assertion (`/dashboard/evidence` renders
exactly one `<main>`), and one security assertion (a low role reaching the evidence cockpit's
content).

---

## 5. Decisions I made

| Decision | Why |
|---|---|
| Simulate all eight cumulatively before merging | A per-branch simulation would have missed conflicts that only appear once an earlier branch is in the tree. Chaining `commit-tree` objects predicts the real sequence without touching the tree |
| Merge in the shared tree at `D:\Azura World` rather than a scratch worktree | It was already on `main` and clean apart from two tracked files, which were stashed. W-INT needed a scratch worktree because the tree was on a feature branch with 78 untracked paths; that condition no longer held |
| Stash `CLAUDE.md` rather than commit or discard it | Its working-tree change replaces the project file with the **generic global harness-config boilerplate**, and the same churn is present in the `w3c`, `w4d` and `wux` worktrees. It looks like tooling, not authorship. Stashed, recoverable, **not merged** |
| Pin gate ports 3230–3233 | The CSP false alarm above. A gate that silently measures whatever server happens to hold a port is not a gate |
| Report the six new FAILs rather than tune them green | They are the first real measurements this project has had of layout, a11y, performance, security and end-to-end behaviour. Making them pass is the next task, not this one |

---

## 6. Requests for other windows

- **W1-B / W1-A — SEC-A03 is critical and it is yours.** Either add `roles` and `anonymized_at` to
  a migration, or stop selecting them in `lib/auth.ts`. Today every authenticated user silently
  degrades to the minimal tenant.
- **W0-B — SEC-H05 first**: four staff names in committed data, public repo. Then SEC-H03 and
  SEC-H04, which are both F-002 narrative claims that the data does not support.
- **W3-A / W1-D — perf**: CLS 0.1244 and landing JS 264.7 KB gz. Both are over budget and both are
  on the page a client will be shown.
- **W4-A — push `feature/INTERNAL-107-w4a-e2e`.** It is merged into `main` but has no remote.
- **W4-B — the a11y and layout numbers are now real.** 18 of 24 combinations and 1,822 findings.
- **Repo owner** — `Format` (159 files) and the Next.js security bump (9 advisories, patched in
  `>=16.2.11`, pinned at `16.2.6`) are both still open decisions from `RELEASE-STATUS.md` §5.

---

## 7. Known gaps

- `[GAP]` **pgTAP still NOT RUN.** Docker unavailable for the entire project to date.
- `[GAP]` **e2e mobile-chrome was run only inside the 19-gate suite**, where it failed; I did not
  run it standalone or triage its failures separately from chromium's.
- `[GAP]` **No CI run on the merged `main`.** The push succeeded and the two required checks were
  reported as expected by the remote; I did not wait for or read the CI result.
- `[GAP]` **I did not re-run W-UX's plain-language gate after the merge.** W3-C's
  `dashboard.units.provenance.*` keys landed after W-UX's vocabulary pass ran, so they still carry
  the pre-rewrite wording, including at least one em dash. The two passes were correct
  individually and the merge did not reconcile them.
- `[GAP]` **`CLAUDE.md` and `AGENTS.md` remain unrefreshed**, still carrying a "Last verified
  2026-07-27" header from before waves 2, 3 and 4.
