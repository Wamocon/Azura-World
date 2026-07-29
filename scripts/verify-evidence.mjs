#!/usr/bin/env node
/**
 * verify-evidence.mjs — independent validator for the Azura World dataset (W0-B).
 *
 * "Independent" is the whole point, so read this before changing it:
 *
 *   - it validates the EMITTED ARTIFACT (apps/web/lib/azura-world-data.ts), which
 *     is what actually ships, not the builder's in-memory view of what it meant
 *     to emit;
 *   - it re-computes every snapshot sha256 from the files on disk rather than
 *     trusting sources/manifest.json, so a citation is only accepted when the
 *     bytes it points at still exist and still hash to the same value.
 *
 * A builder checking its own work catches typos and nothing else. The failure
 * this guards against is the one the reference project actually shipped: an
 * artifact that looks complete and whose citations do not resolve.
 *
 * Usage:
 *   node scripts/verify-evidence.mjs [--json] [--quiet]
 * Exit 0 clean · 1 violations found · 2 could not run.
 */

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DATA_TS = path.join(ROOT, "apps", "web", "lib", "azura-world-data.ts");
const RAW_DIR = path.join(ROOT, "sources", "raw");
const MANIFEST = path.join(ROOT, "sources", "manifest.json");

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const quiet = argv.includes("--quiet");

const violations = [];
const fail = (rule, where, detail) => violations.push({ rule, where, detail });

/**
 * How many snapshotHash → file resolutions were skipped because there are no
 * snapshots on disk at all. Non-zero means half of invariant 6 was NOT RUN;
 * see the comment at the check itself.
 */
let skippedHashResolutions = 0;

/* --------------------------------------------------- overclaim gates (F2) -- */

/**
 * Number words a finding might use for a publisher count, up to twelve.
 * A count can be written either way and both must be checked; "four publishers"
 * is exactly how M-010 was written.
 */
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** Distinct publishers named by a finding's own competing values. */
function competingPublishers(finding) {
  return new Set(
    (finding.competingValues || [])
      .map((entry) => entry?.source?.publisher)
      .filter((publisher) => typeof publisher === "string"),
  );
}

/** Distinct currencies in a finding's own competing values. */
function competingCurrencies(finding) {
  return new Set(
    (finding.competingValues || [])
      .map((entry) => entry?.value?.currency)
      .filter((currency) => typeof currency === "string"),
  );
}

/**
 * A finding may not state a ratio it computed across two currencies.
 *
 * MANUAL-TEST-REPORT M-003 / SECURITY-REVIEW SEC-007: F-002's headline "2.1x"
 * was 239,171 USD divided by 112,000 EUR, an implied rate of exactly 1.0. It was
 * rendered to users two lines below the sentence saying amounts in different
 * currencies are never converted.
 *
 * This does not merely look for the word "currency" near the number. It:
 *
 *   1. finds every multiplier token in the message (`2.1x`, `2,1-fach`);
 *   2. if the finding's competing values carry more than one currency, requires
 *      the multiplier to be qualified by a currency code in the same sentence;
 *   3. **recomputes** the ratio within that currency and requires the stated
 *      figure to match.
 *
 * Step 3 is what makes this a check rather than a lint. A message could satisfy
 * steps 1 and 2 by naming a currency beside a number that still came from a
 * cross-currency division; recomputing catches that.
 */
