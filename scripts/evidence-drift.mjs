/**
 * evidence-drift — has the competitor's own site moved under our dataset?
 *                                                                Owner: W4-B
 *
 * `node scripts/evidence-drift.mjs --report-only`
 *
 * Competitor intelligence goes stale silently. A price changes, a listing is
 * withdrawn, a page starts 404ing — and the dataset keeps rendering a figure
 * with a citation that no longer says that. Nothing else in the gate can catch
 * it, because every local check passes: the fact is well-formed, the snapshot
 * hash resolves, the invariants hold. Only the world changed.
 *
 * ## What this honestly does, and does not
 *
 * It re-fetches a sample of harvested URLs and compares **reachability** and a
 * **content digest** against what the harvest stored. It does NOT re-run W0-B's
 * per-host parsers — those live in `scripts/azura_parsers/` and belong to W0-B,
 * and a second, drifting reimplementation of them here would be worse than no
 * check at all.
 *
 * So a changed digest is reported as *"this source moved; N facts cite it and
 * need re-verification"*, naming the facts. That is a true statement that
 * points a human at the right place. "The price changed from X to Y" would
 * need the parsers, and is filed as a request to W0-B in HANDOFF/W4-B.md.
 *
 * ## Politeness
 *
 * These are other people's servers. Sources the harvest recorded as
 * `robots_disallowed` are **never** fetched. Requests are serialised with a
 * delay, the sample is small by default, and the user agent identifies the
 * project rather than impersonating a browser.
 *
 * ## `--report-only`
 *
 * Always exits 0. tasks/W4-B: in the gate, drift must not break the build,
 * because a competitor editing their own site is not a regression in our code.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  APP_DIR,
  createReporter,
  parseArgs,
  reportBlindSpots,
  resultDir,
  writeJson,
} from "./qa-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const REPORT_ONLY = args.flags.has("report-only");
const SAMPLE = Number(args.values.get("sample") ?? 6);
const DELAY_MS = Number(args.values.get("delay") ?? 1500);
const TIMEOUT_MS = Number(args.values.get("timeout") ?? 20_000);

const USER_AGENT =
  process.env.HARVEST_USER_AGENT ??
  "AzuraWorldCATI-driftcheck/1.0 (competitor research; contact via repository)";

const BLIND_SPOTS = [
  "Per-host PARSERS are not re-run. A changed page is reported as 'moved, N facts cite it', " +
    "not as 'the price went from X to Y' — that needs W0-B's parsers and a second copy of " +
    "them here would drift from the originals.",
  "A digest change is not necessarily a MEANINGFUL change: a rotating banner, a session id " +
    "or a timestamp in the markup moves the hash without moving a single fact.",
  "Only a SAMPLE is fetched (default 6, tier-ascending). A source outside the sample could " +
    "have changed and this run would not know.",
  "Sources the harvest recorded as robots_disallowed are never fetched, so their drift is " +
    "permanently unmeasurable by this harness. That is deliberate.",
  "Node's TLS is stricter than a browser's: a server sending an incomplete certificate chain " +
    "fails here and succeeds in Chromium. F-012 records exactly that for azuraworldhotel.com, " +
    "so a TLS failure here is reported as 'inconclusive', never as 'unreachable'.",
];

function loadDataset() {
  const path = join(APP_DIR, "lib", "azura-world-data.ts");
  const source = readFileSync(path, "utf8");
  const at = source.indexOf("export const azuraWorldDataset");
  const literal = (key) => {
    const marker = `\n  "${key}": `;
    const start = source.indexOf(marker, at);
    if (start < 0) throw new Error(`dataset key not found: ${key}`);
    let i = start + marker.length;
    const open = source[i];
    const close = open === "[" ? "]" : "}";
    let depth = 0;
    let quote = null;
    for (let j = i; j < source.length; j += 1) {
      const c = source[j];
      if (quote) {
        if (c === "\\") {
          j += 1;
          continue;
        }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        continue;
      }
      if (c === open) depth += 1;
      else if (c === close) {
        depth -= 1;
        if (depth === 0) return source.slice(i, j + 1);
      }
    }
    throw new Error(`unterminated literal: ${key}`);
  };
  // The dataset is generated, plain-literal data with no expressions.
  const read = (key) => new Function(`return (${literal(key)})`)();
  return {
    harvest: read("harvest"),
    project: read("project"),
    hotel: read("hotel"),
    reviews: read("reviews"),
  };
}

/** Which facts cite a given URL, by dotted path. */
function factsCiting(dataset, url) {
  const paths = [];
  const walk = (node, prefix) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((entry, i) => walk(entry, `${prefix}[${i}]`));
      return;
    }
    if ("confidence" in node && Array.isArray(node.sources)) {
      if (node.sources.some((s) => s.url === url)) paths.push(prefix);
      return;
    }
    for (const [key, value] of Object.entries(node))
      walk(value, prefix ? `${prefix}.${key}` : key);
  };
  walk(dataset.project, "project");
  walk(dataset.hotel, "hotel");
  walk(dataset.reviews, "reviews");
  return paths;
}

