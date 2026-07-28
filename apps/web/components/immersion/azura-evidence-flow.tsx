"use client"

import {
  ArrowRight,
  Check,
  GitBranch,
  ScanSearch,
  Database,
} from "lucide-react"
import { useState, type ReactNode } from "react"

import { cn } from "@/lib/cn"
import type { SourcedFact } from "@/lib/contracts"

import {
  ProvenanceValue,
  type ProvenanceLabels,
} from "@/components/evidence/provenance-value"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { AnimatedCounter } from "./primitives"

/**
 * AzuraEvidenceFlow — the component that argues the whole project.
 *                                                          Owner: W3-I
 *
 * Nothing in either reference repo corresponds to this. 1Çatı's simulations
 * demonstrate an ERP; this demonstrates *why the numbers can be trusted*, which
 * is the only thing a competitor-intelligence product actually sells.
 *
 * Four stages — sources → harvest → conflict detection → dataset — and then the
 * ending, which is the point: **F-002 resolves to nothing.** Four publishers,
 * four prices, two currencies, a 2.1× spread, and the pipeline deliberately
 * does not pick one.
 *
 * That ending is the argument. Any competitor CATI can show a number. Showing
 * the number you *refused* to invent is the part that is hard to fake, and it
 * is why the last panel is a non-resolution rather than a tidy green check.
 *
 * Every figure renders through `ProvenanceValue` or an `AnimatedCounter` over a
 * real dataset count. Nothing here is invented, including the stage counts.
 */

export interface EvidenceFlowLabels {
  heading: string
  intro: string
  stages: {
    sources: { title: string; body: string }
    harvest: { title: string; body: string }
    conflict: { title: string; body: string }
    dataset: { title: string; body: string }
  }
  /** The ending. */
  finding: {
    eyebrow: string
    title: string
    body: string
    resolution: string
    /** e.g. "Nicht aufgelöst" */
    unresolved: string
  }
  next: string
  restart: string
  /** Counter units. */
  units: {
    sources: string
    validated: string
    findings: string
    facts: string
  }
}

export interface EvidenceFlowCounts {
  /** Harvest attempts. */
  sourcesTotal: number
  /** Attempts whose bytes validated — NOT whose status was 200. */
  sourcesValidated: number
  /** Recorded findings. */
  findings: number
  /** Conflicted project facts. */
  conflictedFacts: number
}

/** One competing price, straight from F-002's `competingValues`. */
export interface CompetingPrice {
  publisher: string
  amount: number
  currency: string
}

type Stage = "sources" | "harvest" | "conflict" | "dataset"
const STAGES: readonly Stage[] = ["sources", "harvest", "conflict", "dataset"]

const STAGE_ICON = {
  sources: ScanSearch,
  harvest: Database,
  conflict: GitBranch,
  dataset: Check,
} as const

