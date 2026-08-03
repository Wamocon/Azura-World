#!/usr/bin/env node
/**
 * check-i18n — message-catalogue gate for W1-C (INTERNAL-107).
 *
 * German is the source of truth (CONTRACTS §7). Every other catalogue is
 * measured against it. Runs in W4-D's quality gate; exits non-zero on any error.
 *
 * ERRORS (the six rules in tasks/W1-C-i18n.md §5 — each one fails the build):
 *   1  A key in de.json missing from another locale
 *   2  A key in another locale absent from de.json (orphan)
 *   3  An empty string value
 *   4  Placeholder mismatch — {count} in de but {anzahl} in en
 *   5  A value identical to its key (an unfilled stub)
 *   6  A German string > 1.4x its English counterpart with no `_long` variant
 *
 *   Plus three structural errors that make rules 1–6 meaningless if ignored:
 *   0a Invalid JSON, or a catalogue that is not an object
 *   0b Shape mismatch — a path that is an object in one locale, a string in another
 *   0c A duplicate key inside one object. `JSON.parse` silently keeps the last
 *      one, so a duplicate does not fail any of rules 1–6 — it just deletes a
 *      key that the author believes is there. This check caught exactly that
 *      during W1-C: `nav.dashboard` was written twice, once as a label and once
 *      as a group of labels, and the label vanished without a word.
 *
 * WARNINGS (reported, do not fail the build):
 *   W1 A non-German value byte-identical to the German one after proper nouns,
 *      digits and punctuation are stripped — a likely untranslated copy-paste.
 *      This is a heuristic, which is why it warns rather than fails.
 *
 * Usage:
 *   node scripts/check-i18n.mjs                 # human output
 *   node scripts/check-i18n.mjs --json          # machine output for the gate
 *   node scripts/check-i18n.mjs --dir=<path>    # check a different catalogue dir
 *
 * `--dir` exists so the gate can be pointed at fixture catalogues and shown to
 * actually REJECT each rule. A validator nobody has watched fail is a validator
 * nobody has tested — `scripts/smoke-contracts.mts` proves its invariants the
 * same way.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

const dirArg = process.argv
  .slice(2)
  .find((value) => value.startsWith("--dir="));
const messagesDir =
  dirArg === undefined
    ? join(repoRoot, "apps", "web", "messages")
    : resolve(dirArg.slice("--dir=".length));

/** CONTRACTS §7. Hard-coded rather than imported: this script must run with
 *  plain `node` and no TypeScript loader, and a drift between this list and
 *  lib/contracts.ts is itself something the gate should surface. */
const LOCALES = ["tr", "en", "ru", "de"];
const DEFAULT_LOCALE = "tr";
/** Rule 6. German runs ~30% longer than English by nature; 1.4 is the point
 *  where it stops being the language and starts being a layout problem. */
const LENGTH_RATIO_LIMIT = 1.4;
/**
 * Rule 6 floor, applied to the GERMAN string.
 *
 * 20 characters, arrived at empirically rather than chosen. The floor was first
 * written at 12 and on the English side, which let a 4-character English button
 * with a 36-character German label through — the worst case there is. Moving it
 * to the German side fixed that and immediately raised 24 findings, every one of
 * which was simply German being German: "Zurücksetzen" (12) vs "Reset" (5) is
 * 2.4x and overflows nothing. Above ~20 characters a label stops fitting a
 * button or a column header at our breakpoints, and the ratio starts telling
 * you something. Below it, the ratio is arithmetic about short words.
 *
 * This is an early warning, not a layout test. W4-B's harness measures real
 * boxes; this only says "look here first".
 */
const LENGTH_RATIO_MIN_CHARS = 20;
/** Warning W1 floor, in characters remaining after normalisation. */
const IDENTICAL_MIN_CHARS = 4;

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");

// ---------------------------------------------------------------------------
// Proper nouns — shared with apps/web/lib/proper-nouns.ts, which imports the
// same JSON. One list, two consumers; a divergence is impossible by construction.
// ---------------------------------------------------------------------------

