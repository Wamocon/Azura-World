/**
 * F6 — the locale guard, proved against the corpus that reproduced F1-002.
 *
 * The end-to-end `next start` measurement cannot attribute its result to this
 * change alone: a concurrent window added a `notFound()` to
 * `app/[locale]/page.tsx` at 09:54, which returns before any section renders. So
 * this proves the guard itself, exhaustively and in isolation.
 *
 * Run:
 *   node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs <this file>
 */

import { intlLocale, intlLocaleTag, isLocale } from "../apps/web/lib/format.ts";
import { defaultLocale, locales } from "../apps/web/lib/contracts.ts";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, observed = ""): void {
  if (condition) {
    pass += 1;
    return;
  }
  fail += 1;
  failures.push(`${name}${observed === "" ? "" : `  ::  ${observed}`}`);
}

/**
 * Every string measured to throw out of `new Intl.*Format()` on this Node, plus
 * the ones that do not. The first group is what a browser or a crawler actually
 * asks for.
 */
const HOSTILE = [
  "favicon.ico",
  "robots.txt",
  "index.php",
  ".well-known",
  "apple-touch-icon.png",
  "sitemap.xml",
  "de_DE",
  "de-",
  "de.DE",
  "en US",
  "",
  " ",
  "a",
  "123",
  "%20",
  "..",
  "../../etc/passwd",
  "\u0000",
  "xx",
  "wp-admin",
  "DE",
  "de-DE",
  "zz-ZZ-ZZ",
];

console.log("\n── the corpus still throws when passed raw, which is the defect");
let rawThrows = 0;
for (const value of HOSTILE) {
  try {
    new Intl.NumberFormat(value);
  } catch {
    rawThrows += 1;
  }
}
check(
  "the corpus contains inputs that throw when handed straight to Intl",
  rawThrows > 0,
  `${rawThrows} of ${HOSTILE.length} throw raw`,
);
console.log(`   ${rawThrows} of ${HOSTILE.length} inputs throw when passed raw`);

console.log("── the guard never throws, and what it returns is always usable");
for (const value of HOSTILE) {
  let tag: string | null = null;
  let threw = false;
  try {
    tag = intlLocaleTag(value);
  } catch {
    threw = true;
  }
  check(`intlLocaleTag(${JSON.stringify(value)}) does not throw`, !threw);
  if (threw || tag === null) continue;

  // The returned tag must itself be safe in all three constructors.
  for (const construct of [
    () => new Intl.NumberFormat(tag as string),
    () => new Intl.DateTimeFormat(tag as string),
    () => new Intl.Collator(tag as string),
  ]) {
    let ok = true;
    try {
      construct();
    } catch {
      ok = false;
    }
    check(`the tag for ${JSON.stringify(value)} is accepted by Intl`, ok, String(tag));
  }
}

console.log("── an unrecognised locale degrades to the default, it does not guess");
for (const value of HOSTILE.filter((v) => !isLocale(v))) {
  check(
    `${JSON.stringify(value)} degrades to the default locale's tag`,
    intlLocaleTag(value) === intlLocale(defaultLocale),
    intlLocaleTag(value),
  );
}

console.log("── control: the four real locales are NOT degraded");
for (const locale of locales) {
  check(
    `${locale} keeps its own pinned tag`,
    intlLocaleTag(locale) === intlLocale(locale),
    `${intlLocaleTag(locale)} vs ${intlLocale(locale)}`,
  );
  check(`${locale} is not the default's tag unless it is the default`,
    locale === defaultLocale || intlLocaleTag(locale) !== intlLocale(defaultLocale));
}

console.log("── control: the pinned tags are the ones W1-C specified");
const EXPECTED: Record<string, string> = {
  de: "de-DE",
  en: "en-US",
  tr: "tr-TR",
  ru: "ru-RU",
};
for (const [locale, tag] of Object.entries(EXPECTED)) {
  check(`${locale} resolves to ${tag}`, intlLocaleTag(locale) === tag, intlLocaleTag(locale));
}

// The reason the tag matters and not merely the absence of a throw: `en` alone
// formats a date in the runtime's default order, `en-US` in the pinned one.
const sample = new Date("2026-07-27T09:00:00.000Z");
const withTag = new Intl.DateTimeFormat(intlLocaleTag("en"), {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Europe/Istanbul",
}).format(sample);
check("en renders the US order W1-C pinned", withTag === "07/27/2026", withTag);
console.log(`   en → ${withTag}`);

console.log("── isLocale is a real check, not a cast");
for (const value of ["de", "en", "tr", "ru"]) {
  check(`isLocale(${JSON.stringify(value)}) is true`, isLocale(value));
}
for (const value of ["DE", "de-DE", "xx", "", "favicon.ico", null, undefined, 42, {}]) {
  check(`isLocale(${JSON.stringify(value)}) is false`, !isLocale(value));
}

const MINIMUM = 120;
check(`the suite still runs at least ${MINIMUM} assertions`, pass + fail >= MINIMUM, `${pass + fail}`);

console.log(`\n${pass} pass · ${fail} fail`);
if (fail > 0) {
  console.log("\nFAILED:");
  for (const line of failures.slice(0, 30)) console.log(`  - ${line}`);
}
process.exit(fail > 0 ? 1 : 0);
