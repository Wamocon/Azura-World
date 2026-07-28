import { z } from "zod"

import { roles, type Permission } from "../contracts"
import { documentCategories } from "../document-data"
import { ledgerEntryTypes, vendorInvoiceStatuses } from "../finance-data"
import { leadSources, pipelineStages } from "../lead-data"
import {
  activityCategories,
  ticketEventKinds,
  ticketPriorities,
  ticketStatuses,
} from "../operations-data"
import {
  currencyCode,
  identifier,
  isoInstant,
  longText,
  minorUnits,
  reason,
  shortText,
  version,
} from "./primitives"

/**
 * One schema per mutating operation.                         Owner: W2-B
 *
 * ## Every object is strict
 *
 * `z.strictObject` rejects unknown keys instead of stripping them. Stripping is
 * the friendlier default and the wrong one here: a caller who sends
 * `{ amount: 100, ammount: 5000 }` has a bug, and silently dropping the typo
 * writes the wrong number with no complaint. Rejecting says so.
 *
 * It is also a mass-assignment control. A body that carries `role: "admin"` at
 * an endpoint that does not take a role is refused rather than quietly ignored,
 * so a future refactor that starts passing the parsed object straight to an
 * insert cannot become a privilege-escalation bug.
 *
 * ## Schemas describe the request, not the row
 *
 * None of these mention `id`, `created_at`, `company_id` or `version` unless the
 * caller genuinely supplies them. Server-owned fields are not accepted from the
 * wire at all — that is the difference between a schema and a table definition.
 *
 * ## Every enumeration is imported, never retyped
 *
 * `z.enum(ticketStatuses)` rather than `z.enum(["open", "closed", …])`. The
 * const arrays are W2-A's, and a hand-copied list is a list that silently goes
 * stale the first time a status is added — the API would then reject a value the
 * database accepts, and the mismatch would surface as a user's form failing for
 * no visible reason. Importing makes that a compile error instead.
 */

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const updateFindingSchema = z.strictObject({
  findingId: identifier,
  status: z.enum(["open", "acknowledged", "resolved", "dismissed"]),
  // A dismissal that records no reason destroys the finding's history, which is
  // the only thing that makes the finding worth keeping.
  reason,
})

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export const updateUnitSchema = z.strictObject({
  unitId: identifier,
  expectedVersion: version,
  saleStatus: z.enum(["available", "reserved", "sold", "unknown"]).optional(),
  askingPriceMinor: minorUnits.optional(),
  askingPriceCurrency: currencyCode.optional(),
  notes: longText("Notes").optional(),
})
  // A price is an amount AND a currency. Accepting one without the other is how
  // a USD figure silently becomes a EUR figure, which is precisely the error
  // this dataset exists to document in other people's listings.
  .refine(
    (value) =>
      (value.askingPriceMinor === undefined) === (value.askingPriceCurrency === undefined),
    {
      message: "A price needs both an amount and a currency.",
      path: ["askingPriceCurrency"],
    }
  )

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export const createLeadSchema = z.strictObject({
  fullName: shortText("Name"),
  email: z.email("That is not a valid email address.").max(254),
  // Deliberately loose on format and strict on length: phone numbers across
  // DE/EN/TR/RU take too many shapes for a regex to be anything but a source of
  // false rejections for real people.
  phone: shortText("Phone number").optional(),
  source: z.enum(leadSources),
  unitId: identifier.optional(),
  message: longText("Message").optional(),
  // No `assignedTo`, no `status`, no `score`. A lead arrives unassigned and new;
  // letting the request choose would let a caller route leads to themselves.
})

export const updatePipelineSchema = z.strictObject({
  entryId: identifier,
  expectedVersion: version,
  stage: z.enum(pipelineStages),
  reason,
})

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export const createPaymentSchema = z.strictObject({
  unitId: identifier.optional(),
  residentId: identifier.optional(),
  walletId: identifier.optional(),
  direction: z.enum(["inbound", "outbound"]),
  amountMinor: minorUnits.min(1, "A payment must be greater than zero."),
  currency: currencyCode,
  receivedAt: isoInstant,
  method: z.enum(["bank_transfer", "card", "cash", "cheque", "other"]),
  reference: shortText("Payment reference"),
  note: longText("Note").optional(),
})

export const createVendorInvoiceSchema = z.strictObject({
  vendorProfileId: identifier,
  siteId: identifier.optional(),
  totalAmountMinor: minorUnits.min(1, "An invoice must be greater than zero."),
  currency: currencyCode,
  issuedOn: isoInstant,
  dueOn: isoInstant,
  reference: shortText("Invoice reference"),
  description: longText("Description").optional(),
}).refine((value) => Date.parse(value.dueOn) >= Date.parse(value.issuedOn), {
  message: "An invoice cannot fall due before it was issued.",
  path: ["dueOn"],
})

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

const ticketStatus = z.enum(ticketStatuses)

