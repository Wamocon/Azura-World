/**
 * phase-harness — runs the gates a given wave is actually gated on.
 *                                                                Owner: W4-B
 *
 * `node scripts/phase-harness.mjs --wave 4 --profile full`
 *
 * ORCHESTRATION §5 defines a wave gate as: every handoff exists, none is
 * blocked, the tree compiles, nothing was written outside ownership. This runs
 * the executable half of that and records the result under
 * `quality/results/wave-<n>/`.
 *
 * ## Why the wave→gate mapping is data, not code
 *
 * Each wave is gated on different things — there is no point running a layout
 * audit at wave 0 when no route exists, and no point pretending a wave-4 pass
 * means anything without one. The table below is the whole policy, so changing
 * it is a one-line diff a reviewer can see.
 *
 * ## Exit codes
 *
 * Non-zero if any required gate fails. `--profile smoke` runs the fast subset
 * for an inner loop; `full` is what a wave gate means. Every gate's exit code
 * is captured **from the process**, never inferred from its output — piping a
 * status through `tail` is the mistake CONVENTIONS §8 records by name.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

import {
  ROOT,
  createReporter,
  parseArgs,
  resultDir,
  writeJson,
} from "./qa-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const WAVE = args.values.get("wave");
const PROFILE = args.values.get("profile") ?? "smoke";

/**
 * `required: false` means the gate runs and is reported but does not fail the
 * wave — used where the target legitimately does not exist yet, so a wave gate
 * says "NOT RUN, and here is why" instead of going red for a known absence.
 */
const GATES = {
  typecheck: {
    cmd: ["pnpm", "--dir", "apps/web", "typecheck"],
    profiles: ["smoke", "full"],
  },
  lint: {
    cmd: ["pnpm", "--dir", "apps/web", "lint"],
    profiles: ["smoke", "full"],
  },
  build: { cmd: ["pnpm", "--dir", "apps/web", "build"], profiles: ["full"] },
  contracts: { cmd: ["pnpm", "smoke:contracts"], profiles: ["smoke", "full"] },
  evidence: { cmd: ["pnpm", "qa:evidence"], profiles: ["smoke", "full"] },
  i18n: {
    cmd: ["node", "scripts/check-i18n.mjs"],
    profiles: ["smoke", "full"],
  },
  csp: { cmd: ["pnpm", "qa:csp"], profiles: ["full"] },
  layout: { cmd: ["node", "scripts/layout-audit.mjs"], profiles: ["full"] },
  perf: { cmd: ["node", "scripts/perf.mjs", "--no-soak"], profiles: ["full"] },
  a11y: { cmd: ["node", "scripts/a11y-audit.mjs"], profiles: ["full"] },
  browser: { cmd: ["node", "scripts/browser-audit.mjs"], profiles: ["full"] },
  drift: {
    cmd: ["node", "scripts/evidence-drift.mjs", "--report-only"],
    profiles: ["full"],
    required: false,
  },
};

/** ORCHESTRATION §2's wave map, as gates. */
const WAVE_GATES = {
  0: ["typecheck", "lint", "contracts", "evidence"],
  1: ["typecheck", "lint", "contracts", "evidence", "i18n"],
  2: ["typecheck", "lint", "build", "contracts", "evidence", "i18n"],
  3: [
    "typecheck",
    "lint",
    "build",
    "contracts",
    "evidence",
    "i18n",
    "csp",
    "browser",
  ],
  4: [
    "typecheck",
    "lint",
    "build",
    "contracts",
    "evidence",
    "i18n",
    "csp",
    "layout",
    "perf",
    "a11y",
    "browser",
    "drift",
  ],
  5: [
    "typecheck",
    "lint",
    "build",
    "contracts",
    "evidence",
    "i18n",
    "csp",
    "layout",
    "perf",
    "a11y",
    "browser",
    "drift",
  ],
};

function run(name, gate) {
  const [command, ...rest] = gate.cmd;
  const started = Date.now();
  // `shell: true` on Windows so `pnpm` resolves; every argument is still passed
  // as an array element, so a path containing a space is never re-split.
  const result = spawnSync(command, rest, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return {
    name,
    cmd: gate.cmd.join(" "),
    exitCode: result.status,
    signal: result.signal ?? null,
    required: gate.required !== false,
    durationMs: Date.now() - started,
  };
}

async function main() {
  if (WAVE === undefined || !(WAVE in WAVE_GATES)) {
    console.error(
      `usage: node scripts/phase-harness.mjs --wave <0-5> [--profile smoke|full]`,
    );
    process.exit(2);
  }
  if (!["smoke", "full"].includes(PROFILE)) {
    console.error(`--profile must be "smoke" or "full"`);
    process.exit(2);
  }

  const reporter = createReporter(`phase-harness wave ${WAVE} (${PROFILE})`);
  const names = WAVE_GATES[WAVE].filter((name) =>
    GATES[name].profiles.includes(PROFILE),
  );

  reporter.section(
    `Wave ${WAVE} · profile ${PROFILE} · ${names.length} gate(s)`,
  );
  console.log(`  ${names.join(", ")}`);
  const skipped = WAVE_GATES[WAVE].filter((name) => !names.includes(name));
  if (skipped.length > 0) {
    console.log(`  not in this profile: ${skipped.join(", ")}`);
  }

  const results = [];
  for (const name of names) {
    reporter.section(`gate: ${name}`);
    const result = run(name, GATES[name]);
    results.push(result);
    const ok = result.exitCode === 0;
    reporter.check(
      `${name} (${GATES[name].cmd.join(" ")})`,
      ok || !result.required,
      `exit=${result.exitCode}${result.required ? "" : " — advisory, does not gate"} · ${(result.durationMs / 1000).toFixed(1)}s`,
    );
  }

  const dir = resultDir(join("results", `wave-${WAVE}`));
  const path = writeJson(dir, "gates.json", {
    harness: "phase-harness",
    wave: Number(WAVE),
    profile: PROFILE,
    generatedAt: new Date().toISOString(),
    gatesRun: names,
    gatesSkippedByProfile: skipped,
    results,
    totalMs: results.reduce((sum, r) => sum + r.durationMs, 0),
  });

  reporter.section("Wave summary");
  for (const result of results) {
    const mark =
      result.exitCode === 0 ? "ok  " : result.required ? "FAIL" : "warn";
    console.log(
      `  ${mark}  ${result.name.padEnd(12)} exit=${String(result.exitCode).padStart(3)}  ${(result.durationMs / 1000).toFixed(1)}s`,
    );
  }
  console.log(`\n  report: ${path}`);

  process.exit(reporter.summary());
}

main().catch((error) => {
  console.error(`\nphase-harness failed to run: ${error?.stack ?? error}`);
  process.exit(2);
});
