#!/usr/bin/env node
/**
 * W2-D acceptance suite — mode resolution, backoff, coalescing, and the PWA
 * caching boundary.
 *
 *   node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs \
 *        scripts/realtime-probe.mts
 *
 * ## What this proves, and what it does not
 *
 * The brief's nine numbered checks split cleanly. Six are decisions —
 * "which mode, given this state", "how long until the next reconnect", "does
 * this URL get cached" — and those are proved here, exhaustively, because
 * `lib/realtime.ts` and `lib/pwa.ts` hold them as pure functions rather than
 * burying them in a hook.
 *
 * Three need a live browser: a channel actually closing on unmount, a real
 * Cache Storage enumeration, and a real socket dropping mid-session. Those are
 * **NOT RUN** here and are named as such in HANDOFF/W2-D.md rather than being
 * approximated by something that looks like a test and is not. There is no
 * Playwright config in this repository yet (W4-A owns it).
 *
 * Test 8 — "the service worker caches no /dashboard/* URL" — is the privacy
 * control, and it is proved *better* than by enumerating one runtime cache: the
 * predicate is exercised against every protected pattern, in all four locales,
 * plus the near-misses that a sloppier deny-list would let through.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  BACKOFF_CAP_MS,
  COALESCE_WINDOW_MS,
  REALTIME_TABLES,
  backoffSequence,
  createCoalescer,
  isRealtimeTable,
  isStale,
  nextBackoffDelay,
  relativeAge,
  resolveLiveMode,
  shouldPoll,
  type LiveMode,
  type RealtimeStatus,
} from "../apps/web/lib/realtime.ts";
import {
  PROTECTED_PATH_PATTERNS,
  cacheStrategyFor,
  currentCacheNames,
  isProtectedPath,
} from "../apps/web/lib/pwa.ts";
import { resolveMutationOutcome } from "../apps/web/hooks/use-optimistic-mutation.ts";

// ── reporting ──────────────────────────────────────────────────────────────
const useColor =
  process.env["NO_COLOR"] === undefined && process.stdout.isTTY === true;
const c = (code: string, text: string): string =>
  useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
const bold = (text: string): string => c("1", text);

let passes = 0;
let failures = 0;

function pass(label: string, detail = ""): void {
  passes += 1;
  console.log(`  ${c("32", "PASS")}  ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label: string, detail: string): void {
  failures += 1;
  console.log(`  ${c("31", "FAIL")}  ${label} — ${detail}`);
}
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) pass(label, detail);
  else fail(label, detail || "condition was false");
}
function section(title: string): void {
  console.log(`\n${bold(title)}`);
}

const ORIGIN = "http://127.0.0.1:3200";

// ── tests 1-4: mode resolution ─────────────────────────────────────────────
section("[DoD 1-4] Mode resolution — the badge must never overstate liveness");

const modeCase = (
  label: string,
  input: {
    online: boolean;
    supabaseConfigured: boolean;
    realtimeStatus: RealtimeStatus;
    source: "supabase" | "local-seed" | null;
  },
  expected: LiveMode,
): void => {
  const actual = resolveLiveMode(input);
  check(label, actual === expected, `${actual} (expected ${expected})`);
};

modeCase(
  "[1] realtime configured and subscribed ⟹ realtime",
  {
    online: true,
    supabaseConfigured: true,
    realtimeStatus: "subscribed",
    source: "supabase",
  },
  "realtime",
);
modeCase(
  "[2] subscription errored ⟹ polling",
  {
    online: true,
    supabaseConfigured: true,
    realtimeStatus: "error",
    source: "supabase",
  },
  "polling",
);
modeCase(
  "[2] subscription closed ⟹ polling",
  {
    online: true,
    supabaseConfigured: true,
    realtimeStatus: "closed",
    source: "supabase",
  },
  "polling",
);
modeCase(
  "[2] still subscribing ⟹ polling, NOT realtime",
  {
    online: true,
    supabaseConfigured: true,
    realtimeStatus: "subscribing",
    source: "supabase",
  },
  "polling",
);
modeCase(
  "[3] Supabase unconfigured ⟹ static",
  {
    online: true,
    supabaseConfigured: false,
    realtimeStatus: "idle",
    source: null,
  },
  "static",
);
modeCase(
  "[3] configured but the repository returned local-seed ⟹ static",
  {
    online: true,
    supabaseConfigured: true,
    realtimeStatus: "subscribed",
    source: "local-seed",
  },
  "static",
);
modeCase(
  "[4] offline outranks everything",
  {
    online: false,
    supabaseConfigured: true,
    realtimeStatus: "subscribed",
    source: "supabase",
  },
  "offline",
);
modeCase(
  "[4] offline outranks static",
  {
    online: false,
    supabaseConfigured: false,
    realtimeStatus: "idle",
    source: null,
  },
  "offline",
);

section(
  "[DoD 3] static and offline must NOT poll — zero timers, zero requests",
);
check("shouldPoll(static) is false", !shouldPoll("static"));
check("shouldPoll(offline) is false", !shouldPoll("offline"));
check(
  "shouldPoll(realtime) is false",
  !shouldPoll("realtime"),
  "realtime is pushed, not pulled",
);
check("shouldPoll(polling) is true", shouldPoll("polling"));

// Exhaustive: the function is total over the union, and only one member polls.
{
  const all: LiveMode[] = ["realtime", "polling", "static", "offline"];
  check(
    "exactly one mode polls",
    all.filter(shouldPoll).length === 1,
    all.filter(shouldPoll).join(","),
  );
}

// ── test 9: reconnect backoff ──────────────────────────────────────────────
section("[DoD 9] Reconnect backoff — grows, jitters, caps at 30 s");

const sequence = backoffSequence(9);
check(
  "un-jittered sequence is 1s 2s 4s 8s 16s 30s 30s 30s 30s",
  sequence.join(",") === "1000,2000,4000,8000,16000,30000,30000,30000,30000",
  sequence.join(", "),
);
check(
  "the sequence is monotonically non-decreasing",
  sequence.every(
    (value, index) => index === 0 || value >= (sequence[index - 1] ?? 0),
  ),
);
check(
  "nothing exceeds the 30 s cap",
  sequence.every((value) => value <= BACKOFF_CAP_MS),
);

// Jitter: with random() pinned to the extremes, the delay must stay inside the
// band and never go negative or above the cap.
for (const [name, random] of [
  ["random()=0 (maximum negative jitter)", () => 0],
  ["random()=1 (maximum positive jitter)", () => 1],
  ["random()=0.5 (no jitter)", () => 0.5],
] as Array<[string, () => number]>) {
  const jittered = Array.from({ length: 9 }, (_, index) =>
    nextBackoffDelay(index, random),
  );
  check(
    `jittered delays stay in [0, ${BACKOFF_CAP_MS}] with ${name}`,
    jittered.every((value) => value >= 0 && value <= BACKOFF_CAP_MS),
    jittered.join(", "),
  );
}
check(
  "jitter actually varies the delay",
  nextBackoffDelay(3, () => 0) !== nextBackoffDelay(3, () => 1),
  `${nextBackoffDelay(3, () => 0)} vs ${nextBackoffDelay(3, () => 1)} — without this, every client retries in lockstep`,
);
check(
  "a negative attempt is clamped, not exponentiated downwards",
  nextBackoffDelay(-5, () => 0.5) === 1000,
);

// ── test 5: coalescing ─────────────────────────────────────────────────────
section("[DoD 5] 40 rapid updates ⟹ ONE refetch");

{
  // A deterministic fake clock: the coalescer's timer is injected, so no real
  // time passes and the assertion cannot flake on a loaded machine.
  let scheduled: (() => void) | null = null;
  let handles = 0;
  const timers = {
    set: (fn: () => void) => {
      scheduled = fn;
      handles += 1;
      return handles;
    },
    clear: () => {
      scheduled = null;
    },
  };

  let runs = 0;
  const coalescer = createCoalescer(
    () => {
      runs += 1;
    },
    COALESCE_WINDOW_MS,
    timers,
  );

  for (let index = 0; index < 40; index += 1) coalescer.signal();
  check("40 signals have not run anything yet", runs === 0, "trailing edge");
  check("40 signals are pending", coalescer.pending() === 40);
  check(
    "each signal reset the timer",
    handles === 40,
    `${handles} timer resets — the window restarts on every event`,
  );

  scheduled?.();
  check(
    "the quiet window produced exactly ONE run",
    runs === 1,
    `${runs} run(s)`,
  );
  check("pending is cleared after the run", coalescer.pending() === 0);

  // A second burst runs again — the coalescer must not latch.
  for (let index = 0; index < 5; index += 1) coalescer.signal();
  scheduled?.();
  check("a later burst runs again", runs === 2, `${runs} runs total`);

  // Firing with nothing pending must not run.
  scheduled?.();
  check("an empty window does not run", runs === 2);
}

{
  let runs = 0;
  let scheduled: (() => void) | null = null;
  const coalescer = createCoalescer(
    () => {
      runs += 1;
    },
    COALESCE_WINDOW_MS,
    {
      set: (fn) => {
        scheduled = fn;
        return 1;
      },
      clear: () => {
        scheduled = null;
      },
    },
  );
  coalescer.signal();
  coalescer.cancel();
  scheduled?.();
  check(
    "[DoD 6] cancel() drops pending work — nothing runs after unmount",
    runs === 0,
  );
  check("cancel() clears the pending count", coalescer.pending() === 0);
}

// ── test 7: optimistic rollback ────────────────────────────────────────────
section("[DoD 7] Optimistic update + server error ⟹ EXACT prior state");

{
  const snapshot = [
    { id: "a", n: 1 },
    { id: "b", n: 2 },
  ];
  const optimistic = [
    { id: "a", n: 1 },
    { id: "b", n: 2 },
    { id: "c", n: 3 },
  ];

  const rolledBack = resolveMutationOutcome({
    snapshot,
    optimistic,
    succeeded: false,
    rollbackOnError: true,
  });
  check(
    "failure restores the snapshot by value",
    JSON.stringify(rolledBack) === JSON.stringify(snapshot),
    JSON.stringify(rolledBack),
  );
  check(
    "the restored array is a copy, not the caller's reference",
    rolledBack !== snapshot,
    "so a later in-place mutation cannot corrupt a held snapshot",
  );
  check(
    "success keeps the optimistic state",
    JSON.stringify(
      resolveMutationOutcome({
        snapshot,
        optimistic,
        succeeded: true,
        rollbackOnError: true,
      }),
    ) === JSON.stringify(optimistic),
  );
  check(
    "rollbackOnError=false keeps the optimistic state on failure",
    JSON.stringify(
      resolveMutationOutcome({
        snapshot,
        optimistic,
        succeeded: false,
        rollbackOnError: false,
      }),
    ) === JSON.stringify(optimistic),
  );
}

// ── test 8: the PWA caching boundary (the privacy control) ─────────────────
section("[DoD 8] No protected route is EVER cached");

const PROTECTED_URLS = [
  "/de/dashboard",
  "/de/dashboard/",
  "/de/dashboard/finance",
  "/en/dashboard/units/AZW-B01-0001",
  "/tr/dashboard/leads",
  "/ru/dashboard/reports",
  "/dashboard",
  "/dashboard/finance",
  "/api/ai/chat",
  "/api/site-management/dashboard",
  "/de/login",
  "/en/login?next=/dashboard",
  "/de/signup",
  "/de/report/abc",
  "/auth/callback",
];

for (const path of PROTECTED_URLS) {
  const strategy = cacheStrategyFor(
    { method: "GET", url: `${ORIGIN}${path}` },
    ORIGIN,
  );
  check(`${path} ⟹ never cached`, strategy === "never", strategy);
}

const PUBLIC_URLS: Array<[string, string]> = [
  ["/de", "network-first"],
  ["/en", "network-first"],
  ["/de/hotel", "network-first"],
  ["/offline.html", "network-first"],
  ["/_next/static/chunks/main-abc123.js", "cache-first"],
  ["/fonts/inter-latin.woff2", "cache-first"],
  ["/media/hero-01.avif", "cache-first"],
  // Deliberately NOT cache-first: the filename carries no build hash, so a
  // cached copy could outlive the deploy that produced it.
  ["/_next/image?url=%2Fmedia%2Fa.avif&w=640", "network-first"],
];
for (const [path, expected] of PUBLIC_URLS) {
  const strategy = cacheStrategyFor(
    { method: "GET", url: `${ORIGIN}${path}` },
    ORIGIN,
  );
  check(`${path} ⟹ ${expected}`, strategy === expected, strategy);
}

check(
  "a non-GET request is never cached",
  ["POST", "PUT", "PATCH", "DELETE", "HEAD"].every(
    (method) =>
      cacheStrategyFor({ method, url: `${ORIGIN}/de` }, ORIGIN) === "never",
  ),
  "a cached response to a mutation is a leak",
);
check(
  "a cross-origin request is never cached",
  cacheStrategyFor(
    { method: "GET", url: "https://example.supabase.co/rest/v1/units" },
    ORIGIN,
  ) === "never",
);
check(
  "an unparseable URL is never cached",
  cacheStrategyFor({ method: "GET", url: "not a url" }, ORIGIN) === "never",
  "fails closed",
);

// Near-misses: a deny-list that used a bare `startsWith` would wrongly protect
// these, and one that anchored too loosely would wrongly admit the ones above.
for (const path of [
  "/de/dashboards-public",
  "/de/dashboardx",
  "/de/hotel/dashboard-tour",
]) {
  check(
    `${path} is NOT treated as protected (whole-segment matching)`,
    !isProtectedPath(path),
  );
}

check(
  "exactly two cache names are owned; anything else is deleted on activate",
  currentCacheNames().length === 2,
  currentCacheNames().join(", "),
);

section("[DoD 8] The service worker's copy of the policy cannot drift");
{
  const swPath = fileURLToPath(
    new URL("../apps/web/public/sw.js", import.meta.url),
  );
  const sw = readFileSync(swPath, "utf8");

  for (const pattern of PROTECTED_PATH_PATTERNS) {
    check(
      `sw.js carries ${pattern.source}`,
      sw.includes(pattern.source),
      "lib/pwa.ts is the source of truth; this is the drift guard",
    );
  }
  check(
    "sw.js checks the deny-list before any positive rule",
    sw.indexOf("isProtectedPath(url.pathname)") <
      sw.indexOf("STATIC_PREFIXES.some"),
    "order is the security property",
  );
  check(
    "sw.js does not call skipWaiting() unconditionally",
    !/self\.skipWaiting\(\)/.test(
      sw.slice(0, sw.indexOf('event.data.type === "AZURA_SKIP_WAITING"')),
    ),
    "a hot swap under an open form loses the form",
  );
  // Checks for the APIs, not for the words — the file's own comments say
  // "no background sync" and "a sync queue loses writes", and an assertion that
  // tripped on those would be testing prose rather than behaviour.
  check(
    "sw.js registers no background-sync handler",
    !/addEventListener\(\s*["']sync["']/.test(sw) &&
      !/addEventListener\(\s*["']periodicsync["']/.test(sw),
  );
  check(
    "sw.js has no durable store for queued writes",
    !sw.includes("indexedDB") && !sw.includes("IDBDatabase"),
    "there is no offline mutation queue, and nothing here may imply one",
  );
  check(
    "sw.js registers no push handler",
    !/addEventListener\(\s*["']push["']/.test(sw),
  );
  check(
    "sw.js deletes caches outside the current version on activate",
    sw.includes("caches.delete(name)"),
  );
}

// ── the published table list ───────────────────────────────────────────────
section("Realtime tables — must match W1-A migration 12");

const MIGRATION_TABLES = [
  "units",
  "service_tickets",
  "ticket_events",
  "workforce_tasks",
  "media_reports",
  "activities",
  "threads",
  "messages",
  "notifications",
  "ai_action_logs",
];
check(
  "REALTIME_TABLES matches migration 12, in order",
  REALTIME_TABLES.join(",") === MIGRATION_TABLES.join(","),
  REALTIME_TABLES.join(", "),
);
for (const forbidden of [
  "finance_ledger_entries",
  "documents",
  "audit_events",
  "access_events",
  "profiles",
]) {
  check(
    `${forbidden} is NOT realtime-published`,
    !isRealtimeTable(forbidden),
    "a policy bug on these leaks continuously rather than on request",
  );
}

// ── staleness and age formatting ───────────────────────────────────────────
section("Staleness — server time, not the client clock");

const base = Date.parse("2026-07-27T12:00:00.000Z");
check(
  "fresh data is not stale",
  !isStale("2026-07-27T12:00:00.000Z", 30_000, base + 10_000),
);
check(
  "data older than two intervals is stale",
  isStale("2026-07-27T12:00:00.000Z", 30_000, base + 61_000),
);
check(
  "exactly two intervals is not yet stale",
  !isStale("2026-07-27T12:00:00.000Z", 30_000, base + 60_000),
);
check("a null timestamp is not stale", !isStale(null, 30_000, base));
check(
  "an unparseable timestamp IS stale",
  isStale("not-a-date", 30_000, base),
  "fails towards saying less about freshness",
);
check(
  "relativeAge seconds",
  relativeAge("2026-07-27T12:00:00.000Z", base + 12_000) === "12 s",
);
check(
  "relativeAge minutes",
  relativeAge("2026-07-27T12:00:00.000Z", base + 240_000) === "4 min",
);
check(
  "relativeAge hours",
  relativeAge("2026-07-27T12:00:00.000Z", base + 7_200_000) === "2 h",
);
check("relativeAge null", relativeAge(null, base) === null);
check(
  "a future timestamp clamps to 0 rather than going negative",
  relativeAge("2026-07-27T12:00:00.000Z", base - 5_000) === "0 s",
  "clock skew must not render as '-5 s ago'",
);

// ── summary ────────────────────────────────────────────────────────────────
const MINIMUM_ASSERTIONS = 80;
console.log("");
if (passes + failures < MINIMUM_ASSERTIONS) {
  failures += 1;
  console.log(
    `  ${c("31", "FAIL")}  suite ran only ${passes + failures} assertions; expected at least ` +
      `${MINIMUM_ASSERTIONS}. A shrinking suite is a silent regression.`,
  );
}
const summary = `${passes} pass · ${failures} fail`;
console.log(
  failures === 0
    ? `${bold(c("32", "OK"))}  ${summary}`
    : `${bold(c("31", "FAILED"))}  ${summary}`,
);
process.exit(failures === 0 ? 0 : 1);
