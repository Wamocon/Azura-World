/**
 * The manual walkthrough driver.                                   Owner: W5
 *
 * `tasks/W5` asks for a headed, slowed browser with video and trace, driven by
 * hand. This script is the hand: it walks the twelve passes as far as the
 * surfaces exist, captures a screenshot at every stop, and records console
 * errors and failed requests — so that afterwards somebody can **look at the
 * pictures**, which is the entire point of the pass.
 *
 * It is not a test suite. It asserts almost nothing. `scripts/security-probe.mjs`,
 * the e2e suite and the harness already assert; what this produces is evidence
 * for a human judgement, and the judgement lives in `MANUAL-TEST-REPORT.md`.
 *
 *   node scripts/manual-session.mjs [--headed] [--slow-mo 250] [--base URL]
 *
 * Defaults to headed with `--slow-mo=250`, video and trace on, per the brief.
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "apps", "web");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const BASE = value("base", "http://127.0.0.1:3200");
const SLOW_MO = Number(value("slow-mo", 250));
const HEADLESS = flag("headless");
const OUT = join(ROOT, "quality", "manual");
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------

const requireFromApp = createRequire(join(APP, "package.json"));
const playwright = await import(
  pathToFileURL(requireFromApp.resolve("@playwright/test")).href
);
const chromium = playwright.chromium ?? playwright.default?.chromium;
if (chromium === undefined)
  throw new Error("@playwright/test exposes no chromium export");

/** The revision Playwright pins is usually not the one installed. W1-D, W4-A. */
function installedChromium() {
  const root = process.env["LOCALAPPDATA"]
    ? join(process.env["LOCALAPPDATA"], "ms-playwright")
    : undefined;
  if (root === undefined || !existsSync(root)) return undefined;
  const builds = readdirSync(root)
    .filter((n) => /^chromium-\d+$/.test(n))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const build of builds) {
    for (const layout of ["chrome-win64", "chrome-win"]) {
      const candidate = join(root, build, layout, "chrome.exe");
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

const notes = [];
const consoleErrors = [];
const failedRequests = [];

function note(pass, what, detail) {
  notes.push({ pass, what, detail: detail ?? null });
  console.log(`  ${what}${detail === undefined ? "" : `  — ${detail}`}`);
}

function heading(text) {
  console.log(`\n\x1b[1m${text}\x1b[0m\n${"-".repeat(text.length)}`);
}

const executablePath = installedChromium();
const browser = await chromium.launch({
  headless: HEADLESS,
  slowMo: SLOW_MO,
  ...(executablePath === undefined ? {} : { executablePath }),
});

async function session(
  name,
  { role, locale = "de", width = 1440, height = 900, mobile = false },
) {
  const context = await browser.newContext({
    viewport: { width, height },
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
    recordVideo: { dir: join(OUT, "video"), size: { width, height } },
    locale:
      locale === "de"
        ? "de-DE"
        : locale === "ru"
          ? "ru-RU"
          : locale === "tr"
            ? "tr-TR"
            : "en-GB",
  });
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: false,
  });

  if (role !== undefined) {
    await context.addCookies([
      {
        name: "access_profile_role",
        value: role,
        domain: "127.0.0.1",
        path: "/",
        sameSite: "Lax",
      },
    ]);
  }

  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push({ name, text: m.text() });
  });
  page.on("pageerror", (e) =>
    consoleErrors.push({ name, text: `pageerror: ${e.message}` }),
  );
  page.on("response", (r) => {
    if (r.status() >= 400)
      failedRequests.push({ name, status: r.status(), url: r.url() });
  });

  return {
    page,
    async shot(label) {
      const file = join(OUT, `${label}.png`);
      await page.screenshot({ path: file, fullPage: false });
      return file;
    },
    async shotFull(label) {
      const file = join(OUT, `${label}-full.png`);
      await page.screenshot({ path: file, fullPage: true });
      return file;
    },
    async close() {
      await context.tracing.stop({ path: join(OUT, `trace-${name}.zip`) });
      await context.close();
    },
  };
}

// ===========================================================================

