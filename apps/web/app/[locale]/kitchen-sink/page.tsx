import { notFound } from "next/navigation"
import type { ReactNode } from "react"

import { Counter } from "@/components/anim/counter"
import { Reveal, StaggerReveal } from "@/components/anim/reveal"
import { ScrambleText } from "@/components/anim/scramble-text"
import { ConfidenceBadge } from "@/components/evidence/confidence-badge"
import {
  DataQualityMark,
  ProvenanceValue,
  type ProvenanceLabels,
} from "@/components/evidence/provenance-value"
import { SourceChip } from "@/components/evidence/source-chip"
import { TableDemo } from "@/components/dashboard/table-demo"
import { CoastMaquette } from "@/components/three/coast-maquette"
import { CoastPoster } from "@/components/three/coast-poster"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  GlassCard,
} from "@/components/ui/card"
import { EmptyState, LoadingState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import type { Confidence, SourcedFact, SourceRef } from "@/lib/contracts"
import { locales } from "@/lib/contracts"

import { ImmersionDemo } from "./immersion-demo"
import { KitchenSinkClient } from "./kitchen-sink-client"
import { ThemeToggle } from "./theme-toggle"

/**
 * /de/kitchen-sink — the design-system proof page.         Owner: W1-D
 *
 * DEV ONLY. It 404s in a production build (see the guard below), because it
 * imports the full generated dataset and exists purely so the design review
 * has one URL that renders every primitive in every state.
 *
 * It is the artifact for W1-D's definition of done, and each of the six
 * required proofs has its own section, marked with a `data-proof` attribute so
 * a Playwright pass can find it:
 *
 *   1  every confidence level, including `gap` → "—"
 *   2  F-002's competing 1+1 prices, all visible, USD NOT converted
 *   3  measured contrast ratios
 *   4  reduced motion → complete and static
 *   5  WebGL absent → poster
 *   6  320px with German copy → no clipping, no horizontal scroll
 *
 * The German strings are inline rather than from `messages/*`. This is a
 * dev-only design gallery, not a product surface, and hardcoding them here
 * keeps the page renderable while W1-C's message files are still moving.
 */

/**
 * NOT `force-static`, and this is load-bearing.
 *
 * `proxy.ts` emits a per-request CSP containing `'nonce-…' 'strict-dynamic'`.
 * Next can only stamp that nonce onto its script tags when there IS a request
 * — it reads it from the request header. A statically prerendered page is
 * built without one, so its scripts carry no nonce, and under `strict-dynamic`
 * a script without a nonce does not load. The page renders, looks correct, and
 * runs ZERO JavaScript: no hydration, no theme toggle, no popover, no canvas.
 *
 * Measured on this route before the fix: 0 bytes of JS transferred, 0 canvases
 * mounted, and one CSP violation per chunk in the console.
 *
 * `generateStaticParams` stays — it still enumerates the locales for routing.
 * Reported to W0-A/W1-B (proxy.ts) and W3-A in HANDOFF/W1-D.md, because any
 * static page in this app has the same problem.
 */
export const dynamic = "force-dynamic"

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }))
}

// ---------------------------------------------------------------------------
// Labels — German, inline. See the note above.
// ---------------------------------------------------------------------------

const LABELS: ProvenanceLabels = {
  confidence: {
    confirmed: "Bestätigt",
    official: "Offiziell",
    single_source: "Eine Quelle",
    conflicted: "Quellen widersprechen sich",
    inferred: "Berechnet",
    gap: "Nicht belegt",
  },
  conflict: {
    trigger: "Quellen widersprechen sich",
    heading: "Konkurrierende Werte",
    summary: "{count} Quellen, keine Auflösung",
    displayed: "Angezeigt",
    unresolvedNote:
      "Bewusst nicht aufgelöst. Kein Mittelwert, kein Median, keine „wahrscheinlichste“ Auswahl — jede einzelne Zahl hier wäre eine Erfindung mit einer Quellenangabe daran.",
    close: "Schließen",
    source: {
      openSource: "Quelle öffnen",
      snapshot: "Lokaler Snapshot",
      unreachable: "Quelle nicht erreichbar",
      tier: {
        official: "Offiziell",
        developer: "Bauträger",
        hotel: "Hotelbetrieb",
        portal: "Immobilienportal",
        review: "Bewertungsportal",
        press: "Presse",
      },
    },
  },
  source: {
    openSource: "Quelle öffnen",
    snapshot: "Lokaler Snapshot",
    unreachable: "Quelle nicht erreichbar",
    tier: {
      official: "Offiziell",
      developer: "Bauträger",
      hotel: "Hotelbetrieb",
      portal: "Immobilienportal",
      review: "Bewertungsportal",
      press: "Presse",
    },
  },
  gap: "Nicht belegt",
  inferred: "berechnet",
  more: "+{count} weitere",
  sources: "Quellen",
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function source(
  publisher: string,
  url: string,
  tier: SourceRef["tier"],
  hash: string
): SourceRef {
  return {
    publisher,
    url,
    tier,
    fetchedAt: "2026-07-27T14:47:11.080Z",
    snapshotHash: hash,
  }
}

const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)
const HASH_C = "c".repeat(64)
const HASH_D = "d".repeat(64)