export const createTicketSchema = z.strictObject({
  unitId: identifier.optional(),
  siteId: identifier.optional(),
  category: shortText("Category"),
  priority: z.enum(ticketPriorities),
  severity: z.enum(["minor", "moderate", "major", "critical"]).optional(),
  title: shortText("Title"),
  description: longText("Description"),
})

export const updateTicketStatusSchema = z.strictObject({
  ticketId: identifier,
  expectedVersion: version,
  toStatus: ticketStatus,
  note: longText("Note").optional(),
})

export const createActivitySchema = z.strictObject({
  siteId: identifier.optional(),
  category: z.enum(activityCategories),
  title: shortText("Title"),
  description: longText("Description").optional(),
  startsAt: isoInstant,
  endsAt: isoInstant,
}).refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
  message: "An activity must end after it starts.",
  path: ["endsAt"],
})

export const createReportSchema = z.strictObject({
  unitId: identifier.optional(),
  ticketId: identifier.optional(),
  title: shortText("Title"),
  description: longText("Description"),
  // Storage object keys, not file bytes. A multipart upload path is a separate
  // surface with its own limits and is not part of this JSON API.
  mediaKeys: z.array(identifier).max(20, "At most 20 attachments.").optional(),
})

// ---------------------------------------------------------------------------
// Documents and communications
// ---------------------------------------------------------------------------

export const createDocumentSchema = z.strictObject({
  unitId: identifier.optional(),
  residentId: identifier.optional(),
  category: z.enum(documentCategories),
  title: shortText("Title"),
  storageBucket: z.enum(["documents", "compliance", "media"]),
  storageKey: shortText("Storage key"),
  visibility: z.enum(["private", "residents", "company"]),
  expiresOn: isoInstant.optional(),
})

export const createMessageSchema = z.strictObject({
  threadId: identifier,
  body: longText("Message"),
  // No `senderId`. The sender is the session, never the payload — accepting one
  // would let any authenticated caller post as anybody.
  attachments: z.array(identifier).max(10, "At most 10 attachments.").optional(),
})

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

export const createProfileSchema = z.strictObject({
  email: z.email("That is not a valid email address.").max(254),
  fullName: shortText("Name"),
  role: z.enum(roles),
  companyId: identifier.optional(),
  language: z.enum(["de", "en", "tr", "ru"]).optional(),
})

export const updateProfileRoleSchema = z.strictObject({
  profileId: identifier,
  expectedVersion: version,
  role: z.enum(roles),
  reason,
})

// ---------------------------------------------------------------------------
// Public intake
// ---------------------------------------------------------------------------

export const publicReportSchema = z.strictObject({
  // No unit id: an anonymous submitter should not be able to probe which unit
  // ids exist by watching which ones validate.
  location: shortText("Location"),
  description: longText("Description"),
  // The one optional identifier, supplied by the submitter about themselves so
  // somebody can reply. Nothing else about them is collected or inferred.
  contact: shortText("Contact").optional(),
})

// ---------------------------------------------------------------------------
// The command endpoint
// ---------------------------------------------------------------------------

/**
 * The four commands with a real repository implementation.
 *
 * A discriminated union rather than a loose `{ command, payload }`, so an
 * unknown command name is a 422 from the schema instead of a runtime branch
 * that falls through — and so each command's fields are checked, not just its
 * name.
 */
export const commandSchema = z.discriminatedUnion("command", [
  z.strictObject({
    command: z.literal("ticket.appendEvent"),
    ticketId: identifier,
    companyId: identifier,
    kind: z.enum(ticketEventKinds),
    fromStatus: ticketStatus.nullable().optional(),
    toStatus: ticketStatus.nullable().optional(),
    note: longText("Note").optional(),
  }),
  z.strictObject({
    command: z.literal("ticket.updateStatus"),
    ticketId: identifier,
    expectedVersion: version,
    toStatus: ticketStatus,
    note: longText("Note").optional(),
  }),
  z.strictObject({
    command: z.literal("ledger.reverseEntry"),
    entryId: identifier,
    reason,
    balancedGroupId: identifier.optional(),
    counterEntryType: z.enum(ledgerEntryTypes).optional(),
  }),
  z.strictObject({
    command: z.literal("vendorInvoice.settle"),
    invoiceId: identifier,
    expectedVersion: version,
    paidAmountMinor: minorUnits,
    status: z.enum(vendorInvoiceStatuses).optional(),
  }),
])

export type Command = z.infer<typeof commandSchema>

/**
 * The permission each command requires, **in addition to** the endpoint's.
 *
 * Kept beside the schema so adding a command to the union without deciding its
 * authority is a type error, not an endpoint that silently accepts it under
 * `dashboard:view`.
 */
export const commandPermissions = {
  "ticket.appendEvent": "tickets:update",
  "ticket.updateStatus": "tickets:update",
  "ledger.reverseEntry": "finance:manage",
  "vendorInvoice.settle": "vendor_invoices:approve",
} as const satisfies Record<Command["command"], Permission>
