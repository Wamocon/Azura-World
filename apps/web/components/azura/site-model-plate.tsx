/**
 * The masterplan, drawn.                                     Owner: W-SITEMODEL
 *
 * Shared by the server render and the client hydration, so both frames are
 * byte-identical and React never rebuilds the tree. It takes no state: the
 * live layer reaches in by ref afterwards and writes custom properties.
 *
 * ## Why the geometry is inline style and not a class
 *
 * `.azura-iso-slot` in globals.css is a fixed 64x116 cell on a grid, which is
 * right for a schematic of seven identical bars and wrong for this: these are
 * seventeen real footprints at real bearings, where A is 34 x 24 m at -80 deg
 * and I is 62 x 22 m at -25 deg on a detached parcel. Expressing that as
 * classes would mean seventeen of them.
 *
 * So the stage keeps the existing `.azura-iso-*` classes and every block's
 * position, size and bearing arrives as an inline style computed from
 * `lib/site-geometry.ts`. The CSP allows it: proxy.ts emits `style-src 'self'
 * 'unsafe-inline'`, which covers style attributes.
 *
 * ## The projection
 *
 * Plan metres map linearly onto the plate as percentages, so the drawing is to
 * scale in both axes and nothing is nudged to look better. `.azura-iso-field`
 * supplies `rotateX(58deg) rotateZ(-8deg)` and `preserve-3d`; each block then
 * takes `rotateZ(its own bearing)` inside that frame and rises off the plate
 * with `translateZ`. Sign convention is the one `site-geometry.ts` documents,
 * and getting it backwards mirrors the crescent silently, which is why
 * `qa:geometry` asserts A ends up west of E.
 *
 * Height is `storeys`, which is `guessed` on every block. It is extrusion only
 * and is never written as a number anywhere.
 */

import type { CSSProperties, ReactNode } from "react"

import { cn } from "@/lib/cn"
import {
  plotVertices,
  siteBlocks,
  siteFeatures,
  storeyHeightM,
  type SiteBlock,
  type SiteFeature,
} from "@/lib/site-geometry"

// The plan bounding box, derived rather than restated.
const XS = plotVertices.map((v) => v.x)
const ZS = plotVertices.map((v) => v.z)
const MIN_X = Math.min(...XS)
const MIN_Z = Math.min(...ZS)
const SPAN_X = Math.max(...XS) - MIN_X
const SPAN_Z = Math.max(...ZS) - MIN_Z

const pctX = (x: number): number => ((x - MIN_X) / SPAN_X) * 100
const pctZ = (z: number): number => ((z - MIN_Z) / SPAN_Z) * 100

/** Metres of height per pixel of translateZ. Tuned once, for the whole plate. */
const Z_PER_METRE = 0.62

/** The plot polygon as a clip-path, so the ground is the real parcel shape. */
const PLOT_CLIP = `polygon(${plotVertices
  .map((v) => `${pctX(v.x).toFixed(2)}% ${pctZ(v.z).toFixed(2)}%`)
  .join(", ")})`

function blockStyle(block: SiteBlock): CSSProperties {
  return {
    left: `${pctX(block.centre.x)}%`,
    top: `${pctZ(block.centre.z)}%`,
    width: `${(block.size.w / SPAN_X) * 100}%`,
    height: `${(block.size.d / SPAN_Z) * 100}%`,
    // Centre on the footprint, take the block's own bearing, then rise.
    transform: `translate(-50%, -50%) rotateZ(${block.rotationDeg}deg) translateZ(${(
      block.storeys * storeyHeightM * Z_PER_METRE
    ).toFixed(1)}px)`,
    borderRadius: block.shape === "domed-centre" ? "50%" : "3px",
  }
}

function shadowStyle(block: SiteBlock): CSSProperties {
  return {
    left: `${pctX(block.centre.x)}%`,
    top: `${pctZ(block.centre.z)}%`,
    width: `${(block.size.w / SPAN_X) * 100}%`,
    height: `${(block.size.d / SPAN_Z) * 100}%`,
    // Offset a touch so the mass reads as standing on the plate rather than
    // floating over its own outline.
    transform: `translate(-48%, -44%) rotateZ(${block.rotationDeg}deg)`,
    borderRadius: block.shape === "domed-centre" ? "50%" : "3px",
  }
}

function featureStyle(feature: SiteFeature): CSSProperties | null {
  if (feature.centre === undefined || feature.size === undefined) return null
  return {
    left: `${pctX(feature.centre.x)}%`,
    top: `${pctZ(feature.centre.z)}%`,
    width: `${(feature.size.w / SPAN_X) * 100}%`,
    height: `${(feature.size.d / SPAN_Z) * 100}%`,
    transform: `translate(-50%, -50%) rotateZ(${feature.rotationDeg}deg)`,
    borderRadius: feature.key.includes("pool") || feature.key === "lazy-river" ? "44%" : "6px",
  }
}

const WATER = new Set(["lagoon-pool", "lap-pool-west", "lap-pool-east", "lazy-river"])

