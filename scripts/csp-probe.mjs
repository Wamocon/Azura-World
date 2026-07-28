#!/usr/bin/env node
/**
 * S-009 regression gate — the CSP that silently disabled production JavaScript.
 *
 *   node scripts/csp-probe.mjs                 # build artefacts + runtime + browser
 *   node scripts/csp-probe.mjs --build-only    # artefacts only, no server needed
 *   node scripts/csp-probe.mjs --runtime-only  # skips the artefact phase
 *   node scripts/csp-probe.mjs --no-browser    # skips the Playwright pass
 *   node scripts/csp-probe.mjs --port 3210     # default 3200
 *   node scripts/csp-probe.mjs --external      # do not spawn a server; one is already up
 *
 * ## Why this file exists
 *
 * `proxy.ts` emits a per-request CSP containing `'nonce-…' 'strict-dynamic'`.
 * Next stamps that nonce onto its <script> tags by reading it back out of the
 * REQUEST header at render time. A statically prerendered document is built
 * without a request, so its scripts carry no nonce, and `'strict-dynamic'`
 * discards `'self'` and every host allowlist — so every script is blocked. The
 * page renders from server HTML and looks completely correct while running
 * ZERO JavaScript.
 *
 * It passed typecheck, lint, build, `next dev` and a 27-check Playwright suite
 * for a full night before anyone caught it, because **it does not reproduce in
 * `next dev`** — the dev branch of the policy omits `strict-dynamic`. That is
 * why this gate measures a real `next build` + `next start`, and why it asserts
 * on bytes actually transferred rather than on the shape of the policy string.
 *
 * ## What it asserts
 *
 * Phase 1 — build artefacts. No route may be statically prerendered while the
 * nonce policy is in force, except the documented allowlist below. Reads
 * `.next/prerender-manifest.json` and the emitted `.html` files, so it cannot
 * be satisfied by editing a source comment.
 *
 * Phase 2 — runtime under `next start`. For every probe URL: the response
 * carries a nonce CSP; the HTML contains at least one <script>; EVERY <script>
 * carries exactly that nonce; two requests get two different nonces; the
 * referenced chunks are fetchable and non-empty.
 *
 * Phase 3 — the same pages in Chromium: zero `securitypolicyviolation` events,
 * non-zero JS transferred, and `self.__next_f` populated, which is only true if
 * Next's inline bootstrap scripts actually executed.
 *
 * Exit code is 0 only if every assertion passed. Never pipe this through
 * `tail` — the pipe's status is not the gate's (SYSTEM-PROMPT §3).
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(repoRoot, "apps", "web");
const nextDir = join(appDir, ".next");

// ── args ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const portArgIndex = argv.indexOf("--port");
const port = portArgIndex === -1 ? 3200 : Number(argv[portArgIndex + 1]);
const runBuildPhase = !has("--runtime-only");
const runRuntimePhase = !has("--build-only");
const runBrowserPhase = runRuntimePhase && !has("--no-browser");
const useExternalServer = has("--external");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(
    `--port must be an integer 1-65535, got ${argv[portArgIndex + 1]}`,
  );
  process.exit(2);
}

// ── output ──────────────────────────────────────────────────────────────────

const useColour =
  process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
const c = (code, text) => (useColour ? `[${code}m${text}[0m` : text);
const bold = (text) => c("1", text);

let passes = 0;
let failures = 0;
const notes = [];

function section(title) {
  console.log(`\n${bold(title)}`);
  console.log("-".repeat(title.length));
}

function check(label, ok, detail = "") {
  if (ok) {
    passes += 1;
    console.log(
      `  ${c("32", "PASS")}  ${label}${detail === "" ? "" : `  — ${detail}`}`,
    );
  } else {
    failures += 1;
    console.log(
      `  ${c("31", "FAIL")}  ${label}${detail === "" ? "" : `  — ${detail}`}`,
    );
  }
  return ok;
}

function note(text) {
  notes.push(text);
  console.log(`  ${c("33", "NOTE")}  ${text}`);
}

// ---------------------------------------------------------------------------
// Phase 1 — build artefacts
// ---------------------------------------------------------------------------

/**
 * Routes that MAY ship as prerendered HTML under the nonce policy. Every entry
 * needs a reason that survives the question "so this page runs no JavaScript
 * in production — is that acceptable?". An entry without one is a silent
 * regression wearing an allowlist.
 */
const PRERENDER_ALLOWLIST = {
  "/_global-error": [
    "Next prerenders the global-error shell unconditionally: `global-error.tsx`",
    "replaces the root layout, so it never inherits the root layout's dynamic",
    "read and cannot be forced dynamic. Its content is inline-styled with a",
    'plain `<a href="/de">` recovery path that works with no JavaScript. The',
    "`reset()` button does need hydration and may be inert when this static",
    "shell is what gets served — accepted, because the anchor is the working",
    "recovery and the alternative is weakening the policy for every page.",
  ].join(" "),
};