/** @type {{ properNouns: string[], sharedTerms: string[], literalValues: string[], variants: Record<string,string> }} */
const properNounData = JSON.parse(
  readFileSync(
    join(repoRoot, "apps", "web", "lib", "proper-nouns.json"),
    "utf8",
  ),
);

/** Terms that legitimately render identically in every locale (warning W1). */
const ALLOWLIST = [
  ...properNounData.properNouns,
  ...properNounData.sharedTerms,
].map((term) => term.toLocaleLowerCase("en-US"));

/** Values that are legitimately identical to their key leaf (rule 5).
 *  `common.units.rooms: "rooms"` is the unit word, not an unfilled stub. */
const LITERAL_VALUES = new Set(properNounData.literalValues);

// ---------------------------------------------------------------------------
// Loading and flattening
// ---------------------------------------------------------------------------

const errors = [];
const warnings = [];

/** @param {string} rule @param {string} locale @param {string} key @param {string} message */
function error(rule, locale, key, message) {
  errors.push({ rule, locale, key, message });
}
/** @param {string} rule @param {string} locale @param {string} key @param {string} message */
function warn(rule, locale, key, message) {
  warnings.push({ rule, locale, key, message });
}

/**
 * Reports keys that appear twice inside the same JSON object.
 *
 * Has to work on the raw text: by the time `JSON.parse` returns, the duplicate
 * is gone and the last value has silently overwritten the first. Walks the
 * characters tracking string escapes and object depth; a string is a key when
 * the next non-whitespace character is a colon.
 *
 * @param {string} text
 * @returns {Array<{ key: string, line: number }>}
 */
function findDuplicateKeys(text) {
  /** @type {Array<{ key: string, line: number }>} */
  const duplicates = [];
  /** @type {Array<Set<string>>} */
  const scopes = [];
  let line = 1;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === "\n") {
      line += 1;
      i += 1;
      continue;
    }

    if (ch === "{") {
      scopes.push(new Set());
      i += 1;
      continue;
    }

    if (ch === "}") {
      scopes.pop();
      i += 1;
      continue;
    }

    if (ch === '"') {
      // Consume the string, honouring backslash escapes.
      let cursor = i + 1;
      while (cursor < text.length) {
        if (text[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (text[cursor] === '"') break;
        if (text[cursor] === "\n") line += 1;
        cursor += 1;
      }
      const token = text.slice(i + 1, cursor);

      // A key is a string followed (after whitespace) by a colon.
      let after = cursor + 1;
      while (after < text.length && /\s/.test(text[after] ?? "")) {
        if (text[after] === "\n") line += 1;
        after += 1;
      }
      if (text[after] === ":") {
        const scope = scopes[scopes.length - 1];
        if (scope !== undefined) {
          if (scope.has(token)) duplicates.push({ key: token, line });
          scope.add(token);
        }
      }
      i = after;
      continue;
    }

    i += 1;
  }

  return duplicates;
}

/** @returns {Record<string, unknown> | null} */
function loadCatalogue(locale) {
  const file = join(messagesDir, `${locale}.json`);
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (cause) {
    error(
      "0a",
      locale,
      "",
      `cannot read ${relative(repoRoot, file)}: ${cause.message}`,
    );
    return null;
  }
  for (const duplicate of findDuplicateKeys(raw)) {
    error(
      "0c",
      locale,
      duplicate.key,
      `duplicate key at ${locale}.json:${duplicate.line} — JSON.parse keeps only the last one`,
    );
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      error("0a", locale, "", "catalogue root must be a JSON object");
      return null;
    }
    return parsed;
  } catch (cause) {
    error("0a", locale, "", `invalid JSON: ${cause.message}`);
    return null;
  }
}

