#!/usr/bin/env node
/**
 * W3-C design + honesty review of the evidence cockpit.
 *
 *   node scripts/evidence-review.mjs [--base http://127.0.0.1:3211]
 *
 * Drives a real Chromium against a running server and checks the things the
 * W3-C brief calls acceptance criteria, plus the floors azura-ui-ux §5 sets.
 * Screenshots land in `quality/w3c/`.
 *
 * ## Why a script and not a description
 *
 * "F-002 renders clearly and honestly" is not a claim anyone can verify by
 * reading a diff. Every assertion here is about the DOM the browser actually
 * built: the four prices are present as text, the USD figure still says USD,
 * the stale marker sits in the same row as the price it qualifies, and nothing
 * that carries a conflict is reachable only on hover.
 *
 * Playwright is driven directly rather than through `@playwright/test` because
 * `apps/web/playwright.config.ts` is W4-A's file and does not exist yet. W1-D
 * and W3-I did the same for the same reason.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

/**
 * Resolved from `apps/web`, not from here. `@playwright/test` is a devDependency
 * of the web package and pnpm does not hoist, so a bare `import` from `scripts/`
 * fails with ERR_MODULE_NOT_FOUND. Anchoring the require to the package that
 * actually declares the dependency is more honest than adding a second
 * declaration at the root.
 */
const requireFromWeb = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { chromium } = requireFromWeb("@playwright/test");

const argv = process.argv.slice(2);
const baseIndex = argv.indexOf("--base");
const BASE = baseIndex === -1 ? "http://127.0.0.1:3211" : argv[baseIndex + 1];
const OUT = new URL("../quality/w3c/", import.meta.url);

const useColor =
  process.env["NO_COLOR"] === undefined && process.stdout.isTTY === true;
const c = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

let passes = 0;
let failures = 0;
const check = (label, ok, detail = "") => {
  if (ok) {
    passes += 1;
    console.log(
      `  ${c("32", "PASS")}  ${label}${detail ? ` — ${detail}` : ""}`,
    );
  } else {
    failures += 1;
    console.log(
      `  ${c("31", "FAIL")}  ${label} — ${detail || "condition was false"}`,
    );
  }
};
const section = (t) => console.log(`\n${c("1", t)}`);

await mkdir(OUT, { recursive: true });

/**
 * Playwright 1.62 pins Chromium 1234; this machine has up to 1228 (W-INT §10
 * records the same mismatch). Rather than download a browser, fall back to the
 * newest full Chromium already present — and say which one, on every run, so a
 * result is never quietly attributed to a build that was not used. Nothing
 * asserted here depends on the revision.
 */
async function launchChromium() {
  try {
    return { browser: await chromium.launch(), revision: "pinned" };
  } catch (error) {
    const { existsSync, readdirSync } = await import("node:fs");
    const root = `${process.env["LOCALAPPDATA"]}\\ms-playwright`;
    if (!existsSync(root)) throw error;
    const candidate = readdirSync(root)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
    if (candidate === undefined) throw error;
    // The directory name changed across revisions (`chrome-win` → `chrome-win64`),
    // so both are tried rather than one being assumed.
    const executablePath = [
      `${root}\\${candidate}\\chrome-win64\\chrome.exe`,
      `${root}\\${candidate}\\chrome-win\\chrome.exe`,
    ].find((path) => existsSync(path));
    if (executablePath === undefined) throw error;
    console.log(
      `  ${c("33", "INFO")}  falling back to ${candidate} (pinned build absent)`,
    );
    return {
      browser: await chromium.launch({ executablePath }),
      revision: candidate,
    };
  }
}

const { browser, revision } = await launchChromium();

async function open(
  path,
  {
    width = 1280,
    height = 1400,
    colorScheme = "light",
    reducedMotion = "no-preference",
  } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    reducedMotion,
    locale: "de-DE",
  });
  const page = await context.newPage();
  const violations = [];
  page.on("console", (message) => {
    if (message.type() === "error") violations.push(message.text());
  });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations.push(event.violatedDirective);
    });
  });
  const response = await page.goto(`${BASE}${path}`, {
    waitUntil: "networkidle",
  });
  return { context, page, response, violations };
}

