# NIGHT LOG 2 — 2026-07-28 → 29

One line per window per hour: `HH:MM  N<n>  <module>  <what happened>  <gates>`
Append only. Never rewrite another window's lines.

```
17:39  ORCH --  night 2 started. main 136 commits. 5 windows, 5 worktrees, 18 modules to build. Gates: typecheck 0 / lint 0 / evidence 0 / format FAIL.
18:52  N2  finance      money core + ledger + per-currency totals; typecheck 0 lint 0; money.test.ts 43/0  gates: green
20:10  N2  wallet       wallet + vendor-invoices + nav registration; build 0, all six routes Dynamic          gates: green
20:45  N2  all three    qa:dashboard 647/0 · qa:csp 30/0 · scope probe 27/0 · browser acceptance 52/0 (11 roles)  gates: green
