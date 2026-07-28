/**
 * Adversarial security probe.                                     Owner: W4-C
 *
 * This is not a checklist that confirms the team followed the rules. It is the
 * executable half of `SECURITY-REVIEW.md`: every check here corresponds to a
 * finding that was found by *trying to break something*, and exists so the same
 * break cannot silently return.
 *
 * ## Contract
 *
 *   - Exit **0** only when no Critical and no High finding reproduces.
 *   - Exit **1** when any Critical or High reproduces.
 *   - Exit **2** when the probe itself could not run a gate (a skipped gate is
 *     not a pass, and must not be reported as one).
 *
 * A Medium or Low finding that reproduces prints and does **not** fail the
 * build. That is a deliberate line: this probe is a regression gate for the
 * severe classes, not a lint pass. Every reproducing finding of any severity is
 * printed with its SEC id so the summary is never quieter than the review.
 *
 * ## Why some checks import the real module and some read the source
 *
 * Anything that can be imported is imported — a probe that re-implements the
 * predicate it is testing proves only that the copy agrees with itself. Where
 * the module cannot be loaded outside a Next request scope (`next/headers`
 * throws at module load), the check is **SKIPPED with a stated reason** rather
 * than approximated. Two checks read source text instead of importing, because
 * what they assert is a property *of the text*: which columns a PostgREST
 * `select()` names, and whether a file contains a byte that hides it from
 * `git grep`.
 *
 * ## Run
 *
 *   node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs \
 *        scripts/security-probe.mjs
 *
 * `package.json` is W0-A's file; a `qa:security` entry is requested in
 * `HANDOFF/W4-C.md` rather than added here.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB = join(ROOT, "apps", "web");

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Severity ordering. `critical` and `high` are the only ones that fail the run. */
const FAILING = new Set(["critical", "high"]);

const results = [];
const pending = [];
let skippedGates = 0;

/**
 * Runs one check.
 *
 * Every assertion is written against the **desired** state, not the current
 * one. A finding that is still open therefore reports `OPEN` on its own, and
 * flips to `PASS` the day it is fixed without anyone editing this file. There
 * is no expected-failure list to fall out of date.
 *
 * `fn` may be async. Its slot in `results` is reserved synchronously so the
 * report keeps source order, and the outcome is filled in before anything is
 * printed.
 */