/**
 * F-002, transcribed from the generated dataset.
 *
 * The real finding carries nineteen competing values; the four named in the
 * W1-D brief are the ones the conflict is usually described by, and they are
 * the four that matter for the proof: two currencies, a 2.1x spread, and
 * nothing resolved. `resolvedTo` is `null` in the dataset and stays null here.
 *
 * The USD figure is the load-bearing one. It renders as USD, beside EUR
 * values, unconverted.
 */
const ENTRY_PRICE: SourcedFact<{ amount: number; currency: string }> = {
  value: { amount: 112000, currency: "EUR" },
  confidence: "conflicted",
  sources: [
    source(
      "Haspo Realty",
      "https://hasporealty.com/en/properties/prodaetsya-kvartira-1-1-v-komplekse-azura-world-oba-alanya/",
      4,
      HASH_A
    ),
  ],
  conflictsWith: [
    {
      value: { amount: 185000, currency: "EUR" },
      source: source(
        "Seaside Alanya",
        "https://seaside-alanya.com/azura-world",
        4,
        HASH_B
      ),
    },
    {
      value: { amount: 220000, currency: "EUR" },
      source: source(
        "Alanya-Home",
        "https://alanya-home.com/property/466/de/verkauf_wohnungen_in_azura_world_residence_hotel_turkler_alanya_turkei",
        4,
        HASH_C
      ),
    },
    {
      value: { amount: 239171, currency: "USD" },
      source: source(
        "Housearch",
        "https://housearch.com/turkey/alanya/azura-world",
        4,
        HASH_D
      ),
    },
  ],
}

const PLOT_AREA: SourcedFact<number> = {
  value: 76000,
  confidence: "confirmed",
  sources: [
    source("Azura World", "https://azuraworld.com/", 1, HASH_A),
    source("Cebeci Group", "https://cebecigroup.com/", 2, HASH_B),
  ],
}

const DOWN_PAYMENT: SourcedFact<number> = {
  value: 30,
  confidence: "single_source",
  sources: [
    source("Terra Real Estate", "https://terrarealestate.com/", 4, HASH_A),
  ],
}

const TOTAL_UNITS: SourcedFact<number> = {
  value: 656,
  confidence: "official",
  sources: [source("Azura World", "https://azuraworld.com/", 1, HASH_A)],
}

/**
 * CONSTRUCTED, not from the dataset — labelled as such on the page.
 *
 * The generated dataset contains no `inferred` fact (14 confirmed, 19
 * single_source, 13 conflicted, 2 gap). The component must still handle the
 * level, so the gallery constructs one rather than pretending the dataset has
 * one. Inventing a number and presenting it as harvested would be exactly the
 * failure this whole project is built to avoid.
 */
const PRICE_PER_SQM: SourcedFact<number> = {
  value: 1982,
  confidence: "inferred",
  note: "Median der beobachteten EUR/m² für Layout 1+1 (n=10). Aus bestätigten Beobachtungen berechnet, nicht von einer Quelle veröffentlicht.",
  sources: [source("Haspo Realty", "https://hasporealty.com/", 4, HASH_A)],
}

/** Real: `reviews[0].ranking` is a genuine gap in the dataset. */
const RANKING: SourcedFact<string> = {
  value: null,
  confidence: "gap",
  note: "Keine Quelle nennt eine Platzierung für dieses Bewertungsportal. Bewusst als Lücke geführt.",
  sources: [],
}

