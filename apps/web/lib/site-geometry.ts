/**
 * The Azura World site, as measurable geometry.              Owner: W-SITEMODEL
 *
 * Every number here was fitted to drawings Azura World and Cebeci Group
 * published themselves, chiefly the numbered 3D masterplan at
 * `azuraworld.com/assets/3d-vaziyet-plan.jpg`, corroborated against the GENERAL
 * PLAN and three aerial renders. Nothing was invented to make a picture work.
 *
 * ## Read the confidence, not the number
 *
 * A single scalar confidence would be a lie on every row. A block's centre is
 * read off a drawing, its rotation is fitted to that drawing, its storey count
 * comes from a different elevation strip, and its shape is a simplification of
 * a real facade. Those four claims are not equally strong, so `confidence`
 * grades each field separately and `storeys` is `guessed` on every block in the
 * set. **Storeys drive extrusion height and are never rendered as a number** —
 * they contradict `project.floorsPerBuilding` (6, single source, itself
 * conflicted against 5) and this file is not the place to resolve that.
 *
 * ## The arithmetic is checkable, and it is checked
 *
 * `scripts/check-site-geometry.mjs` recomputes the totals from this data on
 * every run rather than trusting the comments:
 *
 *   shoelace(plotVertices)              = 73,618 m2
 *   + blockIParcelAreaSqm               =  2,584 m2
 *   = 76,202 m2   vs the published 76,000   (+0.27%)
 *
 *   sum(footprintSqm) over all 17       = 15,183 m2
 *                 vs the published 15,000   (+1.2%)
 *
 * Those margins are the honest result of fitting boxes to a perspective render.
 * They are recorded rather than tuned away: a spec that reproduced 76,000
 * exactly would mean somebody had adjusted the drawing to match the brochure.
 *
 * ## Why the building count finally reconciles
 *
 * The developer's plan letters eleven keys (A, B, C1, C2, C3, D, E, I, F1, F2,
 * H) and additionally marks three masses `? BLOK` — the amphitheatre and the
 * two arcade rows, carried here as UNREAD-1..3. Eleven plus three is fourteen,
 * which is `project.buildingCount`. G is real but appears only in the
 * Alanya-Home renders, so it sits outside that arithmetic; UNREAD-4 is a fourth
 * unread label with no counterpart in the published count. Both are kept, and
 * both are excluded from the reconciliation rather than being quietly folded in
 * to make it land.
 *
 * ## Sign convention, which is easy to get backwards and silent when you do
 *
 * `rotationDeg` is the plan-view angle of the long axis, measured from +x
 * toward +z. In CSS that is `rotateZ(rotationDeg)` applied inside the
 * `.azura-iso-field` transform. Reversing it mirrors the crescent and swaps A
 * with E without breaking anything visibly enough to notice, so the gate
 * asserts A renders west of E.
 */

/** x is east, z is south, metres, origin at the plot polygon centroid. */
export interface PlanPoint {
  readonly x: number
  readonly z: number
}

export type BlockShape =
  | "bar"
  | "curved-bar"
  | "domed-centre"
  | "string"
  | "fan"

export type BlockRole = "residence" | "hotel" | "amenity" | "service" | "unknown"

/** Read off a drawing, derived from something read, or frankly a guess. */
export type Confidence = "read-from-plan" | "inferred" | "guessed"

export interface FieldConfidence {
  readonly centre: Confidence
  readonly size: Confidence
  readonly rotation: Confidence
  readonly storeys: Confidence
  readonly shape: Confidence
}

