"use client"

import { useMemo, useState, type ReactNode } from "react"

import { StaggerList } from "@/components/anim/stagger"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { DataSurface, EmptyState, ErrorState, LoadingState } from "@/components/ui/empty-state"
import { Field, Input } from "@/components/ui/input"
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScrollArea,
  VirtualTableBody,
} from "@/components/ui/table"
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTableScrollRef } from "@/components/ui/table"

/**
 * The interactive half of the kitchen sink.                Owner: W1-D
 *
 * Split from `page.tsx` because these need state and event handlers. The
 * server half renders everything that does not, which is most of it — a
 * client component that only renders props is a bundle-size bug
 * (CONVENTIONS §2).
 *
 * The table section is the load-bearing proof here: 656 rows, the real
 * inventory size, windowed. Count the `<tr>` elements in the DOM.
 */

const ROW_HEIGHT = 44
const LAYOUTS = ["1+1", "2+1", "3+1", "4+1", "penthouse"] as const

interface DemoUnit {
  id: string
  block: string
  layout: string
  interiorM2: number
  modelled: boolean
}

/**
 * 656 rows — the corroborated total unit count. Generated arithmetically, not
 * randomly, so the DOM is identical on every load and a Playwright snapshot
 * is stable.
 *
 * These are FIXTURES for a layout proof, not inventory. The real units come
 * from the generated dataset through W2-A's repositories, and 631 of the 656
 * there are `modelled` — which is why the marker below exists at all.
 */
function demoUnits(): DemoUnit[] {
  return Array.from({ length: 656 }, (_, index) => {
    const block = `B0${(index % 7) + 1}`
    const layout = LAYOUTS[index % LAYOUTS.length] ?? "1+1"
    return {
      id: `AZW-${block}-${String(index + 1).padStart(4, "0")}`,
      block,
      layout,
      interiorM2: 68 + (index % 9) * 17,
      // Mirrors the real 25 / 631 split.
      modelled: index % 26 !== 0,
    }
  })
}

