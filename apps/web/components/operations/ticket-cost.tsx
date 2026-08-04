"use client"

import { Receipt } from "lucide-react"
import { useCallback, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/cn"

/**
 * What a reported job cost, on the job.                        Owner: W-NIGHT
 *
 * ## The link this closes
 *
 * The chain a building runs on is: a resident reports a fault, a manager
 * triages it, a contractor works, an invoice arrives, finance pays, the ledger
 * records it. Measured against the live database on 2026-08-04, every join in
 * that chain existed except one — `vendor_invoices` had no reference to
 * `service_tickets` at all. So the single question an operator asks most often,
 * *what did that repair cost?*, could not be answered anywhere in the product,
 * and the ticket page and the invoice page had nothing to say to each other.
 *
 * Migration 25 adds the column. This is the surface for it, from the job's side.
 *
 * ## Why the form posts rather than uses a server action
 *
 * `/api/site-management/vendor-invoices` already exists, is already in
 * `docs/api/openapi.yaml`, already carries the `vendor_invoices:create`
 * permission, the write rate limit, idempotency and an audit entry. A server
 * action beside it would be a second write path to the same table with none of
 * that, and the two would drift. `ticket-transitions.tsx` posts to the tickets
 * endpoint for the same reason.
 *
 * ## The absence is information
 *
 * A job with no invoice renders as "nothing has been billed for this job" — not
 * as a zero, and not as an empty slot. Most of what a residence pays for is
 * recurring contract work that no ticket produced, and most tickets cost nothing
 * outside the in-house team. Both facts have to survive contact with this
 * component or it teaches the reader something false.
 */

const ENDPOINT = "/api/site-management/vendor-invoices"

export interface TicketCostInvoice {
  id: string
  invoiceNo: string
  vendorName: string
  /** Preformatted server-side: the page owns the locale and the currency. */
  total: string
  outstanding: string | null
  status: string
  statusLabel: string
  issuedOn: string
}

export interface TicketCostLabels {
  heading: string
  /** Nothing billed yet. A sentence, not a zero. */
  empty: string
  /** Nothing billed and this reader cannot bill either. */
  emptyReadOnly: string
  openInvoices: string
  outstanding: string
  settled: string
  record: string
  recordHeading: string
  recordLead: string
  vendorLabel: string
  vendorPlaceholder: string
  referenceLabel: string
  referencePlaceholder: string
  amountLabel: string
  dueLabel: string
  submit: string
  cancel: string
  saving: string
  failed: string
}

interface Vendor {
  id: string
  name: string
}

export function TicketCost({
  ticketId,
  invoices,
  vendors,
  currency,
  mayRecord,
  labels,
}: {
  ticketId: string
  invoices: readonly TicketCostInvoice[]
  /** Suppliers this caller may bill against. Empty ⟹ no form, with a reason. */
  vendors: readonly Vendor[]
  currency: string
  mayRecord: boolean
  labels: TicketCostLabels
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const submit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      const amount = Number(form.get("amount"))
      if (!Number.isFinite(amount) || amount <= 0) {
        setError(labels.failed)
        return
      }
      setBusy(true)
      setError(null)
      try {
        const today = new Date().toISOString()
        const due = String(form.get("dueOn") ?? "")
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            vendorProfileId: String(form.get("vendorProfileId") ?? ""),
            // Minor units on the wire, everywhere in this API.
            totalAmountMinor: Math.round(amount * 100),
            currency,
            issuedOn: today,
            dueOn: due === "" ? today : new Date(`${due}T00:00:00Z`).toISOString(),
            reference: String(form.get("reference") ?? ""),
            ticketId,
          }),
        })
        const payload = (await response.json()) as { ok?: boolean }
        if (!response.ok || payload.ok !== true) {
          setError(labels.failed)
          return
        }
        setOpen(false)
        // Re-read rather than splicing: the server derives the outstanding
        // balance and the status, and a second answer computed here would
        // eventually disagree with the finance page.
        startTransition(() => router.refresh())
      } catch {
        setError(labels.failed)
      } finally {
        setBusy(false)
      }
    },
    [currency, labels.failed, router, ticketId]
  )

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Receipt aria-hidden="true" className="size-4 text-muted-foreground" />
          {labels.heading}
        </h2>
        {mayRecord && vendors.length > 0 && !open ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {labels.record}
          </Button>
        ) : null}
      </div>

      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {mayRecord && vendors.length > 0 ? labels.empty : labels.emptyReadOnly}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {invoices.map((invoice) => (
            <li
              key={invoice.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-input px-3 py-2"
            >
              <span className="font-mono text-sm tabular-nums">
                {invoice.invoiceNo}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {invoice.vendorName}
              </span>
              <span className="text-sm font-medium tabular-nums">
                {invoice.total}
              </span>
              <Badge
                variant={
                  invoice.status === "paid"
                    ? "muted"
                    : invoice.status === "disputed"
                      ? "destructive"
                      : "single"
                }
              >
                {invoice.statusLabel}
              </Badge>
              {invoice.outstanding === null ? null : (
                <span className="w-full text-xs text-muted-foreground tabular-nums">
                  {labels.outstanding} {invoice.outstanding}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <form
          onSubmit={submit}
          className={cn(
            "flex flex-col gap-3 rounded-md border border-input bg-muted/30 p-3",
            "transition-opacity duration-200 ease-[var(--ease-out)]",
            busy && "opacity-60"
          )}
        >
          <div>
            <p className="text-sm font-medium">{labels.recordHeading}</p>
            <p className="text-xs text-muted-foreground">{labels.recordLead}</p>
          </div>

          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))]">
            <Field label={labels.vendorLabel} htmlFor="cost-vendor">
              <select
                id="cost-vendor"
                name="vendorProfileId"
                required
                defaultValue=""
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="" disabled>
                  {labels.vendorPlaceholder}
                </option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={labels.referenceLabel} htmlFor="cost-reference">
              <input
                id="cost-reference"
                name="reference"
                required
                maxLength={80}
                placeholder={labels.referencePlaceholder}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              />
            </Field>

            <Field
              label={`${labels.amountLabel} (${currency})`}
              htmlFor="cost-amount"
            >
              <input
                id="cost-amount"
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                inputMode="decimal"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm tabular-nums"
              />
            </Field>

            <Field label={labels.dueLabel} htmlFor="cost-due">
              <input
                id="cost-due"
                name="dueOn"
                type="date"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              />
            </Field>
          </div>

          {error === null ? null : (
            <p role="alert" className="text-sm text-confidence-gap">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? labels.saving : labels.submit}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                setError(null)
              }}
            >
              {labels.cancel}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  )
}
