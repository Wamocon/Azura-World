# HANDOFF — W-FIX  Mechanical cleanup: format, dependencies, artefact policy

STATUS: COMPLETE
Completed: 2026-07-28
Branch: `feature/INTERNAL-107-final-cleanup` · Worktree: `D:\azura-fix` · From `origin/main` @ `1de48e4`

Three jobs, three commits, no logic changes.

| Commit | Job |
|---|---|
| `08dfc28` | Formatting only, 269 files |
| `f118962` | Dependency advisories 15 → 3 |
| `f6a01bb` | Untrack 38 generated QA artefacts |

Verified on the final tree, each exit code read directly off its own process:

```
typecheck_EXIT=0   lint_EXIT=0   format_EXIT=0
check-i18n_EXIT=0  verify-evidence_EXIT=0  build_EXIT=0  qa:csp 30 pass 0 fail
```

---

## 1. Format — `08dfc28`

`prettier --write` across the tree: **269 files, whitespace only.**

**The root cause was that no `.prettierignore` existed anywhere.** That is why the gate had never
been green, and it is also why `scripts/quality-gate.mjs` had to point `--ignore-path` at
`.gitignore` — a workaround for a missing file rather than a policy. Two ignore files now exist,
root and `apps/web`, and the gate passes both so a bare `prettier --check` and the gate agree.

**Generated files are not reformatted**, per the instruction. `azura-world-data.ts`,
`media-manifest.ts` and `lqip.json` are excluded with the reason inline: SYSTEM-PROMPT §2.4 makes
the generator the owner of their formatting, and reformatting one turns the next regeneration into
a spurious multi-thousand-line diff with the real change buried inside it. `supabase/imports/`,
`docs/api/openapi.yaml` and `sources/` are excluded on the same grounds.

I did **not** need to fix a generator: none of them emits unformatted output that matters, because
none of their output is now checked.

One wrinkle worth recording: `prettier` is a devDependency of `apps/web`, not of the root, so
`npx prettier` from the repo root fails with *"not recognized as an internal or external
command"*. The tree was formatted in two invocations from `apps/web`, the second reaching out with
`../../` globs.

---

## 2. Dependencies — `f118962`

**15 advisories → 3.** Nothing that CONVENTIONS §1 pins by major moved.

### Patched

| Change | Clears |
|---|---|
| `next` 16.2.6 → **16.2.12** | all **9** next advisories (4 high, 5 moderate) |
| `react` / `react-dom` 19.2.4 → **19.2.8** | pairs with next, as dependabot #4 does |
| pnpm override `postcss >=8.5.18` | **3** postcss advisories reached via next |

All three are patch-level **inside the pinned minor** (16.2.x, 19.2.x), so the pin's intent holds.
The 9 next advisories included the *Middleware / Proxy bypass in App Router*, which sits on exactly
the mechanism `apps/web/proxy.ts` uses for session refresh and the route guard.

**Untouched, as instructed:** `typescript` stays `^5`, `eslint` stays `^9`, `@types/node` stays
`^20`. Dependabot **#6, #7 and #8 remain closed**.

**One thing needs an owner's decision.** `CONVENTIONS.md` §1 literally reads `16.2.6` and `19.2.4`.
Those strings are now a patch behind the lockfile. CONVENTIONS is frozen so I did not edit it; it
needs a one-line amendment. The alternative was leaving four high-severity advisories on the route
guard, which is the worse trade.

### The three that remain, and why

**1. `sharp` 0.34.5 · high · CVE-2026-33327 · patched `>=0.35.0`**
Path: `apps/web > next@16.2.12 > sharp`.
*Not patchable here:* sharp's version is chosen by next, and an override pinning it above what next
expects risks the image pipeline for a component we barely use.
*Reachability: **low**.* sharp runs inside Next's image optimizer. `next/image` appears in exactly
two files, `lib/pwa.ts` and the generated `next-env.d.ts`; **no rendered surface uses `<Image>`**.
*Accepted* until next ships a sharp bump.