try {
  // -------------------------------------------------------------------------
  heading("Pass 1 — first impression, cold, /de at 1440");
  {
    const s = await session("pass1", { locale: "de" });
    await s.page.goto(`${BASE}/de`, { waitUntil: "domcontentloaded" });
    await s.page.waitForTimeout(1500);
    note(
      1,
      "above the fold captured",
      await s.shot("pass01-landing-1440-above-fold"),
    );

    // Scroll slowly, the way a reader would.
    for (let i = 1; i <= 6; i += 1) {
      await s.page.evaluate(
        (n) => window.scrollTo(0, (document.body.scrollHeight / 7) * n),
        i,
      );
      await s.page.waitForTimeout(700);
      await s.shot(`pass01-scroll-${String(i).padStart(2, "0")}`);
    }
    note(1, "six scroll stops captured");
    await s.shotFull("pass01-landing-1440");

    const h1 = await s.page.locator("h1").first().innerText();
    note(1, "h1", JSON.stringify(h1));
    const canvases = await s.page.locator("canvas").count();
    note(1, "canvases", String(canvases));
    await s.close();
  }

  // -------------------------------------------------------------------------
  heading("Pass 2 — the evidence claim: can I trace a number in 10 seconds?");
  {
    const s = await session("pass2", { locale: "de" });
    await s.page.goto(`${BASE}/de`, { waitUntil: "domcontentloaded" });
    await s.page.waitForTimeout(1200);

    const conflicted = s.page.locator("[data-confidence='conflicted']").first();
    if ((await conflicted.count()) > 0) {
      await conflicted.scrollIntoViewIfNeeded();
      await s.page.waitForTimeout(400);
      note(
        2,
        "conflicted figure",
        JSON.stringify((await conflicted.innerText()).slice(0, 80)),
      );
      await s.shot("pass02-conflicted-figure");

      // The affordance the brief asks about: from a number to its source.
      const trigger = conflicted.locator("button, [role='button']").first();
      if ((await trigger.count()) > 0) {
        await trigger.click({ timeout: 5000 }).catch(() => {});
        await s.page.waitForTimeout(800);
        await s.shot("pass02-conflict-popover-open");
        note(2, "conflict affordance clicked");
      } else {
        note(2, "NO clickable affordance on the conflicted figure");
      }
    } else {
      note(2, "NO conflicted figure found on the landing page");
    }

    const outbound = await s.page.locator("a[href^='http']").count();
    note(2, "outbound source links on the page", String(outbound));
    await s.close();
  }

  // -------------------------------------------------------------------------
  heading("Pass 3 — four locales at 1440 and 375");
  for (const locale of ["de", "en", "tr", "ru"]) {
    for (const [w, h] of [
      [1440, 900],
      [375, 812],
    ]) {
      const s = await session(`pass3-${locale}-${w}`, {
        locale,
        width: w,
        height: h,
      });
      await s.page.goto(`${BASE}/${locale}`, { waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(1200);
      await s.page.evaluate(() =>
        window.scrollTo(0, document.body.scrollHeight),
      );
      await s.page.waitForTimeout(600);

      const overflow = await s.page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      const body = await s.page.locator("body").innerText();
      const tofu = /[�]/.test(body);
      const rawKeys = [
        ...body.matchAll(
          /\b(landing|hotel|evidence|dashboard|common)\.[a-z][a-zA-Z.]+/g,
        ),
      ].map((m) => m[0]);

      note(
        3,
        `${locale} @${w}`,
        `overflow ${overflow.scroll}>${overflow.client ? overflow.client : "?"} ${overflow.scroll > overflow.client ? "YES" : "no"} · tofu ${tofu} · raw keys ${[...new Set(rawKeys)].length}`,
      );
      if (rawKeys.length > 0)
        note(
          3,
          `  raw keys in ${locale}`,
          [...new Set(rawKeys)].slice(0, 6).join(", "),
        );
      await s.shotFull(`pass03-${locale}-${w}`);
      await s.close();
    }
  }

  // -------------------------------------------------------------------------
  heading("Pass 4 — every role's first screen");
  {
    const roles = [
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
    for (const role of roles) {
      const s = await session(`pass4-${role}`, { role, locale: "de" });
      const response = await s.page.goto(`${BASE}/de/dashboard`, {
        waitUntil: "domcontentloaded",
      });
      await s.page.waitForTimeout(900);
      const navLinks = await s.page
        .locator("nav a[href*='/dashboard']")
        .count();
      const text = await s.page.locator("body").innerText();
      note(
        4,
        role,
        `HTTP ${response?.status()} · ${navLinks} nav link(s) · ${text.trim().length} chars`,
      );
      await s.shot(`pass04-${role}`);
      await s.close();
    }
  }

  // -------------------------------------------------------------------------
  heading("Pass 5 — the 656-unit table");
  {
    const s = await session("pass5", { role: "manager", locale: "de" });
    const response = await s.page.goto(`${BASE}/de/dashboard/units`, {
      waitUntil: "domcontentloaded",
    });
    await s.page.waitForTimeout(1200);
    note(5, "units route", `HTTP ${response?.status()}`);
    await s.shot("pass05-units-top");
    await s.shotFull("pass05-units-full");

    const modelled = await s.page
      .locator("[data-data-quality='modelled'], [data-quality='modelled']")
      .count();
    const portal = await s.page
      .locator(
        "[data-data-quality='portal_listing'], [data-quality='portal_listing']",
      )
      .count();
    const rows = await s.page.locator("tbody tr").count();
    note(5, "rows rendered", String(rows));
    note(5, "modelled marks / portal_listing marks", `${modelled} / ${portal}`);

    // The honesty question: are the two visually different, not just labelled?
    const firstModelled = s.page.locator("tr[data-modelled]").first();
    if ((await firstModelled.count()) > 0) {
      await firstModelled.scrollIntoViewIfNeeded();
      await s.page.waitForTimeout(300);
      await s.shot("pass05-modelled-row");
      note(5, "modelled row captured for visual comparison");
    } else {
      note(5, "NO row-level modelled treatment (`data-modelled`) found");
    }
    await s.close();
  }

  // -------------------------------------------------------------------------
  heading("Pass 6 — the conflict, end to end");
  {
    const s = await session("pass6", { role: "manager", locale: "de" });
    const response = await s.page.goto(`${BASE}/de/dashboard/evidence`, {
      waitUntil: "domcontentloaded",
    });
    await s.page.waitForTimeout(1200);
    note(6, "evidence cockpit", `HTTP ${response?.status()}`);
    await s.shot("pass06-evidence-top");
    await s.shotFull("pass06-evidence-full");

    const body = await s.page.locator("body").innerText();
    for (const figure of ["112.000", "185.000", "220.000", "239.171"]) {
      note(6, `price ${figure}`, body.includes(figure) ? "present" : "MISSING");
    }
    note(
      6,
      "USD kept as USD",
      /239[.,]171\s*\$|239[.,]171[^€]{0,30}(\$|USD)/.test(body) ? "yes" : "NO",
    );
    note(
      6,
      "a converted EUR twin appears",
      /239[.,]171\s*€/.test(body) ? "YES — BAD" : "no",
    );
    await s.close();
  }

  // -------------------------------------------------------------------------
  heading("Pass 11 — reduced motion: is any content missing?");
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
      recordVideo: { dir: join(OUT, "video") },
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/de`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
    const invisible = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll("body *")).filter((n) => {
          const st = getComputedStyle(n);
          if (st.display === "none" || st.visibility === "hidden") return false;
          return Number(st.opacity) === 0 && n.innerText?.trim().length > 0;
        }).length,
    );
    const canvases = await page.locator("canvas").count();
    note(11, "elements left at opacity 0", String(invisible));
    note(11, "canvases under reduced motion", String(canvases));
    await page.screenshot({
      path: join(OUT, "pass11-reduced-motion-full.png"),
      fullPage: true,
    });
    await context.close();
  }

  // -------------------------------------------------------------------------
  heading("Pass 12 — mobile, 375px");
  {
    const s = await session("pass12", {
      role: "manager",
      locale: "de",
      width: 375,
      height: 812,
      mobile: true,
    });
    for (const [label, path] of [
      ["landing", "/de"],
      ["dashboard", "/de/dashboard"],
      ["units", "/de/dashboard/units"],
    ]) {
      await s.page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(1100);
      await s.shot(`pass12-${label}-375`);
      const overflow = await s.page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      note(
        12,
        `${label} @375`,
        `scrollWidth ${overflow.scroll} vs clientWidth ${overflow.client}`,
      );
    }
    await s.close();
  }
} finally {
  await browser.close();
}

// ---------------------------------------------------------------------------

writeFileSync(
  join(OUT, "session.json"),
  JSON.stringify(
    {
      base: BASE,
      slowMo: SLOW_MO,
      headless: HEADLESS,
      notes,
      consoleErrors,
      failedRequests,
    },
    null,
    2,
  ),
  "utf8",
);

const bar = "─".repeat(72);
console.log(`\n${bar}`);
console.log(`console errors: ${consoleErrors.length}`);
for (const e of [
  ...new Map(consoleErrors.map((e) => [e.text, e])).values(),
].slice(0, 10)) {
  console.log(`  [${e.name}] ${e.text.slice(0, 140)}`);
}
console.log(`failed requests: ${failedRequests.length}`);
for (const r of [
  ...new Map(failedRequests.map((r) => [r.url, r])).values(),
].slice(0, 10)) {
  console.log(`  ${r.status}  ${r.url}`);
}
console.log(`\nartifacts: ${OUT}`);
console.log(bar);
