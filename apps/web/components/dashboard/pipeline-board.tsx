"use client"

import { CalendarClock, Clock, Home, TriangleAlert } from "lucide-react"
import { useMemo, useState, type ReactNode } from "react"

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/cn"
import type { Locale, Money } from "@/lib/contracts"
import { formatMoney } from "@/components/evidence/format"
import { intlLocaleTag } from "@/lib/format"

/**
 * PipelineBoard — the funnel, made legible.                   Owner: W-NIGHT
 *
 * The read-only pipeline was a stack of dense rows. This is the same data as a
 * board a salesperson recognises: a funnel strip across the top, then each stage
 * as a column of cards with the lead, the deal, and a probability bar, and a
 * click opens the full record in a popup. Every honesty rule the old page kept
 * is kept here — a missing lead is named, a `null` probability is "no estimate"
 * and never 0%, deals stay in their own currency, and the empty stages are still
 * shown, because the shape of the funnel is the information.
 */

export type PipelineStage = string

export interface BoardEntry {
  id: string
  stage: PipelineStage
  name: string | null
  reference: string
  deal: Money | null
  probability: number | null
  unitId: string | null
  expectedClose: string | null
  daysInStage: number | null
  enteredStageAt: string
  previousStage: PipelineStage | null
  blocker: string | null
}

export interface BoardStage {
  stage: PipelineStage
  label: string
  count: number
  entries: BoardEntry[]
}

export interface PipelineBoardLabels {
  /** Template with `{value}` (a percent). */
  probability: string
  probabilityUnset: string
  probabilityLabel: string
  expectedClose: string
  noExpectedClose: string
  unit: string
  noUnit: string
  inStage: string
  firstStage: string
  blocker: string
  missingLead: string
  noDeal: string
  stageEmpty: string
  close: string
  stageLabel: string
  previousStage: string
  detailLead: string
}

function initialsOf(name: string | null): string {
  if (name === null) return "?"
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ""
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : ""
  return (first + last).toUpperCase() || "?"
}

/** Probability band → bar colour. Green high, amber mid, muted low. */
function probTone(p: number): string {
  if (p >= 60) return "bg-emerald-500"
  if (p >= 30) return "bg-amber-500"
  return "bg-muted-foreground/50"
}

function ProbabilityBar({
  value,
  labels,
  locale,
}: {
  value: number | null
  labels: PipelineBoardLabels
  locale: Locale
}): ReactNode {
  if (value === null) {
    return (
      <span className="text-xs text-muted-foreground">
        {labels.probabilityUnset}
      </span>
    )
  }
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)]"
      >
        <span
          className={cn("block h-full rounded-full", probTone(pct))}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span
        data-numeric
        className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums"
      >
        {labels.probability.replace(
          "{value}",
          new Intl.NumberFormat(intlLocaleTag(locale)).format(value)
        )}
      </span>
    </div>
  )
}

function formatDay(iso: string, locale: Locale): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  return new Intl.DateTimeFormat(intlLocaleTag(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(parsed))
}

