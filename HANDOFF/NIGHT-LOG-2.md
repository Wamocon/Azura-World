# NIGHT LOG 2 — 2026-07-28 → 29

One line per window per hour: `HH:MM  N<n>  <module>  <what happened>  <gates>`
Append only. Never rewrite another window's lines.

```
17:39  ORCH --  night 2 started. main 136 commits. 5 windows, 5 worktrees, 18 modules to build. Gates: typecheck 0 / lint 0 / evidence 0 / format FAIL.
17:55  N4  setup  worktree azura-n4, docs read (OVERNIGHT-2, SYSTEM-PROMPT, W3-B, W1-B, SECURITY-REVIEW, W3-F brief). node_modules symlinked to the main tree; Turbopack rejects that symlink, so dev runs --webpack.  gates: not yet run
18:10  N4  users+admin  role-policy.ts (pure): no self role change in either direction, last active admin immovable, uncountable census refuses. governance-audit.ts is the only INSERT into audit_events, service-role, refusals audited too.  gates: typecheck 0 / lint 0
18:25  N4  documents+compliance  document-storage.ts: content sniffing beats the filename, markup refused whatever it claims. compliance: not_evidenced DERIVED from the evidence, since the DB CHECK has no such status and CONTRACTS is frozen.  gates: typecheck 0 / lint 0
18:35  N4  reports+settings  CSV export with provenance columns as a route handler under my own segment (app/api is W2-B's). XLSX/PDF/jobs declared unavailable with the missing library and table named, not stubbed.  gates: typecheck 0 / lint 0
18:45  N4  i18n  six sub-namespaces x 4 locales, +310 keys each. check-i18n caught 6 German strings over the 1.4x English ceiling; shortened rather than padding the English.  gates: i18n 0 errors
18:55  N4  probe  scripts/governance-probe.mts: 216 pass / 0 fail, every fail-closed case paired with a positive control. One failure was my own assertion (a CSV field needing both the quote guard and quoting), fixed in the probe not the code.  gates: probe 0
19:05  N4  build  build exit 0, all 7 routes emit as Dynamic. Fixed: a `use server` file may export only async functions, so the initial action states moved into the client components.  gates: typecheck 0 / lint 0 / build 0
19:20  N4  live  qa:csp 30/0. Live HTTP check over 11 roles x 6 routes + the export: 155 pass / 0 fail. Every forbidden pair gets the SERVER-side 403 and no repository data beyond the shell baseline (SEC-003 class).  gates: csp 0 / live 0
19:25  N4  live  3 bugs found in my own check script, none in the code: React splits the flight payload across push() chunks; payload quotes are backslash-escaped; next-intl ships the whole catalogue to every page, so absence assertions on UI copy report leaks that are not there.  gates: green
19:30  N4  handoff  HANDOFF/W3-F.md written. 12 DoD items: 8 pass, 1 partial, 3 NOT RUN (no data plane, no bucket, no seeded compliance rows). plain-language 116 on main and 116 here, none in my files.  gates: typecheck 0 / lint 0 / build 0 / i18n 0 / csp 0 / probe 0