function checkNoCrossCurrencyRatio(finding) {
  const message = String(finding.message || "");
  const currencies = competingCurrencies(finding);

  // Every way this codebase writes a multiple, in the four locales it ships.
  //
  // `-fach` carries NO word boundary, deliberately. German inflects it:
  // "2,1-fache Spanne" has a letter straight after "fach", so `-fach\b` did
  // not match the exact string this project actually shipped in its German
  // search title. The negative control found that too.
  //
  // THE FIRST VERSION OF THIS PATTERN MATCHED ONLY `Nx` AND `N-fach`, AND THE
  // NEGATIVE CONTROL CAUGHT IT: `compose_f002_message()` writes "a factor of 2.8
  // within EUR alone", which has no `x` in it, so the gate would have skipped
  // the very sentence it exists to police. A corrupted build stating "a factor
  // of 9.9" passed with exit 0. Extended, and the control now fails it.
  const tokens = [
    ...message.matchAll(
      /(?:factor(?:\s+of)?|faktor|kat|раз(?:а|)|multiple\s+of)\s+(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:[x×]\b|-fach|\s+times\b)/gi,
    ),
  ].map((match) => ({
    // One of the two capture groups fires, never both.
    text: match[0],
    value: match[1] ?? match[2],
    index: match.index,
  }));
  if (tokens.length === 0) return;

  // One currency in the record: any ratio is necessarily within it.
  if (currencies.size <= 1) return;

  for (const token of tokens) {
    const stated = Number(String(token.value).replace(",", "."));

    // The sentence the token sits in. Ratios are qualified locally or not at all.
    //
    // BOUNDARIES ARE ". " AND NOT ".", because a decimal point is a full stop to
    // a naive split: "a factor of 2.8 within EUR alone" cut at the first "." and
    // yielded "That is a factor of 2", which contains no currency code, and the
    // gate then reported its own correct message as a violation. Found by
    // running the gate against the artefact rather than by reading it.
    const before = message.lastIndexOf(". ", token.index);
    const start = before === -1 ? 0 : before + 2;
    const after = message.indexOf(". ", token.index);
    const sentence = message.slice(start, after === -1 ? message.length : after);

    const named = [...currencies].filter((currency) =>
      sentence.includes(currency),
    );
    if (named.length !== 1) {
      fail(
        "finding-cross-currency-ratio",
        finding.id,
        `message states "${token.text.trim()}" while competingValues carry ${[...currencies].sort().join(" + ")}, and the sentence names ${named.length === 0 ? "no currency" : `${named.length} currencies`}. A ratio spanning currencies is a conversion at an invented rate (CONVENTIONS §5).`,
      );
      continue;
    }

    const currency = named[0];
    const amounts = (finding.competingValues || [])
      .filter((entry) => entry?.value?.currency === currency)
      .map((entry) => entry?.value?.amount)
      .filter((amount) => typeof amount === "number" && amount > 0);
    if (amounts.length < 2) continue;

    // The message may legitimately restrict the ratio to a subset (F-002 uses
    // the rows whose publisher states a 1+1 layout), so the stated figure must
    // fall inside the full within-currency span rather than equal its extremes.
    const widest = Math.max(...amounts) / Math.min(...amounts);
    if (stated > widest + 0.05) {
      fail(
        "finding-ratio-exceeds-record",
        finding.id,
        `message states a factor of ${stated} in ${currency}, but the widest ${currency} span in its own competingValues is ${widest.toFixed(2)}. A ratio larger than the record supports cannot have been computed from it.`,
      );
    }
  }
}

/**
 * A publisher count stated in a message must equal the count in the record.
 *
 * MANUAL-TEST-REPORT M-010: F-002 said "across four publishers" while carrying
 * nineteen observations from six. SECURITY-REVIEW SEC-006 recorded the same
 * drift and was itself wrong in the other direction ("carries three"). Three
 * documents disagreed about one array, because the number was maintained by hand
 * beside data rebuilt on every harvest.
 *
 * `build-azura-dataset.py` now composes F-002's message from its own
 * competingValues, so the two cannot disagree. This gate is what keeps that true
 * for every finding, including ones a later window writes by hand.
 */