**2. `brace-expansion` · high · patched `>=5.0.8`**
Path: `apps/web > eslint > @eslint/config-array > minimatch@3.1.5`.
*Override attempted and reverted.* Forcing `>=5.0.8` broke lint outright:
`TypeError: expand is not a function` — minimatch 3.x expects v1/v2's CommonJS export shape and v5
changed it. **`lint` went exit 0 → exit 2.** The real fix is eslint 10, which is dependabot #7 and
is explicitly excluded.
*Reachability: **none at runtime**.* Dev tooling, never bundled, never shipped.
*Accepted.* This is the case where silencing the advisory costs more than the advisory.

**3. `@hono/node-server` 1.19.17 · moderate · patched `>=2.0.5`**
Path: `apps/web > shadcn > @modelcontextprotocol/sdk > @hono/node-server`. Path traversal in
`serve-static`, on Windows.
*Reachability: **none at runtime**.* `shadcn` is a scaffolding CLI and is imported by **zero**
source files.
*Accepted*, with one thing to fix separately: `shadcn` is declared under `dependencies` rather than
`devDependencies`. It is not a runtime dependency and moving it would shrink the production tree
and remove this advisory from the runtime surface entirely. That is a `package.json` change owned
by W0-A, not a mechanical cleanup.

---

## 3. Artefact policy — `f6a01bb`

**38 tracked files removed from the index. No file content changed and nothing was deleted from
disk** (`git rm -r --cached`).

Removed: `quality/{a11y,perf,drift,browser,e2e}/**` run directories, `quality/probes/*`,
`quality/w3c/*` and `quality/w3g/*` screenshots, gate JSON, audit JSON and console captures.

Every one is regenerable by re-running its harness, each carries a run timestamp so a re-run adds a
new file rather than a diff, and the screenshots alone are megabytes in a **public** repository.

`.gitignore` now covers those directories plus `quality/*.json`, `quality/*.txt` and
`quality/**/*.png`. `quality/.gitkeep` is force-added back behind a negation so the directory
survives a fresh clone for the harnesses to write into, matching the `sources/media/.gitkeep`
pattern already in the file.

**Kept, verified still tracked:** `RELEASE-STATUS.md`, `TRACEABILITY.md`, `QUALITY-REPORT.md`. All
three are at the repo root. They are documents a person wrote for a reader, not output a script
emitted.

---

## 4. What this does and does not change

**Does not change:** any behaviour. No logic was touched in any of the three commits. The only
non-formatting source edit is `scripts/quality-gate.mjs` gaining a second `--ignore-path`, which is
required for the format gate to honour the new ignore file.

**Does change, for the better:** the format gate can now pass, and it will keep passing, because
the thing that made it structurally unpassable — no ignore file, so build output and generated
files counted as unformatted source — is fixed rather than worked around.

---

## 5. Requests for other windows

- **Owner of `CONVENTIONS.md`** — §1 needs `next 16.2.12` and `react 19.2.8`. One line. The
  lockfile is already there and the alternative was shipping four high advisories on the route
  guard.
- **W0-A (`apps/web/package.json`)** — move `shadcn` from `dependencies` to `devDependencies`. It
  is a scaffolding CLI imported by zero source files, and the move removes the `@hono/node-server`
  advisory from the runtime surface.
- **W4-D** — the format gate's `--ignore-path` now takes two files. If the gate is ever run from a
  different cwd, both paths are relative to `apps/web`.

---

## 6. Known gaps

- `[GAP]` **`e2e`, `layout-audit`, `a11y-audit`, `perf` and `security-probe` were not re-run on
  this branch.** They take roughly 20 minutes together and none of the three commits touches code
  they exercise. Their last real results are in `HANDOFF/W-INT2.md` §2, measured on `b5a0c83`.
  The one that could plausibly move is `perf`, because `next` changed patch version.
- `[GAP]` **The `next` 16.2.12 bump is verified by typecheck, lint, build and `qa:csp` only.** No
  browser suite was run against it. `qa:csp` passing (30/0) is the strongest single signal, since
  it exercises the production CSP, hydration and the proxy on a real build.
- `[GAP]` **Not pushed and no CI run.** The branch is local at `f6a01bb`.
- `[GAP]` **The three remaining advisories are accepted, not fixed.** Two are unreachable at
  runtime and one is low-reachability; none is closed.