/** Colour by what the mass is, not by how tall it is. */
function blockTone(block: SiteBlock): string {
  if (block.role === "hotel")
    return "border-[color-mix(in_srgb,var(--primary)_72%,transparent)] bg-[color-mix(in_srgb,var(--primary)_46%,transparent)]"
  if (block.role === "residence")
    return "border-[color-mix(in_srgb,var(--primary)_42%,transparent)] bg-[color-mix(in_srgb,var(--primary)_24%,transparent)]"
  // The three masses the plan marks only "? BLOK", the gatehouse and the fourth
  // unread label. Drawn quieter because we do not know what they are.
  return "border-[color-mix(in_srgb,var(--foreground)_26%,transparent)] bg-[color-mix(in_srgb,var(--foreground)_12%,transparent)]"
}

export function SiteModelPlate({
  labelledBlocks,
  selectedBlock,
  className,
}: {
  /** Which masses get a visible letter. The unread ones never do. */
  labelledBlocks: readonly string[]
  selectedBlock: string | null
  className?: string
}): ReactNode {
  return (
    <div
      className={cn(
        "azura-iso-scene aspect-[372/432] w-full rounded-[var(--radius)]",
        className,
      )}
      data-site-plate
    >
      <div aria-hidden="true" className="azura-iso-sea" />

      {/* The ground is the real parcel outline, not a rounded rectangle.
          The class's own fill is `primary` at 6%, which was a cool wash while
          primary was azure and became a large warm mass the moment the palette
          was re-measured to the building's gold. Overridden to a neutral so the
          gold stays on the buildings, where it means something. */}
      <div
        aria-hidden="true"
        className="azura-iso-ground !inset-[8%_5%_8%] !border-[color-mix(in_srgb,var(--foreground)_16%,transparent)] !bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]"
        style={{ clipPath: PLOT_CLIP, borderRadius: 0 }}
      />

      <div className="azura-iso-field" aria-hidden="true">
        {/* Water and courts first: they lie on the plate, under everything. */}
        {siteFeatures.map((feature) => {
          const style = featureStyle(feature)
          if (style === null) return null
          const isWater = WATER.has(feature.key)
          return (
            <div
              key={feature.key}
              style={style}
              className={cn(
                "absolute",
                // `--sea-shallow`, not `--accent`. This section renders on the
                // night surface, which carries its own palette, and there
                // `--accent` is a warm tone rather than the sky blue measured
                // into `:root` - so the pools came out the colour of sand. The
                // sea tokens are what `.azura-iso-sea` already uses on this
                // same plate, so water now matches water on every surface.
                isWater
                  ? "bg-[color-mix(in_srgb,var(--sea-shallow)_46%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--sea-shallow)_62%,transparent)]"
                  : "bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--foreground)_12%,transparent)]",
              )}
              data-site-feature={feature.key}
            />
          )
        })}

        {/* Grounding shadows, then the masses. Back to front by source order:
            z-index fights preserve-3d, so it is never used here. */}
        {siteBlocks.map((block) => (
          <div
            key={`shadow-${block.key}`}
            style={shadowStyle(block)}
            className="absolute bg-[rgba(2,9,14,0.42)] blur-[2px]"
          />
        ))}

        {siteBlocks.map((block) => (
          <div
            key={block.key}
            data-site-block={block.key}
            style={blockStyle(block)}
            className={cn(
              "absolute border transition-[background-color,border-color] duration-[var(--duration-base)] ease-[var(--ease-out)]",
              blockTone(block),
              // The live layer writes --sim-pulse on these; the ring is what it
              // becomes visible through. Zero by default, so a static render
              // shows no activity at all.
              "shadow-[0_0_calc(var(--sim-pulse,0)*18px)_color-mix(in_srgb,var(--accent)_calc(var(--sim-pulse,0)*70%),transparent)]",
              selectedBlock === block.key &&
                "!border-[var(--primary)] !bg-[color-mix(in_srgb,var(--primary)_62%,transparent)]",
            )}
          />
        ))}

        {/* Letters live INSIDE the field, not in a sibling layer.
            They were in an absolutely-positioned overlay at a different inset,
            which is a different coordinate space from the rotated field, so
            every letter floated somewhere near its block instead of on it.
            Placed here and counter-rotated by the exact inverse of the field's
            own `rotateX(58deg) rotateZ(-8deg)`, each one stands upright facing
            the reader while its anchor stays on the footprint. Raised above the
            roof line so it is not buried by the mass it names. */}
        {siteBlocks
          .filter((b) => labelledBlocks.includes(b.key))
          .map((block) => (
            <span
              key={`label-${block.key}`}
              style={{
                left: `${pctX(block.centre.x)}%`,
                top: `${pctZ(block.centre.z)}%`,
                transform: `translate(-50%, -50%) translateZ(${(
                  block.storeys * storeyHeightM * Z_PER_METRE +
                  9
                ).toFixed(1)}px) rotateZ(8deg) rotateX(-58deg)`,
              }}
              className={cn(
                "absolute font-mono text-[0.5rem] leading-none font-medium tracking-[0.06em]",
                block.role === "hotel"
                  ? "text-[var(--primary)]"
                  : "text-[color-mix(in_srgb,var(--foreground)_72%,transparent)]",
              )}
            >
              {block.key}
            </span>
          ))}
      </div>
    </div>
  )
}