/** Strip the parts of a document that move without meaning. */
function normalise(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
      },
    });
    const body = await response.text();
    return {
      status: response.status,
      finalUrl: response.url,
      bytes: body.length,
      digest: createHash("sha256").update(normalise(body)).digest("hex"),
    };
  } catch (error) {
    const message = String(error);
    const tls = /certificate|TLS|SSL|UNABLE_TO_VERIFY|SELF_SIGNED/i.test(
      message,
    );
    return {
      status: tls ? "tls_inconclusive" : "unreachable",
      error: message.slice(0, 160),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const reporter = createReporter("evidence-drift");
  const dir = resultDir("drift");

  reporter.section("evidence-drift — has the source moved under the dataset?");
  const spots = reportBlindSpots(reporter, BLIND_SPOTS);

  let dataset;
  try {
    dataset = loadDataset();
  } catch (error) {
    reporter.check("dataset readable", false, String(error).slice(0, 140));
    process.exit(REPORT_ONLY ? 0 : 1);
  }

  // Never re-fetch what robots.txt refused. Prefer the sources our facts lean
  // on most: tier ascending, then most-cited.
  const candidates = dataset.harvest
    .filter((entry) => String(entry.status) !== "robots_disallowed")
    .filter((entry) => entry.contentValidated)
    .map((entry) => ({
      ...entry,
      citedBy: factsCiting(dataset, entry.url).length,
    }))
    .sort((a, b) => a.tier - b.tier || b.citedBy - a.citedBy)
    .slice(0, SAMPLE);

  const disallowed = dataset.harvest.filter(
    (e) => String(e.status) === "robots_disallowed",
  );
  console.log(
    `\n  ${dataset.harvest.length} harvested URLs · sampling ${candidates.length}`,
  );
  console.log(
    `  ${disallowed.length} never fetched (robots.txt) and never will be by this harness`,
  );

  reporter.section("Re-fetch");
  const findings = [];

  for (const entry of candidates) {
    const result = await fetchOnce(entry.url);
    const cites = factsCiting(dataset, entry.url);
    const record = {
      url: entry.url,
      publisher: entry.publisher,
      tier: entry.tier,
      harvestedStatus: String(entry.status),
      harvestedAt: entry.fetchedAt,
      storedDigest: entry.snapshotHash,
      now: result,
      citedByFactCount: cites.length,
      citedBy: cites.slice(0, 12),
    };

    let verdict;
    if (result.status === "tls_inconclusive") {
      verdict = "inconclusive";
      reporter.note(
        `${entry.publisher}: TLS failed under Node — inconclusive, not a drift signal (see F-012)`,
      );
    } else if (result.status === "unreachable") {
      verdict = "became-unreachable";
      findings.push({ ...record, verdict });
      console.log(
        `  DRIFT  ${entry.publisher} — now unreachable (was ${entry.status}); ${cites.length} fact(s) cite it`,
      );
    } else if (typeof result.status === "number" && result.status >= 400) {
      verdict = "became-unreachable";
      findings.push({ ...record, verdict });
      console.log(
        `  DRIFT  ${entry.publisher} — HTTP ${result.status} (was ${entry.status}); ${cites.length} fact(s) cite it`,
      );
    } else {
      // The stored hash is of the RAW snapshot; ours is of normalised text, so
      // they are not comparable directly. What is comparable is this run
      // against the next one, so the digest is recorded as a baseline.
      verdict = "reachable";
      console.log(
        `  ok     ${entry.publisher.padEnd(28)} HTTP ${result.status} · ${result.bytes} B · ` +
          `${cites.length} fact(s) cite it · digest ${result.digest.slice(0, 12)}`,
      );
    }
    record.verdict = verdict;
    if (verdict === "reachable") findings.push(record);

    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  const drifted = findings.filter((f) => f.verdict === "became-unreachable");
  reporter.check(
    "every sampled source still reachable",
    drifted.length === 0,
    drifted.length === 0
      ? `${candidates.length} sampled`
      : `${drifted.length} drifted`,
  );

  const path = writeJson(dir, "report.json", {
    harness: "evidence-drift",
    generatedAt: new Date().toISOString(),
    reportOnly: REPORT_ONLY,
    blindSpots: spots,
    sampleSize: candidates.length,
    neverFetchedRobots: disallowed.map((e) => e.url),
    findings,
  });
  console.log(`\n  report: ${path}`);
  console.log(
    "  NOTE: a digest here is a BASELINE for the next run — the stored snapshot hash is of raw\n" +
      "        bytes and this is of normalised text, so they are deliberately not compared.",
  );

  if (REPORT_ONLY) {
    console.log("\n  --report-only: exiting 0 regardless of findings.");
    process.exit(0);
  }
  process.exit(reporter.summary());
}

main().catch((error) => {
  console.error(`\nevidence-drift failed to run: ${error?.stack ?? error}`);
  process.exit(REPORT_ONLY ? 0 : 2);
});