function phaseBuildArtefacts() {
  section("Phase 1 — build artefacts: nothing may be statically prerendered");

  const prerenderManifestPath = join(nextDir, "prerender-manifest.json");
  if (!existsSync(prerenderManifestPath)) {
    check(
      "a production build exists",
      false,
      `${prerenderManifestPath} is missing — run \`pnpm --dir apps/web build\` first`,
    );
    return;
  }
  check("a production build exists", true, "prerender-manifest.json found");

  const manifest = JSON.parse(readFileSync(prerenderManifestPath, "utf8"));
  const prerendered = Object.keys(manifest.routes ?? {}).sort();

  // Only HTML documents matter. `/manifest.webmanifest` is a route handler
  // returning JSON — it has no scripts to block.
  const htmlRoutes = prerendered.filter((route) =>
    existsSync(
      join(nextDir, "server", "app", `${route.replace(/^\//, "")}.html`),
    ),
  );
  const nonHtmlRoutes = prerendered.filter(
    (route) => !htmlRoutes.includes(route),
  );

  console.log(
    `  prerendered routes: ${prerendered.length === 0 ? "(none)" : prerendered.join(", ")}`,
  );
  if (nonHtmlRoutes.length > 0) {
    console.log(
      `  …of which emit no HTML document: ${nonHtmlRoutes.join(", ")}`,
    );
  }

  for (const route of htmlRoutes) {
    const reason = PRERENDER_ALLOWLIST[route];
    check(
      `prerendered HTML route ${route} is allowlisted`,
      reason !== undefined,
      reason === undefined
        ? "NOT allowlisted. Under the nonce CSP this page ships with every script " +
            "blocked. Either make it render dynamically (the root layout's " +
            "headers() read normally does this for you) or add it to " +
            "PRERENDER_ALLOWLIST in this file WITH a written reason."
        : "documented",
    );
  }

  if (htmlRoutes.length === 0) {
    check(
      "no prerendered HTML route at all",
      true,
      "the strongest possible state",
    );
  }

  for (const route of Object.keys(PRERENDER_ALLOWLIST)) {
    if (!htmlRoutes.includes(route)) {
      note(
        `allowlist entry ${route} is stale — it is no longer prerendered. ` +
          "Remove it so the list keeps meaning something.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — runtime under `next start`
// ---------------------------------------------------------------------------

/**
 * Two pages, chosen because they exercise the two rendering paths that matter.
 *
 * `/de` is the landing surface (W3-A) — the page that actually has to survive
 * this, and the one whose scripts a static render would kill. It is checked
 * first and it is the reason the gate exists.
 *
 * `/de/kitchen-sink` stays because it is the densest interactive route in the
 * tree. It calls `notFound()` in a production build unless
 * `AZURA_ENABLE_KITCHEN_SINK=1`, which is why this gate sets that variable on
 * the server it spawns: without it the probe would silently be measuring the
 * 404 page and would pass while proving nothing about a content page.
 *
 * `/de/there-is-no-such-page` is the 404, which Next prerenders as
 * `/_not-found`. It is the live reproduction of S-009 in this repository.
 */
const PROBE_PAGES = [
  { path: "/de", label: "the landing surface" },
  { path: "/de/kitchen-sink", label: "the densest interactive route" },
  { path: "/de/there-is-no-such-page", label: "a 404 under the proxy matcher" },
];

function waitForPort(targetPort, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ host: "127.0.0.1", port: targetPort });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(
            new Error(
              `nothing listening on 127.0.0.1:${targetPort} after ${timeoutMs}ms`,
            ),
          );
          return;
        }
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function startServer() {
  const nextBin = join(appDir, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) {
    throw new Error(`next binary not found at ${nextBin}`);
  }
  const child = spawn(
    process.execPath,
    [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: appDir,
      stdio: ["ignore", "pipe", "pipe"],
      // See PROBE_PAGES: the kitchen-sink route 404s in a production build
      // unless this is set, and a gate that measures the 404 page twice would
      // pass without proving anything about a content page.
      env: {
        ...process.env,
        NODE_ENV: "production",
        AZURA_ENABLE_KITCHEN_SINK: "1",
      },
    },
  );
  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));
  return { child, log };
}

/** Every `<script …>` opening tag in the document, as raw text. */
function scriptTags(html) {
  return html.match(/<script\b[^>]*>/gi) ?? [];
}

function nonceFromCsp(csp) {
  const match = /'nonce-([^']+)'/.exec(csp ?? "");
  return match === null ? null : match[1];
}