export interface SiteBlock {
  readonly key: string
  readonly role: BlockRole
  /** Extrusion height only. Never printed. See the header. */
  readonly storeys: number
  readonly centre: PlanPoint
  readonly size: { readonly w: number; readonly d: number }
  readonly rotationDeg: number
  readonly shape: BlockShape
  /** Total sweep of an arced facade. Never 0 — omit the field instead. */
  readonly curveDeg?: number
  readonly domeDiameterM?: number
  readonly domeHeightM?: number
  /** Ends terrace down by this many storeys on the crescent blocks. */
  readonly endStepDownStoreys?: number
  readonly fan?: {
    readonly radius: number
    readonly sweepDeg: number
    readonly unitCount: number
  }
  /** w * d, or the ellipse area where the mass is round. Gate-checked. */
  readonly footprintSqm: number
  /** True for the three `? BLOK` masses that reconcile to buildingCount. */
  readonly countsTowardBuildingCount: boolean
  readonly confidence: FieldConfidence
  readonly note?: string
}

export type FeatureClass = "zone" | "structure" | "water" | "surface"

export interface SiteFeature {
  readonly key: string
  readonly featureClass: FeatureClass
  /** `vertices` and `ring` features carry no centre or size, by design. */
  readonly geometryFrom?: "vertices" | "ring"
  readonly centre?: PlanPoint
  readonly size?: { readonly w: number; readonly d: number }
  readonly rotationDeg: number
  /** Containment claim, asserted by the gate. */
  readonly within?: string
  readonly note?: string
}

// ---------------------------------------------------------------------------
// Top-level constants
// ---------------------------------------------------------------------------

/** Derived from `plotVertices`, never restated. The gate recomputes it. */
export const plotMetres = { w: 372, d: 432 } as const

export const plotAreaSqm = 73_618
export const blockIParcelAreaSqm = 2_584
export const totalPlotSqm = plotAreaSqm + blockIParcelAreaSqm

export const storeyHeightM = 3.2
export const podiumHeightM = 4.5

/**
 * The plan is drawn at an angle to true north, and how much is a guess. It is
 * carried explicitly so that nothing downstream quietly assumes the drawing is
 * north-up.
 */
export const globalYawDeg = 40
export const seaDirectionTrue = "south"
export const seaDirectionPlanFrame = "plan bearing 140 deg, plus or minus 25"
export const metresPerPlanPixel = 0.63

/** Clockwise from the north apex. Shoelace = 73,618 m2. */
export const plotVertices: readonly PlanPoint[] = Object.freeze([
  { x: -14, z: -193 },
  { x: 140, z: -78 },
  { x: 203, z: -23 },
  { x: 60, z: 67 },
  { x: 42, z: 94 },
  { x: 25, z: 239 },
  { x: -27, z: 239 },
  { x: -38, z: 176 },
  { x: -145, z: 125 },
  { x: -54, z: 50 },
  { x: -169, z: -73 },
])

const read = "read-from-plan" as const
const inf = "inferred" as const
const guess = "guessed" as const

/** Most of the set: position fitted, storeys guessed. */
const FITTED: FieldConfidence = {
  centre: inf,
  size: inf,
  rotation: inf,
  storeys: guess,
  shape: inf,
}

const ALL_INFERRED: FieldConfidence = {
  centre: inf,
  size: inf,
  rotation: inf,
  storeys: inf,
  shape: inf,
}

const ALL_GUESSED: FieldConfidence = {
  centre: guess,
  size: guess,
  rotation: guess,
  storeys: guess,
  shape: guess,
}

// ---------------------------------------------------------------------------
// The blocks
// ---------------------------------------------------------------------------