export function PipelineBoard({
  stages,
  labels,
  locale,
}: {
  stages: readonly BoardStage[]
  labels: PipelineBoardLabels
  locale: Locale
}): ReactNode {
  const [selected, setSelected] = useState<BoardEntry | null>(null)
  const maxCount = useMemo(
    () => Math.max(1, ...stages.map((s) => s.count)),
    [stages]
  )

  const daysText = (days: number | null, enteredAt: string): string =>
    days === null
      ? formatDay(enteredAt, locale)
      : new Intl.NumberFormat(intlLocaleTag(locale)).format(days)

  return (
    <div className="flex flex-col gap-6">
      {/* Funnel strip — every stage, width proportional to its count. */}
      <ol className="flex flex-wrap gap-2 p-0">
        {stages.map((stage, index) => (
          <li key={stage.stage} className="min-w-0 flex-1 basis-[7rem]">
            <div
              className={cn(
                "flex h-full flex-col gap-2 rounded-lg border px-3 py-2.5",
                stage.count === 0
                  ? "border-dashed border-border bg-transparent"
                  : "border-border bg-card"
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium text-foreground">
                  <span className="text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>{" "}
                  {stage.label}
                </span>
                <span
                  data-numeric
                  className="shrink-0 font-display text-sm font-semibold text-foreground tabular-nums"
                >
                  {stage.count}
                </span>
              </div>
              <span
                aria-hidden="true"
                className="h-1 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)]"
              >
                <span
                  className="block h-full rounded-full bg-primary/60"
                  style={{ width: `${(stage.count / maxCount) * 100}%` }}
                />
              </span>
            </div>
          </li>
        ))}
      </ol>

      {/* Stage columns with entry cards. */}
      <div className="flex flex-col gap-5">
        {stages.map((stage) => (
          <section
            key={stage.stage}
            aria-label={stage.label}
            className="flex flex-col gap-3"
          >
            <h3 className="flex items-baseline gap-2 font-display text-base font-semibold tracking-[-0.012em] text-foreground">
              {stage.label}
              <span
                data-numeric
                className="text-sm font-normal text-muted-foreground tabular-nums"
              >
                {stage.count}
              </span>
            </h3>
            {stage.entries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                {labels.stageEmpty}
              </p>
            ) : (
              <ul className="grid gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
                {stage.entries.map((entry) => (
                  <li key={entry.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setSelected(entry)}
                      className="flex h-full w-full flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all duration-200 outline-none hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_12px_32px_-24px_rgb(0_0_0/0.5)] focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          aria-hidden="true"
                          className="grid size-9 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-xs font-semibold text-primary"
                        >
                          {initialsOf(entry.name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-foreground">
                            {entry.name ?? (
                              <span className="text-muted-foreground italic">
                                {labels.missingLead}
                              </span>
                            )}
                          </p>
                          <p className="truncate text-xs text-muted-foreground tabular-nums">
                            {entry.reference}
                          </p>
                        </div>
                        <span className="shrink-0 text-right">
                          {entry.deal === null ? (
                            <span className="text-xs text-muted-foreground">
                              {labels.noDeal}
                            </span>
                          ) : (
                            <span
                              data-numeric
                              className="font-display text-sm font-semibold text-foreground tabular-nums"
                            >
                              {formatMoney(entry.deal, locale)}
                            </span>
                          )}
                        </span>
                      </div>

                      <ProbabilityBar
                        value={entry.probability}
                        labels={labels}
                        locale={locale}
                      />

                      <div className="flex flex-wrap gap-1.5">
                        <Chip icon={Home}>
                          {entry.unitId ?? labels.noUnit}
                        </Chip>
                        {entry.expectedClose !== null ? (
                          <Chip icon={CalendarClock}>
                            {formatDay(entry.expectedClose, locale)}
                          </Chip>
                        ) : null}
                        <Chip icon={Clock}>
                          {daysText(entry.daysInStage, entry.enteredStageAt)}
                        </Chip>
                      </div>

                      {entry.blocker !== null && entry.blocker.length > 0 ? (
                        <p className="flex items-start gap-1.5 rounded-md border border-quality-stale/30 bg-quality-stale/[0.06] px-2 py-1.5 text-xs text-foreground">
                          <TriangleAlert
                            className="mt-px size-3.5 shrink-0 text-quality-stale"
                            aria-hidden="true"
                          />
                          <span className="line-clamp-2">{entry.blocker}</span>
                        </p>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {/* Full-record popup. */}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        {selected !== null ? (
          <DialogContent closeLabel={labels.close}>
            <div className="flex items-start gap-3 pr-8">
              <span
                aria-hidden="true"
                className="grid size-11 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-sm font-semibold text-primary"
              >
                {initialsOf(selected.name)}
              </span>
              <div className="min-w-0">
                <span className="azura-label text-muted-foreground">
                  {labels.detailLead}
                </span>
                <DialogTitle>
                  {selected.name ?? labels.missingLead}
                </DialogTitle>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {selected.reference}
                </p>
              </div>
              {selected.deal !== null ? (
                <span
                  data-numeric
                  className="ml-auto shrink-0 font-display text-lg font-semibold text-foreground tabular-nums"
                >
                  {formatMoney(selected.deal, locale)}
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="azura-label text-muted-foreground">
                {labels.probabilityLabel}
              </span>
              <ProbabilityBar
                value={selected.probability}
                labels={labels}
                locale={locale}
              />
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Field
                label={labels.stageLabel}
                value={stageLabelOf(stages, selected.stage)}
              />
              <Field
                label={labels.unit}
                value={selected.unitId ?? labels.noUnit}
              />
              <Field
                label={labels.expectedClose}
                value={
                  selected.expectedClose === null
                    ? labels.noExpectedClose
                    : formatDay(selected.expectedClose, locale)
                }
              />
              <Field
                label={labels.inStage}
                value={daysText(selected.daysInStage, selected.enteredStageAt)}
              />
              <Field
                label={labels.previousStage}
                value={
                  selected.previousStage === null
                    ? labels.firstStage
                    : stageLabelOf(stages, selected.previousStage)
                }
              />
            </dl>

            {selected.blocker !== null && selected.blocker.length > 0 ? (
              <p className="flex items-start gap-2 rounded-md border border-quality-stale/30 bg-quality-stale/[0.06] px-3 py-2 text-sm text-foreground">
                <TriangleAlert
                  className="mt-0.5 size-4 shrink-0 text-quality-stale"
                  aria-hidden="true"
                />
                <span>
                  <span className="font-semibold">{labels.blocker}: </span>
                  {selected.blocker}
                </span>
              </p>
            ) : null}
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  )
}

function stageLabelOf(
  stages: readonly BoardStage[],
  stage: PipelineStage
): string {
  return stages.find((s) => s.stage === stage)?.label ?? stage
}

function Chip({
  icon: Icon,
  children,
}: {
  icon?: typeof Home
  children: ReactNode
}): ReactNode {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[0.6875rem] text-muted-foreground tabular-nums">
      {Icon !== undefined ? (
        <Icon className="size-3 shrink-0" aria-hidden="true" />
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  )
}

function Field({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[0.6875rem] tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  )
}
