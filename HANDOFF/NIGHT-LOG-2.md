# NIGHT LOG 2 — 2026-07-28 → 29

One line per window per hour: `HH:MM  N<n>  <module>  <what happened>  <gates>`
Append only. Never rewrite another window's lines.

```
17:39  ORCH --  night 2 started. main 136 commits. 5 windows, 5 worktrees, 18 modules to build. Gates: typecheck 0 / lint 0 / evidence 0 / format FAIL.
18:05  N5  report/signup  rebased onto cffe4b3 (2 ahead 2 behind, clean). Audited admin matrix: RLS+RBAC already complete, API blocked by writeGap, last-admin guard and self-elevation audit ABSENT.  gates: green
18:50  N5  admin-capability  migration 15 (2 guards, audit_events.metadata, profiles.version) + 3 write paths + 39-case probe. Found: every audit row silently dropped since W2-B shipped (no metadata column); expectedVersion unenforceable (no version column).  gates: green
19:30  N5  report proofs  next start on 3215. Open redirect 16/16 blocked vs evil.com. Rate limit 429+Retry-After, fingerprint bucket separation proven. 503 with NO reference issued. XSS escaped in form and tracker.  gates: green
19:55  N5  N5 COMPLETE  handoff W3-H.md §10-§17. NOT proven: no Postgres ran migration 15 (docker daemon down); idempotency 409 unreachable without a data plane; triage view does not exist. Found for W2-B: origin check 403s the address the app is served on.  gates: green