function checkPublisherCountMatchesRecord(finding) {
  const message = String(finding.message || "");
  const publishers = competingPublishers(finding);
  if (publishers.size === 0) return;

  // ONLY COUNTING CONSTRUCTIONS. The first version of this pattern matched any
  // "<number> publishers" and immediately produced a WRONG finding: F-013 reads
  // "a stronger signal ... than two publishers disagreeing", which is a
  // rhetorical contrast, not a count of its own record. A check that cannot tell
  // a count from a comparison costs more than the drift it catches, which is the
  // reasoning SECURITY-REVIEW.md applies to narrowing its own SEC-006 pattern so
  // it would not report F-006.
  //
  // Requiring a counting preposition still catches the defect this gate exists
  // for, verbatim: M-010's message said "spans a 2.1x range ACROSS four
  // publishers", and F-002's composed replacement says "from 6 publishers".
  const pattern = new RegExp(
    String.raw`\b(?:across|from|among|by|over)\s+(\d+|${Object.keys(NUMBER_WORDS).join("|")})\s+(?:distinct\s+|different\s+|separate\s+)?publishers\b`,
    "gi",
  );

  for (const match of message.matchAll(pattern)) {
    const raw = String(match[1]).toLowerCase();
    const stated = NUMBER_WORDS[raw] ?? Number(raw);
    if (!Number.isFinite(stated)) continue;
    if (stated !== publishers.size) {
      fail(
        "finding-publisher-count",
        finding.id,
        `message says "${match[0]}" but competingValues carry ${publishers.size} distinct publishers (${[...publishers].sort().join(", ")}). Compose the count from the record instead of typing it.`,
      );
    }
  }
}

/**
 * Remove comments from TypeScript source, leaving string literals intact.
 *
 * WITHOUT THIS THE SWEEP REPORTS ITS OWN DOCUMENTATION. The seed file explains
 * the fix by quoting the sentence that was removed, and a scanner that treats
 * any quoted run as a literal flagged that comment as a live overclaim. That is
 * the second false positive this exercise produced, and both had the same
 * shape: a pattern that could not tell what kind of text it was reading.
 * `check-plain-language.mjs` strips comments for the same reason and says so.
 *
 * A small hand scanner rather than a regex: a regex cannot tell `//` inside a
 * URL string from the start of a comment, and this file is full of URLs.
 */
