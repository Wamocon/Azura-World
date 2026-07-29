# NIGHT LOG 2 — 2026-07-28 → 29

One line per window per hour: `HH:MM  N<n>  <module>  <what happened>  <gates>`
Append only. Never rewrite another window's lines.

```
17:39  ORCH --  night 2 started. main 136 commits. 5 windows, 5 worktrees, 18 modules to build. Gates: typecheck 0 / lint 0 / evidence 0 / format FAIL.
18:37  N3  operations  four modules built: tickets/activities/calendar/communications; state machine 704-triple exhaustive, ICS probe 59/0, csp 30/0, qa:dashboard 647/0  gates: green
07:46  N3  capacity  docker engine will not start (pipe absent, app exits on launch, no local pg on 5432/54322); capacity probe NOT RUN, diagnosis in HANDOFF/W3-E.md  gates: green
