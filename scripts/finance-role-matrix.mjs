/**
 * Eleven roles × every finance surface, in both data modes.       Owner: F5
 *
 * The brief's requirement: *a role that may not read must get 403, never 500,
 * never a blank.* This asserts it as a matrix rather than by sampling, in the
 * two configurations that behave differently:
 *
 *   - **session**   real sign-in against Supabase, which is production's path
 *   - **anon**      QA access profiles with no Supabase session, which is the
 *                   fixture four other windows use and the one that produced
 *                   F1-001's 500s (the query runs as `anon`, which holds no
 *                   GRANT on `wallets` or `payment_transactions`)
 *
 * The expectation column is `HANDOFF/W1-B.md`'s matrix, transcribed longhand.
 * `scripts/finance-gate-parity.mts` asserts `rbac.ts` reproduces it; this
 * asserts the running pages do.
 *
 * Run: `node scripts/finance-role-matrix.mjs [--mode=session|anon|both]`
 * Needs a production build in `apps/web/.next`. `session` mode also needs
 * `quality/manual/.seed-password`.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "apps", "web");
const OUT = join(ROOT, "quality", "f5");

const arg = process.argv.find((a) => a.startsWith("--mode="));
const MODE = arg === undefined ? "both" : arg.slice("--mode=".length);
const PORT = Number(process.env["F5_PORT"] ?? 3240);
const BASE = `http://127.0.0.1:${PORT}`;

const ROLES = [
  "admin",
  "manager",
  "accountant",
  "staff",
  "owner",
  "tenant",
  "guest",
  "service_provider",
  "child_owner",
  "child_tenant",
  "child_guest",
];

const ROUTES = [
  ["finance", "/de/dashboard/finance"],
  ["wallet", "/de/dashboard/wallet"],
  ["vendor_invoices", "/de/dashboard/vendor-invoices"],
];

/** HANDOFF/W1-B.md, "The permission matrix". The authority. */
const MAY_VIEW = {
  finance: ["admin", "manager", "accountant", "owner"],
  wallet: [
    "admin",
    "manager",
    "accountant",
    "staff",
    "owner",
    "tenant",
    "child_owner",
    "child_tenant",
  ],
  vendor_invoices: [
    "admin",
    "manager",
    "accountant",
    "staff",
    "service_provider",
  ],
};

// ---------------------------------------------------------------------------

if (!existsSync(join(APP, ".next", "BUILD_ID"))) {
  console.error("No production build. Run `pnpm --dir apps/web build` first.");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

function startServer(extraEnv) {
  const bootstrap = `
    const next = require('next')
    const { createServer } = require('node:http')
    const app = next({ dev: false, dir: ${JSON.stringify(APP)} })
    const handle = app.getRequestHandler()
    app.prepare().then(() => {
      createServer((req, res) => handle(req, res)).listen(${PORT}, '127.0.0.1')
    })
  `;
  const child = spawn(process.execPath, ["-e", bootstrap], {
    cwd: APP,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "development", ...extraEnv },
  });
  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));
  return { child, log };
}