export const siteBlocks: readonly SiteBlock[] = Object.freeze([
  // --- the crescent, west to east. A and E are the squarer end pavilions. ---
  {
    key: "A",
    role: "residence",
    storeys: 8,
    centre: { x: -119, z: -52 },
    size: { w: 34, d: 24 },
    rotationDeg: -80,
    shape: "bar",
    endStepDownStoreys: 2,
    footprintSqm: 816,
    countsTowardBuildingCount: true,
    confidence: FITTED,
  },
  {
    key: "B",
    role: "residence",
    storeys: 8,
    centre: { x: -95, z: -94 },
    size: { w: 42, d: 22 },
    rotationDeg: -55,
    shape: "curved-bar",
    curveDeg: 26,
    endStepDownStoreys: 2,
    footprintSqm: 924,
    countsTowardBuildingCount: true,
    confidence: FITTED,
  },
  {
    key: "C1",
    role: "residence",
    storeys: 8,
    centre: { x: -62, z: -124 },
    size: { w: 34, d: 22 },
    rotationDeg: -29,
    shape: "curved-bar",
    curveDeg: 19,
    endStepDownStoreys: 2,
    footprintSqm: 748,
    countsTowardBuildingCount: true,
    confidence: FITTED,
  },
  {
    // The domed centrepiece of the crescent. The one block whose identity the
    // drawing states outright rather than leaving to be fitted.
    key: "C2",
    role: "hotel",
    storeys: 8,
    centre: { x: -13, z: -137 },
    size: { w: 48, d: 32 },
    rotationDeg: 0,
    shape: "domed-centre",
    curveDeg: 27,
    domeDiameterM: 18,
    domeHeightM: 14,
    footprintSqm: 1_536,
    countsTowardBuildingCount: true,
    confidence: {
      centre: read,
      size: inf,
      rotation: read,
      storeys: guess,
      shape: read,
    },
  },
  {
    key: "C3",
    role: "residence",
    storeys: 8,
    centre: { x: 36, z: -124 },
    size: { w: 34, d: 22 },
    rotationDeg: 29,
    shape: "curved-bar",
    curveDeg: 19,
    endStepDownStoreys: 2,
    footprintSqm: 748,
    countsTowardBuildingCount: true,
    confidence: FITTED,
  },
  {
    key: "D",
    role: "residence",
    storeys: 8,
    centre: { x: 69, z: -94 },
    size: { w: 42, d: 22 },
    rotationDeg: 55,
    shape: "curved-bar",
    curveDeg: 26,
    endStepDownStoreys: 2,
    footprintSqm: 924,
    countsTowardBuildingCount: true,
    confidence: FITTED,
  },
  {
    key: "E",
    role: "residence",
    storeys: 8,
    centre: { x: 93, z: -52 },
    size: { w: 34, d: 24 },
    rotationDeg: 80,
    shape: "bar",
    endStepDownStoreys: 2,
    footprintSqm: 816,
    countsTowardBuildingCount: true,
    confidence: FITTED,
  },

  // --- the low serpentine townhouse runs, east side ---
  {
    key: "F2",
    role: "residence",
    storeys: 3,
    centre: { x: 54, z: 45 },
    size: { w: 46, d: 16 },
    rotationDeg: -32,
    shape: "string",
    footprintSqm: 736,
    countsTowardBuildingCount: true,
    confidence: FITTED,
  },
  {
    key: "H",
    role: "residence",
    storeys: 3,
    centre: { x: 98, z: 17 },
    size: { w: 48, d: 18 },
    rotationDeg: -32,
    shape: "string",
    footprintSqm: 864,
    countsTowardBuildingCount: true,
    confidence: FITTED,
  },
  {
    key: "F1",
    role: "residence",
    storeys: 3,
    centre: { x: 142, z: -10 },
    size: { w: 46, d: 16 },
    rotationDeg: -32,
    shape: "string",
    footprintSqm: 736,
    countsTowardBuildingCount: true,
    confidence: FITTED,
  },
  {
    // Never lettered on the developer's own plan. It appears only in the
    // Alanya-Home renders and one caption, so it is carried but deliberately
    // left out of the buildingCount reconciliation.
    key: "G",
    role: "residence",
    storeys: 2,
    centre: { x: 150, z: -41 },
    size: { w: 38, d: 20 },
    rotationDeg: -32,
    shape: "fan",
    fan: { radius: 26, sweepDeg: 70, unitCount: 12 },
    footprintSqm: 760,
    countsTowardBuildingCount: false,
    confidence: ALL_GUESSED,
    note: "absent from the first-party plan",
  },

  // --- the detached parcel to the south west ---
  {
    key: "I",
    role: "residence",
    storeys: 8,
    centre: { x: -86, z: 204 },
    size: { w: 62, d: 22 },
    rotationDeg: -25,
    shape: "bar",
    footprintSqm: 1_364,
    countsTowardBuildingCount: true,
    confidence: FITTED,
    note: "sits in block-I-parcel, outside the main plot polygon",
  },

  // --- the three masses the plan marks only as "? BLOK", plus a fourth ---
  {
    key: "UNREAD-1",
    role: "unknown",
    storeys: 1,
    centre: { x: -13, z: 29 },
    size: { w: 45, d: 38 },
    rotationDeg: 0,
    shape: "domed-centre",
    domeDiameterM: 45,
    domeHeightM: 9,
    // Elliptical, so the footprint is pi/4 * w * d rather than w * d.
    footprintSqm: 1_343,
    countsTowardBuildingCount: true,
    confidence: ALL_INFERRED,
    note: "open-air amphitheatre",
  },
  {
    key: "UNREAD-2",
    role: "unknown",
    storeys: 1,
    centre: { x: -22, z: 130 },
    size: { w: 14, d: 70 },
    rotationDeg: 0,
    shape: "bar",
    footprintSqm: 980,
    countsTowardBuildingCount: true,
    confidence: ALL_INFERRED,
    note: "retail arcade, west row",
  },
  {
    key: "UNREAD-3",
    role: "unknown",
    storeys: 1,
    centre: { x: 5, z: 130 },
    size: { w: 14, d: 70 },
    rotationDeg: 0,
    shape: "bar",
    footprintSqm: 980,
    countsTowardBuildingCount: true,
    confidence: ALL_INFERRED,
    note: "retail arcade, east row",
  },
  {
    key: "UNREAD-4",
    role: "unknown",
    storeys: 1,
    centre: { x: -84, z: 118 },
    size: { w: 22, d: 14 },
    rotationDeg: -38,
    shape: "bar",
    footprintSqm: 308,
    countsTowardBuildingCount: false,
    confidence: ALL_GUESSED,
    note: "wing building inside the water park zone, no counterpart in the published count",
  },

  {
    key: "GATEHOUSE",
    role: "service",
    storeys: 1,
    centre: { x: -11, z: 223 },
    size: { w: 30, d: 20 },
    rotationDeg: 0,
    shape: "bar",
    footprintSqm: 600,
    countsTowardBuildingCount: false,
    confidence: {
      centre: read,
      size: inf,
      rotation: inf,
      storeys: guess,
      shape: read,
    },
  },
])

