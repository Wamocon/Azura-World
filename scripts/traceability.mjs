#!/usr/bin/env node
/**
 * W4-D — acceptance-criteria traceability probe.
 *
 * The W4-D brief maps each acceptance criterion to a named e2e spec
 * (`e2e/evidence/sources.spec.ts`, `e2e/inventory/listings.spec.ts`,
 * `e2e/hotel/reviews.spec.ts`). **None of those files exists**: W4-A was never
 * started, `apps/web/playwright.config.ts` is absent and the e2e directory is
 * empty. So the criteria had no named proving test at all.
 *
 * Rather than record four unproven criteria, this file IS the named test. Every
 * assertion runs against a **production** server (`next build` + `next start`),
 * because that is the only place the CSP/prerender behaviour of S-009 is real —
 * `next dev` does not reproduce it, and a criterion proven only in dev is not
 * proven for a client demo.
 *
 * It deliberately does NOT replace the e2e matrix. It proves the four ticket
 * criteria and nothing else; role permutations, mobile viewports, layout and
 * a11y remain NOT RUN and are reported as such by `scripts/quality-gate.mjs`.
 *
 * Usage:
 *   node scripts/traceability.mjs                     # spawns its own server
 *   node scripts/traceability.mjs --base http://127.0.0.1:3211
 *   node scripts/traceability.mjs --json
 *   node scripts/traceability.mjs --out=quality/traceability.json
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const WEB = path.join(REPO, "apps", "web");

const argv = process.argv.slice(2);
const AS_JSON = argv.includes("--json");
const BASE =
  (argv.find((a) => a.startsWith("--base=")) ?? "").split("=")[1] ??
  argvPair("--base");
const OUT =
  (argv.find((a) => a.startsWith("--out=")) ?? "").split("=")[1] ?? null;
const PORT = Number(argvPair("--port") ?? 3212);

function argvPair(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

const results = [];
let server = null;

function assert(ac, id, description, ok, evidence) {
  results.push({
    ac,
    id,
    description,
    ok: Boolean(ok),
    evidence: String(evidence),
  });
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: "manual" });
  const body = await res.text();
  return { status: res.status, location: res.headers.get("location"), body };
}

/** Occurrences, not matching lines — server HTML is effectively one line. */
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