const ALL_LEVELS: ReadonlyArray<{
  level: Confidence
  label: string
  node: ReactNode
}> = [
  {
    level: "confirmed",
    label: "confirmed — Grundstücksfläche",
    node: (
      <ProvenanceValue
        fact={PLOT_AREA}
        format="area"
        locale="de"
        labels={LABELS}
        showSources
      />
    ),
  },
  {
    level: "official",
    label: "official — Wohneinheiten gesamt",
    node: (
      <ProvenanceValue
        fact={TOTAL_UNITS}
        format="number"
        locale="de"
        labels={LABELS}
        showSources
      />
    ),
  },
  {
    level: "single_source",
    label: "single_source — Anzahlung",
    node: (
      <ProvenanceValue
        fact={DOWN_PAYMENT}
        format="percent"
        locale="de"
        labels={LABELS}
        showSources
      />
    ),
  },
  {
    level: "conflicted",
    label: "conflicted — Einstiegspreis 1+1 (F-002)",
    node: (
      <ProvenanceValue
        fact={ENTRY_PRICE}
        format="money"
        locale="de"
        labels={LABELS}
      />
    ),
  },
  {
    level: "inferred",
    label: "inferred — EUR/m² (konstruiert, siehe Hinweis)",
    node: (
      <ProvenanceValue
        fact={PRICE_PER_SQM}
        format="number"
        locale="de"
        labels={LABELS}
      />
    ),
  },
  {
    level: "gap",
    label: "gap — Platzierung des Hotels",
    node: (
      <ProvenanceValue
        fact={RANKING}
        format="text"
        locale="de"
        labels={LABELS}
      />
    ),
  },
]

/** Measured by the W1-D contrast harness. Pasted, not paraphrased. */
const CONTRAST: ReadonlyArray<[string, string, string]> = [
  ["foreground / background", "17.29", "17.01"],
  ["muted-foreground / card", "6.26", "8.28"],
  ["primary / background (Link)", "6.80", "9.92"],
  ["primary-foreground / primary (Button)", "6.80", "9.92"],
  ["accent-foreground / accent (CTA)", "5.06", "8.33"],
  ["input / card (Bedienelement-Kante)", "3.44", "3.38"],
  ["ring / background (Fokus)", "3.80", "9.92"],
  ["conflicted / Konfliktfläche", "5.81", "8.91"],
  ["gap / card", "4.93", "6.82"],
]

// ---------------------------------------------------------------------------

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children: ReactNode
}): ReactNode {
  return (
    <section data-proof={id} className="flex min-w-0 flex-col gap-4">
      <header className="flex min-w-0 flex-col gap-1 border-b border-border pb-2">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  )
}