async function waitReady() {
  for (let i = 0; i < 90; i += 1) {
    try {
      const r = await fetch(`${BASE}/de`);
      if (r.status < 500) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server did not become ready");
}

/**
 * The listening PID must belong to THIS tree.
 *
 * W5 spent a pass reporting that a fix broke login, when in fact a stale server
 * from another worktree held the port. The check is four lines and it is the
 * difference between a QA result and a guess.
 */
async function assertOwnPort() {
  const { execSync } = await import("node:child_process");
  const out = execSync(`netstat -ano | findstr "127.0.0.1:${PORT}"`, {
    encoding: "utf8",
  });
  const pid = (out.match(/LISTENING\s+(\d+)/) ?? [])[1];
  if (pid === undefined) throw new Error(`nothing listening on ${PORT}`);
  const cmd = execSync(
    `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
    { encoding: "utf8" },
  );
  // Compare with every separator stripped. The app directory reaches the child's
  // command line in three different spellings depending on how it was started:
  // `D:/azura-f5/...` from a bootstrap literal, `D:\azura-f5\...` from
  // `next start`, and `D:\\azura-f5\\...` once JSON-escaped inside `node -e`.
  // Two earlier versions of this guard matched one spelling each and rejected
  // this script's own server - a false alarm, but the same class of mistake as
  // the false confidence it exists to prevent, so it is normalised rather than
  // enumerated.
  const strip = (s) => s.replace(/[\\/]+/g, "").toLowerCase();
  if (!strip(cmd).includes(strip(APP))) {
    throw new Error(
      `port ${PORT} is held by PID ${pid}, which is NOT this tree:\n  ${cmd.trim().slice(0, 200)}`,
    );
  }
  console.log(`  port ${PORT} verified: PID ${pid} is this worktree`);
}

async function runMode(mode) {
  const supabaseSession = mode === "session";
  const env = supabaseSession
    ? {}
    : {
        ENABLE_ACCESS_PROFILES: "true",
        AZURA_ALLOW_REMOTE_ACCESS_PROFILES: "true",
        AZURA_DEMO_DATA_ISOLATED: "true",
      };

  const { child, log } = startServer(env);
  const results = [];
  let browserRef = null;
  try {
    await waitReady();
    await assertOwnPort();

    let contexts = null;
    let browser = null;
    if (supabaseSession) {
      const pwPath = join(
        ROOT,
        "..",
        "Azura World",
        "quality",
        "manual",
        ".seed-password",
      );
      const alt = join(ROOT, "quality", "manual", ".seed-password");
      const file = existsSync(pwPath) ? pwPath : alt;
      if (!existsSync(file)) {
        console.log("  no .seed-password; skipping session mode");
        child.kill();
        return [];
      }
      const password = readFileSync(file, "utf8").trim();
      const envFile = Object.fromEntries(
        readFileSync(join(APP, ".env.local"), "utf8")
          .split(/\r?\n/)
          .filter((l) => /^[A-Z_]+=/.test(l))
          .map((l) => {
            const i = l.indexOf("=");
            return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
          }),
      );
      // A real sign-in through the form, in a real browser.
      //
      // The first version of this hand-assembled an `@supabase/ssr` cookie from
      // an access token. Every request 307d to /de/login and the matrix read as
      // 33 failures - a harness defect that looked exactly like an application
      // one. The cookie format is @supabase/ssr's to define, not this script's
      // to guess, so the browser is left to produce it.
      browser = await launchChromium();
      browserRef = browser;
      contexts = {};
      for (const role of ROLES) {
        const ctx = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          locale: "de-DE",
        });
        const page = await ctx.newPage();
        await page.goto(`${BASE}/de/login`, { waitUntil: "domcontentloaded" });
        await page.fill('input[type="email"]', `${role}@azura.local`);
        await page.fill('input[type="password"]', password);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(2200);
        contexts[role] = page;
      }
      void envFile;
    }

    console.log(
      "\n  " + "role".padEnd(18) + ROUTES.map(([k]) => k.padEnd(22)).join(""),
    );
    console.log("  " + "-".repeat(18 + 22 * ROUTES.length));

    for (const role of ROLES) {
      let line = "  " + role.padEnd(18);
      for (const [surface, route] of ROUTES) {
        let status;
        let body;
        if (supabaseSession) {
          const page = contexts[role];
          const response = await page.goto(`${BASE}${route}`, {
            waitUntil: "domcontentloaded",
          });
          await page.waitForTimeout(400);
          status = response?.status() ?? 0;
          body = await page.content();
        } else {
          const res = await fetch(`${BASE}${route}`, {
            headers: { cookie: `access_profile_role=${role}` },
            redirect: "manual",
          });
          status = res.status;
          body = await res.text();
        }
        const res = { status };
        const expected = MAY_VIEW[surface].includes(role) ? "allow" : "refuse";
        // A refusal PANEL, not the words, and there are legitimately TWO of
        // them at two layers:
        //
        //   `data-testid="dashboard-403"`     W3-B's shell route guard, which
        //                                     refuses before the page renders
        //   `data-slot="access-refused"`      the finance surface's own panel
        //
        // Grepping for "Kein Zugriff" instead matched a per-KPI-card refusal on
        // a fully-rendered admin page and reported seventeen false failures;
        // accepting only the second missed every role the shell stops first.
        const refused =
          /data-slot="access-refused"/.test(body) ||
          /data-testid="dashboard-403"/.test(body);
        const blank = body.replace(/<[^>]*>/g, "").trim().length < 40;
        const actual =
          res.status >= 500
            ? `HTTP${res.status}`
            : blank
              ? "blank"
              : refused
                ? "refuse"
                : "allow";
        // In `anon` mode the data plane refuses everyone, so "refuse" where the
        // matrix says "allow" is CORRECT there: the page must render the
        // refusal rather than 500. Only a 5xx or a blank is a failure.
        const ok = supabaseSession
          ? actual === expected
          : actual === "refuse" || actual === expected;
        results.push({
          mode,
          role,
          surface,
          status: res.status,
          expected,
          actual,
          ok,
        });
        line += `${ok ? " " : "!"}${actual}`.padEnd(22);
      }
      console.log(line);
    }
  } finally {
    if (typeof browserRef !== "undefined" && browserRef !== null) {
      await browserRef.close();
    }
    child.kill();
    await new Promise((r) => setTimeout(r, 800));
  }

  const errors = log.join("").match(/RepositoryError|Unhandled|⨯ Error/g) ?? [];
  const fives = results.filter((r) => r.status >= 500);
  const blanks = results.filter((r) => r.actual === "blank");
  console.log(
    `\n  ${mode}: ${results.filter((r) => r.ok).length}/${results.length} cells OK · ` +
      `${fives.length} HTTP 5xx · ${blanks.length} blank · ` +
      `${errors.length} unhandled server errors in the log`,
  );
  for (const r of results.filter((x) => !x.ok)) {
    console.log(
      `    FAIL ${r.role.padEnd(18)} ${r.surface.padEnd(16)} expected ${r.expected} got ${r.actual} (HTTP ${r.status})`,
    );
  }
  return results;
}

/** Chromium, pinned build first and any installed revision second. */
async function launchChromium() {
  const { createRequire } = await import("node:module");
  const req = createRequire(join(APP, "package.json"));
  const { chromium } = req("@playwright/test");
  try {
    return await chromium.launch({ headless: true });
  } catch {
    const { readdirSync } = await import("node:fs");
    // `join` rather than string concatenation: the separator survives every
    // later edit of this file, which two hand-written versions of these paths
    // did not.
    const root = join(process.env["LOCALAPPDATA"] ?? "", "ms-playwright");
    const candidate = readdirSync(root)
      .filter((n) => /^chromium-\d+$/.test(n))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
    const exe = [
      join(root, candidate, "chrome-win64", "chrome.exe"),
      join(root, candidate, "chrome-win", "chrome.exe"),
    ].find((p) => existsSync(p));
    return chromium.launch({ headless: true, executablePath: exe });
  }
}

const all = [];
for (const mode of MODE === "both" ? ["session", "anon"] : [MODE]) {
  console.log(`\n\x1b[1m=== ${mode} mode ===\x1b[0m`);
  all.push(...(await runMode(mode)));
}

writeFileSync(
  join(OUT, "finance-role-matrix.json"),
  JSON.stringify(all, null, 2),
);

const failed = all.filter((r) => !r.ok);
const fives = all.filter((r) => r.status >= 500);
console.log(
  `\n\x1b[1m${all.length - failed.length} of ${all.length} cells OK · ${fives.length} HTTP 5xx\x1b[0m`,
);
process.exit(failed.length === 0 && fives.length === 0 ? 0 : 1);
