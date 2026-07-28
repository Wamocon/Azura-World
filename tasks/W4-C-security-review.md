# W4-C — Adversarial security review

**Wave:** 4 · **Depends on:** all of wave 3 · **Runs with:** W4-A, W4-B, W4-D

> Read `SYSTEM-PROMPT.md` §2 (the non-negotiables you are auditing), every wave handoff, and
> `D:\Real Estate CRM\Cati\docs\requirements\option-3-ai-site-crm\Security-Compliance-Plan.md`.

---

## Mission

**Try to break it.** You are not reviewing whether the team followed the rules — you are trying
to find where the rules do not hold. Assume every other window did its best and still left
something exploitable, because that is normally true.

Authorised scope: this repository and a local instance only. No external systems, no competitor
infrastructure, no live Supabase project without explicit written approval. Testing competitor
websites is out of scope entirely — we read their public pages, we do not probe them.

---

## Files you own

```
SECURITY-REVIEW.md · docs/security/**
scripts/security-probe.mjs
HANDOFF/W4-C.md
```

You write **no application code.** Findings go to the owning window as requests. If something is
critical and the owning window is closed, escalate in the handoff rather than patching it
yourself — an unreviewed security patch from outside the owning window is its own risk.

---

## Attack surface — work through all of it

### 1. Authentication & session

- Access-profile picker reachable in a production build? **Try to defeat W1-B's module-load
  guard.** Env manipulation, build-flag combinations, direct route access.
- Session fixation; token in a URL; session surviving deactivation.
- `?next=` open redirect: `https://evil.com`, `//evil.com`, `/\evil.com`, `%2F%2Fevil.com`,
  `/\/\evil.com`, backslash and unicode variants.
- Password reset flow, if present: token entropy, expiry, single use.

### 2. Authorisation — the big one

- **Every route × every one of 11 roles.** Script it. Vertical escalation: can `tenant` reach
  finance? Horizontal: can `owner` A reach `owner` B's units, statements, documents?
- **`child_*` escalation via the guardian relation** — the most likely real hole in this model.
- Self-role elevation via a direct `PATCH`.
- IDOR on every `[id]` route: iterate ids as a low-privilege role.
- **RLS bypass**: does any route use the service-role client where it should use the user client?
  Grep for `createServiceRoleClient` and justify every call site.
- Does the API re-check permission, or does it trust that the UI hid the button?

### 3. Injection

- SQL injection through every filter, sort, and search parameter. `?sort=` is the usual one.
- **XSS**: stored (report form → dashboard triage), reflected (search), DOM-based. Scraped
  competitor content is untrusted input — check every render path for it.
- **Prompt injection**: through the report form into AI context; through scraped portal pages
  into retrieval context. W2-C claims to neutralise both — verify it independently.
- Path traversal in document filenames and storage keys.
- Header injection in any redirect or generated file.
- ICS injection through activity titles (`\n` breaking the calendar format).

### 4. Data exposure

- Does any error response leak `postgres`, `PGRST`, a stack frame, a file path, or a table name?
  **Grep every captured response body.**
- Is the service-role key reachable from the client bundle? Search the built output.
- Are PII fields present in exports for roles that cannot see them in the UI?
- **Is any protected route in the service-worker cache?** Enumerate the cache (W2-D claims none).
- Are signed URLs short-lived and unguessable? Does an expired one actually fail?
- Timing differences that reveal whether a record exists.

### 5. Rate limiting & abuse

- Public report and public chat: is the limit real, and keyed on more than IP?
- Idempotency: can a replay create two records? Can a different body reuse a key?
- Denial-of-wallet on the AI endpoint: concurrent requests per user.
- Large payloads, deeply nested JSON, zip bombs in attachments.

### 6. Integrity

- Can a posted ledger entry be modified through any path — API, RPC, direct table?
- Can an audit event be edited or deleted?
- Is the last admin protected?
- Do concurrent writes produce a lost update anywhere?

### 7. Honesty audit — specific to this project

A category that a normal pentest would miss, and that matters more here than most:

- Does any UI present **seed data as live data**? (W2-D's `static` badge must be unmissable.)
- Does any write **fake success** when persistence is unavailable, instead of 503?
- Does any integration panel show an unconfigured provider as healthy?
- Does the concierge ever state a figure it cannot ground?
- Does any view **average across review platforms** or **convert currency silently**?
- Is any `modelled` unit presented in a way a user would read as a real listing?
- Does any `gap` fact render as `0` rather than "—"?

Each of these is a **High** finding. A system that misrepresents its own certainty is, for a
competitor-intelligence product, a security failure in the sense that matters: it causes bad
decisions.

---

## Deliverables

### `SECURITY-REVIEW.md`

Per finding:

```markdown
### SEC-001 — <title>

**Severity:** Critical | High | Medium | Low | Info
**Category:** authz | injection | exposure | integrity | abuse | honesty
**Owner:** W3-F (the window that must fix it)
**Status:** OPEN | FIXED | ACCEPTED-RISK | FALSE-POSITIVE

**Finding:** what is wrong
**Reproduction:** exact steps or the script invocation
**Evidence:** the actual request and response
**Impact:** what an attacker or a misled user gets
**Recommendation:** the specific fix
```

Plus a summary table, a coverage statement (**what you tested and what you did not**), and an
explicit residual-risk list.

### `scripts/security-probe.mjs`

Automates the mechanical parts — role × route matrix, IDOR sweep, error-leak grep, redirect
variants — so this review is repeatable rather than a one-off read-through.

---

## Definition of done

- Every surface in the list above tested, or **explicitly listed as not tested with a reason**
- `SECURITY-REVIEW.md` complete
- `security-probe.mjs` runs and exits non-zero on any Critical or High
- **Zero unresolved Critical or High.** Medium may be accepted risk with a named owner and a
  written justification.
- Every finding communicated to its owning window

Paste: the full findings table, and the probe output.

---

## Handoff must state

- Findings by severity and status
- **What you did not test, and why** — this is the most important line in your handoff
- Residual risks accepted, who accepted them, and the justification
- Whether every non-negotiable in `SYSTEM-PROMPT.md` §2 actually holds in the built system —
  go through them one by one and say so for each
