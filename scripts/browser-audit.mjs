/**
 * browser-audit — walks every route in every locale and treats any console
 * error as a finding.                                            Owner: W4-B
 *
 * `node scripts/browser-audit.mjs`
 *
 * tasks/W4-B: "**Any console error is a finding** — they are almost always real
 * bugs that nobody looked at." This project has already paid for that twice:
 * S-009 shipped pages whose every script was CSP-blocked, and next-themes'
 * no-flash script was blocked on every production load for a night. Both
 * announced themselves in the console and neither had anyone reading it.
 *
 * Also captures failed network requests and unhandled promise rejections,
 * which are the same class of problem with no visible symptom.
 */

import {
  LOCALES,
  ROUTES,
  createReporter,
  launchBrowser,
  parseArgs,
  reportBlindSpots,
  resultDir,
  startServer,
  urlFor,
  writeJson,
} from "./qa-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.values.get("port") ?? 3280);

const BLIND_SPOTS = [
  "Only the load path is exercised: navigate, scroll to the bottom, wait. An error thrown " +
    "by an interaction nobody performs here is invisible.",
  "Roles are not exercised. tasks/W4-B asks for 'every route × locale × ROLE'; the QA " +
    "access-profile cookie is disabled under NODE_ENV=production, so every walk here is " +
    "anonymous. Authenticated routes are recorded as their redirect, not their content.",
  "A `console.warn` is recorded but does not fail the run. Only `error` does.",
  "Third-party console noise is not filtered — there is none, because the CSP forbids " +
    "external scripts. If that changes, this list will need an allowlist with reasons.",
  "Requests that fail AFTER the load event (a late fetch, a retry) may be missed: the " +
    "walk stops a fixed interval after the page settles.",
];

/**
 * Errors that are expected and why. Empty on purpose — an allowlist is where a
 * real bug goes to hide, so each entry must carry a reason and a ticket.
 */
const EXPECTED = [];

async function main() {
  const reporter = createReporter("browser-audit");
  const dir = resultDir("browser");

  reporter.section("browser-audit — every route × locale, anonymous");
  const spots = reportBlindSpots(reporter, BLIND_SPOTS);

  const server = startServer(PORT);
  let browser;
  const findings = [];
  const startedAt = Date.now();

  try {
    await server.ready();
    const launched = await launchBrowser({});
    browser = launched.browser;
    console.log(`  chromium: ${launched.executablePath}`);

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });

    for (const locale of LOCALES) {
      for (const route of ROUTES) {
        const page = await context.newPage();
        const errors = [];
        const warnings = [];
        const failedRequests = [];

        page.on("console", (msg) => {
          const text = msg.text();
          if (EXPECTED.some((rule) => rule.match.test(text))) return;
          if (msg.type() === "error") errors.push(text.slice(0, 200));
          else if (msg.type() === "warning") warnings.push(text.slice(0, 200));
        });
        page.on("pageerror", (error) =>
          errors.push(`[pageerror] ${String(error).slice(0, 200)}`),
        );
        page.on("requestfailed", (request) => {
          failedRequests.push(
            `${request.method()} ${request.url().slice(0, 120)} — ${request.failure()?.errorText ?? "?"}`,
          );
        });
        page.on("response", (response) => {
          if (response.status() >= 400) {
            failedRequests.push(
              `HTTP ${response.status()} ${response.url().slice(0, 120)}`,
            );
          }
        });

        const url = urlFor(server.base, locale, route);
        let status = null;
        let finalUrl = url;
        try {
          const response = await page.goto(url, {
            waitUntil: "load",
            timeout: 45_000,
          });
          status = response?.status() ?? null;
          finalUrl = page.url();
          // Walk the page so lazy content mounts and its errors surface.
          await page.evaluate(async () => {
            for (let y = 0; y < document.body.scrollHeight; y += 700) {
              window.scrollTo(0, y);
              await new Promise((r) => setTimeout(r, 90));
            }
          });
          await page.waitForTimeout(700);
        } catch (error) {
          errors.push(`[navigation] ${String(error).slice(0, 200)}`);
        }

        const redirected = !finalUrl.endsWith(route.path) && route.auth;
        // A protected route redirecting an anonymous visitor to login is the
        // correct behaviour, not a finding. Recorded so the report is explicit
        // about what was actually loaded.
        const label = `${locale}${route.path || "/"}`;
        const bad = errors.length + failedRequests.length;

        if (bad > 0) {
          findings.push({
            locale,
            route: route.name,
            url,
            finalUrl,
            status,
            errors,
            failedRequests,
            warnings,
          });
        }
        reporter.check(
          `${label.padEnd(26)}${redirected ? " → login" : ""}`,
          bad === 0,
          bad === 0
            ? `HTTP ${status}${warnings.length ? `, ${warnings.length} warning(s)` : ""}`
            : `${errors.length} console error(s), ${failedRequests.length} failed request(s)`,
        );
        for (const error of errors.slice(0, 3))
          console.log(`         ${error}`);
        for (const failure of failedRequests.slice(0, 3))
          console.log(`         ${failure}`);

        await page.close();
      }
    }

    await context.close();

    const runtimeMs = Date.now() - startedAt;
    const path = writeJson(dir, "report.json", {
      harness: "browser-audit",
      generatedAt: new Date().toISOString(),
      blindSpots: spots,
      expectedAllowlist: EXPECTED,
      routes: ROUTES.map((r) => r.name),
      locales: LOCALES,
      findings,
      runtimeMs,
    });
    console.log(`\n  report: ${path}`);
  } finally {
    if (browser) await browser.close();
    server.stop();
  }

  process.exit(reporter.summary());
}

main().catch((error) => {
  console.error(`\nbrowser-audit failed to run: ${error?.stack ?? error}`);
  process.exit(2);
});