export function AzuraEvidenceFlow({
  counts,
  competingPrices,
  entryPriceFact,
  labels,
  provenanceLabels,
  locale,
  className,
}: {
  counts: EvidenceFlowCounts
  /** F-002's competing values. Rendered each in its own currency. */
  competingPrices: readonly CompetingPrice[]
  entryPriceFact: SourcedFact<{ amount: number; currency: string }>
  labels: EvidenceFlowLabels
  provenanceLabels: ProvenanceLabels
  locale: string
  className?: string
}): ReactNode {
  const [stage, setStage] = useState<Stage>("sources")
  const stageIndex = STAGES.indexOf(stage)
  const atEnd = stageIndex === STAGES.length - 1

  return (
    <section
      data-slot="evidence-flow"
      className={cn("flex min-w-0 flex-col gap-5", className)}
      aria-labelledby="azura-flow-heading"
    >
      <header className="flex min-w-0 flex-col gap-2">
        <h3
          id="azura-flow-heading"
          className="font-display text-xl font-semibold"
        >
          {labels.heading}
        </h3>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          {labels.intro}
        </p>
      </header>

      {/* Stage rail. Buttons, not a scroll-scrubbed timeline: a reader must be
          able to go back to a stage, and on a phone a scrubbed animation means
          the content is only reachable at one exact scroll position. */}
      <ol
        className="flex min-w-0 flex-wrap items-center gap-2"
        data-testid="flow-stages"
      >
        {STAGES.map((candidate, index) => {
          const Icon = STAGE_ICON[candidate]
          const done = index < stageIndex
          const active = index === stageIndex
          return (
            <li key={candidate} className="flex items-center gap-2">
              <Button
                size="sm"
                variant={active ? "default" : done ? "secondary" : "outline"}
                aria-current={active ? "step" : undefined}
                onClick={() => setStage(candidate)}
                data-testid={`flow-stage-${candidate}`}
              >
                <Icon aria-hidden="true" />
                {labels.stages[candidate].title}
              </Button>
              {index < STAGES.length - 1 ? (
                <ArrowRight
                  className="size-3 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : null}
            </li>
          )
        })}
      </ol>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <p className="font-display text-base font-semibold">
            {labels.stages[stage].title}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {labels.stages[stage].body}
          </p>

          <dl className="mt-1 grid grid-cols-2 gap-3">
            <Metric
              label={labels.units.sources}
              value={counts.sourcesTotal}
              locale={locale}
            />
            <Metric
              label={labels.units.validated}
              value={counts.sourcesValidated}
              locale={locale}
            />
            <Metric
              label={labels.units.findings}
              value={counts.findings}
              locale={locale}
            />
            <Metric
              label={labels.units.facts}
              value={counts.conflictedFacts}
              locale={locale}
            />
          </dl>
        </div>

        {/* The ending. Always rendered — not gated behind reaching stage 4 —
            because it is the argument, and a reader who never clicks through
            must still see that the conflict was left open. */}
        <div className="flex min-w-0 flex-col gap-3 rounded-xl border-2 border-confidence-conflicted/45 bg-surface-conflict p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold tracking-[0.08em] text-confidence-conflicted uppercase">
              {labels.finding.eyebrow}
            </span>
            <Badge variant="conflicted">{labels.finding.unresolved}</Badge>
          </div>

          <p className="font-display text-base font-semibold">
            {labels.finding.title}
          </p>

          <ul
            className="flex min-w-0 flex-col gap-1.5"
            data-testid="flow-competing"
          >
            {competingPrices.map((price) => (
              <li
                key={`${price.publisher}-${price.amount}-${price.currency}`}
                className="flex items-baseline justify-between gap-3 border-b border-confidence-conflicted/20 pb-1.5 text-sm last:border-0"
              >
                <span className="truncate text-muted-foreground">
                  {price.publisher}
                </span>
                <span data-numeric className="shrink-0 font-semibold">
                  {/* Each in its own currency. Converting would require a rate
                      and a rate date no source provides. */}
                  {new Intl.NumberFormat(locale, {
                    style: "currency",
                    currency: price.currency,
                    maximumFractionDigits: 0,
                  }).format(price.amount)}
                </span>
              </li>
            ))}
          </ul>

          <div className="min-w-0">
            <ProvenanceValue
              fact={entryPriceFact}
              format="money"
              locale={locale}
              labels={provenanceLabels}
            />
          </div>

          <p className="text-xs leading-relaxed text-foreground/80">
            {labels.finding.body}
          </p>
          <p className="text-xs leading-relaxed font-medium text-confidence-conflicted">
            {labels.finding.resolution}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setStage(atEnd ? "sources" : (STAGES[stageIndex + 1] ?? "sources"))
          }
          data-testid="flow-next"
        >
          {atEnd ? labels.restart : labels.next}
        </Button>
      </div>
    </section>
  )
}

function Metric({
  label,
  value,
  locale,
}: {
  label: string
  value: number
  locale: string
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="truncate text-xs tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="font-display text-2xl font-bold">
        <AnimatedCounter value={value} locale={locale} />
      </dd>
    </div>
  )
}
