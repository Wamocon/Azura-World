# OVERNIGHT RUN — 2026-07-27 → 28

Unattended. Nobody is watching. Everything here exists because a mistake made at 03:00 with no
human present is expensive to unwind at 09:00.

---

## 1. Branch discipline — read this first

`main` is protected: 1 approving review + 2 CI checks required. **You cannot push to `main`, and
you must not try.** Four windows sharing one branch would collide anyway.

**Each window works on its own branch and pushes that branch. Nothing merges tonight.**

| Window | Branch |
|---|---|
| 1 | `feature/INTERNAL-107-w1a-w2a-data` |
| 2 | `feature/INTERNAL-107-w1b-w2c-auth-ai` |
| 3 | `feature/INTERNAL-107-w1c-w0d-i18n-media` |
| 4 | `feature/INTERNAL-107-w1d-w3i-design` |

```bash
git fetch origin && git checkout -b <your-branch> origin/main
```

**Commit every 30–45 minutes**, and only when `typecheck` and `lint` are green. A night of work
in one commit is a night of work you cannot bisect.

**Pushing.** The Windows credential manager caches the wrong account. Push with:

```bash
gh auth switch --user Maanik-WMC
export TK="$(gh auth token)"
git -c credential.helper= \
    -c credential."https://github.com".helper='!f() { echo username=x-access-token; echo "password=$TK"; }; f' \
    push -u origin <your-branch>
unset TK
```

Another window may flip the active gh account between commands, so **switch and push in the same
command**. If a push fails on auth, retry once; if it fails twice, keep committing locally and
record it in your handoff. Local commits are not lost.

---

## 2. Work chains

Each window runs its tasks **in order**, in one window, without waiting for anyone else. Chained
tasks share a domain deliberately: the window that wrote the schema is the best one to write the
repositories against it.

### Window 1 — Data spine *(critical path — the longest chain, most valuable)*
```
tasks/W1-A-database-schema.md   →   tasks/W2-A-repositories.md
```
Everything in waves 2 and 3 waits on this. If only one window survives the night, make it this one.

**Carry in:** Supabase is live and **empty** (0 public tables, Postgres 17.6). `pgcrypto` is
installed; **`pg_trgm` is NOT** — migration 10 must create it. Details in `HANDOFF/W0-ENV.md`.

### Window 2 — Auth, RBAC, AI
```
tasks/W1-B-auth-rbac.md   →   tasks/W2-C-ai-layer.md
```
W2-C needs the dataset (exists, 33,562 lines) and RBAC (yours), **not** the repositories — so it
does not block on Window 1.

### Window 3 — i18n, then finish media
```
tasks/W1-C-i18n.md   →   finish tasks/W0-D-media-harvest.md
```
W0-D is ~85% done: 995 files harvested, `media-manifest.ts` and `lqip.json` exist. Outstanding:
run the encoder (only 1 file in `public/media`), the validation table, and **the handoff, which
was never written**. Both halves are DB-independent.

### Window 4 — Design system, then the simulation layer
```
tasks/W1-D-design-system.md   →   tasks/W3-I-immersion-simulation.md
```
Read `DESIGN-RESEARCH.md` first. Load `emil-design-eng` and `apple-design`. Natural chain — W3-I
composes exactly the primitives W1-D builds.

**Stretch, only if your chain finishes and gates are green:** W1 → start `W2-B` (API/OpenAPI).
W2 → start `W2-D` (realtime). W3 → start `W1-C` translations to full parity across all four
locales. W4 → `W3-A` landing page. **Never start a stretch task on a red tree.**

---

## 3. Stop conditions — when to halt rather than guess

Halt, write your handoff with `STATUS: BLOCKED`, name the blocker precisely, and stop:

1. A prerequisite file your brief names does not exist
2. `CONTRACTS.md` does not fit what you must build — **do not amend it**, three other windows
   are compiling against it right now
3. The same test fails 3 times with 3 different fixes — you are guessing, and guessing
   unattended compounds
4. You would need to write a file another window owns (`ORCHESTRATION.md` §4)
5. A destructive database operation looks necessary

**A clear blocker at 02:00 is a good deliverable. Eight hours of plausible-looking wrong work is
not.**

## 4. Never, unattended

- `supabase db reset` against the **linked cloud** project — it drops everything
- Dropping or altering any table holding data
- `git push --force` anywhere, `--no-verify` on any commit
- Rotating credentials
- `pnpm jira:sync` without `--dry-run`
- Editing `CONTRACTS.md`, `CONVENTIONS.md`, `SYSTEM-PROMPT.md`, `ORCHESTRATION.md`
- Committing anything under `sources/` — competitor media and snapshots are git-ignored, and
  this repository is **public**
- Disabling a failing test to make a gate pass

## 5. Reporting — the rule that was broken twice already

**Every task ends by writing `HANDOFF/<task-id>.md`.** All four wave-0 windows skipped this on the
first run; W0-D has still not written one. It is not optional. A task without a handoff is not
finished, no matter what shipped.

Write it **when the task ends**, not at 06:00 for everything at once. If you crash mid-chain, the
handoff for the completed task is what survives.

State only what you verified. Paste real output. Capture exit codes explicitly — `cmd | tail`
reports `tail`'s status, so a failing suite looks green. Anything not run is **NOT RUN**, with
the reason. Never "should pass".

Also append one line per hour to `HANDOFF/NIGHT-LOG.md`:

```
HH:MM  W<n>  <task>  <what just happened>  <gates: green|red>
```

That file is how the 02:00 / 04:00 / 06:00 supervisor check knows you are alive and moving.

## 6. Before you finish

```bash
pnpm --dir apps/web typecheck    # capture $? explicitly
pnpm --dir apps/web lint
pnpm --dir apps/web build
pnpm qa:evidence
git status --porcelain           # nothing outside your ownership
```

Leave the branch **green**. If you cannot, leave it green at the last good commit and describe
the broken work in the handoff rather than pushing it.
