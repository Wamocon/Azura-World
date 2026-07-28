#!/usr/bin/env node
/**
 * W0-D — build-time image pipeline for harvested competitor media.
 *
 * Mirrors D:\Ataberg\scripts\images.mjs in shape (ahead-of-time encode, AVIF +
 * WebP + JPEG floor, responsive widths, never upscale) and adds what this task
 * needs on top: an LQIP table and a rights gate on the output directory.
 *
 * Encoding is deliberately ahead-of-time. AVIF costs up to ~50x JPEG CPU, so
 * doing it per-request would be indefensible.
 *
 * THE RIGHTS GATE — read this before changing the output path
 * ──────────────────────────────────────────────────────────
 * `apps/web/public/**` is served by Next.js to anyone who knows the URL, with no
 * authentication. Writing a competitor's `internal_only` render there publishes
 * it, whether or not a page links to it. So:
 *
 *   usage = "attributed_display"  →  apps/web/public/media/   (publishable)
 *   usage = "internal_only"       →  sources/media/encoded/   (git-ignored)
 *   usage = "unknown"             →  sources/media/encoded/   (git-ignored)
 *
 * The default is `internal_only` (MEDIA-LICENSE.md §2), so the public directory
 * stays close to empty by design. That is the correct outcome, not a bug: these
 * images are not ours. Internal assets are served to the authorised dashboard
 * through a gated route — see the request to W2-B in HANDOFF/W0-D.md.
 *
 * EXIF is stripped from every encoded output. Republishing a competitor's
 * geotags is careless, and sharp only carries metadata when asked, so the
 * pipeline simply never asks. `.rotate()` bakes orientation in first, so
 * dropping the EXIF cannot flip an image.
 *
 * Usage:
 *   node scripts/encode-images.mjs
 *   node scripts/encode-images.mjs --dry-run
 *   node scripts/encode-images.mjs --only=floorplan,siteplan
 */

import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  stat,
  rm,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DIR,
  REPO,
  loadDep,
  resolveUsage,
  loadRightsPolicy,
} from "./harvest-media.mjs";

/** Responsive widths from the brief. Never upscaled beyond the stored original. */
export const WIDTHS = [400, 800, 1200, 1600, 2400];
export const QUALITY = { avif: 50, webp: 75, jpeg: 80 };
/** LQIP: 20px wide blur placeholder as a base64 data URI. Prevents CLS. */
export const LQIP_WIDTH = 20;

const RASTER_KINDS = new Set(["image", "svg"]);

/**
 * Encode one asset into every format/width that its source can honestly support.
 * Returns the emitted relative paths, grouped by format, plus the LQIP data URI.
 */
