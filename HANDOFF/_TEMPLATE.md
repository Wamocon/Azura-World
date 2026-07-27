# HANDOFF — <task-id> <title>

STATUS: COMPLETE | PARTIAL | BLOCKED
Completed: <ISO date>
Window: <task file executed>

## What was built

<3–8 bullets, concrete. Name the files. No adjectives.>

## Verification actually run

| Command | Result | Evidence |
|---|---|---|
| `pnpm --dir apps/web typecheck` | PASS / FAIL | <pasted output tail> |
| `pnpm --dir apps/web lint` | PASS / FAIL | <pasted output tail> |
| <task-specific> | PASS / FAIL / **NOT RUN** | <output or the reason it did not run> |

Anything not executed is listed as **NOT RUN** with the reason.
Never write "should pass", "expected to work", or "presumably fine".
An exit code captured behind a pipe is not an exit code — capture it explicitly.

## Contracts I consumed

<Which `CONTRACTS.md` interfaces you used, and whether each fitted what you had to build.>

## Decisions I made

<Judgement calls the next window needs to know about, each with its reason.>

## Requests for other windows

| File | Owning task | What is needed | Why |
|---|---|---|---|

<Changes you needed in files you do not own. You did not make them yourself.>

## Known gaps

<`[GAP]` items, deferred edge cases, anything a later wave must pick up.
Be specific — "error handling incomplete" is useless; "the 409 path on concurrent
ticket transition is untested" is actionable.>

## Files I wrote

<`git status --porcelain` output, proving nothing outside your ownership was touched.>
