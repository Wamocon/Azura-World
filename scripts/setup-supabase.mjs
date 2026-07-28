#!/usr/bin/env node
/**
 * Create the two Azura World storage buckets in Supabase.
 *
 * Requested by HANDOFF/W0-ENV.md, verbatim: "create both buckets private, with
 * size + MIME limits".
 *
 * Zero dependencies — global fetch and node:fs only. It never pulls
 * @supabase/supabase-js into a root-level script (the workspace uses isolated
 * node_modules; the root has no such dependency).
 *
 *   node scripts/setup-supabase.mjs --dry-run   report only — changes nothing
 *   node scripts/setup-supabase.mjs             CREATES the buckets  (default)
 *
 * What this script will never do:
 *   · print a key or a secret. Bucket names, statuses and limits only.
 *   · create a public bucket. CONVENTIONS §4: "Signed URLs for documents,
 *     short TTL. No public buckets."
 *   · flip an existing PUBLIC bucket to private. That breaks every live public
 *     URL already handed out, so an operator must do it deliberately. The
 *     script FAILs loudly and says where to click.
 *   · trust its own create response. Every bucket is re-read from the API and
 *     re-checked before anything is reported as PASS (SYSTEM-PROMPT §3).
 *
 * Idempotent: an existing private bucket is SKIP, not an error.
 * Exit code is 0 only when nothing FAILed, so this works as a gate.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");

// Honour NO_COLOR and a non-TTY stdout so redirected output pastes cleanly.
const useColor =
  process.env.NO_COLOR === undefined && process.stdout.isTTY === true;
const c = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
Usage:
  node scripts/setup-supabase.mjs --dry-run   report what would change, change nothing
  node scripts/setup-supabase.mjs             DEFAULT — creates any missing bucket

Creates the document and evidence buckets named in .env.local, both private,
each with a file-size limit and a MIME allowlist. Existing buckets are never
modified. Never prints a key.
`);
  process.exit(0);
}

// ── minimal .env.local loader (no dotenv dependency) ────────────────────────
function loadEnv(file) {
  const path = resolve(ROOT, file);
  if (!existsSync(path)) return {};
  const out = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

const env = { ...loadEnv(".env.local"), ...process.env };

// ── reporting — same shape as scripts/verify-supabase.mjs ───────────────────
const results = [];
const record = (name, status, detail) => {
  results.push({ name, status, detail });
  const mark = {
    PASS: c("32", "PASS"),
    FAIL: c("31", "FAIL"),
    SKIP: c("33", "SKIP"),
    WARN: c("33", "WARN"),
  }[status];
  console.log(`  ${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const need = (k) => {
  const v = env[k];
  return v && !v.startsWith("your-") && !v.startsWith("replace-with")
    ? v
    : null;
};

const MB = 1024 * 1024;
const mb = (n) =>
  typeof n === "number" ? `${Math.round(n / MB)} MB` : String(n ?? "unset");

/** Order-insensitive, case-insensitive comparison of two MIME allowlists. */
const sameMimeSet = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
    return false;
  const set = new Set(a.map((x) => String(x).toLowerCase()));
  return b.every((x) => set.has(String(x).toLowerCase()));
};