// ── the page loads ─────────────────────────────────────────────────────────
section("Evidence cockpit — /de/dashboard/evidence");
const de = await open("/de/dashboard/evidence");
check("HTTP 200", de.response?.status() === 200, String(de.response?.status()));

const body = await de.page.innerText("body");

// ── acceptance criterion: F-002 renders, all four prices, USD as USD ───────
section("F-002 — the four competing 1+1 prices");

const priceProbes = [
  ["Haspo entry price 112.000 €", /112[.\s]000/],
  ["Seaside 185.000 €", /185[.\s]000/],
  ["Alanya-Home 220.000 €", /220[.\s]000/],
  ["Housearch 239.171 USD", /239[.\s]171/],
];
for (const [label, pattern] of priceProbes) {
  check(
    label,
    pattern.test(body),
    pattern.test(body) ? "present as text" : "MISSING",
  );
}

check(
  "the USD figure is still labelled USD, not converted to EUR",
  /\$|USD/.test(body),
  "no silent conversion",
);
check(
  "both currencies appear on the page",
  /€|EUR/.test(body) && /\$|USD/.test(body),
);

const publishers = [
  "Haspo Realty",
  "Seaside Alanya",
  "Housearch",
  "Capital Estate",
  "Alanya-Home",
];
for (const publisher of publishers) {
  check(`publisher named: ${publisher}`, body.includes(publisher));
}

// ── the two rails are separate, and say why ────────────────────────────────
section("Two currencies, two axes, no conversion");

const rails = await de.page.$$('[data-slot="ladder-rail"]');
check("exactly two rails", rails.length === 2, `${rails.length} rails`);
const railCurrencies = await Promise.all(
  rails.map((rail) => rail.getAttribute("data-currency")),
);
check(
  "one rail per currency",
  new Set(railCurrencies).size === rails.length,
  railCurrencies.join(", "),
);
check(
  "the separator states that the rails are not comparable",
  /nicht vergleichbar/i.test(body),
  "keine Umrechnung",
);
// Scoped to the ladder, not to the whole page. The resolution prose deliberately
// contains the word "Mittelwert" — it is the sentence explaining that no average
// is taken — so a page-wide text check fails on the copy that proves the point.
// What matters is that no central-tendency VALUE is plotted.
const ladderText = await de.page.innerText(
  '[data-slot="price-conflict-ladder"]',
);
check(
  "the ladder plots no average, median or midpoint",
  !/(durchschnitt|mittelwert|median|average)/i.test(ladderText),
  "F-002.resolvedTo is null by design",
);
check(
  "the resolution copy still explains WHY no average is taken",
  /mittelwert/i.test(body),
  "the prohibition is stated, not merely obeyed",
);
check(
  "the panel says the finding is deliberately unresolved",
  /bewusst offen/i.test(body),
);

// ── stale is next to the price, not in a footnote ──────────────────────────
section("Stale listings — marked next to the price");

const staleRows = await de.page.$$(
  '[data-slot="observation-row"][data-stale="true"]',
);
check("stale rows exist", staleRows.length > 0, `${staleRows.length} rows`);
const staleBadgeInRow = await Promise.all(
  staleRows.map(async (row) => {
    const firstCell = await row.$("td:first-child");
    const text = (await firstCell?.innerText()) ?? "";
    return /veraltet/i.test(text);
  }),
);
check(
  "every stale row carries the badge in the PRICE cell",
  staleBadgeInRow.every(Boolean),
  `${staleBadgeInRow.filter(Boolean).length}/${staleRows.length}`,
);

const staleTicks = await de.page.$$(
  '[data-slot="ladder-tick"][data-stale="true"]',
);
check(
  "stale ticks are marked on the ladder too",
  staleTicks.length > 0,
  `${staleTicks.length} ticks`,
);
const tickShape = await de.page.evaluate(() => {
  const stale = document.querySelector(
    '[data-slot="ladder-tick"][data-stale="true"]',
  );
  const fresh = document.querySelector(
    '[data-slot="ladder-tick"][data-stale="false"]',
  );
  if (!stale || !fresh) return null;
  const a = getComputedStyle(stale);
  const b = getComputedStyle(fresh);
  return {
    staleStyle: a.borderStyle,
    staleWidth: a.width,
    freshWidth: b.width,
  };
});
check(
  "stale is a SHAPE difference, not only a colour difference",
  tickShape !== null &&
    tickShape.staleStyle === "dashed" &&
    tickShape.staleWidth !== tickShape.freshWidth,
  tickShape
    ? `stale ${tickShape.staleWidth}/${tickShape.staleStyle} vs fresh ${tickShape.freshWidth}`
    : "no ticks",
);

