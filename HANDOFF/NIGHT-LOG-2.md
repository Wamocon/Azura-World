# NIGHT LOG 2 — 2026-07-28 → 29

One line per window per hour: `HH:MM  N<n>  <module>  <what happened>  <gates>`
Append only. Never rewrite another window's lines.

```
17:39  ORCH --  night 2 started. main 136 commits. 5 windows, 5 worktrees, 18 modules to build. Gates: typecheck 0 / lint 0 / evidence 0 / format FAIL.
17:58  N1  listings  /dashboard/listings built: 47 rows / 7 publishers grouped, per-publisher claim matrix, F-002 side-by-side EUR|USD unconverted, stale badge in the price cell. Not yet browser-verified.  typecheck 0 / lint 0 / build 0 / check-i18n 0
18:09  N1  listings  DONE. 55/55 browser assertions on a production build. 47 rows / 7 publishers / 18 stale, F-002 four prices side by side EUR|USD unconverted. HANDOFF/N1-listings.md written. Starting leads.  typecheck 0 / lint 0 / build 0 / i18n 0 / listings-verify 0
18:32  N1  leads+pipeline  DONE. Both modules built and verified. Harness now 93/93 across all three N1 modules. Found a real seed defect: lead assigned_to ids (0a1b2c3d-…) do not exist in the profile seed (b0000000-…). HANDOFF/N1-crm.md written. W3-C scope complete.  typecheck 0 / lint 0 / build 0 / i18n 0 / listings-verify 0
18:33  N1  all three  Cross-checked the shared gates after removing three pending flags from dashboard-routing.ts: qa:dashboard 647/0, qa:csp 30/0. Branch pushed. N1 complete.  typecheck 0 / lint 0 / build 0 / i18n 0 / listings-verify 93-0 / dashboard 647-0 / csp 30-0
