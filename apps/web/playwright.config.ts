import { defineConfig, devices } from "@playwright/test"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { existsSync, readdirSync } from "node:fs"

/**
 * Playwright configuration.                                       Owner: W4-A
 *
 * ## Two servers, because the role matrix and production truth are exclusive
 *
 * `tasks/W4-A` asks for the server to auto-start "with the three access-profile
 * flags set true", and its edge-case list also says to prefer a production
 * build. **Those two cannot both hold**, and the reason is W1-B's design rather
 * than a configuration mistake:
 *
 *   `accessProfilesEnabledForEnvironment()` returns `false` for any process
 *   where `NODE_ENV`, `VERCEL_ENV` or `AZURA_ENV` is `production`, *before it
 *   reads a single flag*. `next start` sets `NODE_ENV=production`. So in a
 *   production server the three flags are inert by construction — which is
 *   exactly the guarantee W4-C verified 39/39 at the HTTP boundary.
 *
 * There is no session available to replace them: a real Supabase session needs
 * a data plane, and this machine has no Docker daemon and no `psql`, so
 * `supabase start` cannot run. And `/[locale]/login` returns 404 today (W4-B
 * §4.1 — the directory has `actions.ts` and no `page.tsx`), so there is no
 * login form to drive either.
 *
 * The configuration therefore declares both servers and splits the suite:
 *
 *   | project              | server                | what only it can prove |
 *   |----------------------|-----------------------|------------------------|
 *   | chromium             | `next dev`  :3200     | 11 roles × 21 routes   |
 *   | mobile-chrome        | `next dev`  :3200     | the same, at 393×851   |
 *   | production           | `next start` :3201    | the picker is inert, CSP holds, the guard redirects |
 *
 * Every spec states which server it needs. Nothing is asserted on the wrong one.
 *
 * ## Retries
 *
 * 1 in CI, 0 locally, per the brief — and `tasks/W4-A` is explicit that a test
 * which only passes on retry is flaky and must be **named** in the handoff
 * rather than hidden. `HANDOFF/W4-A.md` §4 lists them.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const TMP = join(HERE, "..", "..", ".tmp")

/** Windows: keep temp files inside the repo. */
process.env["TEMP"] ??= TMP
process.env["TMP"] ??= TMP

/**
 * The browser this suite drives.
 *
 * `PLAYWRIGHT_BROWSERS_PATH` is deliberately **not** redirected into `.tmp`.
 * Doing so points Playwright at an empty directory, and it then looks for the
 * revision its own version pins — 1234 for `@playwright/test` 1.62 — which is
 * not the build installed on this machine. Every test fails at launch with
 * "Executable doesn't exist", which is what happened on the first run here and
 * what W1-D hit before that.
 *
 * So: use the default install location, and pin `executablePath` to the newest
 * full Chromium actually present. Resolved at config load, so a machine with a
 * matching revision needs no change and a machine without one is told plainly.
 */
function installedChromium(): string | undefined {
  const root =
    process.env["PLAYWRIGHT_BROWSERS_PATH"] ??
    (process.env["LOCALAPPDATA"] === undefined
      ? undefined
      : join(process.env["LOCALAPPDATA"], "ms-playwright"))
  if (root === undefined || !existsSync(root)) return undefined

  const builds = readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .map((name) => ({ name, revision: Number(name.split("-")[1]) }))
    .sort((a, b) => b.revision - a.revision)

  for (const build of builds) {
    for (const layout of ["chrome-win64", "chrome-win"]) {
      const candidate = join(root, build.name, layout, "chrome.exe")
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

const CHROMIUM = installedChromium()
if (CHROMIUM === undefined) {
  console.warn(
    "[playwright.config] No installed Chromium found; falling back to Playwright's own resolution. " +
      "If every test fails at launch, run `npx playwright install chromium`."
  )
}
const launch =
  CHROMIUM === undefined ? {} : { launchOptions: { executablePath: CHROMIUM } }

const DEV_PORT = 3200
const PROD_PORT = 3201

/** The three QA flags. Inert in a production process — see the header. */
const ACCESS_PROFILE_ENV = {
  ENABLE_ACCESS_PROFILES: "true",
  AZURA_ALLOW_REMOTE_ACCESS_PROFILES: "true",
  AZURA_DEMO_DATA_ISOLATED: "true",
}

export default defineConfig({
  testDir: "./e2e",
  // Generated matrices are large; a per-test timeout that is generous for the
  // 3D route but still bounded.
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  workers: process.env["CI"] ? 2 : 4,
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: join(HERE, "..", "..", "quality", "e2e", "results.json") },
    ],
  ],
  outputDir: join(TMP, "playwright-artifacts"),

  use: {
    baseURL: `http://127.0.0.1:${DEV_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        ...launch,
      },
      testIgnore: /production\//,
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"], ...launch },
      testIgnore: /production\//,
    },
    {
      // Production truth. A different base URL, and only the specs that must be
      // measured against a real production build.
      name: "production",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        baseURL: `http://127.0.0.1:${PROD_PORT}`,
        ...launch,
      },
      testMatch: /production\//,
    },
  ],

  // ONE server per run, selected by AZURA_E2E_MODE.
  //
  // `next dev` and `next start` both read and write `apps/web/.next`. Declaring
  // both webServers made Playwright start them together, dev recompiled into
  // the directory start was serving from, and every dashboard request died with
  // `SyntaxError: Unexpected non-whitespace character after JSON` — a
  // half-written build manifest. 248 of 263 tests failed on a problem that was
  // entirely the harness's.
  //
  // So the suite runs twice, and the handoff reports both runs.
  webServer:
    process.env["AZURA_E2E_MODE"] === "prod"
      ? [
          {
            command: `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${PROD_PORT}`,
            port: PROD_PORT,
            cwd: HERE,
            reuseExistingServer: !process.env["CI"],
            timeout: 180_000,
            // Set deliberately: the production specs assert that setting them
            // changes nothing, which is a stronger claim than not setting them.
            env: { ...ACCESS_PROFILE_ENV },
          },
        ]
      : [
          {
            // `--webpack`: Turbopack fails to start under load on this machine
            // (0xc0000142, recorded by W1-D), and the matrix opens many contexts.
            command: `node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port ${DEV_PORT}`,
            port: DEV_PORT,
            cwd: HERE,
            reuseExistingServer: !process.env["CI"],
            timeout: 180_000,
            env: { ...ACCESS_PROFILE_ENV, NODE_ENV: "development" },
          },
        ],
})
