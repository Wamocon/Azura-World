import type { ReactNode } from "react"

import {
  AzuraImmersionSection,
  type AzuraImmersionLabels,
} from "@/app/sections/azura-immersion"
import type { CompetingPrice } from "@/components/immersion/azura-evidence-flow"
import type { SiteBlock } from "@/components/immersion/azura-site-world"
import type { ExplorerUnit } from "@/components/immersion/azura-unit-explorer"
import { azuraWorldDataset } from "@/lib/azura-world-data"
import type { SourcedFact } from "@/lib/contracts"

/**
 * The immersion layer, mounted against the REAL dataset.   Owner: W3-I
 *
 * This is the W3-I proof. It reads `lib/azura-world-data.ts` directly rather
 * than through W2-A's repositories, because those are still being written —
 * the shapes are identical (`RepositoryResult.data` is exactly what is passed
 * here), so W3-A swaps the source without touching the section.
 *
 * A Server Component: the 33,562-line dataset stays on the server and only the
 * records actually rendered cross into the RSC payload.
 *
 * The German strings are inline for the same reason as the rest of the kitchen
 * sink — this is a dev-only proof route, and W1-C owns the real messages.
 */

const dataset = azuraWorldDataset

/** Structural cast to the frozen contract type. The dataset declares its own
 *  `Azura*` twins, which are identical field-for-field; the generated file just
 *  does not import from `contracts.ts` (it is dependency-free by design). */
function asFact<T>(value: unknown): SourcedFact<T> {
  return value as SourcedFact<T>
}

const blocks: SiteBlock[] = [
  ...dataset.blocks.map((block) => ({
    code: String(block.code),
    unitCount: Number(block.unitCount),
    kind: "residence" as const,
  })),
  // The hotel is not in `blocks` — it is a separate record in the dataset, and
  // 188 rooms is not a unit count. It is drawn as the eighth volume because the
  // masterplan is a schematic, which the component says on itself.
  { code: "HOTEL", unitCount: 188, kind: "hotel" as const },
]

const units: ExplorerUnit[] = dataset.units.map((unit) => ({
  id: unit.id,
  blockCode: unit.blockCode,
  layout: unit.layout,
  interiorM2: unit.interiorM2,
  dataQuality: unit.dataQuality,
}))

/**
 * F-002's competing values, deduplicated by publisher + amount.
 *
 * The finding carries nineteen entries; several are repeat observations of the
 * same listing. Housearch legitimately appears twice — USD 238,967 and USD
 * 239,171, both at 75 m² — and BOTH are kept, because collapsing them would be
 * the silent resolution CONTRACTS §8 forbids.
 */
