import { createManifestHandler } from "@/lib/api-handler"
import { forbidden } from "@/lib/api-errors"
import {
  reverseLedgerEntry,
  settleVendorInvoice,
} from "@/lib/finance-repository"
import {
  appendTicketEvent,
  updateTicketStatus,
} from "@/lib/operations-repository"
import type { Permission } from "@/lib/contracts"
import { hasPermission } from "@/lib/rbac"
import type {
  LedgerReversalResult,
  VendorInvoice,
} from "@/lib/finance-repository"
import type {
  TicketEvent,
  UpdateTicketStatusResult,
} from "@/lib/operations-repository"
import type { HandlerResult } from "@/lib/api-handler"
import { RepositoryError } from "@/lib/repository-base"
import { commandPermissions, commandSchema } from "@/lib/validation/schemas"

export const dynamic = "force-dynamic"

/** Every shape a command can return. Stated, not inferred from the first branch. */
type CommandResult =
  TicketEvent | UpdateTicketStatusResult | LedgerReversalResult | VendorInvoice

/**
 * The audited command endpoint.
 *
 * ## Why one endpoint instead of four
 *
 * These four operations share everything that is hard: optimistic concurrency,
 * an idempotency key, an audit row, and a 503 when the write did not land. Split
 * across four routes, each of those is implemented four times and drifts three
 * times. Together, the difficult part is written once and each command supplies
 * only its own arguments.
 *
 * ## Two permission checks, not one
 *
 * `createHandler` has already checked the endpoint's own permission
 * (`dashboard:view` — enough to reach the door). That is deliberately weak,
 * because the real authority depends on which command was sent, and the command
 * is in the body, which the wrapper does not interpret.
 *
 * So the second check is here, against `commandPermissions`. Reversing a ledger
 * entry needs `finance:manage`; settling an invoice needs
 * `vendor_invoices:approve`. A caller who can open the dashboard and sends
 * `ledger.reverseEntry` gets a 403 — the weak outer permission buys nothing.
 *
 * `commandPermissions` is `satisfies Record<Command["command"], string>`, so
 * adding a command to the union without giving it a permission is a compile
 * error rather than a command that inherits `dashboard:view`.
 */
export const POST = createManifestHandler("executeCommand", {
  schema: commandSchema,
  handler: async ({ body, profile }): Promise<HandlerResult<CommandResult>> => {
    const required: Permission = commandPermissions[body.command]
    if (!hasPermission(profile.role, required)) {
      // Says nothing about which permission was missing. Naming it would turn
      // this endpoint into a way to map the permission matrix from outside.
      throw new RepositoryError(forbidden("You do not have access to this."))
    }

    const access = { role: profile.role, profileId: profile.id }

    switch (body.command) {
      case "ticket.appendEvent": {
        const result = await appendTicketEvent({
          ...access,
          ticketId: body.ticketId,
          companyId: body.companyId,
          kind: body.kind,
          actorProfileId: profile.id,
          ...(body.fromStatus === undefined
            ? {}
            : { fromStatus: body.fromStatus }),
          ...(body.toStatus === undefined ? {} : { toStatus: body.toStatus }),
          ...(body.note === undefined ? {} : { note: body.note }),
        })
        return { data: result.data, source: result.source }
      }
      case "ticket.updateStatus": {
        const result = await updateTicketStatus({
          ...access,
          ticketId: body.ticketId,
          expectedVersion: body.expectedVersion,
          toStatus: body.toStatus,
          actorProfileId: profile.id,
          ...(body.note === undefined ? {} : { note: body.note }),
        })
        return { data: result.data, source: result.source }
      }
      case "ledger.reverseEntry": {
        const result = await reverseLedgerEntry({
          ...access,
          entryId: body.entryId,
          reason: body.reason,
          actorProfileId: profile.id,
          ...(body.balancedGroupId === undefined
            ? {}
            : { balancedGroupId: body.balancedGroupId }),
        })
        return { data: result.data, source: result.source }
      }
      case "vendorInvoice.settle": {
        const result = await settleVendorInvoice({
          ...access,
          invoiceId: body.invoiceId,
          expectedVersion: body.expectedVersion,
          // The wire carries minor units; the repository takes a major-unit
          // amount. Converting here, once, beats every caller guessing which
          // one this endpoint wanted.
          paidAmount: body.paidAmountMinor / 100,
          ...(body.status === undefined ? {} : { status: body.status }),
        })
        return { data: result.data, source: result.source }
      }
    }
  },
})