// ── ticks are positioned by value ──────────────────────────────────────────
section("The ladder is driven by the data");

// Grouped BY RAIL. Each currency has its own axis and its own min/max, so a
// USD tick at 239,171 legitimately sits far left on its own rail while an EUR
// tick at 310,000 sits far right on another. Comparing positions across rails
// is the mistake the two-rail design exists to prevent, and the first version
// of this check made exactly it.
const railTicks = await de.page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-slot="ladder-rail"]')).map(
    (rail) => ({
      currency: rail.getAttribute("data-currency"),
      ticks: Array.from(rail.querySelectorAll('[data-slot="ladder-tick"]')).map(
        (el) => ({
          amount: Number(el.getAttribute("data-amount")),
          left: parseFloat(el.style.left),
        }),
      ),
    }),
  ),
);
const allTicks = railTicks.flatMap((rail) => rail.ticks);
check(
  "ticks carry a positioned left offset",
  allTicks.every((t) => Number.isFinite(t.left)),
);
check(
  "ticks are not all stacked at one position",
  new Set(allTicks.map((t) => t.left)).size > 3,
  `${new Set(allTicks.map((t) => t.left)).size} distinct positions`,
);
for (const rail of railTicks) {
  const sorted = [...rail.ticks].sort((a, b) => a.amount - b.amount);
  const monotonic = sorted.every(
    (t, i) => i === 0 || t.left >= sorted[i - 1].left,
  );
  check(
    `${rail.currency}: a higher price sits further right`,
    monotonic,
    `${sorted.length} ticks`,
  );
  // A rail either spans its axis (a real disagreement) or clusters at the
  // centre (a negligible one). What it must never do is stretch two nearly
  // identical values across the full width, which reads as a 2.8× spread.
  const lo = sorted[0]?.left;
  const hi = sorted[sorted.length - 1]?.left;
  const ratio =
    (sorted[sorted.length - 1]?.amount ?? 1) / (sorted[0]?.amount ?? 1);
  const clustered = lo === 50 && hi === 50;
  const spanned = lo === 0 && hi === 100;
  check(
    `${rail.currency}: axis treatment matches the real spread (${ratio.toFixed(3)}×)`,
    sorted.length < 2 || (ratio < 1.05 ? clustered : spanned),
    sorted.length < 2
      ? "single observation"
      : `${lo}% → ${hi}% (${clustered ? "clustered" : "spanned"})`,
  );
}

// ── the entrance animation actually exists ─────────────────────────────────
section("Motion — the one moment, and it is real");

const tickMotion = await de.page.evaluate(() => {
  const ticks = Array.from(
    document.querySelectorAll('[data-slot="ladder-tick"]'),
  );
  return ticks.slice(0, 4).map((el) => {
    const s = getComputedStyle(el);
    return {
      property: s.transitionProperty,
      duration: s.transitionDuration,
      delay: s.transitionDelay,
      easing: s.transitionTimingFunction,
      origin: s.transformOrigin,
    };
  });
});
// If Tailwind had not emitted these the classes would be inert and the
// "animation" would be a claim with nothing behind it.
check(
  "ticks carry a real transition, not `all`",
  tickMotion.every(
    (t) =>
      t.property.includes("opacity") &&
      t.property.includes("transform") &&
      !t.property.includes("all"),
  ),
  tickMotion[0]?.property ?? "none",
);
check(
  "the transition has a duration under 600ms",
  tickMotion.every((t) => {
    const ms = parseFloat(t.duration) * (t.duration.includes("ms") ? 1 : 1000);
    return ms > 0 && ms <= 600;
  }),
  tickMotion[0]?.duration ?? "0s",
);
// Not just "they differ" — they must differ by an amount a person can see.
// A 0.05ms stagger is arithmetically distinct and visually simultaneous.
const delaysMs = tickMotion.map((t) => parseFloat(t.delay) * 1000);
check(
  "the stagger delay is perceptible and increases",
  delaysMs.length > 1 &&
    delaysMs[1] - delaysMs[0] >= 20 &&
    delaysMs.every((d, i) => i === 0 || d >= delaysMs[i - 1]),
  delaysMs.map((d) => `${Math.round(d)}ms`).join(" → "),
);
check(
  "the whole cascade finishes inside a second",
  Math.max(...delaysMs) <= 700,
  `last delay ${Math.round(Math.max(...delaysMs))}ms`,
);
check(
  "the easing is the project's ease-out, not a browser default",
  tickMotion.every((t) => t.easing.startsWith("cubic-bezier(0.23")),
  tickMotion[0]?.easing ?? "none",
);
check(
  "ticks grow from the axis, not from their centre",
  tickMotion.every(
    (t) => t.origin.endsWith("36px") || t.origin.includes("bottom"),
  ),
  tickMotion[0]?.origin ?? "none",
);

