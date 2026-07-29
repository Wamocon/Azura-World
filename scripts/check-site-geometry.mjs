/**
 * Geometry invariant gate.                                   Owner: W-SITEMODEL
 *
 * `lib/site-geometry.ts` is a set of boxes fitted by eye to a perspective
 * render. That is a legitimate way to build a schematic and a terrible thing to
 * leave unchecked, because every failure mode is silent: a block drifts into a
 * pool, two masses occupy the same ground, a rotation sign flips and mirrors
 * the crescent, or somebody "corrects" a footprint until the brochure total
 * lands and quietly breaks the drawing.
 *
 * So the totals in that file's header are not trusted. They are recomputed here
 * from the vertices and the block list on every run, and the published figures
 * they are compared against come from the dataset rather than from a constant
 * repeated in two places.
 *
 * Run: `pnpm qa:geometry`
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "..")

// The module is TypeScript, and this gate must run under plain node without a
// build step. Rather than pull in a transpiler for one file of frozen data, the
// arithmetic is re-derived here from the same literals, and a source check
// below asserts the two have not drifted apart.
const SRC = readFileSync(
  path.join(REPO, "apps/web/lib/site-geometry.ts"),
  "utf8",
)

let failures = 0
let checks = 0

function check(name, ok, detail = "") {
  checks += 1
  if (ok) {
    console.log(`  PASS  ${name}${detail ? `  ${detail}` : ""}`)
  } else {
    failures += 1
    console.log(`  FAIL  ${name}${detail ? `  ${detail}` : ""}`)
  }
}

// ---------------------------------------------------------------------------
// Parse the literals straight out of the source
// ---------------------------------------------------------------------------

function parseVertices() {
  const m = SRC.match(/export const plotVertices[\s\S]*?\[([\s\S]*?)\]\)/)
  if (!m) return []
  return [...m[1].matchAll(/\{\s*x:\s*(-?\d+(?:\.\d+)?),\s*z:\s*(-?\d+(?:\.\d+)?)\s*\}/g)].map(
    (v) => ({ x: Number(v[1]), z: Number(v[2]) }),
  )
}

function parseBlocks() {
  const start = SRC.indexOf("export const siteBlocks")
  const end = SRC.indexOf("export const siteFeatures")
  const body = SRC.slice(start, end)
  const blocks = []
  for (const chunk of body.split(/\n  \{\n/).slice(1)) {
    const get = (re) => {
      const m = chunk.match(re)
      return m ? m[1] : null
    }
    const key = get(/key:\s*"([^"]+)"/)
    if (!key) continue
    const num = (re) => {
      const v = get(re)
      return v === null ? null : Number(v.replace(/_/g, ""))
    }
    blocks.push({
      key,
      role: get(/role:\s*"([^"]+)"/),
      storeys: num(/storeys:\s*(\d+)/),
      centre: {
        x: num(/centre:\s*\{\s*x:\s*(-?[\d_]+)/),
        z: num(/centre:\s*\{\s*x:\s*-?[\d_]+,\s*z:\s*(-?[\d_]+)/),
      },
      size: {
        w: num(/size:\s*\{\s*w:\s*([\d_]+)/),
        d: num(/size:\s*\{\s*w:\s*[\d_]+,\s*d:\s*([\d_]+)/),
      },
      rotationDeg: num(/rotationDeg:\s*(-?[\d_]+)/),
      shape: get(/shape:\s*"([^"]+)"/),
      curveDeg: num(/curveDeg:\s*([\d_]+)/),
      footprintSqm: num(/footprintSqm:\s*([\d_]+)/),
      countsToward: /countsTowardBuildingCount:\s*true/.test(chunk),
      hasFiveConfidences:
        /confidence:\s*(FITTED|ALL_INFERRED|ALL_GUESSED)/.test(chunk) ||
        (/centre:\s*(read|inf|guess)/.test(chunk) &&
          /size:\s*(read|inf|guess)/.test(chunk) &&
          /rotation:\s*(read|inf|guess)/.test(chunk) &&
          /storeys:\s*(read|inf|guess)/.test(chunk) &&
          /shape:\s*(read|inf|guess)/.test(chunk)),
      raw: chunk,
    })
  }
  return blocks
}

const vertices = parseVertices()
const blocks = parseBlocks()

// ---------------------------------------------------------------------------
// Geometry helpers, duplicated deliberately so the gate does not verify the
// implementation against itself.
// ---------------------------------------------------------------------------

const shoelace = (poly) => {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.x * b.z - b.x * a.z
  }
  return Math.abs(s) / 2
}

const corners = (b) => {
  const r = (b.rotationDeg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const hw = b.size.w / 2
  const hd = b.size.d / 2
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([px, pz]) => ({
    x: b.centre.x + px * c - pz * s,
    z: b.centre.z + px * s + pz * c,
  }))
}

const inside = (poly, pt) => {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.z > pt.z !== b.z > pt.z) {
      const x = ((b.x - a.x) * (pt.z - a.z)) / (b.z - a.z) + a.x
      if (pt.x < x) hit = !hit
    }
  }
  return hit
}

const overlaps = (A, B) => {
  for (const quad of [A, B]) {
    for (let i = 0; i < quad.length; i++) {
      const p = quad[i]
      const q = quad[(i + 1) % quad.length]
      const ax = -(q.z - p.z)
      const az = q.x - p.x
      let minA = Infinity
      let maxA = -Infinity
      let minB = Infinity
      let maxB = -Infinity
      for (const v of A) {
        const d = v.x * ax + v.z * az
        minA = Math.min(minA, d)
        maxA = Math.max(maxA, d)
      }
      for (const v of B) {
        const d = v.x * ax + v.z * az
        minB = Math.min(minB, d)
        maxB = Math.max(maxB, d)
      }
      if (maxA < minB || maxB < minA) return false
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// The published figures, read from the dataset rather than restated
// ---------------------------------------------------------------------------

let published = { plot: 76000, footprint: 15000, buildings: 14 }
try {
  const ds = readFileSync(
    path.join(REPO, "apps/web/lib/azura-world-data.ts"),
    "utf8",
  )
  const grab = (name) => {
    const m = ds.match(new RegExp(`${name}[\\s\\S]{0,200}?value:\\s*([\\d_]+)`))
    return m ? Number(m[1].replace(/_/g, "")) : null
  }
  published = {
    plot: grab("plotAreaSqm") ?? published.plot,
    footprint: grab("buildingFootprintSqm") ?? published.footprint,
    buildings: grab("buildingCount") ?? published.buildings,
  }
} catch {
  console.log("  NOTE  dataset not readable; using the brochure figures")
}

console.log("\nsite geometry\n")

// 1. Parsing actually worked -------------------------------------------------
check("source parses", vertices.length === 11 && blocks.length === 17,
  `${vertices.length} vertices, ${blocks.length} blocks`)

if (vertices.length !== 11 || blocks.length !== 17) {
  console.log("\n  cannot continue: the source shape changed, update this gate\n")
  process.exit(1)
}

// 2. Plot arithmetic ---------------------------------------------------------
const plotArea = Math.round(shoelace(vertices))
const parcel = 2584
const total = plotArea + parcel
check("shoelace(plotVertices) == 73,618", plotArea === 73618, `${plotArea} m2`)
check(
  `total plot within 0.5% of published ${published.plot.toLocaleString("en")}`,
  Math.abs(total - published.plot) / published.plot < 0.005,
  `${total.toLocaleString("en")} m2 (${(((total - published.plot) / published.plot) * 100).toFixed(2)}%)`,
)

const xs = vertices.map((v) => v.x)
const zs = vertices.map((v) => v.z)
const derivedW = Math.max(...xs) - Math.min(...xs)
const derivedD = Math.max(...zs) - Math.min(...zs)
check("plotMetres is derived, not restated", derivedW === 372 && derivedD === 432,
  `${derivedW} x ${derivedD}`)

// 3. Footprint arithmetic ----------------------------------------------------
let footSum = 0
let footMismatch = []
for (const b of blocks) {
  footSum += b.footprintSqm
  // The two round masses are ellipses; every other block is a rectangle.
  const ellipse = b.key === "UNREAD-1"
  const expect = ellipse
    ? Math.round((Math.PI / 4) * b.size.w * b.size.d)
    : b.size.w * b.size.d
  if (Math.abs(expect - b.footprintSqm) > 2) {
    footMismatch.push(`${b.key} says ${b.footprintSqm}, w*d gives ${expect}`)
  }
}
check("every footprintSqm equals its own w*d", footMismatch.length === 0,
  footMismatch.join("; "))
check("sum(footprintSqm) == 15,183", footSum === 15183, `${footSum} m2`)
check(
  `footprint within 2% of published ${published.footprint.toLocaleString("en")}`,
  Math.abs(footSum - published.footprint) / published.footprint < 0.02,
  `${(((footSum - published.footprint) / published.footprint) * 100).toFixed(2)}%`,
)

// 4. buildingCount reconciles ------------------------------------------------
const counted = blocks.filter((b) => b.countsToward).length
check(`counted masses == published buildingCount ${published.buildings}`,
  counted === published.buildings, `${counted}`)

// 5. Containment -------------------------------------------------------------
const parcelBlock = {
  centre: { x: -86, z: 204 },
  size: { w: 68, d: 38 },
  rotationDeg: -25,
}
const parcelPoly = corners(parcelBlock)
let outside = []
for (const b of blocks) {
  const poly = b.key === "I" ? parcelPoly : vertices
  for (const c of corners(b)) {
    if (!inside(poly, c)) {
      outside.push(b.key)
      break
    }
  }
}
check("every block lies inside its own polygon", outside.length === 0,
  outside.length ? `outside: ${[...new Set(outside)].join(", ")}` : "17 of 17")

// 6. No two blocks intersect -------------------------------------------------
let clashes = []
for (let i = 0; i < blocks.length; i++) {
  for (let j = i + 1; j < blocks.length; j++) {
    if (overlaps(corners(blocks[i]), corners(blocks[j]))) {
      clashes.push(`${blocks[i].key}/${blocks[j].key}`)
    }
  }
}
check("no block intersects another", clashes.length === 0, clashes.join(" "))

// 7. Schema completeness -----------------------------------------------------
check("no curveDeg: 0 exists", !/curveDeg:\s*0\b/.test(SRC))
check('no shape: "serpentine" exists', !/"serpentine"/.test(SRC))
check("every block has five per-field confidences",
  blocks.every((b) => b.hasFiveConfidences))
check("plot-outline carries geometryFrom and no centre",
  /key:\s*"plot-outline"[\s\S]{0,200}?geometryFrom:\s*"vertices"/.test(SRC) &&
    !/key:\s*"plot-outline"[\s\S]{0,200}?centre:/.test(SRC))
check("every feature carries a rotationDeg",
  (SRC.slice(SRC.indexOf("export const siteFeatures")).match(/key:\s*"/g) ?? []).length ===
    (SRC.slice(SRC.indexOf("export const siteFeatures")).match(/rotationDeg:/g) ?? []).length)

// 8. Rotation convention regression -----------------------------------------
const A = blocks.find((b) => b.key === "A")
const E = blocks.find((b) => b.key === "E")
check("A renders west of E (rotation sign not flipped)",
  A.centre.x < E.centre.x, `A x=${A.centre.x}, E x=${E.centre.x}`)

const C2 = blocks.find((b) => b.key === "C2")
check("C2 is the hotel and sits at the crescent apex",
  C2.role === "hotel" && C2.centre.z < A.centre.z && C2.centre.z < E.centre.z,
  `C2 z=${C2.centre.z}`)

// ---------------------------------------------------------------------------

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures} of ${checks} checks passed\n`,
)
process.exit(failures === 0 ? 0 : 1)
