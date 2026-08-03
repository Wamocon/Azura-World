"use client"

import { CalendarClock, Clock, Home, TriangleAlert } from "lucide-react"
import { useCallback, useMemo, useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/cn"
import type { ApiResponse, Locale, Money } from "@/lib/contracts"
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
 *
 * ## The board is no longer read-only
 *
 * `PATCH /api/site-management/buyer-pipeline` used to answer 503, so the page
 * said so in words instead of shipping a control that could not work. Migration
 * 21 restored the UPDATE grant, so the popup now carries a stage-change control
 * — inside the existing dialog rather than in a second one, because a deal is
 * moved while looking at it, not from a separate screen.
 *
 * The control is **absent** rather than disabled for a reader who may not move
 * entries: `move` is undefined and nothing renders. A disabled button advertises
 * an operation and refuses it in the same breath.
 *
 * After a successful move nothing here is patched locally. `router.refresh()`
 * re-runs the Server Component and the new stage, "days at this stage" and
 * "previous stage" come back from the row the `track_pipeline_stage_change`
 * trigger wrote. Patching state here would show a client-computed day count that
 * the database never agreed to.
 */

const PIPELINE_ENDPOINT = "/api/site-management/buyer-pipeline"

/** `updatePipelineSchema` requires a substantive reason, not a keystroke. */
const REASON_MIN = 8
const REASON_MAX = 500

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
  /** Optimistic concurrency. Travels with the move; a mismatch is a 409. */
  version: number
}

/**
 * The stage-change control's strings. Supplied only when the reader holds
 * `buyer_pipeline:update` — its absence is what hides the control.
 */
export interface PipelineMoveLabels {
  heading: string
  stageLabel: string
  stagePlaceholder: string
  reasonLabel: string
  reasonPlaceholder: string
  reasonRequired: string
  /**
   * The honest note about where the reason goes. `buyer_pipeline_entries` has no
   * column for it, so it is checked and then discarded; asking for a sentence
   * and silently binning it without saying so would be the kind of quiet lie
   * this product exists not to tell.
   */
  reasonNotStored: string
  submit: string
  busy: string
  conflict: string
  genericError: string
  unavailable: string
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
  move,
}: {
  stages: readonly BoardStage[]
  labels: PipelineBoardLabels
  locale: Locale
  /** Present only for a reader who may move entries. Absent hides the control. */
  move?: PipelineMoveLabels
}): ReactNode {
  const router = useRouter()
  /**
   * The OPEN CARD'S ID, never a snapshot of the card.
   *
   * This held a `BoardEntry` object captured at click time, and that made the
   * move control fail permanently the first time it lost a race. On a 409 the
   * handler calls `router.refresh()`, which re-renders `stages` with the
   * winner's version — but the captured object still carried the stale
   * `version`, so every retry sent the same losing `expectedVersion` and got
   * the same 409, under a message telling the operator to try again.
   *
   * Deriving the entry from `stages` instead means a refresh updates the open
   * popup too: the version is current, and so are `previous_stage` and
   * `entered_stage_at`, which the database trigger has just rewritten.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo(
    () =>
      selectedId === null
        ? null
        : (stages
            .flatMap((stage) => stage.entries)
            .find((entry) => entry.id === selectedId) ?? null),
    [stages, selectedId]
  )
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [target, setTarget] = useState("")
  const [reason, setReason] = useState("")
  const [moveError, setMoveError] = useState<string | null>(null)
  const maxCount = useMemo(
    () => Math.max(1, ...stages.map((s) => s.count)),
    [stages]
  )

  /**
   * Opening a different card must not inherit the last card's half-typed reason
   * — that is how a note about one deal ends up submitted against another.
   */
  const open = useCallback((entry: BoardEntry) => {
    setSelectedId(entry.id)
    setTarget("")
    setReason("")
    setMoveError(null)
  }, [])

  const submitMove = useCallback(
    async (entry: BoardEntry, stage: string, why: string) => {
      if (move === undefined) return
      setBusy(true)
      setMoveError(null)
      try {
        const response = await fetch(PIPELINE_ENDPOINT, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entryId: entry.id,
            expectedVersion: entry.version,
            stage,
            reason: why,
          }),
        })
        const payload = (await response.json()) as ApiResponse<unknown>

        if (response.ok && payload.ok) {
          setSelectedId(null)
          setTarget("")
          setReason("")
          // Re-read rather than patch: the trigger owns `previous_stage` and
          // `entered_stage_at`, and a locally-computed "days at this stage"
          // would be a number the database never wrote.
          startTransition(() => router.refresh())
          return
        }

        const code = payload.ok ? null : payload.error.code
        if (response.status === 409 || code === "conflict") {
          // Somebody else moved this deal first. Say so and re-render against
          // the truth; retrying silently would apply this operator's intent to
          // an entry that is no longer the one they read.
          setMoveError(move.conflict)
          startTransition(() => router.refresh())
          return
        }
        if (code === "persistence_unavailable") {
          // 503. The move did NOT happen, and the popup stays open saying so
          // rather than closing as though it had.
          setMoveError(move.unavailable)
          return
        }
        setMoveError(payload.ok ? move.genericError : payload.error.message)
      } catch {
        setMoveError(move.genericError)
      } finally {
        setBusy(false)
      }
    },
    [move, router]
  )

  const working = busy || pending

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
                      onClick={() => open(entry)}
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
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedId(null)
            setMoveError(null)
          }
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

            {move === undefined ? null : (
              <MoveForm
                entry={selected}
                stages={stages}
                labels={move}
                working={working}
                error={moveError}
                target={target}
                reason={reason}
                onTargetChange={setTarget}
                onReasonChange={setReason}
                onInvalid={setMoveError}
                onSubmit={(entry, stage, why) => {
                  void submitMove(entry, stage, why)
                }}
              />
            )}
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

