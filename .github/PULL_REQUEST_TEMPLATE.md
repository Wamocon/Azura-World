## Business summary

<!-- What changes for a user or stakeholder. Plain language, 2–3 sentences. -->

## Technical summary

<!-- What changed in the code and why this approach. -->

**Jira:** INTERNAL-107 <!-- or state why no ticket applies -->
**Task brief:** <!-- e.g. W3-C — or "none" -->

## Validation actually run

Paste **real output**. Anything not run is **NOT RUN** with the reason.
Never "should pass". Capture exit codes explicitly — `cmd | tail` reports `tail`'s status.

| Command | Result | Evidence |
|---|---|---|
| `pnpm --dir apps/web typecheck` | PASS / FAIL / NOT RUN | |
| `pnpm --dir apps/web lint` | | |
| `pnpm --dir apps/web build` | | |
| `pnpm test:contract` | | |
| `pnpm qa:evidence` | | |
| `pnpm --dir apps/web test:e2e` | | |

<details><summary>Output</summary>

```
```

</details>

## Screenshots

<!-- Required for any UI change. German at 320px is where layouts actually break. -->

## Checklist

- [ ] Only files my task **owns** ([ORCHESTRATION.md](../ORCHESTRATION.md) §4) were modified — verified with `git status`
- [ ] `HANDOFF/<task-id>.md` written
- [ ] No secrets, no `.env` files, no `sources/raw/` content staged
- [ ] Every displayed fact carries its source (`SourcedFact<T>`) — no bare numbers in JSX
- [ ] No source conflict silently resolved; disagreements produce a `Finding`
- [ ] Missing values are `null` + `confidence: "gap"` — never invented, never `0`
- [ ] New tables ship with RLS **in the same migration**
- [ ] `lib/rbac.ts` and SQL role helpers changed together, if roles changed
- [ ] RBAC decision happens before any model call, if AI paths changed
- [ ] `prefers-reduced-motion` yields a complete static page, if motion changed
- [ ] Copy exists in all four locales (de·en·tr·ru), fallbacks marked honestly

## Risks and follow-ups

<!-- What could break. What you deliberately deferred, and why. -->