async function waitForServer(base, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(base, { redirect: "manual" });
      if (res.status > 0) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  let base = BASE;

  if (!base) {
    if (!existsSync(path.join(WEB, ".next", "BUILD_ID"))) {
      console.error(
        "No production build at apps/web/.next — run `pnpm --dir apps/web build` first.",
      );
      process.exit(2);
    }
    server = spawn(
      "npx",
      ["next", "start", "--hostname", "127.0.0.1", "--port", String(PORT)],
      {
        cwd: WEB,
        shell: true,
        stdio: "ignore",
      },
    );
    base = `http://127.0.0.1:${PORT}`;
    if (!(await waitForServer(base))) {
      console.error(`Server did not come up on ${base}`);
      if (server) server.kill();
      process.exit(2);
    }
  }

  // ── AC1 — a CATI exists and serves ──────────────────────────────────────
  const root = await fetchText(`${base}/`);
  assert(
    "AC1",
    "AC1.1",
    "`/` redirects to the default locale `/de`",
    root.status === 307 && /\/de$/.test(root.location ?? ""),
    `HTTP ${root.status} → ${root.location}`,
  );

  const landing = await fetchText(`${base}/de`);
  assert(
    "AC1",
    "AC1.2",
    "landing route serves 200 from a production server",
    landing.status === 200,
    `HTTP ${landing.status}, ${landing.body.length} bytes`,
  );
  assert(
    "AC1",
    "AC1.3",
    "landing HTML is a real document, not an error shell",
    landing.body.length > 50_000 && !/__next_error__/.test(landing.body),
    `${landing.body.length} bytes, no __next_error__ marker`,
  );

  const hotel = await fetchText(`${base}/de/hotel`);
  assert(
    "AC1",
    "AC1.4",
    "public hotel route serves 200",
    hotel.status === 200,
    `HTTP ${hotel.status}, ${hotel.body.length} bytes`,
  );

  const guarded = await fetchText(`${base}/de/dashboard`);
  assert(
    "AC1",
    "AC1.5",
    "protected route redirects to login rather than leaking (route guard live in prod)",
    guarded.status === 307 && /\/login\?next=/.test(guarded.location ?? ""),
    `HTTP ${guarded.status} → ${guarded.location}`,
  );

  const unknownLocale = await fetchText(`${base}/xx/dashboard`);
  assert(
    "AC1",
    "AC1.6",
    "unknown locale 404s rather than silently serving German",
    unknownLocale.status === 404,
    `HTTP ${unknownLocale.status}`,
  );

  // ── AC2 — the important sources and links are carried ───────────────────
  // "berücksichtigen" is only satisfied if the SOURCE URL reaches the user, so
  // these assert on rendered anchors, not on the dataset behind them.
  const httpsLinks = count(landing.body, "https://");
  assert(
    "AC2",
    "AC2.1",
    "landing page renders outbound source links",
    httpsLinks >= 50,
    `${httpsLinks} https:// occurrences in server HTML`,
  );

  const tier123 = ["azuraworld.com", "cebecigroup"];
  const tier123Found = tier123.filter((h) => count(landing.body, h) > 0);
  assert(
    "AC2",
    "AC2.2",
    "official/developer sources (tier 1-2) are cited on the landing page",
    tier123Found.length === tier123.length,
    `${tier123Found.join(", ") || "none"}`,
  );

  const confidenceVocab = ["Nicht belegt", "Quellen"];
  const vocabFound = confidenceVocab.filter((v) => count(landing.body, v) > 0);
  assert(
    "AC2",
    "AC2.3",
    "provenance vocabulary is rendered (gaps are shown, not hidden)",
    vocabFound.length > 0,
    `${vocabFound.join(", ") || "none"} present`,
  );

  const evidenceGate = spawnSync("node", ["scripts/verify-evidence.mjs"], {
    cwd: REPO,
    shell: true,
    encoding: "utf8",
  });
  assert(
    "AC2",
    "AC2.4",
    "evidence invariants hold across the dataset (`verify-evidence.mjs`)",
    evidenceGate.status === 0,
    `exit ${evidenceGate.status} · ${/no violations/.test(evidenceGate.stdout ?? "") ? "no violations" : "violations present"}`,
  );

  // ── AC3 — property-portal information is included ───────────────────────
  const portals = [
    "terrarealestate",
    "housearch",
    "seaside-alanya",
    "alanya-home",
    "ivm-turkey",
    "hasporealty",
  ];
  const portalsFound = portals.filter((p) => count(landing.body, p) > 0);
  assert(
    "AC3",
    "AC3.1",
    "property portals are cited on the landing page",
    portalsFound.length >= 3,
    `${portalsFound.length}/${portals.length}: ${portalsFound.join(", ")}`,
  );

  const unitSplit =
    /(\d+)\s+portal_listing\s*\+\s*(\d+)\s+modelled\s*=\s*(\d+)/.exec(
      evidenceGate.stdout ?? "",
    );
  assert(
    "AC3",
    "AC3.2",
    "portal listings are distinguished from modelled records in the dataset",
    Boolean(unitSplit) && Number(unitSplit[1]) > 0,
    unitSplit
      ? `${unitSplit[1]} portal_listing + ${unitSplit[2]} modelled = ${unitSplit[3]}`
      : "split not reported",
  );

  // ── AC4 — reviews and hotel booking sources ─────────────────────────────
  const reviewPlatforms = ["tripadvisor", "booking.com", "agoda", "onthebeach"];
  const reviewFound = reviewPlatforms.filter((p) => count(hotel.body, p) > 0);
  assert(
    "AC4",
    "AC4.1",
    "review and booking platforms are cited on the public hotel page",
    reviewFound.length >= 3,
    `${reviewFound.length}/${reviewPlatforms.length}: ${reviewFound.map((p) => `${p}×${count(hotel.body, p)}`).join(", ")}`,
  );

  const hotelLinks = count(hotel.body, "https://");
  assert(
    "AC4",
    "AC4.2",
    "hotel page links out to the booking/review sources",
    hotelLinks >= 20,
    `${hotelLinks} https:// occurrences`,
  );

  assert(
    "AC4",
    "AC4.3",
    "Tripadvisor is cited repeatedly, not once in passing",
    count(hotel.body, "tripadvisor") >= 5,
    `${count(hotel.body, "tripadvisor")} occurrences`,
  );

  if (server) server.kill();

  // ── report ──────────────────────────────────────────────────────────────
  const acs = ["AC1", "AC2", "AC3", "AC4"];
  const byAc = acs.map((ac) => {
    const items = results.filter((r) => r.ac === ac);
    const failed = items.filter((r) => !r.ok);
    return {
      ac,
      total: items.length,
      passed: items.length - failed.length,
      failed: failed.length,
      met: failed.length === 0,
    };
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    base,
    servedFrom: "next start (production build)",
    acs: byAc,
    assertions: results,
    totals: {
      assertions: results.length,
      passed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    },
  };

  if (OUT) {
    const abs = path.isAbsolute(OUT) ? OUT : path.join(REPO, OUT);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify(summary, null, 2));
  }

  if (AS_JSON) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(
      `\nTraceability probe — production server at ${base}\n${"─".repeat(104)}\n`,
    );
    for (const r of results) {
      process.stdout.write(
        `${r.ok ? "PASS" : "FAIL"}  ${r.id.padEnd(7)} ${r.description.slice(0, 62).padEnd(64)} ${r.evidence.slice(0, 30)}\n`,
      );
    }
    process.stdout.write(`${"─".repeat(104)}\n`);
    for (const a of byAc) {
      process.stdout.write(
        `${a.ac}: ${a.met ? "MET" : "NOT MET"}  (${a.passed}/${a.total} assertions passed)\n`,
      );
    }
    process.stdout.write(
      `\n${summary.totals.passed} pass · ${summary.totals.failed} fail\n`,
    );
  }

  process.exit(summary.totals.failed === 0 ? 0 : 1);
}

main().catch((e) => {
  if (server) server.kill();
  console.error("traceability.mjs failed:", e);
  process.exit(2);
});