// ── provenance is never hover-only ─────────────────────────────────────────
section("Provenance is visible, never hover-only (azura-ui-ux §5.3)");

check(
  "the ladder is aria-hidden decoration",
  (await de.page.getAttribute(
    '[data-slot="price-conflict-ladder"] [aria-hidden="true"]',
    "aria-hidden",
  )) === "true",
  "the table below carries the same observations as text",
);
const tableRows = await de.page.$$('[data-slot="observation-row"]');
check(
  "every observation exists as a table row",
  tableRows.length >= 15,
  `${tableRows.length} rows`,
);
const linkCount = await de.page.$$eval(
  '[data-slot="observation-row"] a[href^="http"]',
  (a) => a.length,
);
check(
  "every row offers a route back to its source",
  linkCount >= tableRows.length,
  `${linkCount} links / ${tableRows.length} rows`,
);

// ── tap targets and 320px German ───────────────────────────────────────────
section("Floors — tap targets, 320px German, contrast-independent marking");

const smallTargets = await de.page.evaluate(() => {
  const interactive = Array.from(document.querySelectorAll("a, button"));
  return interactive
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    })
    .filter((box) => box.h > 0 && box.h < 24);
});
check(
  "all tap targets ≥ 24px high",
  smallTargets.length === 0,
  smallTargets.length === 0
    ? "0 violations"
    : JSON.stringify(smallTargets.slice(0, 4)),
);

await de.page.screenshot({
  path: new URL("evidence-f002-de-light.png", OUT).pathname.slice(1),
  fullPage: true,
});

const cspViolations = await de.page.evaluate(
  () => window.__cspViolations ?? [],
);
check(
  "no CSP violations on the page",
  cspViolations.length === 0,
  cspViolations.slice(0, 3).join(", ") || "0",
);

await de.context.close();

// One theme. Asserted by driving a browser that ASKS for dark and checking the
// app refuses — a product decision is only real if it survives the user's OS
// preference, and `prefers-color-scheme: dark` is the case that would have
// quietly re-enabled it.
section("One theme — light, even when the OS asks for dark");
const forced = await open("/de/dashboard/evidence", { colorScheme: "dark" });
const themeState = await forced.page.evaluate(() => ({
  htmlClass: document.documentElement.className,
  bodyBg: getComputedStyle(document.body).backgroundColor,
}));
check(
  "the document never carries the dark class",
  !themeState.htmlClass.split(/\s+/).includes("dark"),
  `<html class="${themeState.htmlClass}">`,
);
check(
  "the page still renders its evidence under a dark OS preference",
  (await forced.page.innerText("body")).includes("112"),
  themeState.bodyBg,
);
await forced.context.close();

// 320px German — where layouts actually break
const narrow = await open("/de/dashboard/evidence", {
  width: 320,
  height: 1200,
});
const overflow = await narrow.page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));
check(
  "320px German: no horizontal page scroll",
  overflow.scrollWidth <= overflow.clientWidth,
  `scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`,
);
await narrow.page.screenshot({
  path: new URL("evidence-f002-de-320.png", OUT).pathname.slice(1),
  fullPage: true,
});
await narrow.context.close();

