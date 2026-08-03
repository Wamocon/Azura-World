"use client"

import { FileQuestion, ShieldAlert } from "lucide-react"
import { useState, type ComponentProps, type ReactNode } from "react"

import { GovernanceTableFrame } from "@/components/governance/governance-table"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Explain, type ExplainLabels } from "@/components/ui/explain"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/cn"

/**
 * The compliance table, and the record behind each row.        Owner: W-NIGHT
 *
 * ## The problem this solves
 *
 * `getComplianceChecks()` reads eighteen columns and the page rendered six of
 * them. The one that hurt most was `rationale`: migration 08 constrains a
 * terminal check to carry `decided_by`, `decided_at` **and** `rationale`
 * together, so the rationale is the recorded human justification for every
 * compliance decision in the system — and it was invisible. A module whose whole
 * argument is "we can show you why" was hiding the why.
 *
 * So a row opens a popup carrying every field the repository reads: the risk
 * level, the rationale, who decided and when, the evidence document with its own
 * review state and expiry, the identifiers, the version, the timestamps, and
 * whatever `metadata` holds.
 *
 * ## Two statuses, kept apart
 *
 * The popup shows the **recorded** status (what `compliance_checks.status`
 * says) beside the **derived** evidence state (what the attached document can
 * actually demonstrate — see `compliance-model.ts`). They are not a duplication
 * to be tidied up: the disagreement between them is the finding, and collapsing
 * them into one badge would silently resolve it in favour of whoever wrote the
 * row. When they disagree the popup says so in words as well as colour.
 *
 * ## Deliberately read-only
 *
 * There is no approve control, no "attach evidence", no status select, and there
 * must not be one. `public.compliance_checks` grants `authenticated` SELECT
 * only; migration 21 restored write GRANTs across seven tables and this was not
 * among them, so any write from this surface would come back as Postgres 42501.
 * A button that always fails is worse than no button — it is a promise the
 * system cannot keep. The popup says it is read-only instead.
 *
 * Every string arrives resolved from the Server Component. This island calls no
 * translator and holds exactly one piece of state: which row is open.
 */

type BadgeVariant = ComponentProps<typeof Badge>["variant"]

/** The evidence document, flattened to the fields that decide the state. */
export interface ComplianceEvidenceSummary {
  title: string
  /** Localised `documents.category`. */
  category: string
  /** Localised `documents.review_status` — why a check can be unreviewed. */
  review: string
  /** Formatted, or `null` when the document carries no expiry. */
  expiresAt: string | null
}

/**
 * One table row, flattened and pre-localised. Slim on purpose: no repository
 * record crosses the server/client boundary, only strings that are already in
 * the reader's language.
 */
export interface ComplianceRow {
  id: string
  /** Raw `EvidenceState`, kept for the row's `data-state` hook. */
  state: string
  /** Localised check type. */
  checkType: string
  /** Raw enums — the table has always shown these verbatim, and they identify. */
  subjectType: string
  subjectId: string
  stateLabel: string
  stateVariant: BadgeVariant
  /** Plain language for the derived state, from `stateExplained.*`. */
  stateExplain: ExplainLabels
  recordedLabel: string
  /** Recorded a pass the evidence cannot support. */
  overclaimed: boolean
  riskLabel: string
  riskVariant: BadgeVariant
  rationale: string | null
  decidedBy: string | null
  /** Formatted date-time, or `null` when nobody has decided. */
  decidedAt: string | null
  humanDecisionRequired: boolean
  /** Formatted date, or `null` when the check carries no deadline. */
  dueAt: string | null
  overdue: boolean
  /** The document reference, present even when the caller may not read it. */
  evidenceDocumentId: string | null
  /** `null` when unset **or** out of the caller's scope — see `evidence` below. */
  evidence: ComplianceEvidenceSummary | null
  companyId: string
  siteId: string | null
  version: string
  createdAt: string
  updatedAt: string
  metadata: readonly { key: string; value: string }[]
  /** Accessible name for the row's opener, naming the check. */
  openLabel: string
}

export interface ComplianceDetailLabels {
  close: string
  caption: string
  hint: string
  detailLead: string
  readOnly: string
  columns: {
    check: string
    subject: string
    state: string
    recorded: string
    evidence: string
    due: string
  }
  statesNote: string
  overclaimed: string
  overdue: string
  subjectType: string
  subjectId: string
  riskLevel: string
  rationale: string
  noRationale: string
  decidedBy: string
  decidedAt: string
  notDecided: string
  humanDecision: string
  humanRequired: string
  humanNotRequired: string
  evidenceHeading: string
  evidenceTitle: string
  evidenceCategory: string
  evidenceReview: string
  evidenceExpires: string
  noExpiry: string
  evidenceId: string
  /**
   * A document id is on the check and the document itself did not come back.
   *
   * States exactly that and no cause. The three candidates — RLS declined the
   * row for this reader, the document was deleted, the join returned nothing —
   * are indistinguishable from here, and an earlier version of this string
   * asserted the first one ("your role cannot read it"). That reads as a
   * permissions problem and would send somebody to ask for access they may
   * already have. Not the same as no evidence at all, which is `noEvidence`.
   */
  evidenceUnreadable: string
  noEvidence: string
  noDueDate: string
  checkId: string
  company: string
  site: string
  noSite: string
  version: string
  createdAt: string
  updatedAt: string
  metadata: string
  noMetadata: string
  /** Glossary entry for the deadline, from `getGlossary(locale)`. */
  explainDue: ExplainLabels
}