export async function encodeAsset(
  asset,
  { outDir, urlPrefix, dryRun = false, fresh = false },
) {
  const sharp = loadDep("sharp");
  const src = path.join(REPO, asset.originalPath);
  if (!existsSync(src))
    return {
      skipped: "original_missing",
      formats: { avif: [], webp: [], jpeg: [] },
      lqip: null,
      bytes: 0,
    };
  if (!RASTER_KINDS.has(asset.kind))
    return {
      skipped: `not_raster(${asset.kind})`,
      formats: { avif: [], webp: [], jpeg: [] },
      lqip: null,
      bytes: 0,
    };

  let meta;
  try {
    meta = await sharp(src).metadata();
  } catch (e) {
    return {
      skipped: `metadata_failed: ${String(e.message).split("\n")[0]}`,
      formats: { avif: [], webp: [], jpeg: [] },
      lqip: null,
      bytes: 0,
    };
  }
  // An SVG has no intrinsic raster size worth trusting; density-render it at the
  // largest width we would ship so the raster tiers are not blurry.
  const isVector = asset.kind === "svg" || meta.format === "svg";
  const srcW = isVector ? WIDTHS[WIDTHS.length - 1] : meta.width;
  const srcH = isVector
    ? Math.round(
        WIDTHS[WIDTHS.length - 1] /
          ((meta.width ?? 1) / (meta.height ?? 1) || 1),
      )
    : meta.height;
  if (!srcW || !srcH)
    return {
      skipped: "no_dimensions",
      formats: { avif: [], webp: [], jpeg: [] },
      lqip: null,
      bytes: 0,
    };

  // Never upscale. Clamp to the source width and always emit at least one tier,
  // so a 640px portal thumbnail still produces a usable file instead of nothing.
  const widths = [
    ...new Set(
      WIDTHS.filter((w) => w <= srcW).concat(Math.min(srcW, WIDTHS[0])),
    ),
  ].sort((a, b) => a - b);

  const formats = { avif: [], webp: [], jpeg: [] };
  let bytes = 0;
  let reused = 0;
  if (!dryRun) await mkdir(outDir, { recursive: true });

  for (const w of widths) {
    // lanczos3 (sharp's default) downscale. No withMetadata() anywhere in this
    // file — that is what strips EXIF, including GPS.
    const base = () =>
      sharp(src, isVector ? { density: 300 } : undefined)
        .rotate()
        .resize(w, null, { kernel: "lanczos3", withoutEnlargement: true });

    for (const [fmt, ext] of [
      ["avif", "avif"],
      ["webp", "webp"],
      ["jpeg", "jpg"],
    ]) {
      const file = path.join(outDir, `${asset.id}-${w}.${ext}`);
      // Incremental by default. Ids are content-addressed (host + sha256), so an
      // existing file for this id/width/format was produced from these exact
      // bytes and is still valid. AVIF costs ~50x JPEG CPU; re-encoding 13,000
      // variants because the dedupe changed is waste, not thoroughness.
      if (!dryRun && !fresh && existsSync(file)) {
        const st = await stat(file);
        if (st.size > 0) {
          bytes += st.size;
          reused++;
          formats[fmt].push(`${urlPrefix}/${asset.id}-${w}.${ext}`);
          continue;
        }
      }
      if (!dryRun) {
        const pipe = base();
        const out =
          fmt === "avif"
            ? pipe.avif({ quality: QUALITY.avif, effort: 4 })
            : fmt === "webp"
              ? pipe.webp({ quality: QUALITY.webp })
              : pipe
                  .flatten({ background: "#ffffff" })
                  .jpeg({ quality: QUALITY.jpeg, mozjpeg: true });
        const info = await out.toFile(file);
        bytes += info.size;
      }
      formats[fmt].push(`${urlPrefix}/${asset.id}-${w}.${ext}`);
    }
  }

  let lqip = null;
  if (!dryRun) {
    const tiny = await sharp(src, isVector ? { density: 72 } : undefined)
      .rotate()
      .resize(LQIP_WIDTH, null, { fit: "inside" })
      .blur(1.2)
      .webp({ quality: 30, alphaQuality: 40 })
      .toBuffer();
    lqip = `data:image/webp;base64,${tiny.toString("base64")}`;
  }

  return {
    skipped: null,
    formats,
    lqip,
    bytes,
    reused,
    widths,
    aspect: Number((srcW / srcH).toFixed(4)),
  };
}

async function dirSize(dir) {
  if (!existsSync(dir)) return { total: 0, byExt: {}, files: 0 };
  const byExt = {};
  let total = 0;
  let files = 0;
  for (const f of await readdir(dir)) {
    const s = await stat(path.join(dir, f));
    if (!s.isFile()) continue;
    total += s.size;
    files++;
    const e = path.extname(f) || "(none)";
    byExt[e] = (byExt[e] ?? 0) + s.size;
  }
  return { total, byExt, files };
}

