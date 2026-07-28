# MORNING BRIEF — 28 July 2026

Overnight run complete. Four windows, four branches, **44 commits**, nobody blocked.
Everything below was verified by the supervisor, not taken from a handoff claim.

---

## 1. Gate status — all green, verified six times through the night

```
typecheck   exit 0        lint       exit 0  (0 errors, 0 warnings)
build       exit 0        evidence   exit 0  (656 units, no violations)
```

Secret hygiene, every cycle: 0 tracked `.env`, 0 tracked `sources/media`, 0 tracked
`sources/raw`, 0 secret-shaped strings in tracked content.

## 2. What was built

| Task              | Status                 | Verified evidence                                          |
| ----------------- | ---------------------- | ---------------------------------------------------------- |
| W0-A foundation   | ✅                     | 33 contract smoke assertions                               |
| W0-B evidence     | ✅                     | 45/60 URLs, 53 sources, 656 units, 24 findings             |
| W0-C market       | ✅                     | Marktanalyse ×4 languages, primary sources parsed          |
| W0-D media        | ✅                     | 833 assets, 828 encoded, 8,649 renditions                  |
| W1-A schema       | ✅                     | **366 pgTAP assertions planned, 366 executed, 366 passed** |
| W1-B auth/RBAC    | ✅                     | rbac probe 157 pass · 0 fail                               |
| W1-C i18n         | ✅                     | 576 keys × 4 locales, 0 English stubs                      |
| W1-D design       | ✅                     | 27/27 Playwright                                           |
| W2-A repositories | ✅                     | 13 repositories, 60 reads, 24/24 contract tests            |
| W2-C AI           | ✅                     | 152 assertions, **17 of 31 probes refused**                |
| W2-D realtime     | ⚠️ PARTIAL _by design_ | 93 pass; 3 browser checks NOT RUN, named                   |
| W3-I simulation   | ✅                     | 16/16 Playwright                                           |

Waves 0 and 1 complete. Wave 2 complete except **W2-B (API/OpenAPI), not started** — W1 declined
the stretch deliberately: _"the night is late enough that a fresh window should take it with the
handoffs in hand."_

## 3. Two real bugs the night caught

**Every authenticated user was an admin.** `is_admin()` is `SECURITY DEFINER`, so `current_user`
resolved to the _function owner_, not the caller — `is_service_context()` returned true for
everyone. Found by the **negative** pgTAP suite. The same run caught a deactivated profile
keeping its residency scope, and `anon` unable to read `public.units` at all, which would have
shipped an empty landing page. All fixed.

**Prerendered pages run zero JS in production.** `proxy.ts` emits a per-request nonce CSP with
`strict-dynamic`; a statically prerendered page has no request to read the nonce from, so every
script is blocked. Measured under `next start`: 0 B JS, 0 canvas, 1 CSP violation per chunk. **It
does not reproduce in `next dev`.** Still open — see §4.

## 4. Decisions waiting for you

### ① S-009 — CSP vs prerendering · **blocks wave 3**

The landing page would ship dead and pass every dev check. Needs either a static-safe CSP
fallback in `proxy.ts` (W1-B's file) or a documented rule that no route may be statically
prerendered. **Fix this before W3-A starts.**

### ② S-010 — the 3D budget is unreachable

Lazy 3D chunk is **236.4 KB gz against a 150 KB budget**. W4 tested removing `drei`: saved
**10 bytes**, already tree-shaken, reverted. The 236 KB is three.js + R3F itself. Raise the
budget for the 3D route, drop WebGL, or accept a documented exception.

### ③ S-014 — the merge, now a two-line instruction

All four branches merge **CLEAN** into `main` individually. Across all six branch pairs the
_entire_ conflict set is two files:

| Path                     | Resolution                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `HANDOFF/NIGHT-LOG.md`   | **Union — keep every line.** Append-only log                                              |
| `scripts/check-i18n.mjs` | **Take W3's copy** (576 lines, fixed two gate bugs). W4's 498-line copy is a stale replay |

Suggested order — data spine first, contaminated branch last:

```
w1a-w2a-data → w1b-w2c-auth-ai → w1c-w0d-i18n-media → w1d-w3i-design
```

`main` is protected (1 review + 2 checks), so this goes through PRs.

### ④ S-007 — do not merge three dependabot PRs

**#8 typescript 5→7**, **#7 eslint 9→10**, **#6 @types/node 20→26** all break the pinned
versions in `CONVENTIONS.md` §1. My `dependabot.yml` bounded the pinned-core group but left
ungrouped dev-deps open — needs an `ignore` block for majors.

### ⑤ Generator fix before wave 3

`azura-world-data.ts` types `project`/`hotel`/`portalListings` as `Record<string, unknown>`, and
the trailing `satisfies` gives those subtrees no contextual type — so `tier` widens to `number`
and `confidence` to `string` at every call site. W2-C worked around it with `isSourcedFact()`
guards. **W3-C and W3-G will each hit this.** Fix in W0-B's generator.

## 5. Honest limits

Every handoff carries a **NOT RUN** section rather than "should pass" — 88 such items across 13
handoffs. The ones that matter:

- **Docker was down all night.** `supabase test db` NOT RUN. W1-A substituted pgTAP 1.3.3 against
  the live cloud DB inside `BEGIN..ROLLBACK` — 366/366 pass, but confirm you accept that as
  equivalent evidence.
- **W2-D's 3 browser checks** NOT RUN, handed to W4-A.
- **W1-D/W3-I perf** — 3D chunk size measured; LCP/INP/CLS and the 60s soak NOT MEASURED, and
  stated as such. `qa:perf` does not exist yet (W4-B).
- **Migrations are applied to your live Supabase project.** It was empty and this was authorised.

## 6. Suggested first moves

1. Read `HANDOFF/SUPERVISOR-NOTES.md` — S-001 through S-014 with diagnoses
2. Decide ① and ②
3. Merge per ③, close the dependabot PRs per ④
4. Fix ⑤, then launch wave 3 — 8 windows, W3-A through W3-H

Wave 3 is fully unblocked once ① is fixed. Everything it depends on — contracts, schema, RBAC,
repositories, i18n, design system, dataset, media — is complete and green.
