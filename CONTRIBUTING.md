# Contributing — Azura World CATI

Internal Wamocon project under Jira **INTERNAL-107**. Read
[SYSTEM-PROMPT.md](SYSTEM-PROMPT.md) and [CONVENTIONS.md](CONVENTIONS.md) before your first
commit — they are binding, not advisory.

---

## Confidentiality

This repository holds **competitor intelligence** about a named real company (Cebeci Group A.Ş.)
and references a separate client engagement (Ataberk Estate / 1Çatı).

- **Never make this repository public.** See [SECURITY.md](SECURITY.md).
- Never mix Ataberk client data into this tree, or Azura data into the 1Çatı tree.
- Harvested competitor media is **not ours to republish** — see `MEDIA-LICENSE.md`.
- Analysis is factual and neutral. We describe what sources say and where they disagree; we do
  not characterise a competitor's conduct, finances or integrity.

## Branches

```
feature/INTERNAL-107-<slug>      fix/INTERNAL-107-<slug>      chore/<slug>
```

Never commit directly to `main`.

## Commits

Prefix with the Jira key when one applies:

```
INTERNAL-107 add sourced-fact invariant guards
fix: reject soft-404 bodies in media harvest
```

Conventional prefixes otherwise: `feat:` `fix:` `docs:` `chore:` `test:` `refactor:`.

## Parallel work

This project is built by many windows at once. **[ORCHESTRATION.md](ORCHESTRATION.md) §4 is the
file-ownership matrix — write only what your task owns.** If you need a change elsewhere, record
it in your handoff under _Requests for other windows_.

Every task ends by writing `HANDOFF/<task-id>.md`. **A task without a handoff is not finished**,
regardless of what shipped. All four wave-0 windows skipped this once; do not repeat it.

## Quality gates — run before every PR

```bash
pnpm --dir apps/web typecheck
pnpm --dir apps/web lint
pnpm --dir apps/web build
pnpm test:contract
pnpm --dir apps/web test:e2e -- --project=chromium
pnpm qa:evidence
```

Capture exit codes **explicitly**. `cmd | tail` reports `tail`'s status, so a failing suite looks
green — that exact mistake is on record in the reference project's lessons file.

A gate that could not run is reported **NOT RUN**, never PASS. "Should pass" is not a result.

## Pull requests

Use the template. It requires: business summary, technical summary, Jira key, the validation
commands you ran **with their real output**, screenshots for UI changes, and risks/follow-ups.

## Non-negotiables

Full list in [SYSTEM-PROMPT.md](SYSTEM-PROMPT.md) §2. The ones most often broken:

1. Every displayed fact carries its source URL — enforced by `SourcedFact<T>`
2. Conflicting sources are **never** silently resolved
3. A missing figure is `null` + `confidence: "gap"`, never an invented number
4. RLS ships in the same migration as the table
5. `lib/rbac.ts` and the SQL role helpers change together, in one commit
6. RBAC decision happens **before** any model call
7. No secrets in code. `.env.example` placeholders only

## Secret hygiene

`.env.local` is git-ignored and must stay that way. Enable the pre-commit guard once per clone:

```bash
git config core.hooksPath .githooks
```

It blocks any commit containing a `.env` file or a recognisable key pattern. If a secret is ever
committed, **rotate it first**, then clean history — rotation is the fix, history rewriting is
only cleanup.