// ── what we intend to exist ─────────────────────────────────────────────────
// Both private. Non-negotiable — CONVENTIONS §4 and HANDOFF/W0-ENV.md.
const BUCKETS = [
  {
    id: need("SUPABASE_DOCUMENT_BUCKET") ?? "azura-documents",
    purpose:
      "contracts, invoices, unit documents — read via short-TTL signed URLs",
    fileSizeLimit: 25 * MB,
    allowedMimeTypes: [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/tiff",
      "image/heic",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
  },
  {
    id: need("SUPABASE_EVIDENCE_BUCKET") ?? "azura-evidence",
    purpose: "raw harvested snapshots — the re-openable half of every citation",
    fileSizeLimit: 10 * MB,
    // Harvest output only: the stored HTML/JSON body, a text fallback, and
    // screenshots. Deliberately no application/pdf — a PDF is a document.
    allowedMimeTypes: [
      "text/html",
      "text/plain",
      "application/json",
      "image/*",
    ],
  },
];

// ── 1. environment ──────────────────────────────────────────────────────────
console.log(
  DRY_RUN
    ? `\n${c("1", "Azura World — Supabase storage setup")}  ${c("33", "(--dry-run — nothing will be changed)")}`
    : `\n${c("1", "Azura World — Supabase storage setup")}  ${c("36", "(default mode — missing buckets WILL be created; --dry-run to preview)")}`,
);
console.log(`\n${c("1", "1. Environment")}`);

const URL_ = need("NEXT_PUBLIC_SUPABASE_URL");
const SVC = need("SUPABASE_SERVICE_ROLE_KEY");

record("NEXT_PUBLIC_SUPABASE_URL", URL_ ? "PASS" : "FAIL", URL_ ?? "not set");
// Presence only. The key itself is never printed, not even as a fingerprint.
record(
  "SUPABASE_SERVICE_ROLE_KEY",
  SVC ? "PASS" : "FAIL",
  SVC ? "set (value never printed)" : "not set",
);
record("SUPABASE_DOCUMENT_BUCKET", "PASS", BUCKETS[0].id);
record("SUPABASE_EVIDENCE_BUCKET", "PASS", BUCKETS[1].id);

if (!URL_ || !SVC) {
  console.log(
    `\n${c("31", "Cannot continue: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.")}`,
  );
  console.log(
    "See SUPABASE-SETUP.md for where each value lives in the dashboard.\n",
  );
  process.exit(1);
}

// ── storage helper ──────────────────────────────────────────────────────────
async function storage(method, path, body) {
  const res = await fetch(`${URL_}/storage/v1${path}`, {
    method,
    headers: {
      apikey: SVC,
      Authorization: `Bearer ${SVC}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

/** Supabase storage errors are `{ statusCode, error, message }`. Show the message only. */
const why = (r) =>
  r.json && typeof r.json.message === "string"
    ? r.json.message
    : `HTTP ${r.status}`;

// ── 2. list what exists today ───────────────────────────────────────────────
console.log(`\n${c("1", "2. Existing buckets")}`);

let existing = new Map();
try {
  const r = await storage("GET", "/bucket");
  if (!r.ok) {
    record("Storage service reachable", "FAIL", why(r));
    console.log(
      `\n${c("31", "Cannot continue: the Storage API did not answer with the service-role key.")}\n`,
    );
    process.exit(1);
  }
  const list = Array.isArray(r.json) ? r.json : [];
  existing = new Map(list.map((b) => [b.name, b]));
  record(
    "Storage service reachable",
    "PASS",
    `${list.length} bucket(s) present`,
  );
} catch (err) {
  record(
    "Storage service reachable",
    "FAIL",
    err.name === "TimeoutError" ? "timed out after 20s" : err.message,
  );
  process.exit(1);
}

// ── 3. reconcile ────────────────────────────────────────────────────────────
/**
 * Re-read a bucket from the API and check it against its spec.
 * `onDrift` is FAIL for a bucket we just created (we set those values, so a
 * mismatch is a real failure) and WARN for a pre-existing one (drift we are
 * reporting, not causing).
 */
async function verifyAgainstSpec(spec, onDrift) {
  const r = await storage("GET", `/bucket/${encodeURIComponent(spec.id)}`);
  if (!r.ok) {
    record(`"${spec.id}" re-read`, "FAIL", why(r));
    return;
  }
  const b = r.json ?? {};

  record(
    `"${spec.id}" is private`,
    b.public === false ? "PASS" : "FAIL",
    b.public === false
      ? "public=false (verified by re-read)"
      : `public=${b.public} — MUST be false`,
  );
  record(
    `"${spec.id}" file size limit`,
    b.file_size_limit === spec.fileSizeLimit ? "PASS" : onDrift,
    b.file_size_limit === spec.fileSizeLimit
      ? mb(b.file_size_limit)
      : `is ${mb(b.file_size_limit)}, spec says ${mb(spec.fileSizeLimit)}`,
  );
  record(
    `"${spec.id}" MIME allowlist`,
    sameMimeSet(b.allowed_mime_types, spec.allowedMimeTypes) ? "PASS" : onDrift,
    sameMimeSet(b.allowed_mime_types, spec.allowedMimeTypes)
      ? `${spec.allowedMimeTypes.length} type(s)`
      : `is ${Array.isArray(b.allowed_mime_types) ? `${b.allowed_mime_types.length} type(s)` : "unrestricted"}, spec says ${spec.allowedMimeTypes.length}`,
  );
}

for (const spec of BUCKETS) {
  console.log(`\n${c("1", `3. Bucket "${spec.id}"`)}  ${spec.purpose}`);

  const found = existing.get(spec.id);

  if (found) {
    if (found.public === true) {
      record(
        `"${spec.id}" exists but is PUBLIC`,
        "FAIL",
        "security regression — not modified by this script",
      );
      console.log(
        c(
          "31",
          [
            "        This bucket serves objects over unauthenticated public URLs.",
            '        CONVENTIONS §4: "Signed URLs for documents, short TTL. No public buckets."',
            "        This script will NOT flip it for you: privatising a bucket breaks every",
            "        public URL already handed out, and that must be a deliberate, audited act.",
            `        Fix: Dashboard → Storage → ${spec.id} → Settings → uncheck "Public bucket",`,
            "        confirm no live integration depends on the public URLs, then re-run this",
            "        script and `node scripts/verify-supabase.mjs`.",
          ].join("\n"),
        ),
      );
      continue;
    }
    record(`"${spec.id}" already exists`, "SKIP", "private — left untouched");
    // Existing bucket: report drift, never silently correct it. Widening a limit
    // on a bucket that already holds objects is an operator's call, not a script's.
    const before = results.length;
    await verifyAgainstSpec(spec, "WARN");
    if (results.slice(before).some((r) => r.status === "WARN")) {
      console.log(
        c(
          "33",
          [
            "        Limits drift from this script's spec. Nothing was changed. To align them:",
            `        Dashboard → Storage → ${spec.id} → Settings, or PUT /storage/v1/bucket/${spec.id}`,
            `        with { "file_size_limit": ${spec.fileSizeLimit}, "allowed_mime_types": [...] }.`,
            "        Check nothing already stored exceeds a limit you are tightening.",
          ].join("\n"),
        ),
      );
    }
    continue;
  }

  if (DRY_RUN) {
    record(
      `"${spec.id}" would be created`,
      "SKIP",
      `private · ${mb(spec.fileSizeLimit)} · ${spec.allowedMimeTypes.length} MIME type(s)`,
    );
    continue;
  }

  const created = await storage("POST", "/bucket", {
    id: spec.id,
    name: spec.id,
    public: false,
    file_size_limit: spec.fileSizeLimit,
    allowed_mime_types: spec.allowedMimeTypes,
  });

  if (created.ok) {
    record(`"${spec.id}" created`, "PASS", "create call accepted");
  } else if (created.status === 409) {
    // Raced with another operator between the list and the create.
    record(
      `"${spec.id}" created`,
      "SKIP",
      "already existed (409) — verifying what is there",
    );
  } else {
    record(`"${spec.id}" created`, "FAIL", why(created));
    continue;
  }

  // Never trust the create response — re-read and check what actually landed.
  await verifyAgainstSpec(spec, created.status === 409 ? "WARN" : "FAIL");
}

// ── summary ─────────────────────────────────────────────────────────────────
const counts = results.reduce(
  (a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a),
  {},
);
console.log(
  `\n${c("1", "Summary")}  ${counts.PASS ?? 0} pass · ${counts.FAIL ?? 0} fail · ${counts.WARN ?? 0} warn · ${counts.SKIP ?? 0} skip`,
);

const failed = results.filter((r) => r.status === "FAIL");
if (failed.length) {
  console.log(`\n${c("31", "Failures:")}`);
  for (const f of failed) console.log(`  · ${f.name} — ${f.detail}`);
  console.log();
  process.exit(1);
}

if (DRY_RUN) {
  console.log(
    `\n${c("33", "Dry run — nothing was changed. Re-run without --dry-run to apply.")}\n`,
  );
} else if (counts.WARN) {
  // Do not claim a clean result over the top of warnings (SYSTEM-PROMPT §3).
  console.log(
    `\n${c("33", `Both buckets are private (verified by re-read), but ${counts.WARN} limit check(s) did not match the spec.`)}`,
  );
  console.log(
    "Review the WARN lines above before treating storage as configured.",
  );
  console.log("Next: node scripts/verify-supabase.mjs\n");
} else {
  console.log(
    `\n${c("32", "Storage buckets ready — both private, limits verified by re-read.")}`,
  );
  console.log("Next: node scripts/verify-supabase.mjs\n");
}
