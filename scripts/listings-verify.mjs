/**
 * /dashboard/listings, verified in a real browser.               Owner: N1
 *
 * The W3-C brief's definition of done for the portal-listings deliverable, run
 * rather than read. Everything here is asserted against a **production build**
 * served programmatically with `dev: false` — W4-A's fixture, reused from
 * `scripts/evidence-production-verify.mjs`.
 *
 * ## Why not `next start`
 *
 * `next start` sets `NODE_ENV=production`, and W1-B's
 * `accessProfilesEnabledForEnvironment()` returns `false` for any production
 * process **before it reads a flag**, so a QA session is unreachable there by
 * design and `/de/dashboard/listings` correctly 307s to `/de/login`. There is no
 * alternative on this machine: `docker info` exits 1, so no Supabase session can
 * be seeded.
 *
 * **What this proves:** the production *compilation* renders and gates this
 * page. **What it does not:** it is not a production *runtime*, so it says
 * nothing about production environment variables or a real session.
 *
 * Run: `node scripts/listings-verify.mjs`   (needs a build in apps/web/.next)
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "apps", "web");
const SHOTS = join(ROOT, "quality", "n1-listings");
const PORT = Number(process.env["AZURA_VERIFY_PORT"] ?? 3291);
const BASE = `http://127.0.0.1:${PORT}`;
const LISTINGS = "/de/dashboard/listings";

const requireFromWeb = createRequire(join(APP, "package.json"));
const { chromium } = requireFromWeb("@playwright/test");

// ---------------------------------------------------------------------------

const results = [];
let section = "";

function group(title) {
  section = title;
  console.log(`\n\x1b[1m${title}\x1b[0m`);
  console.log("-".repeat(title.length));
}

function check(label, passed, detail) {
  results.push({ section, label, passed });
  const mark = passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(
    `  ${mark}  ${label}${detail === undefined ? "" : `  \x1b[2m- ${detail}\x1b[0m`}`,
  );
}

/**
 * Chromium, pinned build first and any installed revision second.
 *
 * Lifted from `scripts/evidence-review.mjs`: `@playwright/test` was updated
 * without `npx playwright install` being re-run, so `chromium.launch()` points
 * at a revision that is not on disk while six older ones are. Falling back is
 * honest here - the assertions are about the page, not about a browser build -
 * and the revision actually used is printed rather than assumed.
 */
async function launchChromium() {
  try {
    const browser = await chromium.launch();
    console.log("  chromium: pinned build");
    return browser;
  } catch (error) {
    const { readdirSync } = await import("node:fs");
    const root = `${process.env["LOCALAPPDATA"]}\\ms-playwright`;
    if (!existsSync(root)) throw error;
    const candidate = readdirSync(root)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
    if (candidate === undefined) throw error;
    // The directory name changed across revisions (`chrome-win` → `chrome-win64`).
    const executablePath = [
      `${root}\\${candidate}\\chrome-win64\\chrome.exe`,
      `${root}\\${candidate}\\chrome-win\\chrome.exe`,
    ].find((path) => existsSync(path));
    if (executablePath === undefined) throw error;
    console.log(`  chromium: ${candidate} (pinned build absent)`);
    return chromium.launch({ executablePath });
  }
}