async function phaseRuntime(base) {
  section(
    "Phase 2 — runtime under `next start`: every script must carry the nonce",
  );

  const seenNonces = new Set();

  for (const probe of PROBE_PAGES) {
    const url = `${base}${probe.path}`;
    console.log(`\n  ${bold(probe.path)}  (${probe.label})`);

    const response = await fetch(url, { redirect: "manual" });
    const csp = response.headers.get("content-security-policy");
    const html = await response.text();

    check(
      `${probe.path} sends a Content-Security-Policy`,
      csp !== null,
      `status ${response.status}`,
    );
    if (csp === null) continue;

    const nonce = nonceFromCsp(csp);
    check(
      `${probe.path} CSP carries a nonce`,
      nonce !== null,
      csp.slice(0, 90),
    );
    check(
      `${probe.path} CSP is the production policy`,
      csp.includes("'strict-dynamic'"),
      csp.includes("'strict-dynamic'")
        ? "'strict-dynamic' present"
        : "NOT a production policy — is NODE_ENV=production? this gate is meaningless in dev",
    );
    if (nonce === null) continue;
    seenNonces.add(nonce);

    const tags = scriptTags(html);
    check(
      `${probe.path} HTML ships script tags`,
      tags.length > 0,
      `${tags.length} <script> tags`,
    );

    const unnonced = tags.filter((tag) => !tag.includes(`nonce="${nonce}"`));
    check(
      `${probe.path} every script tag carries the response nonce`,
      unnonced.length === 0,
      unnonced.length === 0
        ? `${tags.length}/${tags.length} nonced`
        : `${unnonced.length}/${tags.length} UNNONCED — this is the S-009 signature. ` +
            `First: ${unnonced[0].slice(0, 110)}`,
    );

    const srcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map(
      (m) => m[1],
    );
    let bytes = 0;
    for (const src of srcs) {
      const chunk = await fetch(new URL(src, base));
      bytes += (await chunk.arrayBuffer()).byteLength;
    }
    check(
      `${probe.path} referenced chunks are fetchable and non-empty`,
      srcs.length === 0 || bytes > 0,
      `${srcs.length} files, ${bytes} B`,
    );
  }

  console.log("");
  const [a, b] = await Promise.all([
    fetch(`${base}${PROBE_PAGES[0].path}`).then((r) =>
      nonceFromCsp(r.headers.get("content-security-policy")),
    ),
    fetch(`${base}${PROBE_PAGES[0].path}`).then((r) =>
      nonceFromCsp(r.headers.get("content-security-policy")),
    ),
  ]);
  check(
    "the nonce is per-request, not per-build",
    a !== null && b !== null && a !== b,
    `${String(a).slice(0, 12)}… vs ${String(b).slice(0, 12)}…`,
  );
}

// ---------------------------------------------------------------------------
// Phase 3 — Chromium
// ---------------------------------------------------------------------------

const chromiumArgIndex = argv.indexOf("--chromium");

