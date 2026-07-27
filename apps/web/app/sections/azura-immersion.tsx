import type { ReactNode } from "react"

import type { ProvenanceLabels } from "@/components/evidence/provenance-value"
import {
  AzuraEvidenceFlow,
  type CompetingPrice,
  type EvidenceFlowCounts,
  type EvidenceFlowLabels,
} from "@/components/immersion/azura-evidence-flow"
import {
  AzuraLiveSimulation,
  type LiveSimulationLabels,
} from "@/components/immersion/azura-live-simulation"
import {
  AzuraSiteWorld,
  type SiteBlock,
  type SiteWorldFacts,
  type SiteWorldLabels,
} from "@/components/immersion/azura-site-world"
import {
  AzuraUnitExplorer,
  type ExplorerUnit,
  type UnitExplorerLabels,
} from "@/components/immersion/azura-unit-explorer"
import {
  AuroraBackground,
  KineticHeadline,
  TiltCard,
} from "@/components/immersion/primitives"
import { CoastMaquette } from "@/components/three/coast-maquette"
import type { SourcedFact } from "@/lib/contracts"

/**
 * The immersion section, composed.                          Owner: W3-I
 *
 * THIS IS THE IMPORT SURFACE W3-A CONSUMES. One component, one props object:
 *
 *     import { AzuraImmersionSection } from "@/app/sections/azura-immersion"
 *     <AzuraImmersionSection {...props} />
 *
 * It is a **Server Component** and takes only serialisable props. Every child
 * that needs interactivity is `"use client"` on its own; this shell passes data
 * down and mounts nothing itself. That keeps the dataset — 33,562 lines — on
 * the server: only the handful of records actually rendered cross into the RSC
 * payload.
 *
 * W3-A owns the landing page and decides where this sits. It also owns mounting
 * `LenisProvider`, which is deliberately NOT global (see HANDOFF/W1-D.md).
 *
 * DATA IN, NOT DATA FETCHED. Every figure arrives as a prop from W3-A, which
 * gets it from W2-A's repositories. This section does not import the dataset,
 * so it cannot quietly start rendering a number nobody sourced.
 */

export interface AzuraImmersionLabels {
  eyebrow: string
  headline: string
  intro: string
  maquetteAlt: string
  liveSimulation: LiveSimulationLabels
  siteWorld: SiteWorldLabels
  unitExplorer: UnitExplorerLabels
  evidenceFlow: EvidenceFlowLabels
  provenance: ProvenanceLabels
}

export interface AzuraImmersionProps {
  locale: string
  labels: AzuraImmersionLabels
  /** Real block records. */
  blocks: readonly SiteBlock[]
  /** Real units. Windowed by the explorer — pass all 656. */
  units: readonly ExplorerUnit[]
  facts: SiteWorldFacts
  /** Pipeline counts, from the dataset's own coverage block. */
  counts: EvidenceFlowCounts
  /** F-002's competing values. */
  competingPrices: readonly CompetingPrice[]
  entryPriceFact: SourcedFact<{ amount: number; currency: string }>
  /** Whether the backing surface has a live channel. From W2-D. */
  realtime?: boolean
}

export function AzuraImmersionSection({
  locale,
  labels,
  blocks,
  units,
  facts,
  counts,
  competingPrices,
  entryPriceFact,
  realtime = false,
}: AzuraImmersionProps): ReactNode {
  const blockCodes = blocks.map((block) => block.code)
  // Only the ids the ticker can name — it never invents one, and it never
  // needs more than a handful.
  const unitIds = units.slice(0, 64).map((unit) => unit.id)

  return (
    <AuroraBackground className="w-full py-16">
      <div className="container mx-auto flex min-w-0 max-w-6xl flex-col gap-14">
        <header className="flex min-w-0 max-w-3xl flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            {labels.eyebrow}
          </p>
          <KineticHeadline
            text={labels.headline}
            as="h2"
            className="font-display text-3xl font-bold sm:text-4xl"
          />
          <p className="text-base leading-relaxed text-muted-foreground">
            {labels.intro}
          </p>
        </header>

        {/* The maquette carries all of W1-D's guards: lazy behind an
            IntersectionObserver, poster on no-WebGL / reduced motion / a low
            device tier, rAF paused off-tab, DPR capped, disposed on unmount. */}
        <TiltCard className="w-full">
          <CoastMaquette
            posterLabel={labels.maquetteAlt}
            className="border border-border shadow-lg"
          />
        </TiltCard>

        <AzuraSiteWorld
          blocks={blocks}
          facts={facts}
          labels={labels.siteWorld}
          provenanceLabels={labels.provenance}
          locale={locale}
        />

        <AzuraLiveSimulation
          blockCodes={blockCodes}
          unitIds={unitIds}
          labels={labels.liveSimulation}
          locale={locale}
        />

        <AzuraUnitExplorer
          units={units}
          labels={labels.unitExplorer}
          locale={locale}
          realtime={realtime}
        />

        {/* Last on purpose. The section opens with the property and closes with
            the argument: four publishers, four prices, and a conflict nobody
            resolved. */}
        <AzuraEvidenceFlow
          counts={counts}
          competingPrices={competingPrices}
          entryPriceFact={entryPriceFact}
          labels={labels.evidenceFlow}
          provenanceLabels={labels.provenance}
          locale={locale}
        />
      </div>
    </AuroraBackground>
  )
}