// ---------------------------------------------------------------------------
// Everything that is not a building
// ---------------------------------------------------------------------------

export const siteFeatures: readonly SiteFeature[] = Object.freeze([
  {
    key: "plot-outline",
    featureClass: "zone",
    geometryFrom: "vertices",
    rotationDeg: 0,
  },
  {
    key: "perimeter-ring-road",
    featureClass: "surface",
    geometryFrom: "vertices",
    rotationDeg: 0,
    note: "the plot ring inset 8 m",
  },
  {
    key: "block-I-parcel",
    featureClass: "zone",
    centre: { x: -86, z: 204 },
    size: { w: 68, d: 38 },
    rotationDeg: -25,
    note: "detached parcel; block I is contained here, not in plot-outline",
  },
  {
    key: "lagoon-pool",
    featureClass: "water",
    centre: { x: -11, z: -45 },
    size: { w: 76, d: 74 },
    rotationDeg: 0,
  },
  {
    key: "lazy-river",
    featureClass: "zone",
    geometryFrom: "ring",
    centre: { x: -4, z: -20 },
    size: { w: 100, d: 145 },
    rotationDeg: 0,
    note: "a 14 m channel loop, not a solid body",
  },
  {
    key: "lap-pool-west",
    featureClass: "water",
    centre: { x: -78, z: -46 },
    size: { w: 56, d: 14 },
    rotationDeg: 41,
  },
  {
    key: "lap-pool-east",
    featureClass: "water",
    centre: { x: 53, z: -47 },
    size: { w: 56, d: 14 },
    rotationDeg: -47,
  },
  {
    key: "aquapark",
    featureClass: "zone",
    centre: { x: -84, z: 118 },
    size: { w: 46, d: 34 },
    rotationDeg: -38,
    note: "contains UNREAD-4; the slide count is not derivable from geometry",
  },
  {
    key: "tennis-court",
    featureClass: "surface",
    centre: { x: -52, z: 104 },
    size: { w: 34, d: 17 },
    rotationDeg: -38,
  },
])