/**
 * Flattens `{a: {b: "x"}}` to `{"a.b": "x"}`. Arrays are rejected outright:
 * an array in a message catalogue means someone is building a list in JSON
 * that belongs in a component, and it makes rules 1 and 2 unanswerable.
 *
 * `branches` records the paths that are objects, so that a path which is an
 * object in one locale and a string in another can be reported as the one
 * structural fault it is (rule 0b) instead of as the dozens of derived
 * "missing key" errors it would otherwise masquerade as.
 *
 * @param {Record<string, unknown>} node
 * @param {string} locale
 * @param {string} prefix
 * @param {Map<string, string>} out
 * @param {Set<string>} branches
 */
function flatten(node, locale, prefix, out, branches) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out.set(path, value);
    } else if (Array.isArray(value)) {
      error(
        "0b",
        locale,
        path,
        "arrays are not allowed in a message catalogue",
      );
    } else if (value !== null && typeof value === "object") {
      branches.add(path);
      flatten(
        /** @type {Record<string, unknown>} */ (value),
        locale,
        path,
        out,
        branches,
      );
    } else {
      error(
        "0b",
        locale,
        path,
        `value must be a string or an object, got ${value === null ? "null" : typeof value}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// ICU placeholder extraction (rule 4)
// ---------------------------------------------------------------------------

const ICU_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Returns the set of ICU argument names in a message.
 *
 * Walks brace depth rather than running a regex, so `{count, plural, one {#
 * Wohnung} other {# Wohnungen}}` yields exactly `count`. Sub-messages are
 * walked too, so an argument nested inside a plural branch is still found; the
 * branch bodies themselves ("# Wohnung") fail the identifier test and are
 * dropped. That identifier filter is what keeps the walker simple — it is a
 * heuristic, and it is deliberately biased towards dropping rather than
 * inventing an argument name.
 *
 * @param {string} value
 * @returns {Set<string>}
 */
function icuArguments(value) {
  /** @type {Set<string>} */
  const found = new Set();
  let i = 0;
  while (i < value.length) {
    if (value[i] !== "{") {
      i += 1;
      continue;
    }
    // Name runs to the first comma or the closing brace.
    let nameEnd = i + 1;
    while (
      nameEnd < value.length &&
      value[nameEnd] !== "," &&
      value[nameEnd] !== "}"
    ) {
      nameEnd += 1;
    }
    const name = value.slice(i + 1, nameEnd).trim();
    if (ICU_IDENTIFIER.test(name)) found.add(name);

    // Scan to the matching close brace.
    let depth = 1;
    let cursor = i + 1;
    while (cursor < value.length && depth > 0) {
      if (value[cursor] === "{") depth += 1;
      else if (value[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    if (depth > 0) {
      // Unbalanced braces: report through rule 4 rather than looping forever.
      found.add("<unbalanced-braces>");
      break;
    }
    for (const nested of icuArguments(value.slice(nameEnd, cursor - 1))) {
      found.add(nested);
    }
    i = cursor;
  }
  return found;
}

// ---------------------------------------------------------------------------
// Rule 5 / warning W1 helpers
// ---------------------------------------------------------------------------

/** `dashboard.listings.columns.portal` -> `portal` */
function leafOf(path) {
  const parts = path.split(".");
  return parts[parts.length - 1] ?? path;
}

function isAllowlisted(value) {
  const lowered = value.trim().toLocaleLowerCase("en-US");
  return ALLOWLIST.includes(lowered);
}

/**
 * Strips allowlisted proper nouns, then digits, punctuation and symbols.
 * What is left is the part that a translator was actually supposed to change.
 */
function translatableRemainder(value) {
  let remainder = value;
  for (const term of [
    ...properNounData.properNouns,
    ...properNounData.sharedTerms,
  ].sort((a, b) => b.length - a.length)) {
    remainder = remainder.split(term).join(" ");
  }
  return remainder.replace(/[\p{N}\p{P}\p{S}\p{Z}]+/gu, "").trim();
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/** @type {Map<string, Map<string, string>>} */
const catalogues = new Map();
/** @type {Map<string, Set<string>>} */
const branchPaths = new Map();

for (const locale of LOCALES) {
  const raw = loadCatalogue(locale);
  if (raw === null) continue;
  /** @type {Map<string, string>} */
  const flat = new Map();
  /** @type {Set<string>} */
  const branches = new Set();
  flatten(raw, locale, "", flat, branches);
  catalogues.set(locale, flat);
  branchPaths.set(locale, branches);
}

const base = catalogues.get(DEFAULT_LOCALE);
if (base === undefined) {
  report();
  process.exit(1);
}

const english = catalogues.get("en");
/** Rule 6 measures GERMAN against English regardless of which locale is the
 *  source of truth: it is a layout check about German being ~30% longer, not a
 *  statement about the default language. Moving the default to Turkish must not
 *  quietly repoint it. */
const german = catalogues.get("de");

for (const locale of LOCALES) {
  const flat = catalogues.get(locale);
  if (flat === undefined) continue;

  // Rule 0b — shape mismatch against German. Checked before rules 1 and 2
  // because a namespace replaced by a string produces one real fault and a
  // long tail of derived "missing key" noise; naming the real one first is
  // the difference between a two-minute fix and a hunt.
  if (locale !== DEFAULT_LOCALE) {
    const baseBranches = branchPaths.get(DEFAULT_LOCALE) ?? new Set();
    const localeBranches = branchPaths.get(locale) ?? new Set();
    for (const path of baseBranches) {
      if (flat.has(path)) {
        error(
          "0b",
          locale,
          path,
          `is a namespace in ${DEFAULT_LOCALE}.json but a string here — the ` +
            `"missing key" errors under this path are a consequence, not the cause`,
        );
      }
    }
    for (const path of localeBranches) {
      if (base.has(path)) {
        error(
          "0b",
          locale,
          path,
          `is a string in ${DEFAULT_LOCALE}.json but a namespace here`,
        );
      }
    }
  }

  // Rule 1 — missing.
  if (locale !== DEFAULT_LOCALE) {
    for (const key of base.keys()) {
      if (!flat.has(key)) {
        error("1", locale, key, `missing (present in ${DEFAULT_LOCALE}.json)`);
      }
    }
    // Rule 2 — orphan.
    for (const key of flat.keys()) {
      if (!base.has(key)) {
        error("2", locale, key, `orphan (absent from ${DEFAULT_LOCALE}.json)`);
      }
    }
  }

  for (const [key, value] of flat) {
    // Rule 3 — empty.
    if (value.trim().length === 0) {
      error("3", locale, key, "empty string value");
    }

    // Rule 5 — value identical to its key.
    //
    // Matched CASE-SENSITIVELY, which is the whole difficulty of this rule:
    // CONVENTIONS §6 makes keys English, so `common.actions.save: "Save"` in
    // en.json is correct copy while `common.actions.save: "save"` is a raw key
    // someone pasted. Case-folding the comparison would fail the entire English
    // catalogue. `literalValues` covers the handful of keys whose translation
    // genuinely is the lowercase key word (`common.units.rooms: "rooms"`).
    {
      const trimmed = value.trim();
      if (trimmed === key) {
        error(
          "5",
          locale,
          key,
          "value equals its full key path — unfilled stub",
        );
      } else if (trimmed === leafOf(key) && !LITERAL_VALUES.has(trimmed)) {
        error(
          "5",
          locale,
          key,
          `value equals its key leaf ("${value}") — unfilled stub, or add it to ` +
            `lib/proper-nouns.json "literalValues"`,
        );
      }
    }

    // Rule 4 — placeholder parity against German.
    if (locale !== DEFAULT_LOCALE) {
      const baseValue = base.get(key);
      if (baseValue !== undefined) {
        const expected = icuArguments(baseValue);
        const actual = icuArguments(value);
        const missing = [...expected].filter((name) => !actual.has(name));
        const extra = [...actual].filter((name) => !expected.has(name));
        if (missing.length > 0 || extra.length > 0) {
          const parts = [];
          if (missing.length > 0)
            parts.push(`missing {${missing.join("}, {")}}`);
          if (extra.length > 0)
            parts.push(`unexpected {${extra.join("}, {")}}`);
          error(
            "4",
            locale,
            key,
            `placeholder mismatch vs ${DEFAULT_LOCALE}: ${parts.join("; ")}`,
          );
        }
      }
    }

    // Warning W1 — suspected untranslated copy of the German string.
    if (locale !== DEFAULT_LOCALE) {
      const baseValue = base.get(key);
      if (
        baseValue !== undefined &&
        baseValue === value &&
        !isAllowlisted(value)
      ) {
        const remainder = translatableRemainder(value);
        if (remainder.length >= IDENTICAL_MIN_CHARS) {
          warn(
            "W1",
            locale,
            key,
            `identical to ${DEFAULT_LOCALE} ("${value}") — translate it, or add it to lib/proper-nouns.json`,
          );
        }
      }
    }
  }
}

// Rule 6 — German length blow-out against English.
if (english !== undefined) {
  for (const [key, deValue] of german ?? []) {
    if (key.endsWith("_long")) continue; // the declared long variant is exempt
    const enValue = english.get(key);
    if (enValue === undefined || enValue.length === 0) continue;
    // The floor is on the GERMAN length, not the English. Putting it on English
    // was a bug caught by the reject-test: a 4-character English button
    // ("Save") paired with a 36-character German label scores 9x and is the
    // single worst overflow case there is, yet a floor on `enValue` skipped it
    // entirely. A short *German* string cannot overflow anything, so that is
    // the side where a ratio is genuinely noise.
    if (deValue.length < LENGTH_RATIO_MIN_CHARS) continue;
    const ratio = deValue.length / enValue.length;
    if (ratio <= LENGTH_RATIO_LIMIT) continue;
    if (base.has(`${key}_long`)) continue; // an explicit short/long pair was provided
    error(
      "6",
      DEFAULT_LOCALE,
      key,
      `German is ${ratio.toFixed(2)}x English (${deValue.length} vs ${enValue.length} chars) ` +
        `with no "${leafOf(key)}_long" variant — shorten the German or add one`,
    );
  }
}

// Rule 7 — CALL-SITE arity. A message with ICU arguments read through a bare
// `t("key")` throws FORMATTING_ERROR at render, and next-intl's fallback prints
// the KEY PATH on screen. That is how "dashboard.listings.compare.spread" and
// "dashboard.pipeline.card.probability" both reached a client demo: rules 1-6
// all passed, because the catalogues were perfect. The defect was never in the
// catalogue, it was in how the call site read it.
//
// Two legitimate ways to read such a message, and this rule accepts both:
//   t("key", { count })  — next-intl interpolates
//   t.raw("key")         — the caller hands the template to a component that
//                          substitutes it itself (the `fill()` pattern)
// Anything else is a defect.
checkCallSiteArity();

report();
process.exit(errors.length > 0 ? 1 : 0);

/**
 * Walks every `.ts`/`.tsx` under `apps/web/{app,components}`, resolves each
 * `t("...")` against the namespace(s) declared in that file, and fails when the
 * resolved message carries ICU arguments the call site does not supply.
 *
 * Deliberately conservative: a key that resolves in no declared namespace is
 * skipped rather than guessed at, so this reports defects it can prove.
 */
function checkCallSiteArity() {
  const roots = [
    join(repoRoot, "apps", "web", "app"),
    join(repoRoot, "apps", "web", "components"),
  ];

  /** @type {string[]} */
  const files = [];
  for (const root of roots) collectSourceFiles(root, files);

  for (const file of files) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const namespaces = [
      ...source.matchAll(/namespace:\s*["'`]([^"'`]+)["'`]/g),
    ].map((match) => match[1]);

    // `t("key")` / `tCommon("key")` / `t.raw("key")`, capturing the delimiter
    // that follows the key so a supplied argument object is visible.
    //
    // The suffix must start with a CAPITAL (`tCommon`, `tRoot`) or be absent.
    // `[A-Za-z]*` was the first attempt and it matched `template("finding.id")`
    // — a local `t.raw` alias — reporting five defects that did not exist. A
    // build gate that cries wolf gets switched off, so it is deliberately narrow:
    // it reports what it can prove and stays silent on helpers it cannot resolve.
    const callPattern =
      /\bt([A-Z][A-Za-z]*)?\s*(\.raw)?\s*\(\s*["'`]([^"'`${}]+)["'`]\s*(\)|,)/g;

    let match;
    while ((match = callPattern.exec(source)) !== null) {
      const isRaw = match[2] === ".raw";
      const key = match[3];
      const suppliesArguments = match[4] === ",";
      if (isRaw || suppliesArguments) continue;

      const candidates =
        namespaces.length > 0
          ? namespaces.map((namespace) => `${namespace}.${key}`)
          : [key];

      for (const path of candidates) {
        const value = base.get(path);
        if (value === undefined) continue;
        const args = icuArguments(value);
        if (args.size === 0) break;
        const line = source.slice(0, match.index).split("\n").length;
        const where = `${relative(repoRoot, file).split(sep).join("/")}:${line}`;
        error(
          "7",
          DEFAULT_LOCALE,
          path,
          `${where} reads this with a bare t("${key}") but the message takes ` +
            `{${[...args].join("}, {")}} — pass the arguments, or use t.raw() if a ` +
            `component substitutes them. As written it renders the key path on screen`,
        );
        break;
      }
    }
  }
}

/** Every `.ts`/`.tsx` beneath `dir`, skipping build and dependency output. */
function collectSourceFiles(dir, out) {
  /** @type {import("node:fs").Dirent[]} */
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
}

// ---------------------------------------------------------------------------

function report() {
  const keyCounts = Object.fromEntries(
    LOCALES.map((locale) => [locale, catalogues.get(locale)?.size ?? 0]),
  );

  // Structural faults (0a/0b/0c) print first: they are causes, and rules 1–6
  // under a broken namespace are their symptoms. `sort` is stable in V8, so
  // ties keep discovery order.
  errors.sort(
    (a, b) => Number(b.rule.startsWith("0")) - Number(a.rule.startsWith("0")),
  );

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ keyCounts, errors, warnings, ok: errors.length === 0 }, null, 2)}\n`,
    );
    return;
  }

  process.stdout.write("check-i18n — Azura World (INTERNAL-107 · W1-C)\n\n");
  for (const locale of LOCALES) {
    const size = keyCounts[locale];
    const marker =
      locale === DEFAULT_LOCALE ? " (default, source of truth)" : "";
    process.stdout.write(
      `  ${locale}.json  ${String(size).padStart(4)} keys${marker}\n`,
    );
  }
  process.stdout.write("\n");

  if (warnings.length > 0) {
    process.stdout.write(`WARNINGS (${warnings.length}) — not fatal\n`);
    for (const item of warnings) {
      process.stdout.write(
        `  [${item.rule}] ${item.locale}  ${item.key}\n        ${item.message}\n`,
      );
    }
    process.stdout.write("\n");
  }

  if (errors.length === 0) {
    const unique = new Set(LOCALES.map((locale) => keyCounts[locale]));
    const parity = unique.size === 1 ? "identical key sets" : "KEY SETS DIFFER";
    process.stdout.write(
      `PASS — 0 errors, ${warnings.length} warnings, ${parity}\n`,
    );
    return;
  }

  process.stdout.write(`ERRORS (${errors.length})\n`);
  for (const item of errors) {
    process.stdout.write(
      `  [rule ${item.rule}] ${item.locale}  ${item.key}\n        ${item.message}\n`,
    );
  }
  process.stdout.write(`\nFAIL — ${errors.length} errors\n`);
}
