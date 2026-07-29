/**
 * Do the page gate and the repository gate agree with W1-B's matrix?
 *                                                              Owner: F5
 *
 * `HANDOFF/F1.md` §3 diagnosed the finance 500s as a *disagreement* between
 * `components/finance/finance-scope.ts` (RBAC) and `lib/finance-repository.ts`
 * (role level), and recommended reconciling one to the other. This asserts,
 * mechanically, whether such a disagreement exists at all — because a fix aimed
 * at the wrong cause is worse than no fix.
 *
 * The matrix below is transcribed from `HANDOFF/W1-B.md`, which SYSTEM-PROMPT
 * §1 and CONTRACTS §3 make the authority. It is written out longhand rather than
 * derived from `rbac.ts` on purpose: deriving it from the thing under test would
 * make this a tautology.
 *
 * Run: `pnpm gate:finance`
 */

import { roleLevel, roles, type Role } from "../apps/web/lib/contracts.ts";
import { hasPermission } from "../apps/web/lib/rbac.ts";

// ---------------------------------------------------------------------------
// The authority: HANDOFF/W1-B.md, "The permission matrix"
// ---------------------------------------------------------------------------

const W1B_VIEW: Readonly<Record<string, readonly Role[]>> = {
  "finance:view": ["admin", "manager", "accountant", "owner"],
  "wallet:view": [
    "admin",
    "manager",
    "accountant",
    "staff",
    "owner",
    "tenant",
    "child_owner",
    "child_tenant",
  ],
  "vendor_invoices:view": [
    "admin",
    "manager",
    "accountant",
    "staff",
    "service_provider",
  ],
};

// ---------------------------------------------------------------------------
// The repository's gate, re-declared here exactly as `finance-repository.ts`
// computes it. Re-declared rather than imported because the repository module
// pulls `@/lib/...` aliases that this loader does not resolve; the two
// predicates below are four lines and are asserted against the real module's
// behaviour by `scripts/finance-role-matrix.mjs` at the HTTP boundary.
// ---------------------------------------------------------------------------

/** `isFinanceVisibleRole`: FALSE for anon, `guest` and `child_guest`. */
function isFinanceVisibleRole(role: Role): boolean {
  return role !== "guest" && role !== "child_guest";
}

/** `canReadCompanyFinance`: level >= accountant (60). */
function canReadCompanyFinance(role: Role): boolean {
  return isFinanceVisibleRole(role) && roleLevel[role] >= roleLevel.accountant;
}

// ---------------------------------------------------------------------------

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass += 1;
  else fail += 1;
  console.log(
    `  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${label}${detail ? `  \x1b[2m- ${detail}\x1b[0m` : ""}`,
  );
}

console.log(
  "\n\x1b[1m1. The page gate reproduces W1-B's matrix exactly\x1b[0m",
);
console.log("-".repeat(52));
for (const [permission, allowed] of Object.entries(W1B_VIEW)) {
  for (const role of roles) {
    const expected = allowed.includes(role);
    const actual = hasPermission(
      role,
      permission as Parameters<typeof hasPermission>[1],
    );
    check(
      `${role.padEnd(18)} ${permission.padEnd(24)} ${expected ? "allow" : "deny "}`,
      actual === expected,
      actual === expected ? "" : `rbac.ts says ${actual ? "allow" : "deny"}`,
    );
  }
}

console.log(
  "\n\x1b[1m2. The repository gate never refuses a role the page admits\x1b[0m",
);
console.log("-".repeat(52));
console.log(
  "  The claim in F1-001 is that these disagree. `isFinanceVisibleRole` is the\n" +
    "  only predicate that DENIES; `canReadCompanyFinance` only widens a scope\n" +
    "  from own-rows to company-wide. So the question is whether any role holding\n" +
    "  a view permission is refused outright.\n",
);
for (const [permission, allowed] of Object.entries(W1B_VIEW)) {
  for (const role of allowed) {
    check(
      `${role.padEnd(18)} holds ${permission.padEnd(24)} and is finance-visible`,
      isFinanceVisibleRole(role),
      isFinanceVisibleRole(role)
        ? ""
        : "REPOSITORY REFUSES A ROLE THE PAGE ADMITS",
    );
  }
}

console.log(
  "\n\x1b[1m3. Roles the repository scopes to their own rows (not a refusal)\x1b[0m",
);
console.log("-".repeat(52));
for (const role of roles) {
  if (!isFinanceVisibleRole(role)) continue;
  const wide = canReadCompanyFinance(role);
  console.log(
    `  ${role.padEnd(18)} level ${String(roleLevel[role]).padEnd(3)} -> ${wide ? "company-wide books" : "own rows only"}`,
  );
}

console.log(`\n\x1b[1m${pass} pass · ${fail} fail\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
