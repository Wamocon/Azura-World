/**
 * Nothing unrelated, nothing unpublished, nothing unlicensed. Owner: W-CINEMA
 *
 * The brief's hard rule: **no asset with `subject: "unrelated"` may enter the
 * journey.** Nine of the harvested assets are other buildings entirely - a
 * portal that lists several developments embeds media for all of them - and one
 * of them on a page about Azura World is a factual claim that is simply false.
 *
 * `publish-journey-media.mjs` applies the filter. This asserts it against the
 * emitted module and the filesystem, so the filter and its result cannot drift:
 * a hand-edit to `journey-media.ts`, a manifest re-harvest that reclassifies an
 * id, or a file deleted from `public/media` all fail here.
 *
 * Run: `pnpm gate:journey-media`
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const APP = join(ROOT, "apps", "web")

let pass = 0
let fail = 0
function check(label, ok, detail = "") {
  if (ok) pass += 1
  else fail += 1
  console.log(
    `  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${label}${detail ? `  \x1b[2m- ${detail}\x1b[0m` : ""}`
  )
}

const emitted = readFileSync(join(APP, "lib", "journey-media.ts"), "utf8")
const manifest = readFileSync(join(APP, "lib", "media-manifest.ts"), "utf8").replace(
  /\r\n/g,
  "\n"
)

const start =
  emitted.indexOf("journeyImages: JourneyImage[] = ") +
  "journeyImages: JourneyImage[] = ".length -
  1
const images = JSON.parse(
  emitted.slice(emitted.indexOf("[", start), emitted.indexOf("\n]", start) + 2)
)
const vStart =
  emitted.indexOf("journeyVideos: JourneyVideo[] = ") +
  "journeyVideos: JourneyVideo[] = ".length -
  1
const videos = JSON.parse(
  emitted.slice(emitted.indexOf("[", vStart), emitted.indexOf("\n]", vStart) + 2)
)

console.log(`\n\x1b[1mjourney media guard\x1b[0m  ${images.length} images · ${videos.length} video`)
console.log("-".repeat(52))

/** Read one field out of a manifest entry, by id. */
function fieldOf(id, field) {
  const at = manifest.indexOf(`id: "${id}",`)
  if (at === -1) return null
  const entry = manifest.slice(at, manifest.indexOf("\n  },", at))
  return (entry.match(new RegExp(`\\n    ${field}: "([^"]*)"`)) ?? [])[1] ?? null
}

// ---- 1. the hard rule ------------------------------------------------------
const unrelated = images.filter((i) => fieldOf(i.id, "subject") === "unrelated")
check(
  'no journey image carries subject "unrelated"',
  unrelated.length === 0,
  unrelated.length === 0 ? `${images.length} checked` : unrelated.map((i) => i.id).join(", ")
)

// A non-vacuity control: the rule is only meaningful if such assets exist.
const unrelatedInManifest = (manifest.match(/subject: "unrelated"/g) ?? []).length
check(
  "the manifest still contains unrelated assets, so the filter is not vacuous",
  unrelatedInManifest > 0,
  `${unrelatedInManifest} in the manifest`
)

// ---- 2. rights -------------------------------------------------------------
const notPromoted = images.filter(
  (i) => fieldOf(i.id, "usage") !== "attributed_display"
)
check(
  "every journey image is attributed_display in the manifest",
  notPromoted.length === 0,
  notPromoted.map((i) => i.id).slice(0, 3).join(", ")
)
const notPublic = images.filter((i) => fieldOf(i.id, "delivery") !== "public")
check(
  'every journey image is delivery: "public"',
  notPublic.length === 0,
  notPublic.map((i) => i.id).slice(0, 3).join(", ")
)
const noLogo = images.every((i) => fieldOf(i.id, "category") !== "logo")
check("no logo asset entered the journey", noLogo)

// ---- 3. the files exist ----------------------------------------------------
const RUNGS = [800, 1200, 1600]
const missing = []
for (const image of images) {
  for (const w of RUNGS) {
    for (const ext of ["avif", "webp"]) {
      const p = join(APP, "public", "media", `${image.id}-${w}.${ext}`)
      if (!existsSync(p)) missing.push(`${image.id}-${w}.${ext}`)
    }
  }
}
check(
  `every srcset rung exists in public/media (${images.length} × ${RUNGS.length} × 2)`,
  missing.length === 0,
  missing.slice(0, 3).join(", ")
)

// ---- 4. credit + placeholder ----------------------------------------------
check(
  "every image carries a publisher for its visible credit",
  images.every((i) => typeof i.publisher === "string" && i.publisher.length > 0)
)
check(
  "every image carries an LQIP placeholder",
  images.every((i) => typeof i.lqip === "string" && i.lqip.startsWith("data:image/"))
)
check(
  "every image carries real dimensions, so the box is reserved before load",
  images.every((i) => i.width > 0 && i.height > 0)
)

// ---- 5. video --------------------------------------------------------------
for (const v of videos) {
  // `src` is null by contract: the film is referenced at its publisher, never
  // rehosted (MEDIA-LICENSE 4, and the pre-commit hook enforces it). What we
  // publish is the poster frame, and that must exist.
  check(`video ${v.slug}: not rehosted`, v.src === null)
  check(
    `video ${v.slug}: poster published`,
    typeof v.poster === "string" &&
      existsSync(join(APP, "public", v.poster.replace(/^\//, "")))
  )
}

console.log(`\n\x1b[1m${pass} pass · ${fail} fail\x1b[0m`)
process.exit(fail === 0 ? 0 : 1)