// ---------------------------------------------------------------------------
// Pure predicates. No React, no DOM — the gate imports this file from Node.
// ---------------------------------------------------------------------------

/** The four rotated corners of a block, in plan metres. */
export function rectCorners(block: SiteBlock): readonly PlanPoint[] {
  const rad = (block.rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const hw = block.size.w / 2
  const hd = block.size.d / 2
  return [
    { x: -hw, z: -hd },
    { x: hw, z: -hd },
    { x: hw, z: hd },
    { x: -hw, z: hd },
  ].map((p) => ({
    x: block.centre.x + p.x * cos - p.z * sin,
    z: block.centre.z + p.x * sin + p.z * cos,
  }))
}

/** Ray casting. Points exactly on an edge are not worth distinguishing here. */
export function containsPoint(
  polygon: readonly PlanPoint[],
  point: PlanPoint,
): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a === undefined || b === undefined) continue
    const straddles = a.z > point.z !== b.z > point.z
    if (!straddles) continue
    const cross = ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x
    if (point.x < cross) inside = !inside
  }
  return inside
}

/**
 * Separating axis theorem on two convex quads. Two rectangles do not overlap
 * exactly when some edge normal of one separates them, so four axes suffice.
 */
export function rectsOverlap(
  a: readonly PlanPoint[],
  b: readonly PlanPoint[],
): boolean {
  for (const quad of [a, b]) {
    for (let i = 0; i < quad.length; i++) {
      const p = quad[i]
      const q = quad[(i + 1) % quad.length]
      if (p === undefined || q === undefined) continue
      // The outward normal of this edge.
      const axis = { x: -(q.z - p.z), z: q.x - p.x }
      let minA = Infinity
      let maxA = -Infinity
      let minB = Infinity
      let maxB = -Infinity
      for (const v of a) {
        const d = v.x * axis.x + v.z * axis.z
        if (d < minA) minA = d
        if (d > maxA) maxA = d
      }
      for (const v of b) {
        const d = v.x * axis.x + v.z * axis.z
        if (d < minB) minB = d
        if (d > maxB) maxB = d
      }
      if (maxA < minB || maxB < minA) return false
    }
  }
  return true
}

/** Shoelace. Sign is discarded, so winding order does not matter. */
export function polygonArea(polygon: readonly PlanPoint[]): number {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    if (a === undefined || b === undefined) continue
    sum += a.x * b.z - b.x * a.z
  }
  return Math.abs(sum) / 2
}

/** Inset a closed polygon toward its centroid. Good enough for a ring road. */
export function insetPolygon(
  polygon: readonly PlanPoint[],
  metres: number,
): readonly PlanPoint[] {
  const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length
  const cz = polygon.reduce((s, p) => s + p.z, 0) / polygon.length
  return polygon.map((p) => {
    const dx = p.x - cx
    const dz = p.z - cz
    const len = Math.hypot(dx, dz) || 1
    const scale = Math.max(0, len - metres) / len
    return { x: cx + dx * scale, z: cz + dz * scale }
  })
}

/** The 14 the developer's own plan accounts for. Asserted by the gate. */
export const reconciledBuildingCount = siteBlocks.filter(
  (b) => b.countsTowardBuildingCount,
).length
