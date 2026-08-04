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

export const updateUnitSchema = z
  .strictObject({
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
      (value.askingPriceMinor === undefined) ===
      (value.askingPriceCurrency === undefined),
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

export const createVendorInvoiceSchema = z
  .strictObject({
    vendorProfileId: identifier,
    siteId: identifier.optional(),
    totalAmountMinor: minorUnits.min(
      1,
      "An invoice must be greater than zero."
    ),
    currency: currencyCode,
    issuedOn: isoInstant,
    dueOn: isoInstant,
    reference: shortText("Invoice reference"),
    description: longText("Description").optional(),
    /**
     * The reported job this invoice bills, when it came from one.
     *
     * The internal id, not the opaque URL token: this travels in a request body
     * rather than in a path, and the body is not a place ids leak from — it is
     * not logged in a referrer, not pasted into chat, not in browser history.
     * The opaque token exists for the URL, and converting here would mean the
     * server decoding a value the client just encoded from a value the server
     * gave it.
     */
    ticketId: identifier.optional(),
  })
  .refine((value) => Date.parse(value.dueOn) >= Date.parse(value.issuedOn), {
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
  /**
   * Who takes the job. The repository REQUIRES it when `toStatus` is
   * `assigned` — a ticket assigned to nobody reads as handled on every board in
   * the product while nobody is actually coming.
   */
  assigneeProfileId: identifier.optional(),
})

export const createActivitySchema = z
  .strictObject({
    siteId: identifier.optional(),
    category: z.enum(activityCategories),
    title: shortText("Title"),
    description: longText("Description").optional(),
    startsAt: isoInstant,
    endsAt: isoInstant,
  })
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
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
  attachments: z
    .array(identifier)
    .max(10, "At most 10 attachments.")
    .optional(),
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

/**
 * Change a person's role, their active state, or both.
 *
 * `role` and `isActive` are each optional and at least one is required. The
 * refinement is what makes "at least one" a 422 rather than a silent no-op
 * write — a body of `{ profileId, expectedVersion, reason }` is a caller bug,
 * and answering 200 to it would report a change that did not happen.
 *
 * Deactivation lives here rather than at its own endpoint because it is the same
 * mutation to Postgres: `is_active` is one of the three authority columns
 * `prevent_profile_privilege_escalation()` and `enforce_last_admin_survives()`
 * both gate on. Splitting it into a second route would have produced a second
 * place for those guards to be forgotten.
 */
export const updateProfileRoleSchema = z
  .strictObject({
    profileId: identifier,
    expectedVersion: version,
    role: z.enum(roles).optional(),
    isActive: z.boolean().optional(),
    reason,
  })
  .refine((value) => value.role !== undefined || value.isActive !== undefined, {
    message: "Give a new role or a new active state.",
    path: ["role"],
  })

/**
 * Delete a person's record outright.
 *
 * Separate from deactivation on purpose. Deactivation is reversible and is what
 * an administrator wants almost every time; deletion is not, and for anyone who
 * has ever acted it is refused by `audit_events.actor_profile_id ... on delete
 * restrict` rather than by policy. `reason` is required for the same purpose it
 * serves on a role change.
 */
export const deleteProfileSchema = z.strictObject({
  profileId: identifier,
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
  /**
   * Clear your own notifications.
   *
   * No `profileId`: the recipient is the session. Accepting one would let any
   * signed-in caller clear somebody else's badge, and while
   * `notifications_update_own` would refuse the write, an endpoint that accepts
   * the field at all invites the next person to trust it.
   *
   * An absent or empty `notificationIds` means "everything unread addressed to
   * me". Capped at 200 because this is a badge, not a bulk tool.
   */
  z.strictObject({
    command: z.literal("notification.markRead"),
    notificationIds: z
      .array(identifier)
      .max(200, "At most 200 notifications at a time.")
      .optional(),
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
  // The weakest authority in this table, deliberately. A notification is
  // addressed to one person, and the row policy pins the write to
  // `auth.uid()` — so "may reach the messages module" is the whole of the
  // permission question, and every role that holds it can clear its own badge.
  "notification.markRead": "communications:view",
} as const satisfies Record<Command["command"], Permission>

/**
 * The permission a specific command instance needs.
 *
 * Almost always `commandPermissions[command]`. The exception is a **comment**,
 * and it is the difference between a product and a filing cabinet.
 *
 * `ticket.appendEvent` covers both "the status moved" and "somebody said
 * something", and requiring `tickets:update` for the whole command meant the
 * person who reported the fault could not reply on their own ticket — the one
 * conversation the system exists to carry. The database never intended that:
 * `ticket_events_insert_comment` in migration 06 explicitly allows a resident to
 * append `kind='comment'` to a ticket they can see, with the actor pinned to
 * `auth.uid()` and both status fields NULL.
 *
 * So a comment asks for `tickets:view` and the row policy does the rest: you may
 * write a comment exactly on the tickets you are already allowed to read, as
 * yourself, and you cannot dress a status change up as one. Every other kind
 * still needs `tickets:update`.
 */
export function permissionForCommand(command: Command): Permission {
  if (command.command === "ticket.appendEvent" && command.kind === "comment") {
    return "tickets:view"
  }
  return commandPermissions[command.command]
}
