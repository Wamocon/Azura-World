# SUPERVISOR NOTES

Diagnoses only. The supervisor does not edit files another window owns.

---

## 19:07 — cycle 1

**All four windows alive.** Last push: W3 8 min, W2 18 min, W1 31 min, W4 34 min. Nobody stalled.

Gates **in the shared working tree**: `typecheck` **RED** · `lint` **RED** · `evidence`
**GREEN** (656 units, no violations).

> **Important caveat.** The shared tree contains all four windows' in-progress work at once, so a
> red tree does not mean a red branch. W3b reports (19:05): *"typecheck+lint RED in the shared
> tree but ONLY on W2-C `lib/ai-*.ts` and W1-D `coast-maquette.tsx` — none of those files exist
> on my branch, which is green."* Per-branch verification would require checking out, which would
> yank the tree out from under four live windows. **Deferred to morning.**
No `.env` tracked, no `sources/` content tracked. Secret hygiene clean.

---

### S-001 · HIGH · typecheck red — `SourceTier` widened to `number` · owner **Window 2 (W2-C)**

```
lib/ai-retrieval.ts(147,5) TS2345
lib/ai-retrieval.ts(154,5) TS2345
  Type 'number' is not assignable to type 'SourceTier'
```

`SourceTier` is the literal union `1|2|3|4|5|6` (CONTRACTS §1). Object literals are building
`tier` as a widened `number`, so the whole `SourceRef` fails to satisfy `SourcedFact`.