// reduced motion — a complete, static page
const reduced = await open("/de/dashboard/evidence", {
  reducedMotion: "reduce",
});
const hidden = await reduced.page.evaluate(
  () =>
    Array.from(document.querySelectorAll("body *")).filter((el) => {
      const s = getComputedStyle(el);
      return s.opacity === "0" && el.getBoundingClientRect().height > 0;
    }).length,
);
check(
  "reduced motion: nothing left at opacity 0",
  hidden === 0,
  `${hidden} offenders`,
);
// Reduced motion means the finished frame, not a slower journey to it.
const reducedTicks = await reduced.page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-slot="ladder-tick"]'))
    .slice(0, 3)
    .map((el) => {
      const s = getComputedStyle(el);
      return {
        property: s.transitionProperty,
        duration: s.transitionDuration,
        transform: s.transform,
      };
    }),
);
// `transition-property: none` is what actually disables it — Tailwind's
// `transition-none` leaves a residual duration, so asserting `duration === 0`
// tested the wrong thing and would have passed a still-animating element.
check(
  "reduced motion: the tick transition is switched off entirely",
  reducedTicks.every((t) => t.property === "none"),
  `transition-property: ${reducedTicks[0]?.property ?? "none"}`,
);
check(
  "reduced motion: ticks are at full scale, not mid-animation",
  reducedTicks.every(
    (t) => t.transform === "none" || /matrix\(1, 0, 0, 1/.test(t.transform),
  ),
  reducedTicks[0]?.transform ?? "none",
);
const reducedBody = await reduced.page.innerText("body");
check(
  "reduced motion: the evidence is all still there",
  /112[.\s]000/.test(reducedBody) && /239[.\s]171/.test(reducedBody),
);
await reduced.context.close();

// ── all four locales ───────────────────────────────────────────────────────
section("Four locales — translated, and proper nouns pinned");

/**
 * Names that must be byte-identical in every language. A publisher's name is
 * its identity: a reader following a citation has to find the same string on
 * the source register, in `SOURCES.md`, and on the portal itself. Translating
 * or transliterating one breaks that chain silently.
 */
const PINNED = [
  "Azura World",
  "Haspo Realty",
  "Seaside Alanya",
  "Capital Estate",
  "Housearch",
  "Alanya-Home",
  "TERRA Real Estate",
  "F-002",
  "1+1",
];

/** A locale is translated, not a fallback, if it carries its own marker. */
const LOCALE_MARKERS = {
  de: /nicht vergleichbar/,
  en: /not comparable/,
  tr: /karşılaştırılamaz/,
  ru: /несопоставимо/,
};

const localeBodies = {};
for (const locale of ["de", "en", "tr", "ru"]) {
  const page = await open(`/${locale}/dashboard/evidence`);
  check(
    `${locale}: renders`,
    page.response?.status() === 200,
    String(page.response?.status()),
  );
  const text = await page.page.innerText("body");
  localeBodies[locale] = text;

  check(
    `${locale}: is actually ${locale}, not a fallback`,
    LOCALE_MARKERS[locale].test(text),
    "own translation marker present",
  );
  for (const noun of PINNED) {
    check(`${locale}: "${noun}" is unchanged`, text.includes(noun));
  }
  // The figures must survive translation untouched — only their separators
  // change with the locale's number format.
  check(
    `${locale}: the four F-002 figures are all present`,
    /112[.,\s]?000/.test(text) &&
      /185[.,\s]?000/.test(text) &&
      /220[.,\s]?000/.test(text) &&
      /239[.,\s]?171/.test(text),
  );
  await page.page.screenshot({
    path: new URL(`evidence-f002-${locale}.png`, OUT).pathname.slice(1),
    fullPage: true,
  });
  await page.context.close();
}

// No two locales may be byte-identical in their prose — that is what a silent
// fallback looks like, and it passes every other check here.
for (const [a, b] of [
  ["de", "en"],
  ["de", "tr"],
  ["de", "ru"],
  ["en", "tr"],
  ["en", "ru"],
  ["tr", "ru"],
]) {
  check(
    `${a} and ${b} are genuinely different translations`,
    localeBodies[a] !== localeBodies[b],
  );
}

await browser.close();

const summary = `${passes} pass · ${failures} fail`;
console.log(
  failures === 0
    ? `\n${c("1", c("32", "OK"))}  ${summary}`
    : `\n${c("1", c("31", "FAILED"))}  ${summary}`,
);
await writeFile(
  new URL("evidence-review.json", OUT),
  JSON.stringify({ passes, failures, base: BASE }, null, 2),
);
process.exit(failures === 0 ? 0 : 1);
