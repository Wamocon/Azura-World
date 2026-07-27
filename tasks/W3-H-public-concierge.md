# W3-H — Public intake, auth pages, AI concierge UI

**Wave:** 3 · **Depends on:** W1-B, W1-C, W1-D, W2-B, W2-C · **Runs with:** all other W3-*

> Read `SYSTEM-PROMPT.md`, `CONTRACTS.md` §6, `HANDOFF/W2-C.md` (guardrails + probe results),
> `HANDOFF/W1-B.md` (auth + access profiles). Then read
> `D:\Real Estate CRM\Cati\apps\web\components\site-concierge.tsx`, `public-report-form.tsx`,
> `public-report-tracker.tsx`, and `app\[locale]\login\page.tsx`.

---

## Mission

Everything an unauthenticated visitor touches. Two of these surfaces are the app's **only
unauthenticated write paths**, which makes them the highest-risk attack surface in the build:
the public report form and the public concierge.

Treat every input here as hostile.

---

## Files you own

```
apps/web/app/[locale]/{login,signup,report}/**
apps/web/components/site-concierge.tsx
apps/web/components/public-{report-form,report-tracker,access-request}.tsx
apps/web/components/concierge/*
HANDOFF/W3-H.md
```

Messages: `concierge.*`, `report.*`, `auth.*` only.

---

## Deliverables

### 1. Login — `/[locale]/login`

Supabase email/password, plus the **local access-profile role picker** in controlled
environments only.

The role picker is a deliberate QA backdoor. It must:
- Render **only** when `isAccessProfileEnabled()` (W1-B)
- Carry a visible, unmissable banner that this is a QA mode with no real authentication
- Be impossible to reach in a production build — W1-B's module-load guard enforces this; your job
  is to not add a second path around it

Also: `?next=` return-to-destination that is **validated against an allowlist of internal paths**.
An unvalidated `next` parameter is an open-redirect vulnerability, and it is the classic one.

### 2. Signup + access request

Registration with an activation workflow. `guest` role by default; elevation is an `admin`
action, never self-service.

### 3. Public report — `/[locale]/report`

Report an issue on the grounds with no account. Optionally QR-scoped to a unit or area.

**Every control below is required:**

- **Rate limited** — by IP *and* request fingerprint. IP alone is trivially bypassed and, behind a
  carrier NAT, punishes legitimate users.
- **Idempotency key** required. Same key + same fingerprint → return the **stored** response
  byte-identically. Same key + different body → 409.
- **A reference number is issued only after confirmed durable storage.** If persistence is
  unavailable, return **503** and issue nothing. 1Çatı's contract is explicit on this and it is
  the right call: a reference number the system cannot look up later is worse than an honest
  failure, because the reporter believes they have been heard.
- Input validation: length ceilings on every field, MIME + size limits on attachments, enforced
  server-side.
- No PII beyond what is needed. Optional contact details, clearly optional.
- **Tracker**: look up a report by reference. Must not leak other reports — the reference is the
  only key, so make it unguessable (not sequential) and rate-limit lookups too.

### 4. AI concierge — `site-concierge.tsx`

The chat UI over W2-C's guarded endpoint.

- Streaming with a visible stop control; aborting cleans up server-side.
- **Citations rendered inline**, as `SourceChip` components. Every factual claim shows its source.
- **Refusals shown as first-class answers**, not errors. "Nicht belegt" is a good answer and
  should look like one — not a red failure state.
- Conflict answers render the competing values as a small table, not a wall of prose.
- Starter prompts that demonstrate the honest behaviour, e.g. *"Warum widersprechen sich die
  Preisangaben?"*
- Gateway unconfigured → a polite "not configured" state; the page still works entirely.
- Feedback control (helpful / not helpful) writing to `ai_feedback`.

---

## Edge cases

- **Open redirect**: `?next=https://evil.com` → rejected. Allowlist internal paths only. Also
  reject `//evil.com`, `/\evil.com`, and encoded variants. Test all of them.
- **XSS in the report form** → escaped everywhere it is later displayed, including the dashboard
  triage view (W3-C/E consume this data). You are the ingestion point; sanitise here.
- **Prompt injection via the report form** → report text may later enter AI context. Treat it as
  data, delimited, never as instruction.
- **Attachment that is HTML named `.jpg`** → content-sniff, reject.
- **Rate limit hit by a legitimate user** behind shared NAT → clear message with `Retry-After`,
  not a silent failure.
- **Idempotency key replayed after the original expired** → 409 with an explanation, never a
  silent second write.
- **Reference number guessing** → unguessable format, rate-limited lookup, no enumeration signal
  in timing or error text.
- **Session expiry mid-chat** → preserve the draft, re-auth, resume.
- **Chat aborted mid-stream** → no truncated message persisted as complete.
- **Very long chat** → context ceiling handled server-side; the UI must not silently drop turns.
- **Locale mismatch** — user writes Turkish on the German page → the concierge answers in Turkish.
- **Screen reader**: streaming text needs `aria-live="polite"`, not `assertive`, or it interrupts
  constantly.
- **`prefers-reduced-motion`** → no typing animation, text appears directly.
- **JS disabled** → the report form should still submit via a plain form POST if feasible; if not,
  say so clearly rather than presenting a dead button.

---

## Definition of done

```bash
pnpm --dir apps/web typecheck && pnpm --dir apps/web lint && pnpm --dir apps/web build
```

Plus, evidence pasted — these are security proofs, not screenshots:

1. **Open redirect**: `?next=https://evil.com`, `//evil.com`, `/\evil.com`, `%2f%2fevil.com` →
   all rejected. Paste each attempt and its outcome.
2. XSS payload through the report form → escaped in the form, in the tracker, and in the
   dashboard triage view. Screenshot all three.
3. Prompt injection via report text → neutralised in the concierge. Show the exchange.
4. HTML file named `.jpg` → rejected by content sniffing
5. Rate limit exceeded → 429 with `Retry-After`
6. Idempotency: same key twice → **one** stored report, identical responses; different body →409
7. **Persistence unavailable → 503 and no reference number issued.** This is the important one.
8. Reference lookup for a non-existent reference → indistinguishable from an unauthorised one
9. Concierge answering the 1+1 price question → conflict table with four sources rendered
10. Concierge refusal → rendered as an answer, not an error state
11. Access-profile picker absent in a production build
12. Keyboard-only path through login → report → tracker

---

## Handoff must state

- The `next` allowlist implementation and every bypass you tested
- The idempotency and rate-limit parameters as configured
- Confirmation that no reference number can be issued without durable storage
- How report text is neutralised before it can reach AI context