**Fix (W2-C's call, but the shape is standard):** either annotate at construction —
`const ref: SourceRef = {...}` — or `tier: 4 as const`, or parse through a guard
`function toTier(n: number): SourceTier`. **Do not** `as any` or loosen the union in
`CONTRACTS.md`; three other windows compile against it.

*`lib/local-ai.ts` also failed at 19:02 and was clean by 19:07 — Window 2 is actively fixing.
This may resolve without intervention.*

### S-002 · MEDIUM · lint red — 5 errors, all in one window · owner **Window 4 (W1-D)**

```
ERROR  [locale]/kitchen-sink/kitchen-sink-client.tsx:84   react-hooks/use-memo
ERROR  [locale]/kitchen-sink/theme-toggle.tsx:26          react-hooks/set-state-in-effect
ERROR  components/anim/reveal.tsx:160                     react-hooks/refs
ERROR  components/three/coast-maquette.tsx:62             react-hooks/set-state-in-effect
ERROR  components/three/coast-maquette.tsx:71             react-hooks/set-state-in-effect
warn   components/anim/counter.tsx:5                      no-unused-vars
```

All React 19 compiler rules. The `set-state-in-effect` pair in `coast-maquette.tsx` is the
WebGL/reduced-motion fallback path — the comment at line 70 ("rather than never showing it")
shows this is a deliberate guard, but calling `setState` synchronously in an effect still
triggers cascading renders. **Derive during render or use `useSyncExternalStore` for the
capability check** rather than an effect. `reveal.tsx:160` reads a ref during render.

Not a blocker for other windows — these files are W1-D's alone. But **`main` requires the lint
check to pass, so this branch cannot merge until it is green.**

### S-003 · HIGH · shared working tree — structural, needs a morning decision

All four windows are operating in **one checkout**. Window 4 holds `HEAD`; Windows 1, 2 and 3b
are committing to their branches via a private `GIT_INDEX_FILE` without checking out. They
worked this out independently and documented it, which is good improvisation — but it already
cost one incident:

> W3b, 19:20: *"`git checkout -b` moved the SHARED HEAD, so my first W1-C commit (4d8d8ec)
> landed on W4's branch and W4 committed on top of it. Recovered by replaying the same 17 paths
> onto the correct branch (f9bc385, verified byte-identical). **4d8d8ec stays on
> w1d-w3i-design — cannot be removed without rewriting W4's branch.**"*

So `feature/INTERNAL-107-w1d-w3i-design` carries one W1-C commit that does not belong to it.
Harmless if both branches merge, but it means W4's branch is not a clean W1-D diff.

**Root cause:** OVERNIGHT.md §1 assigned a branch per window but assumed separate checkouts.
That was my omission — `git worktree add` per window is the correct pattern and I did not
specify it.

**Morning decision, not a night action:** either accept the contamination and merge both
branches, or rebase. Do **not** rewrite a branch while its window is still committing to it.

### S-004 · MEDIUM · duplicate Window 3 executor

Two executors are running Window 3's chain. They negotiated ownership in the night log rather
than colliding — one took W1-C (COMPLETE, 576 keys × 4 locales, 0 stubs), the other took W0-D.
One real collision at 18:51: two encoders ran over different asset sets; the one with stale data
(754 assets) was killed in favour of the corrected run (776). Handled correctly.

Useful side effect: the reclassification caught that **173 of 174 cebecigroup "floorplans" were
construction aerials** — real plans are 17 (14 floorplan + 3 siteplan).

No action needed. Both are behaving.

### S-005 · MEDIUM · Docker down — pgTAP cannot run as specified

W1-A reports the Docker daemon is unavailable, so `supabase test db` will not run. It adapted by
running pgTAP 1.3.3 against the **cloud** database inside `BEGIN..ROLLBACK`.

That is a reasonable substitute and it is honest about being one. **W1-A's handoff must record
assertions *executed*, and state plainly that `supabase test db` was NOT RUN and why** — the
reference project's status document makes exactly this distinction and it is the standard here.

### S-006 · INFO · migrations applied to the live cloud project

W1-A applied migrations 00–03 to the live Supabase project (PG 17.6) and verified all five
enforceable `SourcedFact` invariants fire server-side, including rejection of a same-host
`confirmed` fact. The database was empty and this was authorised. Recorded for visibility.

### S-007 · MEDIUM · Dependabot opened 8 PRs — several violate the pinned versions

| PR | Bump | Verdict |
|---|---|---|
| **#8** | typescript 5.9.3 → **7.0.2** | ❌ **Do not merge.** Major. CONVENTIONS §1 pins TS 5. |
| **#7** | eslint 9.39.5 → **10.8.0** | ❌ **Do not merge.** Major, and the React-compiler rules in S-002 would shift under it. |
| **#6** | @types/node 20 → **26** | ❌ Do not merge. Node is pinned ≥20. |
| **#4** | pinned-core group (3 updates) | ⚠️ Review individually — this group is `next`/`react`/`three` etc. |
| #5 | eslint-config-next 16.2.6 → 16.2.12 | ✅ Safe, patch-level |
| #1–3 | GitHub Actions major bumps | ⚠️ Low risk, but read the changelogs |

My `dependabot.yml` restricted the *pinned-core group* to minor/patch but left the ungrouped
dev-dependencies unbounded — that is why the TS and eslint majors appeared. **Nobody should merge
these overnight.** Morning fix: add an `ignore` block for major updates on
`typescript`, `eslint`, `@types/node`.

---

## Morning summary

**Working:** all four windows productive, evidence gate green, secret hygiene clean, W1-B and
W1-C complete with verified gates.

**Needs you:**
1. Decide on the contaminated W4 branch (S-003)
2. Close or restrict dependabot PRs #6, #7, #8 (S-007)
3. Confirm the cloud-pgTAP substitution is acceptable evidence (S-005)

**Should self-resolve:** S-001 and S-002 are each in one window's own files, and both windows are
actively committing.

---

## 21:02 — cycle 2

**All four chains COMPLETE.** Windows idle 69–86 min — finished, not stalled.

Gates on the shared tree, verified independently by the supervisor:

```
typecheck  exit 0     lint  exit 0 (0 errors, 0 warnings)
build      exit 0     evidence exit 0  (656 units, no violations)
```

Secret hygiene clean: 0 tracked `.env`, 0 tracked `sources/media`, 0 tracked `sources/raw`
content, no secret-shaped string anywhere in tracked files.

| Branch | Commits | Chain |
|---|---|---|
| `w1a-w2a-data` | 14 | W1-A ✅ → W2-A ✅ |
| `w1b-w2c-auth-ai` | 7 | W1-B ✅ → W2-C ✅ → W2-D (PARTIAL by design) |
| `w1c-w0d-i18n-media` | 7 | W1-C ✅ → W0-D ✅ |
| `w1d-w3i-design` | 16 | W1-D ✅ → W3-I ✅ |

**S-001 CLOSED** — and the root cause was not what I diagnosed. I attributed the `SourceTier`
widening to W2-C's object literals. W2-C traced it further: `azura-world-data.ts` types
`project`/`hotel`/`portalListings` as `Record<string, unknown>`, and because the file ends in
`satisfies AzuraWorldDataset`, those subtrees receive no contextual type at all — so `tier`
widened to `number` and `confidence` to `string` at every call site. Fixed via the guard route
(`isSourcedFact()` before render, malformed facts dropped and counted). **The generator still
emits the weak types — W2-A, W3-C and W3-G will each hit this.** Fix requested from W0-B.

**S-002 CLOSED** — W4 fixed all five lint errors in its own files.

---

### S-008 · CRITICAL (found and fixed by W1-A) · every authenticated user was an admin

`is_admin()` is `SECURITY DEFINER`, so `current_user` inside it resolves to the *function owner*,
not the caller. `is_service_context()` therefore returned true for everyone, and every
authenticated user passed every admin check.

Found by the **negative** pgTAP suite — the half that asserts what a role *cannot* reach. Two
further real bugs came out of the same run: a deactivated profile kept its residency scope, and
`anon` could not read `public.units` at all (helper-calling policies were evaluated for anon), so
the landing page would have shipped empty.

All three fixed. **366 pgTAP assertions, 366 pass, 0 fail** against the live cloud DB.

This is the strongest argument in the whole run for writing the negative tests first.

### S-009 · CRITICAL (found by W4, unresolved) · prerendered pages run zero JS in production

`proxy.ts` emits a per-request `'nonce-…' 'strict-dynamic'` CSP. A **statically prerendered**
page has no request to read the nonce from, so its scripts carry no nonce and `strict-dynamic`
blocks every one of them.

Measured under `next start`: **0 B JS, 0 canvas, 1 CSP violation per chunk.** The page renders;
nothing is interactive. **It does not reproduce under `next dev`.**

W4 fixed its own route with `force-dynamic` and correctly did **not** touch `proxy.ts` (W1-B's).

**This blocks W3-A.** A `force-static` landing page would ship dead in production and look fine
in every dev check. Needs a proper fix in `proxy.ts` — either a static-safe CSP fallback or a
documented rule that no route may be statically prerendered.

### S-010 · MEDIUM · the 150 KB 3D budget is unreachable with the pinned stack

Lazy 3D chunk measures **236.4 KB gz against a 150 KB budget** — over by 86 KB. W4 tested
removing `drei`: it saved **10 bytes**, so it was already tree-shaken, and the change was
reverted. The 236 KB is three.js + R3F itself.

`CONVENTIONS.md` §7 sets that budget. Either raise it for the 3D route specifically, drop WebGL
for a lighter treatment, or accept the overage as a documented exception. **A decision, not a bug.**

### S-011 · MEDIUM (found by W2-A) · RLS looser than RBAC on `leads`

Migration 14's `leads` RLS admitted `staff`, but `rbac.ts` grants staff no `leads` permission.
RLS being *looser* than RBAC is the dangerous direction — the UI hides it, the database allows
it. Tightened. Also found: a guest could reach an owner's private unit **in seed mode only**
(seed and DB disagreed on `is_publicly_listed`), and `toApiError()` missed SQLSTATE 22023, so an
over-long search query returned a retryable 503.

### S-012 · INFO · two windows correctly refused to fabricate

W2-A's subagent drafted synthetic fixtures for 5 empty tables, then **removed them rather than
ship invented numbers**, recording a `[GAP]` for W3-D/E/F to fill. Separately, a subagent
reverted a real fix on a false claim; W2-A verified against `seed.sql:4284` and the live DB and
restored it with the evidence inline. Both are the behaviour the system prompt asks for.

---

## Morning summary — cycle 2

**Done:** waves 0, 1 and most of 2. 9 tasks COMPLETE, 1 PARTIAL by design. All four gates green.

**Not started:** W2-B (API/OpenAPI). W1 deliberately declined the stretch — *"the night is late
enough that a fresh window should take it with the handoffs in hand."* Sound call.

**Needs you:**
1. **S-009** — the CSP/prerender bug. Blocks W3-A. Highest priority.
2. **S-010** — decide the 3D budget.
3. **S-003** — contaminated W4 branch (still open from cycle 1).
4. **S-007** — dependabot PRs #6/#7/#8 must not merge (still open).
5. Generator fix in `azura-world-data.ts` (root cause of S-001) before wave 3 starts.

---

## 23:02 — cycle 3

**No change since cycle 2.** All four windows idle 3 hours; 13 handoffs, same set. Nothing
BLOCKED, nothing stalled mid-task — the chains finished and the windows stopped.

Gates re-verified, all four green:

```
typecheck exit 0   ·   lint exit 0 (0/0)   ·   build exit 0   ·   evidence exit 0 (656 units)
```

### S-013 · CLOSED · "uncommitted" work in the shared tree is not at risk

`git status` on the shared tree showed 7 modified and 76 untracked paths, which looked like
unsaved work. It is not. The tree sits on W4's branch, so every file another window committed via
its private index reads as modified-or-untracked from here.

Verified by hashing each modified file against every branch:

| File | Committed on |
|---|---|
| `apps/web/proxy.ts` | `w1b-w2c-auth-ai` |
| `apps/web/lib/lqip.json` | `w1c-w0d-i18n-media` |
| `apps/web/lib/media-manifest.ts` | `w1c-w0d-i18n-media` |
| `scripts/check-i18n.mjs` | `w1c-w0d-i18n-media` |
| `scripts/encode-images.mjs` | `w1c-w0d-i18n-media` |
| `scripts/harvest-media.mjs` | `w1c-w0d-i18n-media` |

All six byte-identical to a commit on their owning branch. **Nothing is unsaved.** Worth knowing
before anyone runs `git checkout` or `git clean` in the morning — on this tree, both are
dangerous and neither is needed.

The `proxy.ts` diff is W1-B's seam fill (Supabase session refresh + access-profile guard),
already committed and handed off. **It is not an S-009 fix — S-009 remains open.**

### Idle time

The windows finished their chains around 22:30–22:55 and have been idle since. I am not
launching wave 3 unattended: **S-009 blocks W3-A**, and eight windows building surfaces on a CSP
that silently kills JS in production — while looking correct in every dev check — would produce a
lot of work that has to be redone. That decision belongs to the morning.

Nothing needs intervention tonight.

---

## 01:02 — cycle 4

**No change.** Windows idle 5 hours, 13 handoffs unchanged, no branch moved. Gates re-verified:

```
typecheck exit 0   ·   lint exit 0 (0/0)   ·   build exit 0   ·   evidence exit 0 (656 units)
```

Secret audit clean: 0 tracked `.env`, 0 tracked `sources/media`, 0 tracked `sources/raw`,
0 secret-shaped strings in tracked content.

Per-branch scopes look correct — each branch touches its own handoffs, `apps/web`, and its own
scripts. The one exception is the known S-003 contamination, now measured precisely.

### S-003 · QUANTIFIED — the morning fix is a one-liner

Commit `4d8d8ec` ("W1-C: four-locale i18n with a gate that proves parity") sits on
**`w1d-w3i-design`** and is **not** on `w1c-w0d-i18n-media`. W3 replayed the same content there
as `f9bc385`, so the work exists twice as two different commits — 17 paths, 4,515 insertions.

I compared all 16 W1-C files across both branches:

```
identical: 15      diverged: 1
```

The only divergence is `scripts/check-i18n.mjs`:

| Branch | Lines | History |
|---|---|---|
| `w1d-w3i-design` (W4) | 498 | the stray replay only |
| `w1c-w0d-i18n-media` (W3) | **576** | `f9bc385` then `83990f3` — *"fix two bugs the gate had"* |

**W3's copy is authoritative.** It carries the later commit where W3's own reject-test found two
real bugs in the gate (rule 6's floor was on the English side; rule 0b never fired).

**Morning resolution:** merge both branches in any order and take **W3's** `check-i18n.mjs` if
git raises a conflict. The other 15 files are byte-identical, so they will merge silently. No
rebase needed, and no history rewriting — which is the right outcome, since rewriting a branch
its window may still be using was the risk I flagged in cycle 1.

### Idle time — unchanged position

Windows have been done ~6 hours. Still not launching wave 3: **S-009 blocks W3-A**, and building
eight surfaces on a CSP that silently kills production JS while passing every dev check would
create work that has to be thrown away.

Nothing needs intervention tonight.

---

## 03:02 — cycle 5

**No change.** Windows idle 7 hours, 13 handoffs, no branch moved. Gates re-verified:

```
typecheck exit 0   ·   lint exit 0 (0/0)   ·   build exit 0   ·   evidence exit 0 (656 units)
```

Secrets clean: `.env` 0 · `sources/media` 0 · `sources/raw` 0 · secret-shaped strings 0.

### S-014 · Merge readiness — simulated, and it is a two-line fix

State has been static for three cycles, so I used this one to answer the biggest open morning
question: **what happens when these four branches merge?**

Simulated with `git merge-tree --write-tree`, which computes the merge without touching the
working tree or the index — safe to run while windows hold the tree.

**Each branch against `main`, individually: all four CLEAN, zero conflicts.**

Cumulatively, and pairwise across all six branch pairs, the *entire* set of conflicts is:

| # | Path | Cause | Resolution |
|---|---|---|---|
| 1 | `HANDOFF/NIGHT-LOG.md` | All four windows appended concurrently | **Union — keep every line.** It is an append-only log; no line supersedes another |
| 2 | `scripts/check-i18n.mjs` | S-003 contamination (add/add) | **Take W3's copy** — `w1c-w0d-i18n-media`, 576 lines, carries `83990f3` which fixed two real bugs in the gate. W4's is the 498-line stale replay |

**There are no other conflicts.** No code path, no migration, no message file, no component.
44 commits across four parallel windows and the only collisions are one shared log and one
duplicated file whose winner was already determined in cycle 4.

**Suggested morning sequence:**

```bash
git checkout main
git merge --no-ff feature/INTERNAL-107-w1a-w2a-data        # clean
git merge --no-ff feature/INTERNAL-107-w1b-w2c-auth-ai     # NIGHT-LOG: keep both sides
git merge --no-ff feature/INTERNAL-107-w1c-w0d-i18n-media  # NIGHT-LOG: keep both sides
git merge --no-ff feature/INTERNAL-107-w1d-w3i-design      # NIGHT-LOG: keep both; check-i18n.mjs: take W3's
```

Data spine first so the schema lands before everything that depends on it; the contaminated
branch last so its stale `check-i18n.mjs` loses to W3's, which is already in the tree by then.

`main` is protected (1 review + 2 checks), so this goes through PRs rather than direct merges.
Four PRs, or one integration branch — your call.

### Position unchanged on wave 3

Windows done ~8 hours. Still not launching: **S-009 blocks W3-A.** Nothing needs intervention
tonight.

---

## 05:02 — cycle 6 (final overnight cycle)

**No change.** Windows idle 9 hours, 13 handoffs, no branch moved. Fourth consecutive static
cycle. Gates re-verified green; secrets clean.

Rather than log a sixth "still green", I consolidated the run into **`MORNING-BRIEF.md`** at the
repo root — what was built, what is verified, the five decisions waiting, and the honest limits.
Read that first; this file is the detail behind it.

**Counted across all 13 handoffs: 88 `NOT RUN` / `[GAP]` items**, every one stated rather than
papered over. That is the discipline holding. The material ones are in the brief §5.

Nothing needs intervention. The run ends clean.

---

## 07:02 — cycle 7 · supervision ended

**No change.** Fifth consecutive static cycle: windows idle 11 hours, 13 handoffs, no branch
moved, `main` untouched for 13 hours. Gates green, secrets clean.

```
typecheck exit 0   ·   lint exit 0 (0/0)   ·   build exit 0   ·   evidence exit 0 (656 units)
```

**Stopping the loop here.** The overnight run it was supervising ended at ~22:55 last night. Five
identical cycles is conclusive: there is nothing left to observe, and continuing to poll a
finished, static system is pure overhead.

Seven supervisor cycles logged (19:07 · 21:02 · 23:02 · 01:02 · 03:02 · 05:02 · 07:02). Findings
S-001 → S-014, five closed, five awaiting a decision.

Everything needed is in **`MORNING-BRIEF.md`**. Restart supervision with `/loop 2h …` if wave 3
runs unattended.