/** Newest already-downloaded Playwright Chromium on this machine, or null. */
function findInstalledChromium() {
  if (chromiumArgIndex !== -1) return argv[chromiumArgIndex + 1] ?? null;

  const root =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (process.env.LOCALAPPDATA === undefined
      ? null
      : join(process.env.LOCALAPPDATA, "ms-playwright"));
  if (root === null || !existsSync(root)) return null;

  const candidates = readdirSync(root)
    .filter((name) => /^chromium(_headless_shell)?-\d+$/.test(name))
    .map((name) => ({ name, revision: Number(/(\d+)$/.exec(name)[1]) }))
    .sort((a, b) => b.revision - a.revision);

  for (const { name } of candidates) {
    for (const relative of [
      join("chrome-headless-shell-win64", "chrome-headless-shell.exe"),
      join("chrome-win64", "chrome.exe"),
      join("chrome-linux", "chrome"),
      join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    ]) {
      const candidate = join(root, name, relative);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

async function phaseBrowser(base) {
  section("Phase 3 — Chromium: bytes executed, not bytes served");

  // `@playwright/test` is a devDependency of apps/web, not of the root
  // workspace, so it does not resolve from this file's own directory. Resolve
  // it the way apps/web would.
  let chromium;
  try {
    const requireFromApp = createRequire(join(appDir, "package.json"));
    const mod = await import(
      pathToFileURL(requireFromApp.resolve("@playwright/test")).href
    );
    // `@playwright/test` is CJS; under ESM interop the named exports may only
    // be reachable through `default`.
    chromium = mod.chromium ?? mod.default?.chromium;
    if (chromium === undefined) throw new Error("no chromium export");
  } catch (error) {
    check(
      "Chromium phase ran",
      false,
      `Playwright not importable — NOT RUN. Pass --no-browser to accept that ` +
        `explicitly. ${String(error).slice(0, 120)}`,
    );
    return;
  }

  // Playwright pins a browser revision and refuses to launch when that exact
  // build is absent. Rather than download one, fall back to the newest build
  // already on the machine — the assertions here are about CSP enforcement and
  // script execution, which do not depend on the revision. `--chromium <path>`
  // overrides. If nothing is available this is reported as a FAILED assertion,
  // never skipped silently: a gate that quietly drops its strongest evidence is
  // the failure mode this whole file exists to prevent.
  async function launch() {
    try {
      return await chromium.launch();
    } catch (error) {
      const fallback = findInstalledChromium();
      if (fallback === null) throw error;
      note(`pinned Chromium revision absent; using ${fallback}`);
      return chromium.launch({ executablePath: fallback });
    }
  }

  let browser;
  try {
    browser = await launch();
  } catch (error) {
    check(
      "Chromium phase ran",
      false,
      `no Chromium could be launched — NOT RUN. Run \`npx playwright install ` +
        `chromium\`, or pass --no-browser to accept that explicitly. ` +
        `${String(error).slice(0, 120)}`,
    );
    return;
  }

  try {
    for (const probe of PROBE_PAGES) {
      const page = await browser.newPage();
      const violations = [];
      await page.addInitScript(() => {
        globalThis.__cspViolations = [];
        document.addEventListener("securitypolicyviolation", (event) => {
          globalThis.__cspViolations.push(
            `${event.violatedDirective} ${event.blockedURI}`,
          );
        });
      });
      page.on("console", (message) => {
        const text = message.text();
        if (/Content Security Policy/i.test(text)) violations.push(text);
      });

      await page.goto(`${base}${probe.path}`, { waitUntil: "networkidle" });

      // Measured inside the page via the Resource Timing API rather than
      // through Playwright's `request.sizes()`: `sizes()` comes over CDP and
      // silently reports 0 when the driver and the browser build disagree,
      // which is exactly the sort of quiet zero this gate exists to catch.
      // Hydration is proved by React 19's own container key on <body>, not by
      // `self.__next_f`, which Next drains once hydration completes and which
      // therefore reads empty on a HEALTHY page.
      const inPage = await page.evaluate(() => {
        const scripts = performance
          .getEntriesByType("resource")
          .filter((entry) => entry.initiatorType === "script");
        return {
          jsFiles: scripts.length,
          jsBytes: scripts.reduce((sum, entry) => sum + entry.transferSize, 0),
          jsDecoded: scripts.reduce(
            (sum, entry) => sum + entry.decodedBodySize,
            0,
          ),
          violations: globalThis.__cspViolations ?? [],
          scriptTags: document.querySelectorAll("script").length,
          noncedTags: document.querySelectorAll("script[nonce]").length,
          hydrated: Object.keys(document.body).some((key) =>
            key.startsWith("__react"),
          ),
        };
      });

      console.log(`\n  ${bold(probe.path)}`);
      console.log(
        `  JS transferred: ${inPage.jsBytes} B across ${inPage.jsFiles} files ` +
          `(${inPage.jsDecoded} B decoded) · ` +
          `script tags ${inPage.noncedTags}/${inPage.scriptTags} nonced · ` +
          `React hydrated: ${inPage.hydrated}`,
      );

      const allViolations = [...violations, ...inPage.violations];
      check(
        `${probe.path} raises no CSP violation`,
        allViolations.length === 0,
        allViolations.length === 0
          ? "0 violations"
          : `${allViolations.length}: ${allViolations[0]}`,
      );
      check(
        `${probe.path} actually transfers JavaScript`,
        inPage.jsBytes > 0,
        `${inPage.jsBytes} B across ${inPage.jsFiles} files`,
      );
      check(
        `${probe.path} React hydrated the document`,
        inPage.hydrated,
        inPage.hydrated
          ? "React container attached to <body>"
          : "no React container on <body> — the page is server HTML and nothing else, " +
              "however correct it looks",
      );

      await page.close();
    }
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

let server = null;
try {
  if (runBuildPhase) phaseBuildArtefacts();

  if (runRuntimePhase) {
    const base = `http://127.0.0.1:${port}`;
    if (useExternalServer) {
      await waitForPort(port, 5_000);
    } else {
      server = startServer();
      try {
        await waitForPort(port, 60_000);
      } catch (error) {
        console.log(`\n${c("31", "FAILED")}  ${error.message}`);
        console.log(server.log.join("").slice(-2000));
        process.exit(1);
      }
    }
    await phaseRuntime(base);
    if (runBrowserPhase) await phaseBrowser(base);
  }
} finally {
  if (server !== null) server.child.kill();
}

console.log("");
for (const text of notes) console.log(`  note: ${text}`);
const summary = `${passes} pass · ${failures} fail`;
console.log(
  failures === 0
    ? `${bold(c("32", "OK"))}  ${summary}`
    : `${bold(c("31", "FAILED"))}  ${summary}`,
);
process.exit(failures === 0 ? 0 : 1);