async function get(path, role) {
  const response = await fetch(`${BASE}${path}`, {
    headers:
      role === undefined ? {} : { cookie: `access_profile_role=${role}` },
    redirect: "manual",
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.text(),
  };
}

// ---------------------------------------------------------------------------

if (!existsSync(join(APP, ".next", "BUILD_ID"))) {
  console.error("No production build. Run `pnpm --dir apps/web build` first.");
  process.exit(2);
}

const bootstrap = `
  const next = require('next')
  const { createServer } = require('node:http')
  const app = next({ dev: false, dir: ${JSON.stringify(APP)} })
  const handle = app.getRequestHandler()
  app.prepare().then(() => {
    createServer((req, res) => handle(req, res)).listen(${PORT}, '127.0.0.1')
  })
`;

const server = spawn(process.execPath, ["-e", bootstrap], {
  cwd: APP,
  stdio: "ignore",
  env: {
    ...process.env,
    NODE_ENV: "development",
    ENABLE_ACCESS_PROFILES: "true",
    AZURA_ALLOW_REMOTE_ACCESS_PROFILES: "true",
    AZURA_DEMO_DATA_ISOLATED: "true",
  },
});

async function ready() {
  for (let i = 0; i < 90; i += 1) {
    try {
      const response = await fetch(`${BASE}/de`);
      if (response.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("the production server did not become ready");
}

let browser;

try {
  await ready();
  await mkdir(SHOTS, { recursive: true });
  console.log(`\nProduction build served programmatically on ${BASE}`);

  // =========================================================================
  group("1 - the page renders, and the four F-002 prices are on it");

  const page = await get(LISTINGS, "manager");
  check("manager receives 200", page.status === 200, `status ${page.status}`);
  check(
    "not redirected to login",
    !(page.headers.get("location") ?? "").includes("/login"),
    page.headers.get("location") ?? "no redirect",
  );

  // The four figures F-002 names. Asserted individually so a partial render
  // cannot pass on "at least one price is present".
  for (const figure of ["112.000", "185.000", "220.000", "239.171"]) {
    check(`competing 1+1 price ${figure} present`, page.body.includes(figure));
  }

  // The rule that matters most on this page.
  check(
    "the USD figure is rendered as dollars",
    /239[.,]171[^€]{0,60}(\$|USD)/.test(page.body),
  );
  check(
    "the USD figure is NEVER shown as euros",
    !/239[.,]171\s*€/.test(page.body),
  );
  // The first version of this check was `!/umgerechnet|approx|≈/` and it FAILED
  // on the page's own promise, "Nichts wird umgerechnet." Asserting the absence
  // of a word is the wrong shape: the word appears here precisely because the
  // page says it does not convert. What must be absent is an *equivalence* - a
  // second figure offered as the same money in another currency.
  const conversionClaims = [
    ...page.body.matchAll(/(?:≈|entspricht|~)\s*[\d.,]+\s*(?:€|\$|EUR|USD)/gi),
  ].map((match) => match[0]);
  check(
    "no figure is offered as an equivalent in another currency",
    conversionClaims.length === 0,
    conversionClaims.length === 0 ? "0 found" : conversionClaims.join(" | "),
  );
  check(
    "every mention of conversion is a negation of it",
    [...page.body.matchAll(/[^.>]{0,40}(?:umgerechnet|Umrechnung)/g)].every(
      (match) => /nicht|keine|Nichts/i.test(match[0]),
    ),
  );
  check(
    "the two currencies are stated as not comparable",
    page.body.includes("nicht vergleichbar"),
  );
  check(
    "exactly one <main> landmark (the layout's)",
    (page.body.match(/<main[\s>]/g) ?? []).length === 1,
    `${(page.body.match(/<main[\s>]/g) ?? []).length} found`,
  );
  check(
    "the seed slice is labelled, not presented as live",
    /Demodaten/.test(page.body),
  );

  // =========================================================================
  group("2 - every publisher is grouped, and the counts are the dataset's");

  browser = await launchChromium();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "de-DE",
    extraHTTPHeaders: { cookie: "access_profile_role=manager" },
  });
  const view = await context.newPage();
  await view.goto(`${BASE}${LISTINGS}`, { waitUntil: "domcontentloaded" });

  const publishers = await view.$$eval(
    "[data-slot='publisher-group']",
    (nodes) => nodes.map((node) => node.getAttribute("data-publisher")),
  );
  // W0-B harvested 47 rows across exactly these seven publishers.
  const expected = [
    "Alanya-Home",
    "Alto Real Estate",
    "Capital Estate",
    "Haspo Realty",
    "Housearch",
    "Seaside Alanya",
    "TERRA Real Estate",
  ];
  check(
    "all 7 publishers render their own group",
    expected.every((name) => publishers.includes(name)),
    publishers.join(", "),
  );

  const rowCount = await view.$$eval(
    "[data-slot='listing-row']",
    (nodes) => nodes.length,
  );
  check(
    "all 47 harvested listings render",
    rowCount === 47,
    `${rowCount} rows`,
  );

  const staleRows = await view.$$eval(
    "[data-slot='listing-row'][data-stale]",
    (nodes) => nodes.length,
  );
  check(
    "18 stale rows, matching the dataset",
    staleRows === 18,
    `${staleRows} rows`,
  );

  const rentRows = await view.$$eval(
    "[data-slot='listing-row'][data-price-kind='rent']",
    (nodes) => nodes.length,
  );
  check(
    "the 2 rent rows are marked as rent",
    rentRows === 2,
    `${rentRows} rows`,
  );

  // =========================================================================
  group("3 - the stale badge is IN the price cell, not in a footnote");

  const badgePlacement = await view.$$eval(
    "[data-slot='listing-row'][data-stale]",
    (rows) =>
      rows.map((row) => {
        const firstCell = row.querySelector("td");
        return {
          inFirstCell:
            firstCell?.querySelector("[data-slot='stale-badge']") !== null &&
            firstCell?.querySelector("[data-slot='stale-badge']") !== undefined,
          anywhere: row.querySelector("[data-slot='stale-badge']") !== null,
        };
      }),
  );
  check(
    "every stale row carries a badge",
    badgePlacement.length > 0 && badgePlacement.every((r) => r.anywhere),
    `${badgePlacement.filter((r) => r.anywhere).length}/${badgePlacement.length}`,
  );
  check(
    "the badge is inside the PRICE cell in every stale row",
    badgePlacement.length > 0 && badgePlacement.every((r) => r.inFirstCell),
    `${badgePlacement.filter((r) => r.inFirstCell).length}/${badgePlacement.length}`,
  );

  // The distinction must survive greyscale: a dashed border is a shape
  // difference, not a colour one.
  const badgeBorder = await view.$eval(
    "[data-slot='stale-badge']",
    (node) => getComputedStyle(node).borderStyle,
  );
  check(
    "the badge is distinguishable without colour (dashed border)",
    badgeBorder.startsWith("dashed"),
    badgeBorder,
  );

  const staleReason = await view.$eval("[data-slot='stale-badge']", (node) =>
    (node.textContent ?? "").trim(),
  );
  check(
    "the badge states its reason in the document, not on hover",
    /noch im Bau/.test(staleReason),
    staleReason.slice(0, 90),
  );

  // =========================================================================
  group("4 - the comparison: one column per currency, never joined");

  // Scoped to the FIRST comparison. The page renders two - the 1+1 view and the
  // layout-unstated band - and an unscoped selector reported "EUR, USD, EUR",
  // which would have passed even if the 1+1 view itself carried no USD column.
  //
  // Scoped in JS, not with `:first-of-type`: that pseudo-class selects by
  // ELEMENT TYPE among siblings, not by the attribute in front of it, and the
  // two panels are not siblings. It reported a single "EUR" - a green-looking
  // selector bug that would have masked a missing USD column.
  const columns = await view.evaluate(() => {
    const panel = document.querySelectorAll(
      "[data-slot='price-comparison']",
    )[0];
    return panel === undefined
      ? []
      : [...panel.querySelectorAll("section[aria-label]")].map((node) =>
          node.getAttribute("aria-label"),
        );
  });
  check(
    "the 1+1 comparison has exactly one EUR and one USD column",
    columns.filter((c) => c === "EUR").length === 1 &&
      columns.filter((c) => c === "USD").length === 1 &&
      columns.length === 2,
    columns.join(", "),
  );

  // The separator carried a rotated caption inside a 1px-wide flex item and
  // painted over the last EUR card. Geometry, not a class name: the columns must
  // not overlap each other or the rule between them.
  const overlap = await view.evaluate(() => {
    const panel = document.querySelector("[data-slot='price-comparison']");
    if (panel === null) return "no panel";
    const sections = [
      ...panel.querySelectorAll(":scope > div > div > section"),
    ];
    if (sections.length < 2) return "single column";
    const boxes = sections.map((node) => node.getBoundingClientRect());
    const first = boxes[0];
    const second = boxes[1];
    if (first === undefined || second === undefined) return "missing box";
    return first.right <= second.left
      ? "clear"
      : `overlap ${first.right - second.left}px`;
  });
  check(
    "the currency columns and their separator do not overlap",
    overlap === "clear" || overlap === "single column",
    overlap,
  );

  const cells = await view.$$eval(
    "[data-slot='price-comparison'] [data-slot='comparison-cell']",
    (nodes) =>
      nodes.map((node) => ({
        publisher: node.getAttribute("data-publisher"),
        text: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
        stale: node.hasAttribute("data-stale"),
      })),
  );
  const cellText = cells.map((c) => c.text).join(" | ");
  check(
    "Haspo's 112.000 EUR anchor is in the comparison",
    /Haspo/.test(cellText) && /112\.000/.test(cellText),
  );
  check(
    "Housearch's 239.171 USD figure is in the comparison, in dollars",
    cells.some((c) => c.publisher === "Housearch" && /239\.171/.test(c.text)),
  );
  check(
    "Haspo's cell carries the stale badge next to its price",
    cells.some((c) => c.publisher === "Haspo Realty" && c.stale),
  );

  // The spread must be scoped to one currency. A bare "2,1" with no currency
  // would be the cross-currency ratio this page refuses to compute.
  const spreads = await view.$$eval(
    "[data-slot='price-comparison'] section[aria-label] > header span",
    (nodes) => nodes.map((n) => (n.textContent ?? "").trim()),
  );
  check(
    "every spread figure names the currency it was computed in",
    spreads.length > 0 &&
      spreads.every((s) => /nur (EUR|USD)/.test(s) || /nur ein Preis/.test(s)),
    spreads.join(" | "),
  );
  check(
    "F-002's own 2,1 figure is attributed to the finding, not recomputed",
    /Befund F-002 nennt eine Spanne von 2,1/.test(
      (await view.textContent("body")) ?? "",
    ),
  );

  // Alanya-Home states a price without a layout: it must survive the layout
  // filter rather than vanishing from the one view built to show it.
  const bodyText = ((await view.textContent("body")) ?? "").replace(
    /\s+/g,
    " ",
  );
  check(
    "the layout-unstated band is present and holds Alanya-Home's 220.000",
    /Portale ohne Grundrissangabe/.test(bodyText) && /220\.000/.test(bodyText),
  );

  // =========================================================================
  group("5 - the claim matrix: who says what about the building");

  const claimRows = await view.$$eval("[data-slot='claim-row']", (nodes) =>
    nodes.map((node) => ({
      publisher: node.getAttribute("data-publisher"),
      text: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
    })),
  );
  check(
    "the matrix renders one row per claiming publisher",
    claimRows.length >= 3,
    claimRows.map((r) => r.publisher).join(", "),
  );

  const haspo = claimRows.find((r) => r.publisher === "Haspo Realty");
  check(
    "Haspo's own row says 'Im Bau', not the resolved 'Fertiggestellt'",
    haspo !== undefined &&
      /Im Bau/.test(haspo.text) &&
      !/Fertiggestellt/.test(haspo.text),
    haspo?.text.slice(0, 120) ?? "no Haspo row",
  );
  check(
    "Haspo's dissent is marked in the document",
    haspo !== undefined && /Abweichend/.test(haspo.text),
  );

  const housearch = claimRows.find((r) => r.publisher === "Housearch");
  check(
    "Housearch's row says 'Fertiggestellt'",
    housearch !== undefined && /Fertiggestellt/.test(housearch.text),
    housearch?.text.slice(0, 120) ?? "no Housearch row",
  );

  check(
    "the empty claimed_* harvest gap is stated in words, not left blank",
    /Die Erhebung hat die Projektangaben je Inserat nicht mitgeschrieben/.test(
      bodyText,
    ),
  );
  check(
    "a publisher that never stated a field reads 'Keine Angabe', never blank",
    /Keine Angabe/.test(bodyText),
  );

  // =========================================================================
  group("6 - filter to zero names the filter and offers to clear it");

  await view.goto(`${BASE}${LISTINGS}?publisher=Housearch&kind=rent`, {
    waitUntil: "domcontentloaded",
  });
  const emptyText = ((await view.textContent("body")) ?? "").replace(
    /\s+/g,
    " ",
  );
  check(
    "the empty state explains WHICH filter excluded everything",
    /Filter/.test(emptyText) &&
      /schließt alle Inserate aus|Kombination/.test(emptyText),
  );
  const clearHref = await view.getAttribute(
    "a:has-text('Filter zurücksetzen')",
    "href",
  );
  check(
    "it offers a link back to the unfiltered register",
    clearHref !== null && !clearHref.includes("publisher="),
    clearHref ?? "no link",
  );
  check(
    "no listing rows are rendered when the filter matches nothing",
    (await view.$$("[data-slot='listing-row']")).length === 0,
  );

  // =========================================================================
  group("7 - permission matrix, measured per role");

  // `listings:view` is held by admin, manager, accountant, staff, owner, tenant
  // and guest per lib/rbac.ts. The point of the check is that the refusal for a
  // role WITHOUT it happens server-side, before any repository call - the
  // SEC-003 lesson: a client guard decides after the payload has shipped.
  for (const role of ["admin", "manager", "staff"]) {
    const response = await get(LISTINGS, role);
    check(
      `${role} receives 200`,
      response.status === 200,
      `status ${response.status}`,
    );
    check(`${role} sees listing data`, response.body.includes("Haspo"));
  }
  for (const role of ["service_provider", "child_guest"]) {
    const response = await get(LISTINGS, role);
    const leaked = ["Haspo Realty", "Housearch", "239.171", "112.000"].filter(
      (needle) => response.body.includes(needle),
    );
    check(
      `${role} is refused and NO listing data reaches the payload`,
      leaked.length === 0,
      leaked.length === 0 ? "clean" : `leaked: ${leaked.join(", ")}`,
    );
  }

  // =========================================================================
  group("8 - 320px German, tap targets, reduced motion");

  const narrow = await browser.newContext({
    viewport: { width: 320, height: 720 },
    locale: "de-DE",
    extraHTTPHeaders: { cookie: "access_profile_role=manager" },
  });
  const narrowPage = await narrow.newPage();
  await narrowPage.goto(`${BASE}${LISTINGS}`, {
    waitUntil: "domcontentloaded",
  });

  const widths = await narrowPage.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  check(
    "no horizontal page scroll at 320px in German",
    widths.scroll <= widths.client,
    `scrollWidth ${widths.scroll} vs clientWidth ${widths.client}`,
  );

  const tinyTargets = await narrowPage.$$eval("a, button", (nodes) =>
    nodes
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.height < 24;
      })
      .map((node) => (node.textContent ?? "").trim().slice(0, 30)),
  );
  check(
    "every visible tap target is at least 24px tall",
    tinyTargets.length === 0,
    tinyTargets.length === 0 ? "0 violations" : tinyTargets.join(" | "),
  );
  await narrowPage.screenshot({
    path: join(SHOTS, "listings-de-320.png"),
    fullPage: true,
  });

  const reduced = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "de-DE",
    reducedMotion: "reduce",
    extraHTTPHeaders: { cookie: "access_profile_role=manager" },
  });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(`${BASE}${LISTINGS}`, {
    waitUntil: "domcontentloaded",
  });
  const hidden = await reducedPage.$$eval(
    "[data-slot='listing-row'], [data-slot='comparison-cell'], [data-slot='claim-row']",
    (nodes) =>
      nodes.filter((node) => getComputedStyle(node).opacity === "0").length,
  );
  check(
    "under reduced motion the page is complete, not faster",
    hidden === 0,
    `${hidden} elements left at opacity 0`,
  );

  // =========================================================================
  group("9 - English renders as English, not a German fallback");

  const english = await get("/en/dashboard/listings", "manager");
  check("English page returns 200", english.status === 200);
  check(
    "English copy is actually English",
    english.body.includes("Four portals, four prices") &&
      !english.body.includes("Vier Portale, vier Preise"),
  );
  check(
    "the USD figure survives the locale switch unconverted",
    (/239,171/.test(english.body) || /239\.171/.test(english.body)) &&
      !/239[.,]171\s*€/.test(english.body),
  );

  // Publisher names are pinned proper nouns: they must be byte-identical
  // across locales or a citation stops resolving.
  for (const name of ["Haspo Realty", "Housearch", "Alanya-Home"]) {
    check(`"${name}" is unchanged in English`, english.body.includes(name));
  }

  // =========================================================================
  // Back to the unfiltered register before the screenshot. The first run
  // captured the page still on the filter-to-zero URL from group 6, so the
  // "evidence" of the register was a screenshot of its empty state.
  await view.goto(`${BASE}${LISTINGS}`, { waitUntil: "domcontentloaded" });
  await view.waitForSelector("[data-slot='publisher-group']");
  await view.screenshot({
    path: join(SHOTS, "listings-de-desktop.png"),
    fullPage: true,
  });
  const englishShot = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "en-GB",
    extraHTTPHeaders: { cookie: "access_profile_role=manager" },
  });
  const englishPage = await englishShot.newPage();
  await englishPage.goto(`${BASE}/en/dashboard/listings`, {
    waitUntil: "domcontentloaded",
  });
  await englishPage.screenshot({
    path: join(SHOTS, "listings-en-desktop.png"),
    fullPage: true,
  });

  await writeFile(
    join(SHOTS, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
    "utf8",
  );
} finally {
  await browser?.close();
  server.kill();
}

const failed = results.filter((entry) => !entry.passed);
console.log(
  `\n\x1b[1m${results.length - failed.length} pass · ${failed.length} fail\x1b[0m`,
);
console.log(`screenshots: ${SHOTS}`);
process.exit(failed.length === 0 ? 0 : 1);
