"use client"

import { useState, type CSSProperties, type ReactNode } from "react"

import { cn } from "@/lib/cn"
import type { SourcedFact } from "@/lib/contracts"

import {
  ProvenanceValue,
  type ProvenanceLabels,
} from "@/components/evidence/provenance-value"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

/**
 * AzuraSiteWorld — CSS isometric masterplan.               Owner: W3-I
 *
 * Seven residence blocks, the hotel, the beach at 300 m, on the 76,000 m²
 * plot. CSS transforms throughout — no WebGL. The reference repos' "3D" is
 * mostly this: `isometric-erp-world.tsx` is CSS, `3d-card.tsx` is a shadow.
 * The only real WebGL in either is NLP's 235-line `TowerMaquette`.
 *
 * IT SAYS ON ITSELF THAT IT IS A SCHEMATIC, AND THAT IS NOT A DISCLAIMER
 * REFLEX. No source publishes a site plan, a per-block unit split, or a
 * building footprint layout. The block count (7) and the total (656) are
 * corroborated; **everything about the arrangement is drawn, including which
 * block is where.** A plausible-looking site plan reads as a survey, and a
 * reader who takes the geometry literally has been misled by us, not by a
 * source. So the caption is part of the component, not part of the page that
 * embeds it.
 *
 * Every figure renders through `ProvenanceValue`.
 *
 * Depth ordering is `translateZ` plus back-to-front source order, never
 * `z-index` — `z-index` and `preserve-3d` fight, and the result differs per
 * browser.
 */

export interface SiteWorldLabels {
  heading: string
  /** SHORT badge label, e.g. "Schema". Not a sentence — this goes in a Badge. */
  schematicBadge: string
  /** The full sentence. Rendered as a paragraph, twice: once under the scene
   *  and once as the caption, because it is the component's main claim. */
  schematicWarning: string
  blocks: string
  hotel: string
  beach: string
  plot: string
  units: string
  /** Step-through control labels. */
  steps: { site: string; block: string; floor: string; unit: string }
  stepHint: string
  /** e.g. "Block {code}" */
  blockLabel: string
  unitsInBlock: string
}

export interface SiteWorldFacts {
  residenceBlockCount: SourcedFact<number>
  totalUnits: SourcedFact<number>
  plotAreaSqm: SourcedFact<number>
  distanceToSeaM: SourcedFact<number>
  hotelRoomCount: SourcedFact<number>
}

/** One drawn volume. `unitCount` is real; x/y/height are drawn. */
export interface SiteBlock {
  code: string
  unitCount: number
  kind: "residence" | "hotel"
}

type Step = "site" | "block" | "floor" | "unit"
const STEPS: readonly Step[] = ["site", "block", "floor", "unit"]

/** Two rows of four — seven residence blocks plus the hotel. */
const COLUMN_PITCH = 20
const ROW_PITCH = 34

export function AzuraSiteWorld({
  blocks,
  facts,
  labels,
  provenanceLabels,
  locale,
  className,
}: {
  blocks: readonly SiteBlock[]
  facts: SiteWorldFacts
  labels: SiteWorldLabels
  provenanceLabels: ProvenanceLabels
  locale: string
  className?: string
}): ReactNode {
  const [step, setStep] = useState<Step>("site")
  const [activeBlock, setActiveBlock] = useState<string | null>(null)

  const stepIndex = STEPS.indexOf(step)

  return (
    <div
      data-slot="site-world"
      className={cn("flex min-w-0 flex-col gap-4", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-xl font-semibold">{labels.heading}</h3>
        <Badge variant="modelled">{labels.schematicBadge}</Badge>
      </div>

      {/* The scene is decorative: the same information is in the figure list
          below, as text. A screen reader walking 8 nested transformed divs
          learns nothing. */}
      <div
        className="azura-iso-scene aspect-[16/10] w-full rounded-xl border border-border bg-card"
        aria-hidden="true"
      >
        <div className="azura-iso-sea" />
        <div className="azura-iso-ground" />
        <div className="azura-iso-field">
          {blocks.map((block, index) => {
            const column = index % 4
            const row = Math.floor(index / 4)
            const height = 46 + Math.round((block.unitCount / 100) * 34)
            const isActive = activeBlock === block.code
            const dimmed = activeBlock !== null && !isActive

            return (
              <div
                key={block.code}
                className="azura-iso-slot"
                style={
                  {
                    "--iso-x": `${column * COLUMN_PITCH}%`,
                    "--iso-y": `${row * ROW_PITCH}%`,
                    "--iso-h": `${block.kind === "hotel" ? height + 26 : height}px`,
                    opacity: dimmed ? 0.4 : 1,
                    transition: "opacity 320ms cubic-bezier(0.23,1,0.32,1)",
                  } as CSSProperties
                }
              >
                <div className="azura-iso-shadow" />
                <div className="azura-iso-block" data-kind={block.kind}>
                  {/* Windows light up only once the walkthrough reaches the
                      floor step — the detail arrives when it is the subject. */}
                  {Array.from({ length: 9 }, (_, cell) => (
                    <span
                      key={cell}
                      className="azura-iso-window"
                      style={{
                        opacity:
                          stepIndex >= 2 && (isActive || activeBlock === null)
                            ? 0.35 + ((cell * 7) % 5) * 0.13
                            : 0.25,
                      }}
                    />
                  ))}
                </div>
                <span className="azura-iso-label">{block.code}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Walkthrough */}
      <div className="flex flex-wrap items-center gap-2">
        {STEPS.map((candidate, index) => (
          <Button
            key={candidate}
            size="sm"
            variant={step === candidate ? "default" : "outline"}
            aria-pressed={step === candidate}
            onClick={() => {
              setStep(candidate)
              setActiveBlock(index >= 1 ? (blocks[0]?.code ?? null) : null)
            }}
            data-testid={`site-step-${candidate}`}
          >
            {labels.steps[candidate]}
          </Button>
        ))}
        <p className="w-full text-xs text-muted-foreground">{labels.stepHint}</p>
      </div>

      {/* The information, as text. This is the accessible path and it is not a
          summary of the scene — it is the same content, sourced. */}
      <dl className="grid gap-3 sm:grid-cols-2">
        <Figure label={labels.blocks}>
          <ProvenanceValue
            fact={facts.residenceBlockCount}
            format="number"
            locale={locale}
            labels={provenanceLabels}
          />
        </Figure>
        <Figure label={labels.units}>
          <ProvenanceValue
            fact={facts.totalUnits}
            format="number"
            locale={locale}
            labels={provenanceLabels}
          />
        </Figure>
        <Figure label={labels.plot}>
          <ProvenanceValue
            fact={facts.plotAreaSqm}
            format="area"
            locale={locale}
            labels={provenanceLabels}
          />
        </Figure>
        <Figure label={labels.beach}>
          <ProvenanceValue
            fact={facts.distanceToSeaM}
            format="metres"
            locale={locale}
            labels={provenanceLabels}
          />
        </Figure>
        <Figure label={labels.hotel}>
          <ProvenanceValue
            fact={facts.hotelRoomCount}
            format="number"
            locale={locale}
            labels={provenanceLabels}
          />
        </Figure>
      </dl>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {labels.schematicWarning}
      </p>
    </div>
  )
}

function Figure({
  label,
  children,
}: {
  label: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-3">
      <dt className="text-xs uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}