export function KitchenSinkClient(): ReactNode {
  const [query, setQuery] = useState("")
  const [surfaceState, setSurfaceState] = useState<
    "loading" | "error" | "empty" | "ready"
  >("ready")

  const units = useMemo(demoUnits, [])
  const scrollRef = useTableScrollRef()

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de-DE")
    if (needle === "") return units
    return units.filter(
      (unit) =>
        unit.id.toLocaleLowerCase("de-DE").includes(needle) ||
        unit.layout.includes(needle)
    )
  }, [query, units])

  return (
    <>
      <section data-proof="table-virtualisation" className="flex min-w-0 flex-col gap-4">
        <header className="flex min-w-0 flex-col gap-1 border-b border-border pb-2">
          <h2 className="font-display text-xl font-semibold">
            6 · Tabelle mit 656 Zeilen
          </h2>
          <p className="text-sm text-muted-foreground">
            Nur das sichtbare Fenster liegt im DOM. Die Bildlaufleiste beschreibt
            trotzdem die volle Länge.
          </p>
        </header>

        <Field
          htmlFor="unit-search"
          label="Einheiten durchsuchen"
          hint="Nach Einheitenkennung oder Grundriss filtern."
        >
          <Input
            id="unit-search"
            aria-describedby="unit-search-hint"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="AZW-B03 oder 2+1"
            data-testid="unit-search"
          />
        </Field>

        <p className="text-sm text-muted-foreground" data-testid="visible-count">
          {visible.length} von {units.length} Einheiten
        </p>

        <TableScrollArea height={420} ref={scrollRef}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Einheit</TableHead>
                <TableHead>Block</TableHead>
                <TableHead>Grundriss</TableHead>
                <TableHead>Innenfläche</TableHead>
                <TableHead>Datenqualität</TableHead>
              </TableRow>
            </TableHeader>
            <VirtualTableBody
              rows={visible}
              rowHeight={ROW_HEIGHT}
              columnCount={5}
              scrollRef={scrollRef}
              renderRow={(unit) => (
                <TableRow key={unit.id} style={{ height: ROW_HEIGHT }}>
                  <TableCell className="font-medium">{unit.id}</TableCell>
                  <TableCell>{unit.block}</TableCell>
                  <TableCell>{unit.layout}</TableCell>
                  <TableCell data-numeric>{unit.interiorM2} m²</TableCell>
                  <TableCell>
                    {unit.modelled ? (
                      <Badge variant="modelled">Modelliert</Badge>
                    ) : (
                      <Badge variant="outline">Portal</Badge>
                    )}
                  </TableCell>
                </TableRow>
              )}
            />
          </Table>
        </TableScrollArea>
      </section>

      <section data-proof="interactive" className="flex min-w-0 flex-col gap-4">
        <header className="flex min-w-0 flex-col gap-1 border-b border-border pb-2">
          <h2 className="font-display text-xl font-semibold">
            7 · Interaktive Primitiven
          </h2>
          <p className="text-sm text-muted-foreground">
            Tabs, Dialog, Tooltip und der Vier-Zustände-Schalter.
          </p>
        </header>

        <Tabs defaultValue="states">
          <TabsList>
            <TabsIndicator />
            <TabsTab value="states">Zustände</TabsTab>
            <TabsTab value="overlays">Überlagerungen</TabsTab>
            <TabsTab value="stagger">Gestaffelte Liste</TabsTab>
          </TabsList>

          <TabsPanel value="states" className="flex flex-col gap-3 pt-2">
            <div className="flex flex-wrap gap-2">
              {(["loading", "error", "empty", "ready"] as const).map((state) => (
                <Button
                  key={state}
                  size="sm"
                  variant={surfaceState === state ? "default" : "outline"}
                  onClick={() => setSurfaceState(state)}
                  aria-pressed={surfaceState === state}
                  data-testid={`surface-${state}`}
                >
                  {state}
                </Button>
              ))}
            </div>

            <DataSurface
              state={surfaceState}
              loading={<LoadingState rows={3} label="Wird geladen" />}
              error={
                <ErrorState
                  title="Daten konnten nicht geladen werden"
                  message="Die Verbindung zur Datenbank ist unterbrochen. Es werden bewusst keine veralteten Werte angezeigt."
                  retryLabel="Erneut versuchen"
                  onRetry={() => setSurfaceState("ready")}
                />
              }
              empty={
                <EmptyState
                  title="Keine Einheiten gefunden"
                  description="Die aktiven Filter schließen alle 656 Einheiten aus. Setzen Sie den Blockfilter zurück."
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSurfaceState("ready")}
                    >
                      Filter zurücksetzen
                    </Button>
                  }
                />
              }
            >
              <Card>
                <CardTitle>Geladen</CardTitle>
                <CardDescription>
                  Der vierte Zustand. Alle vier sind Pflicht, nicht optional.
                </CardDescription>
              </Card>
            </DataSurface>
          </TabsPanel>

          <TabsPanel value="overlays" className="flex flex-wrap gap-2 pt-2">
            <Dialog>
              <DialogTrigger
                render={<Button variant="outline">Dialog öffnen</Button>}
              />
              <DialogContent closeLabel="Dialog schließen">
                <DialogTitle>Quellenlage für den Einstiegspreis</DialogTitle>
                <DialogDescription>
                  Vier Publisher, zwei Währungen, Spanne 2,1×. Der Konflikt wird
                  bewusst nicht aufgelöst — jede Einzelzahl wäre eine Erfindung.
                </DialogDescription>
              </DialogContent>
            </Dialog>

            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost">Tooltip (nur Hinweise)</Button>}
              />
              <TooltipContent>
                Tooltips tragen niemals Provenienz — auf Touch nicht erreichbar.
              </TooltipContent>
            </Tooltip>
          </TabsPanel>

          <TabsPanel value="stagger" className="pt-2">
            <StaggerList
              items={visible.slice(0, 6)}
              getKey={(unit) => unit.id}
              className="gap-2"
              itemClassName="rounded-lg border border-border bg-card p-3 text-sm"
              renderItem={(unit) => (
                <span>
                  {unit.id} · {unit.layout} · {unit.interiorM2} m²
                </span>
              )}
            />
          </TabsPanel>
        </Tabs>
      </section>
    </>
  )
}