function stripComments(source) {
  let out = "";
  let index = 0;
  const n = source.length;

  while (index < n) {
    const char = source[index];

    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      out += char;
      index += 1;
      while (index < n) {
        if (source[index] === "\\") {
          out += source[index] + (source[index + 1] ?? "");
          index += 2;
          continue;
        }
        out += source[index];
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (char === "/" && source[index + 1] === "/") {
      while (index < n && source[index] !== "\n") index += 1;
      continue;
    }

    if (char === "/" && source[index + 1] === "*") {
      index += 2;
      while (index < n && !(source[index] === "*" && source[index + 1] === "/")) {
        // Newlines are kept so nothing downstream depends on line numbers
        // shifting; everything else in the comment is dropped.
        if (source[index] === "\n") out += "\n";
        index += 1;
      }
      index += 2;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

/**
 * Files that carry findings as HAND-WRITTEN prose rather than as generated
 * output, and are therefore not covered by the checks above.
 *
 * ## Why this list exists at all
 *
 * This validator was built to read the emitted artefact, and that was the right
 * instinct. But `apps/web/lib/evidence-data.ts` also carries an F-002, written
 * by hand, with its own message and its own three competing values. **Nothing
 * checked it, and it held the same overclaim for two days after the artefact
 * was fixed.**
 *
 * It is also why two reviews disagreed about one number: SECURITY-REVIEW SEC-006
 * read this file and reported "claims four publishers and carries three";
 * MANUAL-TEST-REPORT M-010 read the generated dataset and reported six. Both
 * were right about the file they read. Neither noticed there were two.
 */
const SEED_FILES = [path.join(ROOT, "apps", "web", "lib", "evidence-data.ts")];

const CURRENCY_CODES = ["EUR", "USD", "TRY", "GBP"];

/**
 * `message: "…"`, `title: "…"`, and the other prose fields, across line breaks.
 *
 * Built with `new RegExp` and `String.raw` rather than written as a literal, and
 * that is not a style choice. As a literal this pattern silently matched
 * NOTHING at runtime while reading correctly in every editor and in `git diff`,
 * and the gate reported success over a file that contained the defect. Given
 * this validator's whole purpose is to not be fooled by something that looks
 * right, a construction whose escaping is visible in one place is the safer
 * one.
 *
 * A prose field is anchored by name rather than by scanning for long quoted
 * runs, because one stray quote anywhere earlier in a TypeScript file flips the
 * parity of every quote after it. Flat quote-pairing is not a parser and should
 * not pretend to be one.
 */
const PROSE_FIELD = new RegExp(
  String.raw`(?:message|title|summary|resolution|note)\s*:\s*"((?:[^"\\]|\\.)*)"`,
  "g",
);

/**
 * Text-level sweep for a multiplier stated across two currencies, in files whose
 * findings are prose rather than data.
 *
 * This is deliberately weaker than `checkNoCrossCurrencyRatio`: there is no
 * `competingValues` array to recompute against, so it cannot verify arithmetic.
 * What it can do is refuse the shape of the defect — a multiple stated inside a
 * string that names two currencies, without the multiple being scoped to one of
 * them in its own sentence.
 *
 * KNOWN LIMIT, stated rather than papered over: it reasons about one string
 * literal at a time. The same seed carried "2,1-fache Spanne über vier Portale"
 * as a search TITLE with the amounts in a separate SUMMARY field, and this sweep
 * would not have joined the two. That instance was found by reading, and is
 * fixed; a title-plus-summary rule would need the object graph this check
 * deliberately does not parse.
 */
async function checkSeedFiles() {
  for (const file of SEED_FILES) {
    if (!existsSync(file)) {
      fail("seed-file-missing", path.relative(ROOT, file), "expected to scan this file");
      continue;
    }
    // Comments stripped first: this file documents the defect by quoting it.
    const source = stripComments(await readFile(file, "utf8"));

    // `PROSE_FIELD` carries a `g` flag and is module-scoped, so `lastIndex`
    // is reset before each file; otherwise a second file would resume from
    // wherever the first one stopped.
    PROSE_FIELD.lastIndex = 0;
    for (const match of source.matchAll(PROSE_FIELD)) {
      const text = match[1].replace(/\\"/g, '"');
      // `String.raw` already passes the backslash through, so this is `\b` and
      // not `\\b`. It was `\\b` for one revision, which compiles to "a literal
      // backslash followed by b", matched nothing, and made the whole gate a
      // no-op that reported success. The negative control below is the only
      // reason that was caught.
      const currencies = CURRENCY_CODES.filter((code) =>
        new RegExp(String.raw`\b${code}\b`).test(text),
      );
      if (currencies.length < 2) continue;

      const tokens = [
        ...text.matchAll(
          /(?:factor(?:\s+of)?|faktor|multiple\s+of)\s+(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:[x×]\b|-fach|\s+times\b)/gi,
        ),
      ];
      for (const token of tokens) {
        const before = text.lastIndexOf(". ", token.index);
        const after = text.indexOf(". ", token.index);
        const sentence = text.slice(
          before === -1 ? 0 : before + 2,
          after === -1 ? text.length : after,
        );
        const named = currencies.filter((code) =>
          new RegExp(String.raw`\b${code}\b`).test(sentence),
        );
        if (named.length !== 1) {
          fail(
            "seed-cross-currency-ratio",
            path.relative(ROOT, file),
            `a string states "${token[0].trim()}" and names ${currencies.join(" + ")}; the sentence carrying the multiple names ${named.length === 0 ? "no currency" : `${named.length} currencies`}. Scope the ratio to one currency or drop it (CONVENTIONS §5).`,
          );
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ input -- */

/**
 * Pull the dataset literal out of the generated module. Deliberately not an
 * import: this must run before the workspace has a toolchain (W0-A owns
 * dependency installation) and must not execute generated code to inspect it.
 */
function extractDataset(source) {
  const marker = "export const azuraWorldDataset =";
  const start = source.indexOf(marker);
  if (start === -1) throw new Error("azuraWorldDataset export not found");
  const open = source.indexOf("{", start);
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(open, i + 1));
    }
  }
  throw new Error("unterminated dataset literal");
}

async function walk(dir) {
  const out = [];
  let items;
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/** sha256 of every stored snapshot, computed here, from the bytes on disk. */
async function snapshotHashes() {
  const files = (await walk(RAW_DIR)).filter((f) => f.endsWith(".html"));
  const hashes = new Map();
  for (const file of files) {
    const buf = await readFile(file);
    hashes.set(
      createHash("sha256").update(buf).digest("hex"),
      path.relative(ROOT, file),
    );
  }
  return hashes;
}

/* ------------------------------------------------------------- fact checks -- */

const isFact = (node) =>
  node &&
  typeof node === "object" &&
  !Array.isArray(node) &&
  "confidence" in node &&
  "sources" in node;

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The six invariants from CONTRACTS.md §1.
 *
 * W0-A owns `assertFactInvariants` in apps/web/lib/contracts.ts. It does not
 * exist yet, and this validator must be runnable now, so the rules are
 * implemented here against the same specification. When W0-A lands, this should
 * delegate rather than keep a second copy — recorded as a request in HANDOFF/W0-B.md.
 */
function checkFact(pathLabel, fact, hashes) {
  const { value, sources = [], confidence, conflictsWith, note } = fact;

  if (
    ![
      "confirmed",
      "official",
      "single_source",
      "conflicted",
      "inferred",
      "gap",
    ].includes(confidence)
  ) {
    fail("confidence-enum", pathLabel, `unknown confidence "${confidence}"`);
  }

  // 1. gap ⟹ value null AND note non-empty
  if (confidence === "gap") {
    if (value !== null)
      fail(
        "inv-1-gap-value",
        pathLabel,
        `gap with non-null value ${JSON.stringify(value)}`,
      );
    if (!note || !String(note).trim())
      fail("inv-1-gap-note", pathLabel, "gap without an explanatory note");
  }

  // 2. conflicted ⟹ conflictsWith.length >= 1
  if (
    confidence === "conflicted" &&
    !(Array.isArray(conflictsWith) && conflictsWith.length >= 1)
  ) {
    fail("inv-2-conflicted", pathLabel, "conflicted with empty conflictsWith");
  }

  // 3. confirmed ⟹ >= 2 sources with DISTINCT hosts
  if (confidence === "confirmed") {
    const hosts = new Set(sources.map((s) => hostOf(s.url)).filter(Boolean));
    if (sources.length < 2)
      fail(
        "inv-3-confirmed-count",
        pathLabel,
        `confirmed with ${sources.length} source(s)`,
      );
    else if (hosts.size < 2)
      fail(
        "inv-3-confirmed-hosts",
        pathLabel,
        `confirmed but all sources share host ${[...hosts].join(",")}`,
      );
  }

  // 4. inferred ⟹ note explains the computation
  if (confidence === "inferred" && (!note || !String(note).trim())) {
    fail(
      "inv-4-inferred-note",
      pathLabel,
      "inferred without a note explaining the derivation",
    );
  }

  // 5. sources.length === 0 only legal for gap
  if (sources.length === 0 && confidence !== "gap") {
    fail("inv-5-no-sources", pathLabel, `${confidence} with zero sources`);
  }

  // 6. every snapshotHash resolves to a real file under sources/raw/
  //
  // `sources/raw/*` is git-ignored on purpose — the harvested HTML is evidence,
  // not source, and committing 500+ scraped pages is what the ignore rule and
  // the secret-hygiene audit both exist to prevent. So the snapshots exist only
  // on a machine that has run the harvest, and this half of invariant 6 CANNOT
  // be evaluated in a fresh clone, which is what CI is.
  //
  // It is therefore skipped when there are no snapshots at all — counted, and
  // reported as NOT RUN rather than passing quietly. Skipping it silently would
  // turn the strongest check in this file, "the hash in the dataset matches the
  // bytes we actually fetched", into a green tick that means nothing.
  //
  // The other half — "a source carries no snapshotHash at all" — is a property
  // of the DATA, not of the disk, so it always runs.
  const canResolveHashes = hashes.size > 0;
  for (const source of sources) {
    if (!source?.snapshotHash) {
      fail(
        "inv-6-missing-hash",
        pathLabel,
        `source ${source?.url} has no snapshotHash`,
      );
      continue;
    }
    if (!canResolveHashes) {
      skippedHashResolutions += 1;
    } else if (!hashes.has(source.snapshotHash)) {
      fail(
        "inv-6-unresolvable",
        pathLabel,
        `snapshotHash ${String(source.snapshotHash).slice(0, 16)}… (${source.url}) matches no file under sources/raw/`,
      );
    }
  }
  for (const conflict of conflictsWith || []) {
    const hash = conflict?.source?.snapshotHash;
    if (!hash) continue;
    if (!canResolveHashes) {
      skippedHashResolutions += 1;
    } else if (!hashes.has(hash)) {
      fail(
        "inv-6-unresolvable",
        `${pathLabel}.conflictsWith`,
        `snapshotHash ${String(hash).slice(0, 16)}… matches no stored file`,
      );
    }
  }

  // 7. Money amounts must be positive. A price of 0 is a bug; null is honest.
  const money =
    value && typeof value === "object" && "amount" in value ? value : null;
  if (money && !(Number(money.amount) > 0)) {
    fail(
      "money-non-positive",
      pathLabel,
      `amount ${money.amount} — 0 or negative is a parse bug, use null`,
    );
  }
  if (money && !["EUR", "USD", "TRY", "GBP"].includes(money.currency)) {
    fail("money-currency", pathLabel, `unknown currency ${money.currency}`);
  }
}

function walkFacts(node, label, hashes, seen = new Set()) {
  if (!node || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);

  if (isFact(node)) {
    checkFact(label, node, hashes);
    for (const [key, child] of Object.entries(node)) {
      if (key === "sources" || key === "conflictsWith" || key === "value")
        continue;
      walkFacts(child, `${label}.${key}`, hashes, seen);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child, index) =>
      walkFacts(child, `${label}[${index}]`, hashes, seen),
    );
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    walkFacts(child, label ? `${label}.${key}` : key, hashes, seen);
  }
}

function collectFacts(node, label, out = []) {
  if (!node || typeof node !== "object") return out;
  if (isFact(node)) {
    out.push([label, node]);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((child, index) =>
      collectFacts(child, `${label}[${index}]`, out),
    );
    return out;
  }
  for (const [key, child] of Object.entries(node))
    collectFacts(child, label ? `${label}.${key}` : key, out);
  return out;
}

/* ------------------------------------------------------------------- main -- */

async function main() {
  if (!existsSync(DATA_TS)) {
    console.error(
      `FATAL: ${path.relative(ROOT, DATA_TS)} not found — run the dataset build first.`,
    );
    process.exit(2);
  }

  const source = await readFile(DATA_TS, "utf8");
  let dataset;
  try {
    dataset = extractDataset(source);
  } catch (error) {
    console.error(
      `FATAL: could not read the dataset literal: ${error.message}`,
    );
    process.exit(2);
  }

  const hashes = await snapshotHashes();

  walkFacts(dataset.project, "project", hashes);
  walkFacts(dataset.hotel, "hotel", hashes);
  walkFacts(dataset.units, "units", hashes);
  walkFacts(dataset.reviews, "reviews", hashes);

  // Findings: resolvedTo set ⟹ resolution non-empty.
  for (const finding of dataset.findings || []) {
    if (finding.resolvedTo !== null && finding.resolvedTo !== undefined) {
      if (!finding.resolution || !String(finding.resolution).trim()) {
        fail(
          "finding-resolution",
          finding.id,
          "resolvedTo is set but resolution is empty",
        );
      }
    }
    if (!finding.message || !String(finding.message).trim()) {
      fail("finding-message", finding.id, "finding has no message");
    }
    if (
      !["critical", "high", "medium", "low", "info"].includes(finding.severity)
    ) {
      fail(
        "finding-severity",
        finding.id,
        `unknown severity ${finding.severity}`,
      );
    }
  }

  // Two overclaim gates, added by F2 after MANUAL-TEST-REPORT M-003 and M-010.
  // Both apply to EVERY finding, not only to F-002: the class of defect is "a
  // sentence that says more than its own data supports", and naming one finding
  // would leave the other 23 unguarded.
  for (const finding of dataset.findings || []) {
    checkNoCrossCurrencyRatio(finding);
    checkPublisherCountMatchesRecord(finding);
  }

  // The generated artefact is not the only place a finding is written.
  await checkSeedFiles();

  // F-002 must stay unresolved. It is named explicitly because it is the one
  // conflict a well-meaning later change is most likely to "tidy up" into a
  // single number, and that change would be indistinguishable from progress.
  const f002 = (dataset.findings || []).find((f) => f.id === "F-002");
  if (!f002)
    fail(
      "f002-missing",
      "F-002",
      "the 1+1 price conflict finding is absent from the dataset",
    );
  else if (f002.resolvedTo !== null) {
    fail(
      "f002-resolved",
      "F-002",
      `F-002 has been resolved to ${JSON.stringify(f002.resolvedTo)} — the 1+1 price spread must stay unresolved`,
    );
  }

  // Modelled units must never look sourced.
  for (const unit of dataset.units || []) {
    if (unit.dataQuality === "modelled") {
      const conf = unit.askingPrice?.confidence;
      if (!["inferred", "gap"].includes(conf)) {
        fail(
          "modelled-confidence",
          unit.id,
          `modelled unit with askingPrice.confidence "${conf}" — must be inferred or gap`,
        );
      }
      if ((unit.competingPrices || []).length) {
        fail(
          "modelled-competing",
          unit.id,
          "modelled unit carries competingPrices, which implies real observations",
        );
      }
    }
    if (unit.dataQuality === "portal_listing") {
      if (!(unit.askingPrice?.sources || []).length) {
        fail(
          "portal-listing-unsourced",
          unit.id,
          "portal_listing unit with no source",
        );
      }
      // The mirror of the modelled-unit rule, and the one that actually caught a
      // hole: relabelling a modelled unit as portal_listing escaped every other
      // check, because modelled units legitimately carry the sources their price
      // was derived FROM. A real listing has an observed price, never a derived
      // one, so the confidence is what distinguishes them — not the label.
      if (["inferred", "gap"].includes(unit.askingPrice?.confidence)) {
        fail(
          "portal-listing-derived-price",
          unit.id,
          `portal_listing unit with askingPrice.confidence "${unit.askingPrice?.confidence}" — ` +
            "a real listing has an observed price; this is a modelled unit wearing a listing label",
        );
      }
      if (!(unit.competingPrices || []).length) {
        fail(
          "portal-listing-no-observation",
          unit.id,
          "portal_listing unit with no observed price in competingPrices",
        );
      }
    }
  }

  /* ---------------------------------------------------------- coverage -- */

  const facts = [
    ...collectFacts(dataset.project, "project"),
    ...collectFacts(dataset.hotel, "hotel"),
    ...collectFacts(dataset.units, "units"),
    ...collectFacts(dataset.reviews, "reviews"),
  ];
  const byConfidence = {};
  for (const [, fact] of facts)
    byConfidence[fact.confidence] = (byConfidence[fact.confidence] || 0) + 1;

  const bySeverity = {};
  for (const finding of dataset.findings || [])
    bySeverity[finding.severity] = (bySeverity[finding.severity] || 0) + 1;

  const byStatus = {};
  for (const entry of dataset.harvest || []) {
    const key = entry.contentValidated ? "validated" : `failed:${entry.status}`;
    byStatus[key] = (byStatus[key] || 0) + 1;
  }

  const report = {
    ok: violations.length === 0,
    checkedAt: new Date().toISOString(),
    snapshotsOnDisk: hashes.size,
    // Non-zero ⟹ "inv-6-unresolvable" was NOT RUN. A consumer treating `ok`
    // as "everything was checked" must read this too.
    skippedHashResolutions,
    factsChecked: facts.length,
    factsByConfidence: byConfidence,
    findingsBySeverity: bySeverity,
    sourcesByStatus: byStatus,
    unitSplit: dataset.unitSplit,
    violations,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else if (!quiet) {
    const pad = (s, n) => String(s).padEnd(n);
    console.log(
      "verify-evidence · independent validation of apps/web/lib/azura-world-data.ts\n",
    );
    console.log(`  snapshots on disk (sha256 recomputed) : ${hashes.size}`);
    console.log(`  facts checked                         : ${facts.length}\n`);

    if (skippedHashResolutions > 0) {
      console.log(
        `  !! inv-6-unresolvable: NOT RUN — ${skippedHashResolutions} snapshotHash lookups\n` +
          "     skipped because sources/raw/ holds no snapshots. That directory is\n" +
          "     git-ignored, so a fresh clone (and CI) cannot check that a hash in the\n" +
          "     dataset matches the bytes that were actually fetched. Run `pnpm harvest`\n" +
          "     to get the evidence, then re-run this. Every other invariant DID run.\n",
      );
    }

    console.log("  facts by confidence");
    for (const key of [
      "confirmed",
      "official",
      "single_source",
      "conflicted",
      "inferred",
      "gap",
    ]) {
      if (byConfidence[key])
        console.log(
          `    ${pad(key, 16)} ${String(byConfidence[key]).padStart(5)}`,
        );
    }

    console.log("\n  sources by status");
    for (const [key, count] of Object.entries(byStatus).sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`    ${pad(key, 24)} ${String(count).padStart(4)}`);
    }

    console.log("\n  findings by severity");
    for (const key of ["critical", "high", "medium", "low", "info"]) {
      if (bySeverity[key])
        console.log(
          `    ${pad(key, 16)} ${String(bySeverity[key]).padStart(5)}`,
        );
    }

    console.log(
      `\n  units: ${dataset.unitSplit?.portalListing ?? "?"} portal_listing + ` +
        `${dataset.unitSplit?.modelled ?? "?"} modelled = ${dataset.unitSplit?.total ?? "?"}`,
    );

    if (violations.length) {
      console.log(`\n  VIOLATIONS: ${violations.length}\n`);
      const grouped = {};
      for (const v of violations) (grouped[v.rule] ||= []).push(v);
      for (const [rule, items] of Object.entries(grouped)) {
        console.log(`    ${rule}  (${items.length})`);
        for (const item of items.slice(0, 8))
          console.log(`      ${item.where}: ${item.detail}`);
        if (items.length > 8)
          console.log(`      … and ${items.length - 8} more`);
      }
    } else {
      console.log("\n  no violations");
    }
  }

  process.exit(violations.length ? 1 : 0);
}

main().catch((error) => {
  console.error("FATAL:", error?.stack || error);
  process.exit(2);
});