async function run() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fresh = args.includes("--fresh");
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.split("=")[1].split(",").filter(Boolean) : [];

  const assetsFile = path.join(DIR.media, "assets.json");
  if (!existsSync(assetsFile)) {
    console.error(
      `sources/media/assets.json not found. Run: node scripts/harvest-media.mjs`,
    );
    process.exitCode = 1;
    return;
  }
  const { assets } = JSON.parse(await readFile(assetsFile, "utf8"));
  const policy = await loadRightsPolicy();

  console.log("W0-D encode-images");
  console.log(
    `  assets        : ${assets.length} from sources/media/assets.json`,
  );
  console.log(
    `  formats       : AVIF q${QUALITY.avif} · WebP q${QUALITY.webp} · JPEG q${QUALITY.jpeg}`,
  );
  console.log(`  widths        : ${WIDTHS.join(" / ")} (never upscaled)`);
  console.log(`  LQIP          : ${LQIP_WIDTH}px blurred WebP data URI`);
  console.log(
    `  EXIF          : stripped from every output (no withMetadata anywhere)`,
  );
  console.log(`  rights policy : ${policy.source}`);
  if (dryRun) console.log("  MODE          : --dry-run, nothing written");

  // Clear only our own outputs, so a re-run cannot leave orphans behind while
  // still never touching a file another window owns.
  const liveIds = new Set(assets.map((a) => a.id));
  if (!dryRun) {
    for (const d of [DIR.publicMedia, DIR.encoded]) {
      if (!existsSync(d)) continue;
      for (const f of await readdir(d)) {
        if (!/\.(avif|webp|jpg)$/.test(f)) continue;
        // --fresh wipes everything; otherwise drop only ORPHANS — variants whose
        // asset id is no longer in the manifest (e.g. folded away by dedupe).
        const id = f.replace(/-\d+\.(avif|webp|jpg)$/, "");
        if (fresh || !liveIds.has(id)) await rm(path.join(d, f));
      }
    }
  }

  const lqip = {};
  const encoded = [];
  const skipped = [];
  let publicCount = 0;
  let internalCount = 0;

  for (const asset of assets) {
    if (only.length && !only.includes(asset.category)) continue;
    const usage = resolveUsage(asset, policy);
    const isPublic = usage.usage === "attributed_display";
    const target = isPublic
      ? { outDir: DIR.publicMedia, urlPrefix: "/media", delivery: "public" }
      : {
          outDir: DIR.encoded,
          urlPrefix: "sources/media/encoded",
          delivery: "internal",
        };

    const r = await encodeAsset(asset, { ...target, dryRun, fresh });
    if (r.skipped) {
      skipped.push({
        id: asset.id,
        category: asset.category,
        reason: r.skipped,
      });
      continue;
    }
    if (r.lqip) lqip[asset.id] = r.lqip;
    if (isPublic) publicCount++;
    else internalCount++;
    encoded.push({
      id: asset.id,
      category: asset.category,
      usage: usage.usage,
      usageReason: usage.reason,
      delivery: target.delivery,
      formats: r.formats,
      widths: r.widths,
      aspect: r.aspect,
      encodedBytes: r.bytes,
      lqipBytes: r.lqip ? r.lqip.length : 0,
    });
  }

  if (!dryRun) {
    await mkdir(DIR.lib, { recursive: true });
    // JSON cannot carry a comment, so the do-not-hand-edit notice is a key.
    await writeFile(
      path.join(DIR.lib, "lqip.json"),
      JSON.stringify(
        {
          __generated:
            "scripts/encode-images.mjs — DO NOT HAND-EDIT. Fix the encoder and re-run.",
          __note: `${LQIP_WIDTH}px blurred WebP data URIs, keyed by media asset id. Import per-asset via lib/media-manifest.ts; do not import this file wholesale into a public route — it also holds placeholders for internal_only assets (MEDIA-LICENSE.md §5).`,
          __generatedAt: new Date().toISOString(),
          lqip,
        },
        null,
        2,
      ),
    );
    await writeFile(
      path.join(DIR.media, "encoded.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          generator: "scripts/encode-images.mjs",
          encoded,
          skipped,
        },
        null,
        2,
      ),
    );
  }

  const pub = await dirSize(DIR.publicMedia);
  const int = await dirSize(DIR.encoded);
  const fmt = (b) =>
    b > 1024 * 1024
      ? `${(b / 1024 / 1024).toFixed(2)} MB`
      : `${(b / 1024).toFixed(0)} KB`;

  console.log(`\n── Encoded ──`);
  console.log(
    `  assets encoded      : ${encoded.length}  (public ${publicCount} · internal ${internalCount})`,
  );
  console.log(`  assets skipped      : ${skipped.length}`);
  const byReason = {};
  for (const s of skipped)
    byReason[s.reason.replace(/:.*/, "")] =
      (byReason[s.reason.replace(/:.*/, "")] ?? 0) + 1;
  for (const [k, v] of Object.entries(byReason))
    console.log(`      ${String(v).padStart(4)}  ${k}`);
  console.log(`  LQIP entries        : ${Object.keys(lqip).length}`);

  console.log(`\n── On disk ──`);
  for (const [label, d] of [
    ["apps/web/public/media (committed)", pub],
    ["sources/media/encoded (git-ignored)", int],
  ]) {
    console.log(`  ${label}`);
    if (!d.files) {
      console.log(`      empty`);
      continue;
    }
    for (const [e, b] of Object.entries(d.byExt).sort((a, b) => b[1] - a[1]))
      console.log(`      ${e.padEnd(6)} ${fmt(b).padStart(10)}`);
    console.log(
      `      TOTAL  ${fmt(d.total).padStart(10)} across ${d.files} files`,
    );
  }
  console.log(
    `\n  repo size added by W0-D outputs: ${fmt(pub.total)} (public/media) + lqip.json`,
  );
  console.log(`\nWrote apps/web/lib/lqip.json and sources/media/encoded.json`);
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  run().catch((e) => {
    console.error("\nencode-images.mjs failed:", e);
    process.exitCode = 1;
  });
}