const competingPrices: CompetingPrice[] = (() => {
  const finding = dataset.findings.find((entry) => entry.id === "F-002")
  if (finding === undefined) return []
  const seen = new Set<string>()
  const out: CompetingPrice[] = []
  for (const candidate of finding.competingValues) {
    const value = candidate.value as { amount?: number; currency?: string }
    if (typeof value.amount !== "number" || typeof value.currency !== "string") {
      continue
    }
    const key = `${candidate.source.publisher}:${value.amount}:${value.currency}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      publisher: candidate.source.publisher,
      amount: value.amount,
      currency: value.currency,
    })
  }
  return out.sort((a, b) => a.amount - b.amount)
})()

/** The 1+1 entry price as a conflicted fact, built from F-002. */
const entryPriceFact: SourcedFact<{ amount: number; currency: string }> = (() => {
  const finding = dataset.findings.find((entry) => entry.id === "F-002")
  const values = finding?.competingValues ?? []
  const first = values[0]
  if (first === undefined) {
    return {
      value: null,
      confidence: "gap",
      sources: [],
      note: "F-002 not present in the dataset.",
    }
  }
  return {
    value: first.value as { amount: number; currency: string },
    confidence: "conflicted",
    sources: [first.source as SourcedFact<never>["sources"][number]],
    conflictsWith: values.slice(1).map((candidate) => ({
      value: candidate.value,
      source: candidate.source as SourcedFact<never>["sources"][number],
    })),
  }
})()

const LABELS: Omit<AzuraImmersionLabels, "provenance"> = {
  eyebrow: "Simulationsebene",
  headline: "Die Anlage, wie sie sich betreiben ließe",
  intro:
    "Sieben Wohnblöcke, ein Hotel, 656 Einheiten — und der Konflikt, den wir bewusst nicht aufgelöst haben. Alles unten stammt aus dem geernteten Datensatz; simulierte Abläufe sind als solche gekennzeichnet.",
  maquetteAlt:
    "Schematische Massenstudie der Anlage Azura World: sieben Wohnblöcke, das Hotel und das Meer.",
  liveSimulation: {
    heading: "Betriebsablauf",
    simulation: {
      short: "Simulation",
      title: "Simulierter Betrieb — keine Echtdaten",
      body: "Diese Ereignisse sind erfunden, um einen Betriebsablauf zu zeigen. Block- und Einheitenkennungen stammen aus dem echten Datensatz; Zeitpunkte und Ereignisse nicht. Es werden bewusst keine Beträge angezeigt.",
    },
    events: {
      ticket_opened: "Servicemeldung eröffnet",
      ticket_closed: "Servicemeldung geschlossen",
      payment_posted: "Zahlung verbucht",
      reservation_confirmed: "Reservierung bestätigt",
      ai_action: "KI-Empfehlung protokolliert",
      sync: "Datenabgleich ausgeführt",
    },
    sync: {
      realtime: "Laufende Aktualisierung",
      polling: "Aktualisierung alle 30 Sekunden",
    },
    feedSummary:
      "Simulierter Betriebsablauf: Servicemeldungen, Zahlungen, Reservierungen und Datenabgleiche für eine Anlage mit 656 Einheiten und 188 Hotelzimmern. Erfundene Ereignisse, echte Block- und Einheitenkennungen.",
    emptyPending: "Noch keine Ereignisse",
  },
  siteWorld: {
    heading: "Masterplan",
    schematicBadge: "Schema",
    schematicWarning:
      "Schema, keine Vermessung. Blockanzahl und Gesamtzahl der Einheiten sind belegt; die Anordnung ist gezeichnet — keine Quelle veröffentlicht einen Lageplan.",
    blocks: "Wohnblöcke",
    hotel: "Hotelzimmer",
    beach: "Entfernung zum Meer",
    plot: "Grundstücksfläche",
    units: "Wohneinheiten",
    steps: {
      site: "Anlage",
      block: "Block",
      floor: "Etage",
      unit: "Einheit",
    },
    stepHint:
      "Schritt für Schritt von der Anlage bis zur Einheit. Die Kamera bleibt stehen; der Detailgrad ändert sich.",
    blockLabel: "Block {code}",
    unitsInBlock: "Einheiten im Block",
  },
  unitExplorer: {
    heading: "Einheiten erkunden",
    searchLabel: "Einheiten durchsuchen",
    searchPlaceholder: "AZW-B03 oder 2+1",
    searchHint: "Nach Einheitenkennung, Block oder Grundriss filtern.",
    allBlocks: "Alle Blöcke",
    allLayouts: "Alle Grundrisse",
    count: "{visible} von {total} Einheiten",
    connection: {
      live: "Laufende Aktualisierung",
      polling: "Aktualisierung alle 30 Sekunden",
    },
    columns: {
      unit: "Einheit",
      block: "Block",
      layout: "Grundriss",
      area: "Innenfläche",
      quality: "Datenqualität",
    },
    quality: {
      portal_listing: "Portal",
      official: "Offiziell",
      modelled: "Modelliert",
      source_missing: "Quelle fehlt",
    },
    empty: {
      title: "Keine Einheiten gefunden",
      description:
        "Die aktiven Filter schließen alle Einheiten aus. Setzen Sie die Filter zurück, um wieder Ergebnisse zu sehen.",
      reset: "Filter zurücksetzen",
    },
  },
  evidenceFlow: {
    heading: "Von der Quelle zur Zahl",
    intro:
      "Jede angezeigte Zahl lässt sich bis zu der Seite zurückverfolgen, auf der sie stand — und bis zu dem Schnappschuss, der das belegt. Wo Quellen sich widersprechen, wird der Widerspruch gezeigt, nicht geglättet.",
    stages: {
      sources: {
        title: "Quellen",
        body: "60 Abrufversuche über offizielle Seiten, den Bauträger, den Hotelbetrieb, sieben Immobilienportale und fünf Bewertungsportale.",
      },
      harvest: {
        title: "Ernte",
        body: "Geprüft werden die Bytes, nicht die Statuszeile: 15 der 60 Versuche lieferten HTTP 200 mit einer Bot-Wand oder einer Soft-404-Seite und gelten als nicht validiert.",
      },
      conflict: {
        title: "Widerspruch",
        body: "Wo zwei Quellen dieselbe Zahl unterschiedlich angeben, werden beide Werte, beide URLs und ein Befund gespeichert. 13 Projektangaben sind widersprüchlich.",
      },
      dataset: {
        title: "Datensatz",
        body: "Der Datensatz führt jede Angabe mit ihren Quellen und ihrer Konfidenzstufe. Was keine Quelle nennt, bleibt eine Lücke — niemals eine plausible Schätzung.",
      },
    },
    finding: {
      eyebrow: "F-002 · kritisch",
      title: "Einstiegspreis 1+1 — Spanne 2,1×",
      body: "Mehrere Publisher, zwei Währungen, keine Beobachtungsdaten, unterschiedliche Einheiten-Teilmengen und mindestens ein Inserat, das rund zwei Jahre alt ist.",
      resolution:
        "Bewusst nicht aufgelöst. Kein Mittelwert, kein Median, keine „wahrscheinlichste“ Auswahl — jede einzelne Zahl hier wäre eine Erfindung mit einer Quellenangabe daran.",
      unresolved: "Nicht aufgelöst",
    },
    next: "Nächster Schritt",
    restart: "Von vorn",
    units: {
      sources: "Abrufversuche",
      validated: "Validiert",
      findings: "Befunde",
      facts: "Widersprüchlich",
    },
  },
}

export function ImmersionDemo({
  provenanceLabels,
}: {
  provenanceLabels: AzuraImmersionLabels["provenance"]
}): ReactNode {
  return (
    <section data-proof="immersion" className="flex min-w-0 flex-col gap-4">
      <header className="flex min-w-0 flex-col gap-1 border-b border-border pb-2">
        <h2 className="font-display text-xl font-semibold">
          8 · Simulationsebene (W3-I)
        </h2>
        <p className="text-sm text-muted-foreground">
          Gegen den echten Datensatz: {units.length} Einheiten, {blocks.length}{" "}
          Volumen, F-002 mit {competingPrices.length} unterschiedlichen Werten.
        </p>
      </header>

      <AzuraImmersionSection
        locale="de-DE"
        labels={{ ...LABELS, provenance: provenanceLabels }}
        blocks={blocks}
        units={units}
        facts={{
          residenceBlockCount: asFact(dataset.project.residenceBlockCount),
          totalUnits: asFact(dataset.project.totalUnits),
          plotAreaSqm: asFact(dataset.project.plotAreaSqm),
          distanceToSeaM: asFact(dataset.project.distanceToSeaM),
          hotelRoomCount: asFact(dataset.hotel.roomCount),
        }}
        counts={{
          sourcesTotal: dataset.coverage.sourcesTotal,
          sourcesValidated: dataset.coverage.sourcesValidated,
          findings: dataset.findings.length,
          conflictedFacts:
            dataset.coverage.projectFactsByConfidence.conflicted,
        }}
        competingPrices={competingPrices}
        entryPriceFact={entryPriceFact}
      />
    </section>
  )
}
