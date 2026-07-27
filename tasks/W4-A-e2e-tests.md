# W4-A — Playwright end-to-end suite

**Wave:** 4 · **Depends on:** all of wave 3 · **Runs with:** W4-B, W4-C, W4-D

> Read `SYSTEM-PROMPT.md` §3 (how you report), every wave-3 handoff, and
> `D:\Real Estate CRM\Cati\apps\web\playwright.config.ts` plus its `e2e/` tree.

---

## Mission

Prove the app works, and be honest about what you did **not** prove.

The reference project's status document is careful in a way worth copying: it distinguishes
"804 executions in the manifest" from "overall result outstanding", and "326 assertions planned"
from "139 executed and passed". Match that. A suite that reports green because it skipped the
hard cases is worse than no suite.

---

## Files you own

```
apps/web/e2e/**  ·  apps/web/playwright.config.ts
apps/web/e2e/fixtures/*  ·  apps/web/e2e/helpers.ts
HANDOFF/W4-A.md
```

---

## Deliverables

### 1. Configuration

Projects `chromium` + `mobile-chrome` (Pixel 5). Base URL `http://127.0.0.1:3200`. Auto-start the
server with the three access-profile flags set true (`ENABLE_ACCESS_PROFILES`,
`AZURA_ALLOW_REMOTE_ACCESS_PROFILES`, `AZURA_DEMO_DATA_ISOLATED`). Retries 1 in CI, 0 locally — a test that
only passes on retry is flaky and must be reported as such, not hidden by the retry.

Windows: `PLAYWRIGHT_BROWSERS_PATH`, `TEMP`, `TMP` into `.tmp`.

### 2. Suite structure

| Directory | Covers |
|---|---|
| `e2e/public/` | landing, hotel page, report flow, concierge |
| `e2e/auth/` | login, access profiles, redirects, session expiry |
| `e2e/roles/` | **the role × route matrix** |
| `e2e/evidence/` | evidence cockpit, conflicts, provenance rendering |
| `e2e/inventory/` | units, listings, filters, virtualisation |
| `e2e/finance/` | ledger, payments, currency separation |
| `e2e/operations/` | ticket lifecycle, activities, calendar, ICS |
| `e2e/governance/` | documents, compliance, users, admin |
| `e2e/api/` | contract-level assertions against every route |
| `e2e/i18n/` | four locales, switching, formatting |
| `e2e/a11y/` | keyboard paths, focus, landmarks |

### 3. The role × route matrix — the centrepiece

**11 roles × ~20 routes × 2 viewports.** Generated, not hand-written:

```ts
for (const role of roles)
  for (const route of dashboardRoutes)
    test(`${role} → ${route.href}`, async ({ page }) => {
      await loginAs(page, role)
      const res = await page.goto(route.href)
      const allowed = hasPermission(role, route.permission)
      expect(res!.status()).toBe(allowed ? 200 : 403)
      if (allowed) {
        await expect(page.locator("main")).toBeVisible()
        expect(await page.locator("[data-error-boundary]").count()).toBe(0)
      }
    })
```

Assert **both directions**. A matrix that only checks that permitted roles get in proves nothing
about security; the forbidden half is the half that matters.

### 4. Evidence tests — Azura-specific, and non-negotiable

1. Every number on the landing page has a reachable provenance affordance
2. F-002 renders **all four** competing 1+1 prices, and the USD value is **not** converted
3. A `gap` fact renders "—" and never `0` — assert on the DOM text
4. `modelled` units are visually distinguishable from `portal_listing` in the **list** view
5. A stale listing shows its badge adjacent to the price
6. The evidence cockpit's counts match the dataset's own counts
7. **No cross-platform review score average appears anywhere** — assert absence

### 5. Security tests

Open redirect (all encodings), XSS through the report form surfacing in three views, self-role
elevation, cross-owner finance access, access-profile picker absent in a production build,
idempotency replay, rate limiting, and 503-not-fake-success on every write in seed mode.

### 6. Visual + a11y

Screenshot key surfaces across 4 locales × 3 viewports. Keyboard-only paths. `@axe-core/playwright`
on every public route and the dashboard home; zero violations at serious or critical.

---

## Edge cases in the tests themselves

- **Determinism**: seeds must be fixed (W2-A guarantees this). Any test depending on `Date.now()`
  will fail at midnight, in another timezone, or next month. Freeze time.
- **Race conditions**: never `waitForTimeout`. Use web-first assertions and explicit waits.
- **Test pollution**: each test starts from a known state. Do not depend on execution order.
- **Concurrency tests** (capacity race, double payment) need genuinely parallel requests, not
  sequential `await`s — otherwise they prove nothing.
- **Flake**: a test that passes on retry is reported as flaky **by name** in the handoff. Do not
  let the retry hide it.
- **Slow 3D route** — generous timeout, but assert the poster fallback separately with WebGL off.
- **German at 320px** is where layout tests actually fail. Include it.
- **Exit codes**: never pipe the run through `tail`. The reference project's `LESSONS-LEARNED.md`
  records exactly this mistake — `cmd | tail` reports `tail`'s status, so a failing suite looks
  green. Capture `$?` / `$LASTEXITCODE` explicitly.
- **Dev-mode OOM**: the same lessons file records e2e running out of memory in dev mode. Prefer
  `PLAYWRIGHT_SERVER_MODE=start` against a production build.

---

## Definition of done

```bash
pnpm --dir apps/web test:e2e -- --project=chromium
pnpm --dir apps/web test:e2e -- --project=mobile-chrome
echo "exit=$?"      # capture it explicitly
```

Report, honestly:

| Metric | Value |
|---|---|
| Tests defined | n |
| **Tests executed** | n |
| Passed / Failed / Skipped / Flaky | n / n / n / n |
| Role×route combinations asserted | n of 11 × 20 × 2 |
| axe violations (serious+critical) | n |

**A skipped test is not a passing test.** List every skip with its reason. If the full matrix did
not run, say which part did not and why — do not report a partial run as a suite pass.

---

## Handoff must state

- The honest table above
- Every failing test, with the failure output, not a summary
- Every flaky test by name
- What the suite does **not** cover — this list goes straight into W5's manual plan and is the
  most valuable thing you produce
