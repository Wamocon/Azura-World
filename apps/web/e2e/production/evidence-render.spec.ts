import { expect, test } from "@playwright/test"
import { spawn, type ChildProcess } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { ACCESS_PROFILE_COOKIE } from "../../lib/access-profile-policy"

/**
 * W3-C's open verification, closed as far as this environment allows.
 *                                                                 Owner: W4-A
 *
 * `HANDOFF/W3-C.md` §9: *"the evidence cockpit renders under `next start` with a
 * real session"* — the surface had only ever been driven under `next dev`, and
 * W3-C was right to flag that a dev render proves nothing about the production
 * compilation. Their exact words: **"W4-A should treat this as an open
 * verification."**
 *
 * ## Why it cannot be closed literally
 *
 * A session under `next start` needs one of three things and this machine has
 * none of them:
 *
 *   - a Supabase session — `docker info` exits 1, there is no `psql`, so
 *     `supabase start` cannot run and there is no data plane to seed;
 *   - the QA access profile — `accessProfilesEnabledForEnvironment()` returns
 *     `false` whenever `NODE_ENV` is `production`, and `next start` sets it;
 *   - the login form — `/[locale]/login` is a 404 (W4-B §4.1).
 *
 * ## What this test does instead, and the narrower claim it makes
 *
 * It boots Next **programmatically with `dev: false`**, which serves the same
 * `.next` production build that `next start` serves, in a process where
 * `NODE_ENV` is not `production`. The access profile is therefore reachable and
 * the cockpit can be rendered and asserted.
 *
 * That closes the half W3-C actually worried about — *does the production
 * BUILD render this page, or has it only ever worked under the dev compiler?* —
 * and it does not close the other half: this is not a production **runtime**,
 * so it says nothing about behaviour under production environment variables,
 * production CSP nonce generation, or a real session.
 *
 * The distinction is stated here rather than in the handoff alone, because the
 * test name is what somebody will read first and it must not overclaim.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, "..", "..")
const PORT = 3202

let server: ChildProcess | undefined

async function waitForServer(url: string, attempts = 60): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`server at ${url} did not become ready`)
}

test.beforeAll(async () => {
  // `next start` would force NODE_ENV=production and close the access profile,
  // so the production build is served through Next's programmatic server with
  // the flag left off. `dev: false` is what makes this the built artifact.
  const bootstrap = `
    const next = require('next')
    const { createServer } = require('node:http')
    const app = next({ dev: false, dir: ${JSON.stringify(APP)} })
    const handle = app.getRequestHandler()
    app.prepare().then(() => {
      createServer((req, res) => handle(req, res)).listen(${PORT}, '127.0.0.1')
    })
  `
  server = spawn(process.execPath, ["-e", bootstrap], {
    cwd: APP,
    stdio: "ignore",
    env: {
      ...process.env,
      NODE_ENV: "development",
      ENABLE_ACCESS_PROFILES: "true",
      AZURA_ALLOW_REMOTE_ACCESS_PROFILES: "true",
      AZURA_DEMO_DATA_ISOLATED: "true",
    },
  })
  await waitForServer(`http://127.0.0.1:${PORT}/de`)
})

test.afterAll(() => {
  server?.kill()
})

test.describe("the evidence cockpit against the production build", () => {
  test("renders for a permitted role, with its evidence intact", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: `http://127.0.0.1:${PORT}`,
    })
    await context.addCookies([
      {
        name: ACCESS_PROFILE_COOKIE,
        value: "manager",
        domain: "127.0.0.1",
        path: "/",
        sameSite: "Lax",
      },
    ])
    const page = await context.newPage()

    const response = await page.goto(
      `http://127.0.0.1:${PORT}/de/dashboard/evidence`,
      {
        waitUntil: "domcontentloaded",
      }
    )

    expect(
      response?.status(),
      "the cockpit did not render from the production build"
    ).toBe(200)
    expect(
      new URL(page.url()).pathname,
      "redirected instead of rendering"
    ).not.toContain("/login")

    // Not merely a 200: the evidence itself, from the built artifact.
    const body = page.locator("body")
    await expect(body).toContainText("F-002")
    for (const figure of ["112.000", "185.000", "220.000", "239.171"]) {
      await expect(
        body,
        `${figure} missing from the production render`
      ).toContainText(figure)
    }
    // Two currencies, still not reconciled.
    const text = (await body.innerText()).replace(/\s+/g, " ")
    expect(
      text,
      "the USD figure lost its currency in the production build"
    ).toMatch(/239[.,]171\s*(\$|USD)/)

    await context.close()
  })

  test("still refuses a role that lacks evidence:view", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: `http://127.0.0.1:${PORT}`,
    })
    await context.addCookies([
      {
        name: ACCESS_PROFILE_COOKIE,
        value: "tenant",
        domain: "127.0.0.1",
        path: "/",
        sameSite: "Lax",
      },
    ])
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${PORT}/de/dashboard/evidence`, {
      waitUntil: "domcontentloaded",
    })

    await expect(page.locator('[data-testid="dashboard-403"]')).toBeVisible()
    await context.close()
  })
})
