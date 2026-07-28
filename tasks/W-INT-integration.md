# W-INT — Integration: merge, unblock, then hand off

**Runs:** ALONE, before anything else. **Blocks:** every wave-3 window.

> Read `SYSTEM-PROMPT.md`, `MORNING-BRIEF.md`, `HANDOFF/SUPERVISOR-NOTES.md` (S-001…S-014),
> then this file.

---

## Mission

Four branches hold wave 0–2. None are merged. Until they are, no wave-3 window can build anything
— RBAC is on one branch, the repositories on another, i18n on a third, the design system on a
fourth. Your job is to produce **one green `main`** that has all of it, with the two blocking
bugs fixed.

**You are the only window running.** Do not fan out to subagents for the merge itself — a merge
is a sequence of decisions, not parallel work. Subagents are fine for the two code fixes once the
tree is merged.

---

## 1. Merge — the conflict set is already known

Simulated with `git merge-tree`: all four branches merge **CLEAN** into `main` individually, and
across all six branch pairs the *entire* conflict set is two files.

```bash
git checkout main && git pull
git merge --no-ff feature/INTERNAL-107-w1a-w2a-data
git merge --no-ff feature/INTERNAL-107-w1b-w2c-auth-ai
git merge --no-ff feature/INTERNAL-107-w1c-w0d-i18n-media
git merge --no-ff feature/INTERNAL-107-w1d-w3i-design
```

| Conflict | Resolution |
|---|---|
| `HANDOFF/NIGHT-LOG.md` | **Union — keep every line from both sides.** Append-only log; nothing supersedes anything |
| `scripts/check-i18n.mjs` | **Take W3's copy** (`w1c-w0d-i18n-media`, 576 lines). W4's 498-line copy is a stale replay that predates the commit fixing two real bugs in the gate |

Data spine first so the schema lands before its dependents; the contaminated branch last so its
stale file loses to W3's, which is already in the tree by then.

**`main` is protected** (1 review + 2 CI checks). Either open four PRs, or merge into an
integration branch and open one PR from there. Do not disable the protection.

**Do not** `git checkout` or `git clean` casually — other windows may still hold this tree, and
that is exactly what caused the branch contamination in the first place.

After merging, run every gate and **paste the real output**:

```bash
pnpm --dir apps/web typecheck     # capture $? explicitly, never pipe through tail
pnpm --dir apps/web lint
pnpm --dir apps/web build
node scripts/verify-evidence.mjs
npx supabase test db              # or the cloud pgTAP substitute — see §4
```

## 2. S-009 — prerendered pages run zero JS in production · **the blocker**

`proxy.ts` emits a per-request `'nonce-…' 'strict-dynamic'` CSP. A statically prerendered page has
no request to read the nonce from, so its scripts carry none and `strict-dynamic` blocks every
one. Measured under `next start`: **0 B JS, 0 canvas, 1 CSP violation per chunk.** The page
renders; nothing is interactive. **It does not reproduce under `next dev`.**

W4 worked around it on its own route with `force-dynamic` and correctly did not touch `proxy.ts`.

Pick one and write down why:

- **(a)** A static-safe CSP fallback in `proxy.ts` — hash-based or a `strict-dynamic`-free policy
  for prerendered responses. Keeps static rendering, more CSP surface to get right.
- **(b)** A documented rule that no route may be statically prerendered, enforced by a lint rule
  or a build check. Simple and safe; gives up static rendering entirely.
- **(c)** Nonce injection at the edge for prerendered HTML. Best of both, most complex.

**Whatever you choose, prove it under `next start`, not `next dev`** — measure JS bytes actually
executed and CSP violations. A fix verified only in dev is not verified. Then add a regression
test so this cannot come back silently: it passed every check for a full night before W4 caught it
by looking at a production build.

## 3. Generator fix — before wave 3, not after

`apps/web/lib/azura-world-data.ts` types `project` / `hotel` / `portalListings` as
`Record<string, unknown>`. Because the file ends in `satisfies AzuraWorldDataset`, those subtrees
get **no contextual type at all** — so `tier` widens to `number` and `confidence` to `string` at
every call site, and `SourcedFact` no longer type-checks.

W2-C worked around it with `isSourcedFact()` guards. **W3-C and W3-G will each hit it.** Fix it
once, in `scripts/build-azura-dataset.py` (W0-B's generator), so the emitted file carries the real
types. Regenerate, re-run `verify-evidence`, confirm the unit counts are unchanged
(**25 portal_listing + 631 modelled = 656**).

## 4. Housekeeping

- **Dependabot:** close **#8** (typescript 5→7), **#7** (eslint 9→10), **#6** (@types/node 20→26)
  — all break the pins in `CONVENTIONS.md` §1. Add an `ignore` block for majors on those three in
  `.github/dependabot.yml`. #5 and #1–3 are reviewable on their merits.
- **Docker / pgTAP:** if Docker is up, run `supabase test db` properly and record the real number.
  If it is still down, keep W1-A's cloud substitute and report `supabase test db` as **NOT RUN**
  with the reason. Do not infer a pass.
- **`CONVENTIONS.md` §7 3D budget:** the lazy 3D chunk is 236.4 KB gz against a 150 KB budget.
  Removing `drei` saved 10 bytes — it is already tree-shaken, so that is three.js + R3F itself.
  Raise the budget for the 3D route with the measured number and a one-line reason, or record the
  decision to drop WebGL. **Do not leave a budget in the document that the build cannot meet** —
  an unmeetable gate gets ignored, and then every gate gets ignored.

---

## Definition of done

- [ ] One `main` containing all four branches, gates **all green**, real output pasted
- [ ] S-009 fixed and **proven under `next start`** with a regression test
- [ ] Generator emits correctly-typed subtrees; 656 units unchanged
- [ ] Dependabot majors closed and ignored
- [ ] 3D budget either raised with its measured number or the WebGL decision recorded
- [ ] `HANDOFF/W-INT.md` written

## Handoff must state

- The merged commit on `main` and its gate output
- Which S-009 option you chose and **why**, plus the measured before/after JS bytes
- Anything the merge revealed that the four separate branches hid
- **Explicitly: is wave 3 clear to start?** Eight windows are waiting on that answer.