/**
 * The stage-change control, inside the record it changes.
 *
 * Every stage but the one the entry is already in is offered. The current stage
 * is omitted rather than disabled because "move it to where it already is" is
 * not an operation — the repository refuses it, and an option that exists only
 * to be rejected is noise in a nine-item list.
 *
 * The reason is required by `updatePipelineSchema` at eight characters, and the
 * button is disabled until it is met so the operator learns the rule before the
 * round trip rather than from a 422. Where that sentence ends up is stated under
 * the field: nowhere. The entry has no column for it.
 *
 * Presentational and controlled — the board owns the state, so closing the
 * popup discards a half-typed reason instead of carrying it to the next deal.
 */
function MoveForm({
  entry,
  stages,
  labels,
  working,
  error,
  target,
  reason,
  onTargetChange,
  onReasonChange,
  onInvalid,
  onSubmit,
}: {
  entry: BoardEntry
  stages: readonly BoardStage[]
  labels: PipelineMoveLabels
  working: boolean
  error: string | null
  target: string
  reason: string
  onTargetChange: (value: string) => void
  onReasonChange: (value: string) => void
  onInvalid: (message: string) => void
  onSubmit: (entry: BoardEntry, stage: string, reason: string) => void
}): ReactNode {
  const trimmedReason = reason.trim()
  const ready = target !== "" && trimmedReason.length >= REASON_MIN

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (trimmedReason.length < REASON_MIN) {
          onInvalid(labels.reasonRequired)
          return
        }
        onSubmit(entry, target, trimmedReason)
      }}
    >
      <h3 className="text-sm font-medium text-foreground">{labels.heading}</h3>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`move-stage-${entry.id}`}
          className="text-sm font-medium text-foreground"
        >
          {labels.stageLabel}
        </label>
        <select
          id={`move-stage-${entry.id}`}
          required
          value={target}
          disabled={working}
          onChange={(event) => onTargetChange(event.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
        >
          <option value="">{labels.stagePlaceholder}</option>
          {stages
            .filter((stage) => stage.stage !== entry.stage)
            .map((stage) => (
              <option key={stage.stage} value={stage.stage}>
                {stage.label}
              </option>
            ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`move-reason-${entry.id}`}
          className="text-sm font-medium text-foreground"
        >
          {labels.reasonLabel}
        </label>
        <textarea
          id={`move-reason-${entry.id}`}
          required
          rows={3}
          minLength={REASON_MIN}
          maxLength={REASON_MAX}
          value={reason}
          disabled={working}
          placeholder={labels.reasonPlaceholder}
          aria-describedby={`move-reason-note-${entry.id}`}
          onChange={(event) => onReasonChange(event.target.value)}
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
        />
        <p
          id={`move-reason-note-${entry.id}`}
          className="text-xs text-muted-foreground"
        >
          {labels.reasonNotStored}
        </p>
      </div>

      {error === null ? null : (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground"
        >
          {error}
        </p>
      )}

      <div>
        <Button type="submit" size="sm" disabled={working || !ready}>
          {working ? labels.busy : labels.submit}
        </Button>
      </div>
    </form>
  )
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