function check(id, severity, title, owner, fn) {
  const slot =
    results.push({
      id,
      severity,
      title,
      owner,
      state: "pending",
      detail: null,
    }) - 1;

  const settle = (detail) => {
    results[slot] = {
      id,
      severity,
      title,
      owner,
      ...(detail === true || detail === undefined
        ? { state: "clean", detail: null }
        : { state: "reproduces", detail: String(detail) }),
    };
  };
  const fail = (error) => {
    if (error instanceof SkipError) {
      skippedGates += 1;
      results[slot] = {
        id,
        severity,
        title,
        owner,
        state: "skipped",
        detail: error.message,
      };
    } else {
      results[slot] = {
        id,
        severity,
        title,
        owner,
        state: "reproduces",
        detail: `probe error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };

  try {
    const value = fn();
    if (
      value !== null &&
      typeof value === "object" &&
      typeof value.then === "function"
    ) {
      pending.push(value.then(settle, fail));
      return;
    }
    settle(value);
  } catch (error) {
    fail(error);
  }
}

class SkipError extends Error {}
function skip(reason) {
  throw new SkipError(reason);
}

/** Collects sub-assertion failures so one check can report every case it broke. */
function collect() {
  const failures = [];
  return {
    assert(condition, message) {
      if (!condition) failures.push(message);
    },
    result(summaryPrefix) {
      if (failures.length === 0) return true;
      const shown = failures.slice(0, 8).join(" · ");
      const more =
        failures.length > 8 ? ` · (+${failures.length - 8} more)` : "";
      return `${summaryPrefix}: ${failures.length} case(s) — ${shown}${more}`;
    },
    get count() {
      return failures.length;
    },
  };
}

function readIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function walk(dir, filter, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === ".git"
      )
        continue;
      walk(full, filter, out);
    } else if (filter(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Module loading. Anything that cannot load becomes a SKIP, never a pass.
// ---------------------------------------------------------------------------

async function tryImport(specifier) {
  try {
    return await import(specifier);
  } catch (error) {
    return { __failed: error instanceof Error ? error.message : String(error) };
  }
}

const contracts = await tryImport("../apps/web/lib/contracts.ts");
const rbac = await tryImport("../apps/web/lib/rbac.ts");
const access = await tryImport("../apps/web/lib/dashboard-resource-access.ts");
const routing = await tryImport("../apps/web/lib/dashboard-routing.ts");
const authResolution = await tryImport("../apps/web/lib/auth-resolution.ts");
const policy = await tryImport("../apps/web/lib/access-profile-policy.ts");
const format = await tryImport("../apps/web/components/evidence/format.ts");
const loginActions = await tryImport(
  "../apps/web/app/[locale]/login/actions.ts",
);

function need(mod, name) {
  if (mod.__failed)
    skip(
      `${name} could not be loaded outside a Next request scope: ${mod.__failed}`,
    );
  return mod;
}

// ===========================================================================
// 1. Authorisation — the full role x route matrix, not a spot check
// ===========================================================================

check(
  "SEC-M01",
  "high",
  "No dashboard route is reachable without authentication",
  "W3-B / W1-B",
  () => {
    need(access, "lib/dashboard-resource-access.ts");
    need(contracts, "lib/contracts.ts");
    const c = collect();
    for (const role of contracts.roles) {
      for (const path of access.allDashboardPaths) {
        const decision = access.decideDashboardAccess(path, role, false);
        c.assert(
          decision.allowed === false,
          `unauthenticated ${role} allowed ${path}`,
        );
        c.assert(
          decision.allowed === true || decision.reason === "unauthenticated",
          `unauthenticated ${role} on ${path} denied for the wrong reason (${decision.allowed ? "n/a" : decision.reason})`,
        );
      }
    }
    return c.result("unauthenticated access");
  },
);

check(
  "SEC-M02",
  "high",
  "Every allowed route is backed by a permission the role actually holds",
  "W3-B / W1-B",
  () => {
    need(access, "lib/dashboard-resource-access.ts");
    need(rbac, "lib/rbac.ts");
    need(contracts, "lib/contracts.ts");
    const c = collect();
    let allowedCount = 0;
    for (const role of contracts.roles) {
      for (const path of access.allDashboardPaths) {
        const decision = access.decideDashboardAccess(path, role, true);
        if (!decision.allowed) continue;
        allowedCount += 1;
        const permission = access.permissionForPath(path);
        c.assert(
          permission === null || rbac.hasPermission(role, permission),
          `${role} allowed ${path} without holding ${permission}`,
        );
      }
    }
    c.assert(
      allowedCount > 0,
      "the matrix produced no allowed pairs at all — the probe is not exercising anything",
    );
    return c.result("unbacked route grant");
  },
);

check(
  "SEC-M03",
  "low",
  "An unknown path under /dashboard never resolves to an allowed route",
  "W3-B",
  () => {
    need(access, "lib/dashboard-resource-access.ts");
    need(contracts, "lib/contracts.ts");
    // The prefix-match bug class: `/dashboard/<anything>` collapsing onto the
    // index route and inheriting its permission.
    //
    // LOW, not High, and the reason is worth stating rather than assuming: the
    // only caller is `dashboard-route-guard.tsx`, a client component reading
    // `usePathname()`. That value comes from the router, and both the browser
    // and `NextURL` resolve dot segments before it exists. A raw `..` path
    // cannot reach this function from a request. What is being asserted here is
    // the helper's robustness for its next caller, not a live bypass.
    const probes = [
      "/dashboard/not-a-module",
      "/dashboard/units/../../admin",
      "/dashboard/../login",
      "/dashboardx",
      "/dashboard/%2e%2e/admin",
      "/dashboard//units",
      "/dashboard/units%00",
    ];
    const c = collect();
    for (const role of contracts.roles) {
      for (const path of probes) {
        const decision = access.decideDashboardAccess(path, role, true);
        if (decision.allowed) {
          c.assert(false, `${role} allowed synthetic path ${path}`);
        }
      }
    }
    return c.result("synthetic path");
  },
);

check(
  "SEC-M04",
  "high",
  "No added role out-ranks the parent it was derived from",
  "W1-B",
  () => {
    need(rbac, "lib/rbac.ts");
    const violations = rbac.verifyAdditiveAuthority();
    if (violations.length === 0) return true;
    return violations.map((v) => v.detail ?? JSON.stringify(v)).join(" · ");
  },
);

// ===========================================================================
// 2. Authentication — every branch fails closed
// ===========================================================================

check(
  "SEC-A01",
  "high",
  "No profile-resolution branch widens authority beyond what the database stated",
  "W1-B",
  () => {
    need(authResolution, "lib/auth-resolution.ts");
    const c = collect();
    const cases = [
      {
        name: "no user",
        facts: {
          userId: null,
          userEmail: null,
          profileReadFailed: false,
          row: null,
        },
        maxRole: null,
      },
      {
        name: "read failed",
        facts: {
          userId: "u",
          userEmail: null,
          profileReadFailed: true,
          row: null,
        },
        maxRole: "tenant",
      },
      {
        name: "no row",
        facts: {
          userId: "u",
          userEmail: null,
          profileReadFailed: false,
          row: null,
        },
        maxRole: "tenant",
      },
      {
        name: "suspended admin",
        facts: {
          userId: "u",
          userEmail: null,
          profileReadFailed: false,
          row: { role: "admin", is_active: false },
        },
        maxRole: null,
      },
      {
        name: "anonymised admin",
        facts: {
          userId: "u",
          userEmail: null,
          profileReadFailed: false,
          row: {
            role: "admin",
            is_active: true,
            anonymized_at: "2026-01-01T00:00:00Z",
          },
        },
        maxRole: null,
      },
      {
        name: "unknown role string",
        facts: {
          userId: "u",
          userEmail: null,
          profileReadFailed: false,
          row: { role: "superuser", is_active: true },
        },
        maxRole: "tenant",
      },
      {
        name: "role injected as object",
        facts: {
          userId: "u",
          userEmail: null,
          profileReadFailed: false,
          row: { role: { toString: () => "admin" }, is_active: true },
        },
        maxRole: "tenant",
      },
      {
        name: "roles[] claims admin, role says tenant",
        facts: {
          userId: "u",
          userEmail: null,
          profileReadFailed: false,
          row: { role: "tenant", roles: ["admin"], is_active: true },
        },
        maxRole: "admin",
      },
    ];
    for (const { name, facts, maxRole } of cases) {
      const profile = authResolution.resolveSupabaseProfile(facts);
      if (maxRole === null) {
        c.assert(
          profile.authenticated === false,
          `"${name}" produced an authenticated profile (role ${profile.role})`,
        );
        continue;
      }
      c.assert(
        contracts.roleLevel[profile.role] <= contracts.roleLevel[maxRole],
        `"${name}" resolved to ${profile.role}, above the expected ceiling ${maxRole}`,
      );
    }
    return c.result("fail-closed");
  },
);

check(
  "SEC-A02",
  "medium",
  "roles[] cannot introduce authority the primary role column does not carry",
  "W1-B",
  () => {
    need(authResolution, "lib/auth-resolution.ts");
    // `normalizeRoleList` unions the assignment column with the primary role.
    // A `roles` array containing `admin` therefore *does* widen the list. That
    // is the documented design (a multi-role user), but it means the column is
    // authority-bearing and must be protected exactly like `role` is.
    const list = authResolution.normalizeRoleList(["admin"], "tenant");
    if (!list.includes("admin")) return true;
    return (
      "roles[] widens authority (['admin'] on a tenant yields " +
      JSON.stringify(list) +
      ") — so it needs the same write protection as profiles.role, which prevent_profile_privilege_escalation() does not give it"
    );
  },
);

check(
  "SEC-A03",
  "critical",
  "Every column named in the profiles select() exists in the migrations",
  "W1-B / W1-A",
  () => {
    const authSource = readIfPresent(join(WEB, "lib", "auth.ts"));
    if (authSource === null) skip("apps/web/lib/auth.ts not found");

    const select =
      /\.from\("profiles"\)[\s\S]{0,400}?\.select\(\s*"([^"]+)"/.exec(
        authSource,
      );
    if (select === null)
      skip("could not locate the profiles select() in lib/auth.ts");
    const columns = select[1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.includes("("));

    const migrationDir = join(ROOT, "supabase", "migrations");
    if (!existsSync(migrationDir)) skip("supabase/migrations not found");
    const sql = walk(migrationDir, (n) => n.endsWith(".sql"))
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");

    // Comments are stripped first. Without this the check reads its own
    // documentation as schema: `roles` appears in four migration comments and
    // in no DDL, and the loose version of this check called that a pass.
    const ddl = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

    // Only the statements that can define a profiles column count.
    const profilesDdl = [
      ...(ddl.match(/create table[^;]*?public\.profiles[\s\S]*?;/gi) ?? []),
      ...(ddl.match(/alter table[^;]*?public\.profiles[\s\S]*?;/gi) ?? []),
    ].join("\n");
    if (profilesDdl.length === 0)
      skip("no CREATE/ALTER TABLE public.profiles found in the migrations");

    const missing = columns.filter(
      (col) => !new RegExp(`\\b${col}\\b`).test(profilesDdl),
    );
    if (missing.length === 0) return true;
    return `lib/auth.ts selects ${missing.join(", ")} from public.profiles, and no migration creates ${missing.length === 1 ? "it" : "them"}. PostgREST answers 42703, the read fails, and every authenticated user degrades to the minimal tenant role`;
  },
);

// ===========================================================================
// 3. The access-profile backdoor
// ===========================================================================

check(
  "SEC-B01",
  "critical",
  "No environment can enable the role picker in a production environment",
  "W1-B",
  () => {
    need(policy, "lib/access-profile-policy.ts");
    const c = collect();
    const productionMarkers = [
      { NODE_ENV: "production" },
      { VERCEL_ENV: "production" },
      { AZURA_ENV: "production" },
    ];
    const flagSets = [
      {},
      { ENABLE_ACCESS_PROFILES: "true" },
      {
        ENABLE_ACCESS_PROFILES: "true",
        AZURA_ALLOW_REMOTE_ACCESS_PROFILES: "true",
        AZURA_DEMO_DATA_ISOLATED: "true",
      },
      {
        ENABLE_ACCESS_PROFILES: "TRUE",
        AZURA_ALLOW_REMOTE_ACCESS_PROFILES: "1",
        AZURA_DEMO_DATA_ISOLATED: "yes",
      },
    ];
    const dataPlanes = [
      {},
      {
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "k",
      },
    ];
    for (const marker of productionMarkers) {
      for (const flags of flagSets) {
        for (const plane of dataPlanes) {
          const env = { ...marker, ...flags, ...plane };
          c.assert(
            policy.accessProfilesEnabledForEnvironment(env) === false,
            `enabled under ${JSON.stringify(env)}`,
          );
        }
      }
    }
    return c.result("production role picker");
  },
);

check(
  "SEC-B02",
  "high",
  "A misconfigured production process refuses to start",
  "W1-B",
  () => {
    need(policy, "lib/access-profile-policy.ts");
    const c = collect();
    const mustThrow = [
      { NODE_ENV: "production", ENABLE_ACCESS_PROFILES: "true" },
      {
        NODE_ENV: "production",
        ENABLE_ACCESS_PROFILES: "true",
        AZURA_ALLOW_REMOTE_ACCESS_PROFILES: "true",
        AZURA_DEMO_DATA_ISOLATED: "true",
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      },
      { VERCEL_ENV: "production", ENABLE_ACCESS_PROFILES: "true" },
      {
        AZURA_ENV: "production",
        ENABLE_ACCESS_PROFILES: "true",
        AZURA_DEMO_DATA_ISOLATED: "true",
      },
    ];
    for (const env of mustThrow) {
      let threw = false;
      try {
        policy.assertAccessProfileSafety(env);
      } catch {
        threw = true;
      }
      c.assert(threw, `did not throw for ${JSON.stringify(env)}`);
    }
    return c.result("boot guard");
  },
);

check(
  "SEC-B03",
  "medium",
  "The role picker is not enabled against a live data plane on self-declared flags alone",
  "W1-B",
  () => {
    need(policy, "lib/access-profile-policy.ts");
    // Layer 2 (`isProvablyIsolated`) requires that NO Supabase data plane is
    // configured. Layer 1 does not: below production it accepts the three flags
    // while a real project ref sits in the environment. The flag is named
    // AZURA_DEMO_DATA_ISOLATED, but in this path nothing checks the isolation.
    const env = {
      NODE_ENV: "development",
      ENABLE_ACCESS_PROFILES: "true",
      AZURA_ALLOW_REMOTE_ACCESS_PROFILES: "true",
      AZURA_DEMO_DATA_ISOLATED: "true",
      NEXT_PUBLIC_SUPABASE_URL: "https://real-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "real-anon-key",
    };
    const enabled = policy.accessProfilesEnabledForEnvironment(env);
    const planeVisible = policy.hasSupabaseDataPlane(env);
    if (!(enabled && planeVisible)) return true;
    return "accessProfilesEnabledForEnvironment() returns true while hasSupabaseDataPlane() also returns true — an unauthenticated role picker over a real project, gated only by a flag that asserts isolation without checking it";
  },
);

check(
  "SEC-B04",
  "high",
  "An unrecognised access-profile cookie never resolves upward",
  "W1-B",
  () => {
    need(policy, "lib/access-profile-policy.ts");
    need(contracts, "lib/contracts.ts");
    const c = collect();
    const hostile = [
      "admin ",
      "ADMIN",
      "admin\n",
      "admin;role=admin",
      "__proto__",
      "constructor",
      "toString",
      JSON.stringify({ role: "admin" }),
      "0",
      "",
    ];
    for (const value of hostile) {
      const role = policy.resolveAccessProfileRole(value, {});
      c.assert(
        contracts.roleLevel[role] <=
          contracts.roleLevel[policy.DEFAULT_ACCESS_PROFILE_ROLE],
        `cookie ${JSON.stringify(value)} resolved to ${role}`,
      );
    }
    return c.result("cookie escalation");
  },
);

// ===========================================================================
// 4. Open redirect
// ===========================================================================

check(
  "SEC-R01",
  "high",
  "The post-login destination cannot be steered off-origin",
  "W1-B",
  () => {
    if (loginActions.__failed) {
      skip(
        `app/[locale]/login/actions.ts imports next/headers transitively and cannot load outside a request scope (${loginActions.__failed}). safeNextPath() was reviewed by reading it; the corpus below was NOT executed.`,
      );
    }
    const c = collect();
    const hostile = [
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "https://evil.example",
      "http:/evil.example",
      "javascript:alert(1)",
      "/dashboard\r\nSet-Cookie: a=b",
      "/dashboard ",
      "/\tevil.example",
      "/%09/evil.example",
      "/ /evil.example",
    ];
    return Promise.all(
      hostile.map(async (value) => {
        const out = await loginActions.safeNextPath(value);
        c.assert(
          out.startsWith("/") &&
            !out.startsWith("//") &&
            !out.includes("\\") &&
            !/[ -]/.test(out),
          `safeNextPath(${JSON.stringify(value)}) returned ${JSON.stringify(out)}`,
        );
      }),
    ).then(() => c.result("open redirect"));
  },
);

// ===========================================================================
// 5. The secret guard, and what hides from it
// ===========================================================================

check(
  "SEC-S01",
  "medium",
  "No tracked source file contains a NUL byte, which would hide it from the secret scanner",
  "W0-A",
  () => {
    let tracked;
    try {
      tracked = execFileSync("git", ["ls-files", "-z"], {
        cwd: ROOT,
        maxBuffer: 64 * 1024 * 1024,
      })
        .toString("utf8")
        .split("\0")
        .filter((p) => p.length > 0);
    } catch (error) {
      skip(
        `git ls-files failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const sourceish =
      /\.(ts|tsx|mts|mjs|js|jsx|json|sql|md|yml|yaml|css|py|sh)$/;
    const offenders = [];
    for (const rel of tracked) {
      if (!sourceish.test(rel)) continue;
      const full = join(ROOT, rel);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (!stats.isFile() || stats.size > 8 * 1024 * 1024) continue;
      const bytes = readFileSync(full);
      if (bytes.includes(0)) offenders.push(rel);
    }
    if (offenders.length === 0) return true;
    return `${offenders.join(", ")} — git classifies these as binary, so \`git diff --cached | grep\` in .githooks/pre-commit and \`git grep -I\` in .github/workflows/ci.yml both skip their contents entirely. A secret added to any of them commits clean`;
  },
);

check(
  "SEC-S02",
  "medium",
  "The secret-scan pattern covers the key formats this stack actually issues",
  "W0-A",
  () => {
    const hook = readIfPresent(join(ROOT, ".githooks", "pre-commit"));
    if (hook === null) skip(".githooks/pre-commit not found");
    const missing = [];
    // Formats reachable from this repository's own dependencies and workflow.
    const required = [
      ["sb_secret_", "Supabase secret key (current format)"],
      ["sb_publishable_", "Supabase publishable key (current format)"],
      ["sbp_", "Supabase personal access token"],
      ["sk-ant-", "Anthropic API key"],
      ["ghp_|github_pat_", "GitHub token"],
    ];
    for (const [needle, label] of required) {
      if (!needle.split("|").some((n) => hook.includes(n))) missing.push(label);
    }
    if (missing.length === 0) return true;
    return `the hook's pattern list does not match: ${missing.join(", ")}. Its JWT pattern only covers the legacy HS256 Supabase key, and \`sk-[a-f0-9]{24,}\` is lowercase-hex only, so it cannot match sk-ant-*`;
  },
);

check(
  "SEC-S03",
  "low",
  "The CI job named 'Scan history' scans history",
  "W0-A",
  () => {
    const ci = readIfPresent(join(ROOT, ".github", "workflows", "ci.yml"));
    if (ci === null) skip(".github/workflows/ci.yml not found");
    if (!/Scan history/i.test(ci)) return true;
    // `git grep` reads the working tree at the checked-out commit. A secret that
    // was committed and later removed is invisible to it.
    const usesGitGrep = /Scan history[\s\S]{0,600}?git grep/.test(ci);
    const usesLogOrRevList =
      /Scan history[\s\S]{0,600}?git (log|rev-list)/.test(ci);
    if (!usesGitGrep || usesLogOrRevList) return true;
    return "the step is named 'Scan history for secret-shaped strings' but runs `git grep`, which reads only the checked-out tree. A secret committed and removed in a later commit passes this gate, and the name says otherwise";
  },
);

// ===========================================================================
// 6. What reaches the browser
// ===========================================================================

check(
  "SEC-C01",
  "critical",
  "No server-only secret value is present in the client bundle",
  "W0-A",
  () => {
    const staticDir = join(WEB, ".next", "static");
    if (!existsSync(staticDir))
      skip(
        "no production build present — run `pnpm --dir apps/web build` first",
      );
    const files = walk(staticDir, (n) => n.endsWith(".js"));
    if (files.length === 0) skip(".next/static contains no JavaScript chunks");
    const c = collect();
    // Value-shaped, not name-shaped: a Zod schema naming a variable is not a
    // leak, an assignment carrying its value is. Anchored so that
    // "mask-image-linear-..." cannot masquerade as an `sk-` key.
    const valuePatterns = [
      /\bSUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"']{20,}["']/,
      /\bSUPABASE_DB_URL\s*[:=]\s*["']postgres/,
      /\bJIRA_API_TOKEN\s*[:=]\s*["'][^"']{12,}["']/,
      /\bsb_secret_[A-Za-z0-9_-]{10,}/,
      /\bsbp_[a-f0-9]{40}\b/,
      /(?<![A-Za-z])sk-ant-[A-Za-z0-9_-]{20,}/,
      /(?<![A-Za-z])AKIA[0-9A-Z]{16}\b/,
      /\bpostgres(ql)?:\/\/[^:@"'\s]+:[^@"'\s]+@/,
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const pattern of valuePatterns) {
        if (pattern.test(source)) {
          c.assert(false, `${relative(ROOT, file)} matches ${pattern}`);
        }
      }
    }
    return c.result("client bundle secret");
  },
);

check(
  "SEC-C02",
  "medium",
  "The server environment schema does not reach the browser",
  "W2-D / W0-A",
  () => {
    const staticDir = join(WEB, ".next", "static");
    if (!existsSync(staticDir))
      skip(
        "no production build present — run `pnpm --dir apps/web build` first",
      );
    const files = walk(staticDir, (n) => n.endsWith(".js"));
    if (files.length === 0) skip(".next/static contains no JavaScript chunks");
    // A string that only exists inside lib/env.ts's server schema.
    const fingerprint = "does not look like a Supabase service-role key";
    const leaked = files.filter((f) =>
      readFileSync(f, "utf8").includes(fingerprint),
    );
    if (leaked.length === 0) return true;
    return `lib/env.ts's server schema is in ${leaked.map((f) => relative(ROOT, f)).join(", ")}. It publishes the full server variable inventory (names, validation rules, defaults) to any visitor and removes the module boundary that keeps future values server-side. The edge is hooks/use-live-snapshot.ts importing isSupabaseConfigured from "@/lib/env" in a "use client" module`;
  },
);

check(
  "SEC-C03",
  "low",
  "Server-only modules are guarded by the `server-only` package, not by convention",
  "W0-A",
  () => {
    const installed = existsSync(join(ROOT, "node_modules", "server-only"));
    const sources = walk(join(WEB, "lib"), (n) => n.endsWith(".ts"));
    // At the start of a line, so the TODO in lib/supabase/server.ts's header
    // comment — which shows the exact import it has not yet added — is not
    // counted as the import existing.
    const guarded = sources.filter((p) =>
      /^\s*import\s+["']server-only["']/m.test(readFileSync(p, "utf8")),
    );
    if (installed && guarded.length > 0) return true;
    return `the \`server-only\` package is ${installed ? "installed" : "NOT installed"} and ${guarded.length} of ${sources.length} modules under apps/web/lib import it. Nothing turns "this module must not reach the client" into a build error`;
  },
);

// ===========================================================================
// 6b. Server-side enforcement — what the response body contains, not what the
//     browser chooses to display
// ===========================================================================

check(
  "SEC-D01",
  "high",
  "A dashboard module re-checks its own permission on the server",
  "W3-C / W3-B",
  () => {
    const pages = walk(join(WEB, "app"), (n) => n === "page.tsx").filter((p) =>
      relative(WEB, p).replace(/\\/g, "/").includes("dashboard/"),
    );
    if (pages.length === 0) skip("no dashboard module routes found under app/");
    need(access, "lib/dashboard-resource-access.ts");
    const c = collect();
    for (const page of pages) {
      const source = readFileSync(page, "utf8");
      const rel = relative(WEB, page).replace(/\\/g, "/");

      // `app/[locale]/dashboard/evidence/page.tsx` → `/dashboard/evidence`
      const routePath =
        "/" + rel.replace(/^app\/\[locale\]\//, "").replace(/\/page\.tsx$/, "");
      const required = access.permissionForPath(routePath);

      // The dashboard layout already asserts `dashboard:view` server-side, so a
      // module whose own requirement IS `dashboard:view` is covered. Any module
      // that needs something narrower is not — the layout cannot know about it.
      if (required === null || required === "dashboard:view") continue;

      const checks =
        /hasPermission\s*\(|profileCan\s*\(|requireProfile\s*\(|forbidden\s*\(|notFound\s*\(/.test(
          source,
        );
      c.assert(
        checks,
        `${rel} requires ${required} and renders on the server without asserting it. Its output is serialized into the RSC flight payload before the client guard runs, so every role holding dashboard:view receives it`,
      );
    }
    return c.result("module without a server-side permission check");
  },
);

check(
  "SEC-D02",
  "high",
  "A role without the module permission does not receive the module's content",
  "W3-C / W3-B",
  async () => {
    const base = process.env["AZURA_PROBE_BASE_URL"];
    if (base === undefined || base.length === 0) {
      skip(
        "set AZURA_PROBE_BASE_URL to a running instance with access profiles enabled (e.g. http://127.0.0.1:3299) to execute this. It is the live half of SEC-D01 and was NOT run",
      );
    }
    // The needles are content the evidence cockpit renders and that no shell
    // chrome carries: a disputed price, a publisher, and the finding id.
    const needles = ["239.171", "Housearch", "F-002"];
    const c = collect();
    for (const role of ["tenant", "guest", "owner", "staff"]) {
      let body;
      try {
        const response = await fetch(`${base}/de/dashboard/evidence`, {
          headers: { cookie: `access_profile_role=${role}` },
        });
        body = await response.text();
      } catch (error) {
        skip(
          `could not reach ${base}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const leaked = needles.filter((n) => body.includes(n));
      c.assert(
        leaked.length === 0,
        `${role} received ${leaked.join(", ")} in the response body for /de/dashboard/evidence`,
      );
    }
    return c.result("restricted content in the response body");
  },
);

// ===========================================================================
// 7. Honesty — for an intelligence product these are security findings
// ===========================================================================

check(
  "SEC-H01",
  "high",
  "A displayed figure is never silently altered by its formatter",
  "W1-D",
  () => {
    need(format, "components/evidence/format.ts");
    const c = collect();
    const cases = [
      { value: 4.6, format: "number", locale: "en" },
      { value: 6.7, format: "number", locale: "en" },
      { value: 0.4, format: "number", locale: "en" },
      { value: 2.135, format: "number", locale: "en" },
    ];
    for (const testCase of cases) {
      const rendered = format.formatFactValue(
        testCase.value,
        testCase.format,
        testCase.locale,
      );
      const digits = rendered.replace(/[^0-9.,]/g, "").replace(",", ".");
      c.assert(
        Math.abs(Number.parseFloat(digits) - testCase.value) < 1e-9,
        `format="number" rendered ${testCase.value} as ${JSON.stringify(rendered)}`,
      );
    }
    if (c.count === 0) return true;
    return (
      c.result("formatter alters the value") +
      ' — formatNumber() defaults to maximumFractionDigits: 0 and the "number" case never overrides it'
    );
  },
);

check("SEC-H02", "high", "A gap fact never renders as 0", "W1-D", () => {
  need(format, "components/evidence/format.ts");
  const c = collect();
  for (const f of [
    "number",
    "area",
    "money",
    "metres",
    "kilometres",
    "percent",
    "stars",
    "text",
    "date",
  ]) {
    for (const value of [null, undefined]) {
      const rendered = format.formatFactValue(value, f, "de");
      c.assert(
        !/(^|[^0-9])0([^0-9]|$)/.test(rendered) || rendered.includes("—"),
        `format="${f}" rendered ${String(value)} as ${JSON.stringify(rendered)}`,
      );
    }
  }
  return c.result("gap rendered as a number");
});

check(
  "SEC-H03",
  "high",
  "No finding's narrative claims more sources than it carries",
  "W0-B",
  () => {
    const source = readIfPresent(join(WEB, "lib", "evidence-data.ts"));
    if (source === null) skip("apps/web/lib/evidence-data.ts not found");
    const words = {
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      zwei: 2,
      drei: 3,
      vier: 4,
      fünf: 5,
      sechs: 6,
    };
    const c = collect();
    // Each finding literal, from its id to the next one.
    const blocks = source.split(/\n\s*\{\s*\n\s*id: "/).slice(1);
    for (const block of blocks) {
      const id = block.slice(0, block.indexOf('"'));
      const message = /message:\s*\n?\s*"((?:[^"\\]|\\.)*)"/.exec(block);
      if (message === null) continue;
      // Narrowed to "across N publishers", which is a claim about the spread
      // this finding carries. "corroborated by N hosts" is deliberately NOT
      // matched: in F-006 that sentence is about the completion date, a
      // different field, and its sources are not in `competingValues`. A check
      // that cannot tell the two apart produces a finding that is wrong, and a
      // wrong finding costs more than the one it would have caught.
      const claim = new RegExp(
        `\\bacross\\s+(${Object.keys(words).join("|")})\\s+(publishers|portals|sources|hosts|Portale|Quellen)\\b`,
        "i",
      ).exec(message[1]);
      if (claim === null) continue;
      const claimed = words[claim[1].toLowerCase()];
      if (claimed === undefined) continue;
      const competing = /competingValues:\s*\[([\s\S]*?)\n\s*\]/.exec(block);
      const carried =
        competing === null
          ? 0
          : (competing[1].match(/\{\s*value:/g) ?? []).length;
      c.assert(
        carried >= claimed,
        `${id} claims "${claim[0]}" and carries ${carried} competingValues`,
      );
    }
    return c.result("overstated corroboration");
  },
);

check(
  "SEC-H04",
  "high",
  "No finding's headline ratio is computed across currencies",
  "W0-B",
  () => {
    const source = readIfPresent(join(WEB, "lib", "evidence-data.ts"));
    if (source === null) skip("apps/web/lib/evidence-data.ts not found");
    const c = collect();
    const blocks = source.split(/\n\s*\{\s*\n\s*id: "/).slice(1);
    for (const block of blocks) {
      const id = block.slice(0, block.indexOf('"'));
      const message = /message:\s*\n?\s*"((?:[^"\\]|\\.)*)"/.exec(block);
      if (message === null) continue;
      const hasRatio = /\d+([.,]\d+)?\s*x\s+range|\d+([.,]\d+)?-?fache/i.test(
        message[1],
      );
      if (!hasRatio) continue;
      const currencies = new Set(
        (block.match(/currency:\s*"([A-Z]{3})"/g) ?? []).map((m) =>
          m.slice(-4, -1),
        ),
      );
      c.assert(
        currencies.size <= 1,
        `${id} states a ratio in its message while carrying ${[...currencies].join(" and ")} — the ratio can only have been produced by a conversion this product forbids`,
      );
    }
    return c.result("cross-currency ratio");
  },
);

check(
  "SEC-H05",
  "high",
  "No identifiable staff name is carried in the committed dataset",
  "W0-B",
  () => {
    // The specific tokens W3-G found in the 5/5 review it renders as the
    // positive extreme. This is a regression test for a redaction that has to
    // happen at ingestion: the repository is public, so display-time filtering
    // would leave the names in the committed file regardless.
    const names = ["sanemsii", "Tulane"];
    const files = ["lib/azura-world-data.ts", "lib/hotel-data.ts"];
    const c = collect();
    for (const rel of files) {
      const source = readIfPresent(join(WEB, ...rel.split("/")));
      if (source === null) continue;
      for (const name of names) {
        c.assert(!source.includes(name), `${rel} contains "${name}"`);
      }
    }
    return c.result("staff name in committed data");
  },
);

check(
  "SEC-H06",
  "medium",
  "Every surface that can serve seed data can say so",
  "W2-A / W3-*",
  () => {
    const pages = walk(join(WEB, "app"), (n) => n === "page.tsx");
    const c = collect();
    for (const page of pages) {
      const source = readFileSync(page, "utf8");
      if (!/@\/lib\/[a-z-]*repository/.test(source)) continue;
      c.assert(
        /local-seed|\bsource\b/.test(source),
        `${relative(WEB, page)} reads a repository but never inspects the result's \`source\` discriminator`,
      );
    }
    return c.result("seed served unlabelled");
  },
);

// ===========================================================================
// 8. Service-role usage
// ===========================================================================

check(
  "SEC-P01",
  "low",
  "Every createServiceRoleClient() call site uses the client it resolves",
  "W2-C",
  () => {
    const sources = [
      ...walk(join(WEB, "lib"), (n) => n.endsWith(".ts")),
      ...walk(join(WEB, "app"), (n) => n.endsWith(".ts") || n.endsWith(".tsx")),
    ];
    const c = collect();
    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      const rel = relative(WEB, file).replace(/\\/g, "/");
      if (rel === "lib/supabase/server.ts") continue;
      const pattern =
        /(?:const|let)\s+(\w+)\s*=\s*createServiceRoleClient\(\)/g;
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const binding = match[1];
        const after = source.slice(match.index + match[0].length);
        // Used for anything beyond the immediate null check?
        const uses = after.match(new RegExp(`\\b${binding}\\b`, "g")) ?? [];
        const meaningful = new RegExp(`\\b${binding}\\s*\\.`).test(after);
        c.assert(
          meaningful,
          `${rel}: \`${binding}\` is resolved (${uses.length} later mention${uses.length === 1 ? "" : "s"}) but never used — a service-role client held for no reason is a privilege waiting for the next edit`,
        );
      }
    }
    return c.result("unused service-role client");
  },
);

// ===========================================================================
// Report
// ===========================================================================

await Promise.all(pending);

const reproduced = results.filter((r) => r.state === "reproduces");
const clean = results.filter((r) => r.state === "clean");
const skipped = results.filter((r) => r.state === "skipped");
const blocking = reproduced.filter((r) => FAILING.has(r.severity));

const bar = "─".repeat(78);
console.log(bar);
console.log("Azura World CATI — security probe (W4-C)");
console.log(bar);

for (const r of results) {
  const mark =
    r.state === "clean" ? "PASS" : r.state === "skipped" ? "SKIP" : "OPEN";
  console.log(`${mark}  ${r.id}  [${r.severity}]  ${r.title}`);
  if (r.detail !== null) {
    console.log(`        owner: ${r.owner}`);
    for (const line of String(r.detail).match(/.{1,100}(\s|$)/g) ?? []) {
      console.log(`        ${line.trim()}`);
    }
  }
}

console.log(bar);
console.log(
  `${clean.length} clean · ${reproduced.length} open (${blocking.length} Critical/High) · ${skipped.length} skipped`,
);

if (skipped.length > 0) {
  console.log("");
  console.log("SKIPPED GATES — these are not passes:");
  for (const r of skipped) console.log(`  ${r.id}  ${r.detail}`);
}

if (blocking.length > 0) {
  console.log("");
  console.log("BLOCKING:");
  for (const r of blocking)
    console.log(`  ${r.id}  [${r.severity}]  ${r.title}  → ${r.owner}`);
  console.log(bar);
  process.exit(1);
}

if (skippedGates > 0) {
  console.log("");
  console.log(
    "No Critical or High reproduced, but a gate could not run. Exiting 2.",
  );
  console.log(bar);
  process.exit(2);
}

console.log(bar);
process.exit(0);