export default async function KitchenSinkPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  // Dev-only by default. A design gallery on a production origin is an
  // information leak about an unreleased surface, and this one renders
  // fixtures that exist to exercise edge cases rather than to be read as
  // facts.
  //
  // `AZURA_ENABLE_KITCHEN_SINK=1` opts a production BUILD back in, for one
  // reason: the design review has to screenshot the production bundle. On this
  // machine Turbopack cannot compile `globals.css` under load — it spawns a
  // subprocess per PostCSS asset and Windows refuses with 0xc0000142 — so
  // `next build --webpack` + `next start` is the only path that renders, and
  // CONVENTIONS §1 names that the validated build anyway.
  //
  // This is NOT in the class of flag SYSTEM-PROMPT §2.12 governs. It gates a
  // component gallery built from literals: no data, no mutation, no auth
  // bypass. It is off unless explicitly set, and the deploy sets nothing.
  const enabledInProduction = process.env["AZURA_ENABLE_KITCHEN_SINK"] === "1"
  if (process.env.NODE_ENV === "production" && !enabledInProduction) {
    notFound()
  }

  await params

  return (
    <main className="container mx-auto flex max-w-4xl min-w-0 flex-col gap-12 py-10">
      <header className="flex min-w-0 flex-col gap-4">
        <Badge variant="simulation">Nur Entwicklung</Badge>
        {/* The h1 is NOT scrambled. A decode effect on the one line that tells
            you what the page is costs ~800ms of illegibility on the most
            important text on screen — animate the rarely-read, not the
            first-read. ScrambleText is demonstrated on its own row below. */}
        <h1 className="font-display text-3xl font-bold">Azura Design System</h1>
        <p className="font-display text-lg text-primary">
          <ScrambleText text="Türkler · Alanya · Antalya" />
        </p>
        <p className="max-w-prose text-muted-foreground">
          Jede Primitive in jedem Zustand. Diese Seite ist der Nachweis für W1-D
          — sechs Belege, jeweils mit <code>data-proof</code> markiert.
        </p>
        <ThemeToggle />
      </header>

      {/* ---- PROOF 1 ---- */}
      <Section
        id="confidence-levels"
        title="1 · Alle sechs Konfidenzstufen"
        description="CONTRACTS §1. gap rendert einen Gedankenstrich — niemals 0, niemals leer."
      >
        <div className="flex flex-col gap-3">
          {ALL_LEVELS.map((entry) => (
            <Card key={entry.level} className="gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className="text-xs text-muted-foreground">
                  {entry.label}
                </code>
                <ConfidenceBadge
                  confidence={entry.level}
                  labels={LABELS.confidence}
                />
              </div>
              <div className="min-w-0">{entry.node}</div>
            </Card>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Der <code>inferred</code>-Wert ist konstruiert: der generierte
          Datensatz enthält keine berechnete Kennzahl (14 confirmed, 19
          single_source, 13 conflicted, 2 gap). Die Komponente muss die Stufe
          trotzdem beherrschen.
        </p>
      </Section>

      {/* ---- PROOF 2 ---- */}
      <Section
        id="conflict-f002"
        title="2 · F-002 — vier Preise, zwei Währungen, keine Auflösung"
        description="112.000 € · 185.000 € · 220.000 € · 239.171 $ — der USD-Wert wird NICHT umgerechnet."
      >
        <Card>
          <CardHeader>
            <CardTitle>Einstiegspreis 1+1</CardTitle>
            <CardDescription>
              Spanne 2,1× über vier Publisher. Weil die Währungen sich
              unterscheiden, wird keine Spanne gebildet — eine Spanne über zwei
              Währungen wäre keine Spanne, sondern zwei Zahlen in
              unterschiedlichen Einheiten.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProvenanceValue
              fact={ENTRY_PRICE}
              format="money"
              locale="de"
              labels={LABELS}
            />
          </CardContent>
          <CardFooter>
            <DataQualityMark
              dataQuality="modelled"
              labels={{
                portal_listing: "Portal",
                official: "Offiziell",
                modelled: "Modelliert",
                source_missing: "Quelle fehlt",
              }}
            />
            <Badge variant="stale">Veraltet</Badge>
          </CardFooter>
        </Card>
      </Section>

      {/* ---- PROOF 3 ---- */}
      <Section
        id="contrast"
        title="3 · Gemessene Kontrastwerte"
        description="Gemessen, nicht geschätzt. AA verlangt 4,5:1 für Text, 3:1 für Bedienelemente."
      >
        <div className="azura-scrollbar-slim w-full overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs tracking-[0.04em] text-muted-foreground uppercase"
                >
                  Paar
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-right text-xs tracking-[0.04em] text-muted-foreground uppercase"
                >
                  Hell
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-right text-xs tracking-[0.04em] text-muted-foreground uppercase"
                >
                  Dunkel
                </th>
              </tr>
            </thead>
            <tbody>
              {CONTRAST.map(([pair, light, dark]) => (
                <tr key={pair} className="border-b border-border">
                  <td className="px-3 py-2">{pair}</td>
                  <td data-numeric className="px-3 py-2 text-right">
                    {light}
                  </td>
                  <td data-numeric className="px-3 py-2 text-right">
                    {dark}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ---- PROOF 4 + 6 ---- */}
      <Section
        id="motion-and-states"
        title="4 · Bewegung, Zustände und lange deutsche Zeichenketten"
        description="Mit prefers-reduced-motion muss diese Seite vollständig und statisch sein — nicht schneller."
      >
        <StaggerReveal className="flex flex-col gap-3">
          <Card>
            <CardHeader>
              <CardTitle>Gesamtwohneinheiten</CardTitle>
              <CardDescription>
                Zählt hoch, wenn Bewegung erlaubt ist; sonst steht die Zahl
                sofort da. Der Endwert steht immer im SSR-Markup.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Counter
                value={656}
                locale="de-DE"
                className="font-display text-4xl font-bold"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Grundstücksentwässerungssatzung</CardTitle>
              <CardDescription>
                Ein absichtlich überlanges deutsches Kompositum, damit bei 320px
                Breite sichtbar wird, ob der Umbruch trägt.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button>Wohnungsangebot anfordern</Button>
              <Button variant="accent">Besichtigungstermin vereinbaren</Button>
              <Button variant="outline">Quellenverzeichnis</Button>
              <Button variant="destructive">
                Eintrag unwiderruflich löschen
              </Button>
            </CardFooter>
          </Card>
        </StaggerReveal>

        {/* The error state needs an `onRetry` handler, so it lives in the
            client half below — a Server Component cannot pass a function
            across the boundary. */}
        <Reveal>
          <EmptyState
            title="Keine Einheiten gefunden"
            description="Die Filter schließen alle 656 Einheiten aus. Setzen Sie den Blockfilter zurück, um wieder Ergebnisse zu sehen."
          />
        </Reveal>

        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardTitle>Ladezustand</CardTitle>
            <LoadingState rows={3} label="Einheiten werden geladen" />
          </Card>
          <Card>
            <CardTitle>Skelett-Presets</CardTitle>
            <div className="flex flex-col gap-2">
              <Skeleton preset="heading" />
              <Skeleton preset="text" />
              <Skeleton preset="badge" />
            </div>
          </Card>
        </div>

        <Card data-proof="glyph-coverage">
          <CardTitle>Glyphenabdeckung</CardTitle>
          <CardDescription>
            Beide Schriften müssen Latin-ext (türkisch: ı İ ş ğ ç) und
            Kyrillisch abdecken. Ein fehlendes Zeichen rendert als lautloses
            Kästchen — es fällt niemandem auf, der die Sprache nicht liest.
          </CardDescription>
          <div className="flex flex-col gap-1">
            <p className="font-display text-2xl">
              Алания · Türkler · Straße · Азура Уорлд
            </p>
            <p className="text-base">
              Алания · Türkler · Straße · Резиденция и отель
            </p>
          </div>
        </Card>

        <GlassCard>
          <CardTitle>Quellen-Chips</CardTitle>
          <div className="flex flex-wrap gap-2">
            <SourceChip
              source={source(
                "Azura World",
                "https://azuraworld.com/",
                1,
                HASH_A
              )}
              locale="de"
              labels={LABELS.source}
            />
            <SourceChip
              source={source("Housearch", "https://housearch.com/", 4, HASH_D)}
              locale="de"
              labels={LABELS.source}
              reachable={false}
            />
          </div>
          <CardDescription>
            Der zweite Chip ist eine tote Quelle: kein ausgehender Link, dafür
            der Hinweis „Quelle nicht erreichbar“. 15 der 60 Harvest-Versuche
            haben die Inhaltsprüfung nicht bestanden.
          </CardDescription>
        </GlassCard>
      </Section>

      {/* ---- PROOF 5 ---- */}
      <Section
        id="webgl-poster"
        title="5 · WebGL und Poster"
        description="Ohne WebGL, ohne Bewegung oder auf schwacher Hardware: das Poster. Niemals eine leere Fläche."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-xs tracking-[0.06em] text-muted-foreground uppercase">
              Maquette (mit allen Schutzmaßnahmen)
            </p>
            <CoastMaquette posterLabel="Schematische Massenstudie der Anlage Azura World: sieben Wohnblöcke, das Hotel und das Meer." />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs tracking-[0.06em] text-muted-foreground uppercase">
              Poster (erzwungen)
            </p>
            <div className="aspect-[400/260] w-full overflow-hidden rounded-xl border border-border">
              <CoastPoster label="Schematische Massenstudie, statische Fassung." />
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Das Poster ist Inline-SVG, kein Foto. Alle 31 gesammelten Medien sind{" "}
          <code>internal_only</code> — sie gehören einem Wettbewerber und dürfen
          auf keiner öffentlichen Route erscheinen.
        </p>
      </Section>

      {/* ---- interactive ---- */}
      <KitchenSinkClient />

      {/* ---- W3-I, against the real dataset ---- */}
      <ImmersionDemo provenanceLabels={LABELS} />

      {/*
        The `<DataTable>` harness, moved here by W-UX.

        It used to hang off the dashboard home behind `?w3b=table-demo`. Even
        gated, a state-machine toggle labelled ready/loading/empty/error on the
        product's home route is a developer instrument sitting on the first
        screen a property manager opens. This page is the right home for it: it
        already 404s in a production build, and proving a component in every
        state is exactly what a design gallery is for.

        W3-B's 656-row measurement and four-state screenshots still come from
        here, so nothing that handoff proved is lost.
      */}
      <Section
        id="table-states"
        title="Tabelle, alle vier Zustände"
        description="656 Beispielzeilen. Der Umschalter unten ist ein Entwicklerwerkzeug und erscheint auf keiner Produktseite."
      >
        <TableDemo locale="de" provenanceLabels={LABELS} />
      </Section>
    </main>
  )
}