export function ComplianceChecksTable({
  rows,
  labels,
}: {
  rows: readonly ComplianceRow[]
  labels: ComplianceDetailLabels
}): ReactNode {
  const [selected, setSelected] = useState<ComplianceRow | null>(null)

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-xs text-muted-foreground">{labels.hint}</p>

      <GovernanceTableFrame>
        <Table>
          <TableCaption>{labels.caption}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{labels.columns.check}</TableHead>
              <TableHead>{labels.columns.subject}</TableHead>
              <TableHead>{labels.columns.state}</TableHead>
              <TableHead>{labels.columns.recorded}</TableHead>
              <TableHead>{labels.columns.evidence}</TableHead>
              <TableHead>{labels.columns.due}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.state}
                // The whole row lights up, but the opener is the real button in
                // the first cell. A `<tr onClick>` would be unreachable by
                // keyboard and invisible to a screen reader, and a table row is
                // not a control however it is styled.
                className="has-[button:hover]:bg-muted/40 has-[button:focus-visible]:bg-muted/40"
              >
                <TableCell className="font-medium">
                  <button
                    type="button"
                    onClick={() => setSelected(row)}
                    aria-label={row.openLabel}
                    className={cn(
                      "-mx-1 w-full rounded-md px-1 py-0.5 text-left",
                      "underline decoration-dotted decoration-from-font underline-offset-4",
                      "transition-colors hover:text-primary hover:decoration-solid",
                      "outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    )}
                  >
                    {row.checkType}
                  </button>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {row.subjectType}
                  {" · "}
                  {row.subjectId}
                </TableCell>
                <TableCell>
                  <Badge variant={row.stateVariant}>{row.stateLabel}</Badge>
                </TableCell>
                <TableCell>
                  {/* What the DATABASE says, beside what we can prove. Both are
                      shown because the disagreement between them is the
                      finding, and hiding either would resolve it silently. */}
                  <Badge variant="outline">{row.recordedLabel}</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {row.evidence === null ? (
                    <span className="text-confidence-gap">
                      {row.evidenceDocumentId === null
                        ? labels.noEvidence
                        : labels.evidenceUnreadable}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {row.evidence.title}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {row.dueAt === null ? (
                    labels.noDueDate
                  ) : (
                    <span
                      className={
                        row.overdue ? "text-confidence-conflicted" : undefined
                      }
                    >
                      {row.dueAt}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </GovernanceTableFrame>

      {/* One controlled dialog for the whole table, outside the row loop. */}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        {selected !== null ? (
          <DialogContent closeLabel={labels.close}>
            <div className="flex flex-col gap-1">
              <span className="azura-label text-muted-foreground">
                {labels.detailLead}
              </span>
              <DialogTitle>{selected.checkType}</DialogTitle>
              {/* Read-only is a fact about this surface, so it is the dialog's
                  accessible description rather than a footnote. */}
              <DialogDescription className="text-xs">
                {labels.readOnly}
              </DialogDescription>
            </div>

            {/* Recorded and derived, side by side and separately labelled. */}
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
              <PillGroup label={labels.columns.recorded}>
                <Badge variant="outline">{selected.recordedLabel}</Badge>
              </PillGroup>
              <PillGroup label={labels.columns.state}>
                <span className="inline-flex items-center gap-1">
                  <Badge variant={selected.stateVariant}>
                    {selected.stateLabel}
                  </Badge>
                  <Explain iconOnly labels={selected.stateExplain} />
                </span>
              </PillGroup>
              <PillGroup label={labels.riskLevel}>
                <Badge variant={selected.riskVariant}>
                  {selected.riskLabel}
                </Badge>
              </PillGroup>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              {labels.statesNote}
            </p>

            {selected.overclaimed ? (
              <p className="flex items-start gap-2 rounded-md border border-confidence-conflicted/40 bg-surface-conflict px-3 py-2 text-sm text-confidence-conflicted">
                <ShieldAlert
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>{labels.overclaimed}</span>
              </p>
            ) : null}

            {/* The recorded justification. First, because a compliance decision
                without its reason is a rubber stamp, and this is the field the
                database makes mandatory the moment a check leaves `pending`. */}
            <section className="flex flex-col gap-1.5">
              <h3 className="azura-label text-muted-foreground">
                {labels.rationale}
              </h3>
              {selected.rationale === null ||
              selected.rationale.trim().length === 0 ? (
                <p className="text-sm text-confidence-gap">
                  {labels.noRationale}
                </p>
              ) : (
                <p className="text-sm leading-relaxed whitespace-pre-line text-foreground">
                  {selected.rationale}
                </p>
              )}
            </section>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Field
                label={labels.columns.due}
                explain={labels.explainDue}
                value={selected.dueAt ?? labels.noDueDate}
                stated={selected.dueAt !== null}
                {...(selected.overdue ? { note: labels.overdue } : {})}
              />
              <Field
                label={labels.decidedBy}
                value={selected.decidedBy ?? labels.notDecided}
                stated={selected.decidedBy !== null}
                mono={selected.decidedBy !== null}
              />
              <Field
                label={labels.decidedAt}
                value={selected.decidedAt ?? labels.notDecided}
                stated={selected.decidedAt !== null}
              />
              <Field
                label={labels.humanDecision}
                value={
                  selected.humanDecisionRequired
                    ? labels.humanRequired
                    : labels.humanNotRequired
                }
              />
              <Field
                label={labels.subjectType}
                value={selected.subjectType}
                mono
              />
              <Field label={labels.subjectId} value={selected.subjectId} mono />
            </dl>

            {/* The evidence side of the join. `not_evidenced` is derived from
                exactly this block, so it is shown rather than summarised. */}
            <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <h3 className="azura-label text-muted-foreground">
                {labels.evidenceHeading}
              </h3>
              {selected.evidence === null ? (
                <p className="flex items-start gap-2 text-sm text-confidence-gap">
                  <FileQuestion
                    className="mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    {selected.evidenceDocumentId === null
                      ? labels.noEvidence
                      : labels.evidenceUnreadable}
                  </span>
                </p>
              ) : (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <Field
                    label={labels.evidenceTitle}
                    value={selected.evidence.title}
                  />
                  <Field
                    label={labels.evidenceCategory}
                    value={selected.evidence.category}
                  />
                  <Field
                    label={labels.evidenceReview}
                    value={selected.evidence.review}
                  />
                  <Field
                    label={labels.evidenceExpires}
                    value={selected.evidence.expiresAt ?? labels.noExpiry}
                    stated={selected.evidence.expiresAt !== null}
                  />
                </dl>
              )}
              {selected.evidenceDocumentId === null ? null : (
                <dl className="text-sm">
                  <Field
                    label={labels.evidenceId}
                    value={selected.evidenceDocumentId}
                    mono
                  />
                </dl>
              )}
            </section>

            {/* Rendered even when empty. "No extra data recorded" and a section
                that quietly vanished look identical to a reader, and only one of
                them is a statement. */}
            <section className="flex flex-col gap-1.5">
              <h3 className="azura-label text-muted-foreground">
                {labels.metadata}
              </h3>
              {selected.metadata.length === 0 ? (
                <p className="text-sm text-confidence-gap">
                  {labels.noMetadata}
                </p>
              ) : (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  {selected.metadata.map((entry) => (
                    <Field
                      key={entry.key}
                      label={entry.key}
                      value={entry.value}
                      mono
                    />
                  ))}
                </dl>
              )}
            </section>

            {/* The identifiers last: needed when someone has to go and look at
                the row itself, never the first thing a reader wants. */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 text-xs">
              <Field label={labels.checkId} value={selected.id} mono />
              <Field label={labels.version} value={selected.version} />
              <Field label={labels.company} value={selected.companyId} mono />
              <Field
                label={labels.site}
                value={selected.siteId ?? labels.noSite}
                stated={selected.siteId !== null}
                mono={selected.siteId !== null}
              />
              <Field label={labels.createdAt} value={selected.createdAt} />
              <Field label={labels.updatedAt} value={selected.updatedAt} />
            </dl>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  )
}

/** A labelled badge, so "recorded" and "derived" can never be mistaken. */
function PillGroup({
  label,
  children,
}: {
  label: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[0.6875rem] tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </span>
      {children}
    </div>
  )
}

/**
 * One `<dt>`/`<dd>` pair.
 *
 * `stated={false}` marks a value that is the *absence* of data rendered as an
 * explicit label — it is coloured as a gap so a reader can tell "no due date"
 * from a due date, at a glance, without reading the words. It is never blank and
 * never a zero.
 */
function Field({
  label,
  value,
  explain,
  note,
  mono = false,
  stated = true,
}: {
  label: string
  value: string
  explain?: ExplainLabels
  note?: string
  mono?: boolean
  stated?: boolean
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[0.6875rem] tracking-[0.04em] text-muted-foreground uppercase">
        {explain === undefined ? (
          label
        ) : (
          <span className="inline-flex items-center gap-1">
            {label}
            <Explain iconOnly labels={explain} />
          </span>
        )}
      </dt>
      <dd
        className={cn(
          "font-medium break-words tabular-nums",
          mono && "font-mono text-xs",
          stated ? "text-foreground" : "text-confidence-gap"
        )}
      >
        {value}
        {note === undefined ? null : (
          <span className="ml-2 font-sans text-xs font-normal text-confidence-conflicted">
            {note}
          </span>
        )}
      </dd>
    </div>
  )
}
