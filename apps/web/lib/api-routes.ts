import type { Permission } from "./contracts"

/**
 * The API surface, declared once.                           Owner: W2-B
 *
 * ## Why a manifest instead of 28 self-describing route files
 *
 * `CONTRACTS.md` §5 asks for a spec at exact parity with the code, and the
 * usual way that promise is kept — write the route, then remember to write the
 * YAML — fails silently the first time someone forgets. The spec is then worse
 * than no spec, because it is believed.
 *
 * So the spec is not maintained. It is **generated** from this file by
 * `scripts/generate-openapi.mjs`, and `scripts/validate-openapi.mjs` regenerates
 * it and compares byte for byte with `docs/api/openapi.yaml`. Drift is not
 * detected; it is impossible. The validator's remaining job is the interesting
 * one — proving this file matches the filesystem in **both** directions, so an
 * undocumented route cannot be added and a documented one cannot be deleted.
 *
 * The route files then hold only the part a manifest cannot express: which
 * repository function to call and how to map the query string onto it.
 *
 * ## No `server-only`, deliberately
 *
 * `scripts/validate-openapi.mjs` imports this module under plain Node. Adding a
 * server-only import here, or a `zod` schema object, would break that — which is
 * why request schemas live in `lib/validation/*` and are referenced from here by
 * name only.
 *
 * ## Two security properties the validator enforces from this data
 *
 * 1. **No public route without a rate limit.** `permission: null` with no
 *    `rateLimit` fails the build. An unauthenticated endpoint with no ceiling is
 *    a free amplifier.
 * 2. **No mutating route without an audit write.** A POST/PATCH/DELETE with no
 *    `audit` fails the build. An unaudited mutation is indistinguishable from
 *    one that never happened.
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE"

export interface QueryParam {
  name: string
  description: string
  schema:
    | {
        type: "string"
        enum?: readonly string[]
        maxLength?: number
        minLength?: number
      }
    | { type: "integer"; minimum?: number; maximum?: number }
    | { type: "boolean" }
  required?: boolean
}

export interface RouteOperation {
  method: HttpMethod
  /** Globally unique, `verbNoun` camelCase. Also the OpenAPI `operationId`. */
  operationId: string
  summary: string
  description: string
  tag: string
  /** `null` = public. Requires `publicJustification` and `rateLimit`. */
  permission: Permission | null
  publicJustification?: string
  rateLimit?: { windowMs: number; max: number }
  audit?: { action: string; entity: string }
  requiresPersistence?: boolean
  idempotent?: boolean
  /** Set when the write path does not exist yet. Forces 503-and-no-2xx. */
  writeGap?: { reason: string; owner: string }
  /**
   * This route exists and is reachable, but another task owns the file.
   *
   * Five route files predate this manifest — W1-B's access-profile switch and
   * W2-C's AI endpoints — and ORCHESTRATION §4 forbids this window from editing
   * them. Leaving them out of the manifest was the obvious option and the wrong
   * one: they would then be shadow endpoints, absent from the published spec and
   * outside every check in `validate-openapi.mjs`, which is precisely the state
   * that check exists to prevent.
   *
   * So they are declared, documented, and marked. The validator exempts them
   * from the checks it cannot enforce across an ownership boundary — and
   * **prints every exemption**, so an unverified property is visible in the gate
   * output rather than quietly counted as a pass.
   */
  external?: { owner: string; note: string }
  /** Name of the exported schema in `lib/validation/`. Documentation only. */
  requestSchema?: string
  query?: readonly QueryParam[]
  /** Status codes this operation can return, beyond the universal ones. */
  responses: readonly number[]
}

export interface RouteEntry {
  /** OpenAPI form, `{id}` not `[id]`. */
  path: string
  /** Path relative to `apps/web/app/api`, e.g. `site-management/leads`. */
  dir: string
  pathParams?: readonly string[]
  operations: readonly RouteOperation[]
}

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

const PAGE_QUERY: readonly QueryParam[] = [
  {
    name: "limit",
    description:
      "Page size. Clamped to [1, 500]; anything larger is clamped, not rejected.",
    schema: { type: "integer", minimum: 1, maximum: 500 },
  },
  {
    name: "offset",
    description: "Rows to skip. Negative values are clamped to 0.",
    schema: { type: "integer", minimum: 0 },
  },
]

/** Reads: generous, but never unbounded. */
const READ_LIMIT = { windowMs: 60_000, max: 120 }
/** Mutations: an order of magnitude tighter. */
const WRITE_LIMIT = { windowMs: 60_000, max: 20 }
/** Unauthenticated: the tightest budget in the app. */
const PUBLIC_LIMIT = { windowMs: 60_000, max: 5 }

/**
 * The universal responses. Every operation can produce these, so they are added
 * by the generator rather than repeated 42 times.
 *
 * 500 is deliberately NOT here. `createHandler` catches everything and maps it
 * to a declared code, so a 500 means a bug — and documenting it would make that
 * bug look like part of the contract.
 */
export const UNIVERSAL_RESPONSES: readonly number[] = [400, 429]
export const AUTHENTICATED_RESPONSES: readonly number[] = [401, 403]

/** The owners named in every write-gap message. Kept together so they stay honest. */
const W2A = "W2-A (repository mutations)"
const W1A = "W1-A (migrations and RPCs)"

function gap(what: string, owner: string): { reason: string; owner: string } {
  return {
    reason: `${what} is not implemented: no repository write path exists yet.`,
    owner,
  }
}

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

export const apiRoutes: readonly RouteEntry[] = [
  // -- Dashboard ------------------------------------------------------------
  {
    path: "/api/site-management/dashboard",
    dir: "site-management/dashboard",
    operations: [
      {
        method: "GET",
        operationId: "getDashboardSnapshot",
        summary: "Get the role-scoped dashboard snapshot.",
        description:
          "Returns the KPI snapshot for the caller's role. The four module sections are populated only where the role holds the matching permission; a section the role cannot see is absent, not empty.",
        tag: "Dashboard",
        permission: "dashboard:view",
        rateLimit: READ_LIMIT,
        responses: [200],
      },
    ],
  },

  // -- Evidence -------------------------------------------------------------
  {
    path: "/api/site-management/evidence",
    dir: "site-management/evidence",
    operations: [
      {
        method: "GET",
        operationId: "getEvidenceSources",
        summary: "List harvested sources and their health.",
        description:
          "Returns every source the dataset cites, with its last successful fetch and staleness. A source that has not been re-fetched is reported as stale rather than omitted.",
        tag: "Evidence",
        permission: "evidence:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "view",
            description:
              "`sources` returns the source list; `health` returns fetch health per source.",
            schema: { type: "string", enum: ["sources", "health"] },
          },
        ],
        responses: [200],
      },
    ],
  },
  {
    path: "/api/site-management/evidence/findings",
    dir: "site-management/evidence/findings",
    operations: [
      {
        method: "GET",
        operationId: "getEvidenceFindings",
        summary: "List evidence findings.",
        description:
          "Returns findings, optionally filtered by severity or status. Each carries the sources it was derived from; a finding with no sources is a defect, not a result.",
        tag: "Evidence",
        permission: "evidence:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "severity",
            description: "Filter to one severity.",
            schema: {
              type: "string",
              enum: ["low", "medium", "high", "critical"],
            },
          },
          {
            name: "status",
            description: "Filter to one lifecycle status.",
            schema: {
              type: "string",
              enum: ["open", "acknowledged", "resolved", "dismissed"],
            },
          },
          ...PAGE_QUERY,
        ],
        responses: [200],
      },
      {
        method: "PATCH",
        operationId: "updateEvidenceFinding",
        summary: "Change a finding's status.",
        description:
          "Records a human judgement on a finding. Not implemented: the evidence repository is read-only in this wave, so the route validates and authorises the command and then reports 503 rather than accepting a change it cannot store.",
        tag: "Evidence",
        permission: "evidence:manage",
        rateLimit: WRITE_LIMIT,
        audit: {
          action: "evidence_finding.status_changed",
          entity: "evidence_findings",
        },
        requiresPersistence: true,
        requestSchema: "updateFindingSchema",
        writeGap: gap("Changing a finding's status", W2A),
        responses: [503],
      },
    ],
  },
  {
    path: "/api/site-management/evidence/coverage",
    dir: "site-management/evidence/coverage",
    operations: [
      {
        method: "GET",
        operationId: "getEvidenceCoverage",
        summary: "Get the dataset's coverage report.",
        description:
          "Returns the dataset's own assessment of what it does and does not cover, including the count of fields at each confidence level. Gaps are reported as gaps.",
        tag: "Evidence",
        permission: "evidence:view",
        rateLimit: READ_LIMIT,
        responses: [200],
      },
    ],
  },

  // -- Inventory ------------------------------------------------------------
  {
    path: "/api/site-management/inventory/units",
    dir: "site-management/inventory/units",
    operations: [
      {
        method: "GET",
        operationId: "getInventoryUnits",
        summary: "List units.",
        description:
          "Returns role-scoped units. 25 of 656 units are real portal listings and 631 are modelled; every record carries its `dataQuality` so the two are never conflated.",
        tag: "Inventory",
        permission: "units:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "layout",
            description: "Filter to one layout, e.g. `2+1`.",
            schema: { type: "string", maxLength: 16 },
          },
          {
            name: "dataQuality",
            description:
              "`real` keeps only harvested listings; `modelled` keeps only generated records.",
            schema: { type: "string", enum: ["real", "modelled"] },
          },
          {
            name: "saleStatus",
            description: "Filter to one sale status.",
            schema: { type: "string", maxLength: 32 },
          },
          {
            name: "blockCode",
            description: "Filter to one block, e.g. `B3`.",
            schema: { type: "string", maxLength: 16 },
          },
          ...PAGE_QUERY,
        ],
        responses: [200],
      },
    ],
  },
  {
    path: "/api/site-management/inventory/units/{id}",
    dir: "site-management/inventory/units/[id]",
    pathParams: ["id"],
    operations: [
      {
        method: "GET",
        operationId: "getInventoryUnit",
        summary: "Get one unit.",
        description:
          "Returns a single unit by id, e.g. `AZW-B03-0412`. A unit the caller's role cannot see is reported as not found, so the response cannot be used to enumerate ids.",
        tag: "Inventory",
        permission: "units:view",
        rateLimit: READ_LIMIT,
        responses: [200, 404],
      },
      {
        method: "PATCH",
        operationId: "updateInventoryUnit",
        summary: "Update a unit.",
        description:
          "Not implemented: the inventory repository is read-only in this wave. The route authorises and validates the command, then reports 503 naming the missing write path.",
        tag: "Inventory",
        permission: "units:update",
        rateLimit: WRITE_LIMIT,
        audit: { action: "unit.updated", entity: "units" },
        requiresPersistence: true,
        requestSchema: "updateUnitSchema",
        writeGap: gap("Updating a unit", W2A),
        responses: [503],
      },
    ],
  },
  {
    path: "/api/site-management/inventory/blocks",
    dir: "site-management/inventory/blocks",
    operations: [
      {
        method: "GET",
        operationId: "getInventoryBlocks",
        summary: "List blocks, or the floors of one block.",
        description:
          "Returns the seven blocks. Supply `blockId` to return that block's floors instead.",
        tag: "Inventory",
        permission: "units:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "blockId",
            description:
              "Return this block's floors rather than the block list.",
            schema: { type: "string", maxLength: 64 },
          },
          ...PAGE_QUERY,
        ],
        responses: [200],
      },
    ],
  },

  // -- Portal listings ------------------------------------------------------
  {
    path: "/api/site-management/portal-listings",
    dir: "site-management/portal-listings",
    operations: [
      {
        method: "GET",
        operationId: "getPortalListings",
        summary: "List harvested portal listings.",
        description:
          "Returns listings captured from external property portals, each with its publisher and capture date. Two listings from the same publisher are two distinct captures and both are returned; this endpoint never deduplicates, because disagreement between captures is the product.",
        tag: "Listings",
        permission: "listings:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "view",
            description:
              "`listings` (default), `stale` for captures past their freshness window, or `spread` for the price-spread buckets.",
            schema: { type: "string", enum: ["listings", "stale", "spread"] },
          },
          {
            name: "publisher",
            description: "Filter to one publisher.",
            schema: { type: "string", maxLength: 64 },
          },
          {
            name: "unitId",
            description: "Return competing captured prices for this unit.",
            schema: { type: "string", maxLength: 64 },
          },
          ...PAGE_QUERY,
        ],
        responses: [200],
      },
    ],
  },

  // -- Hotel ----------------------------------------------------------------
  {
    path: "/api/site-management/hotel",
    dir: "site-management/hotel",
    operations: [
      {
        method: "GET",
        operationId: "getHotel",
        summary: "Get the hotel and its room breakdown.",
        description:
          "Returns the 188-room hotel record. Supply `view=rooms` for the room-type breakdown.",
        tag: "Hotel",
        permission: "hotel:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "view",
            description: "`hotel` (default) or `rooms`.",
            schema: { type: "string", enum: ["hotel", "rooms"] },
          },
        ],
        responses: [200, 404],
      },
    ],
  },
  {
    path: "/api/site-management/reviews",
    dir: "site-management/reviews",
    operations: [
      {
        method: "GET",
        operationId: "getHotelReviews",
        summary: "List review sources, quotes, or the normalised summary.",
        description:
          "Returns guest-review evidence. Scores arrive on different scales across platforms; `view=summary` normalises them and always reports the scale it normalised to, never silently.",
        tag: "Hotel",
        permission: "reviews:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "view",
            description: "`sources` (default), `quotes`, or `summary`.",
            schema: { type: "string", enum: ["sources", "quotes", "summary"] },
          },
          {
            name: "platform",
            description: "Filter to one review platform.",
            schema: { type: "string", maxLength: 64 },
          },
          {
            name: "reviewSourceId",
            description: "With `view=quotes`, restrict to one source.",
            schema: { type: "string", maxLength: 64 },
          },
          {
            name: "normaliseTo",
            description:
              "With `view=summary`, the scale to express scores on. 5 or 10.",
            schema: { type: "integer", minimum: 5, maximum: 10 },
          },
          ...PAGE_QUERY,
        ],
        responses: [200],
      },
    ],
  },

  // -- Sales ----------------------------------------------------------------
  {
    path: "/api/site-management/leads",
    dir: "site-management/leads",
    operations: [
      {
        method: "GET",
        operationId: "getLeads",
        summary: "List sales leads.",
        description:
          "Returns role-scoped leads. Staff see the leads assigned to them.",
        tag: "Sales",
        permission: "leads:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "status",
            description: "Filter to one lead status.",
            schema: { type: "string", maxLength: 32 },
          },
          {
            name: "source",
            description: "Filter to one acquisition source.",
            schema: { type: "string", maxLength: 32 },
          },
          {
            name: "assignedTo",
            description: "Filter to one assignee profile id.",
            schema: { type: "string", maxLength: 64 },
          },
          ...PAGE_QUERY,
        ],
        responses: [200],
      },
      {
        method: "POST",
        operationId: "createLead",
        summary: "Create a lead.",
        description:
          "Not implemented: no repository write path exists for leads. The route authorises and validates the payload, then reports 503 rather than returning a lead id for a record that was never stored.",
        tag: "Sales",
        permission: "leads:create",
        rateLimit: WRITE_LIMIT,
        audit: { action: "lead.created", entity: "leads" },
        requiresPersistence: true,
        idempotent: true,
        requestSchema: "createLeadSchema",
        writeGap: gap("Creating a lead", W2A),
        responses: [503],
      },
    ],
  },
  {
    path: "/api/site-management/buyer-pipeline",
    dir: "site-management/buyer-pipeline",
    operations: [
      {
        method: "GET",
        operationId: "getBuyerPipeline",
        summary: "List pipeline entries, or the stage summary.",
        description:
          "Returns the buyer pipeline. `view=summary` returns per-stage counts and values, with totals kept per currency rather than summed across them.",
        tag: "Sales",
        permission: "buyer_pipeline:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "view",
            description: "`entries` (default) or `summary`.",
            schema: { type: "string", enum: ["entries", "summary"] },
          },
          {
            name: "stage",
            description: "Filter to one pipeline stage.",
            schema: { type: "string", maxLength: 32 },
          },
          {
            name: "unitId",
            description: "Filter to one unit.",
            schema: { type: "string", maxLength: 64 },
          },
          ...PAGE_QUERY,
        ],
        responses: [200],
      },
      {
        method: "PATCH",
        operationId: "updateBuyerPipelineEntry",
        summary: "Move a pipeline entry to another stage.",
        description:
          "Not implemented: no repository write path exists for the pipeline. Authorised and validated, then 503.",
        tag: "Sales",
        permission: "buyer_pipeline:update",
        rateLimit: WRITE_LIMIT,
        audit: {
          action: "pipeline_entry.stage_changed",
          entity: "buyer_pipeline_entries",
        },
        requiresPersistence: true,
        requestSchema: "updatePipelineSchema",
        writeGap: gap("Moving a pipeline entry", W2A),
        responses: [503],
      },
    ],
  },

  // -- Finance --------------------------------------------------------------
  {
    path: "/api/site-management/finance",
    dir: "site-management/finance",
    operations: [
      {
        method: "GET",
        operationId: "getFinanceLedger",
        summary: "List ledger entries, or the finance summary.",
        description:
          "Returns role-scoped ledger entries. Owners and tenants see only entries for units they hold. Monetary totals are reported per currency; this API never sums across currencies, because the dataset contains both EUR and USD figures that are not commensurable.",
        tag: "Finance",
        permission: "finance:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "view",
            description: "`entries` (default) or `summary`.",
            schema: { type: "string", enum: ["entries", "summary"] },
          },
          {
            name: "unitId",
            description: "Filter to one unit.",
            schema: { type: "string", maxLength: 64 },
          },
          {
            name: "status",
            description: "Filter to one entry status.",
            schema: { type: "string", maxLength: 32 },
          },
          {
            name: "period",
            description: "Accounting period as `YYYY-MM`.",
            schema: { type: "string", maxLength: 7 },
          },
          {
            name: "currency",
            description: "Filter to one ISO 4217 currency.",
            schema: { type: "string", maxLength: 3 },
          },
          ...PAGE_QUERY,
        ],
        responses: [200],
      },
    ],
  },
  {
    path: "/api/site-management/finance/payments",
    dir: "site-management/finance/payments",
    operations: [
      {
        method: "GET",
        operationId: "getPaymentTransactions",
        summary: "List payment transactions.",
        description: "Returns role-scoped payment transactions.",
        tag: "Finance",
        permission: "finance:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "direction",
            description: "`inbound` or `outbound`.",
            schema: { type: "string", enum: ["inbound", "outbound"] },
          },
          {
            name: "status",
            description: "Filter to one payment status.",
            schema: { type: "string", maxLength: 32 },
          },
          {
            name: "unitId",
            description: "Filter to one unit.",
            schema: { type: "string", maxLength: 64 },
          },
          ...PAGE_QUERY,
        ],
        responses: [200],
      },
      {
        method: "POST",
        operationId: "createPayment",
        summary: "Record a payment.",
        description:
          "Not implemented: recording money movement requires the posting RPC that W1-A's migrations have not created. A payments endpoint that appeared to succeed without writing would be the most damaging fake success in this API, so it reports 503.",
        tag: "Finance",
        permission: "finance:create",
        rateLimit: WRITE_LIMIT,
        audit: { action: "payment.recorded", entity: "payment_transactions" },
        requiresPersistence: true,
        idempotent: true,
        requestSchema: "createPaymentSchema",
        writeGap: gap("Recording a payment", W1A),
        responses: [503],
      },
    ],
  },
  {
    path: "/api/site-management/wallet",
    dir: "site-management/wallet",
    operations: [
      {
        method: "GET",
        operationId: "getWallets",
        summary: "List wallets.",
        description:
          "Returns role-scoped wallets. A resident role sees only its own wallet; there is no parameter that widens that.",
        tag: "Finance",
        permission: "wallet:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "lowBalanceOnly",
            description:
              "Keep only wallets below their configured low-balance threshold.",
            schema: { type: "boolean" },
          },
          {
            name: "currency",
            description: "Filter to one ISO 4217 currency.",
            schema: { type: "string", maxLength: 3 },
          },
          ...PAGE_QUERY,
        ],
        responses: [200],
      },
    ],
  },
  {
    path: "/api/site-management/vendor-invoices",
    dir: "site-management/vendor-invoices",
    operations: [
      {
        method: "GET",
        operationId: "getVendorInvoices",
        summary: "List vendor invoices.",
        description:
          "Returns vendor invoices. `overdueOnly` is derived from the remaining balance and the due date rather than stored, because there is no overdue status to filter on.",
        tag: "Finance",
        permission: "vendor_invoices:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "status",
            description: "Filter to one invoice status.",
            schema: { type: "string", maxLength: 32 },
          },
          {
            name: "overdueOnly",
            description:
              "Keep only invoices with a remaining balance and a past due date.",
            schema: { type: "boolean" },
          },
          {
            name: "vendorProfileId",
            description: "Filter to one vendor.",
            schema: { type: "string", maxLength: 64 },
          },
          ...PAGE_QUERY,
        ],
        responses: [200],
      },
      {
        method: "POST",
        operationId: "createVendorInvoice",
        summary: "Create a vendor invoice.",
        description:
          "Not implemented: no repository write path exists for invoice creation. Settling an existing invoice is available as a command on `/api/site-management/actions`.",
        tag: "Finance",
        permission: "vendor_invoices:create",
        rateLimit: WRITE_LIMIT,
        audit: { action: "vendor_invoice.created", entity: "vendor_invoices" },
        requiresPersistence: true,
        idempotent: true,
        requestSchema: "createVendorInvoiceSchema",
        writeGap: gap("Creating a vendor invoice", W2A),
        responses: [503],
      },
    ],
  },

  // -- Operations -----------------------------------------------------------
  {
    path: "/api/site-management/tickets",
    dir: "site-management/tickets",
    operations: [
      {
        method: "GET",
        operationId: "getTickets",
        summary: "List service tickets.",
        description:
          "Returns role-scoped tickets. A service provider sees the tickets assigned to it; a resident sees the tickets for its own units.",
        tag: "Operations",
        permission: "tickets:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "status",
            description: "Filter to one ticket status.",
            schema: { type: "string", maxLength: 32 },
          },
          {
            name: "openOnly",
            description:
              "Keep only tickets that are not resolved, closed or cancelled.",
            schema: { type: "boolean" },
          },
          {
            name: "priority",
            description: "Filter to one priority.",
            schema: { type: "string", maxLength: 16 },
          },
          {
            name: "slaBreachedOnly",
            description:
              "Keep only non-terminal tickets whose SLA due time has passed.",
            schema: { type: "boolean" },
          },
          {
            name: "unitId",
            description: "Filter to one unit.",
            schema: { type: "string", maxLength: 64 },
          },
          ...PAGE_QUERY,
        ],
        responses: [200],
      },
      {
        method: "POST",
        operationId: "createTicket",
        summary: "Open a service ticket.",
        description:
          "Not implemented: no repository write path exists for ticket creation. Appending an event to an existing ticket is available as a command on `/api/site-management/actions`.",
        tag: "Operations",
        permission: "tickets:create",
        rateLimit: WRITE_LIMIT,
        audit: { action: "ticket.created", entity: "service_tickets" },
        requiresPersistence: true,
        idempotent: true,
        requestSchema: "createTicketSchema",
        writeGap: gap("Opening a ticket", W2A),
        responses: [503],
      },
      {
        method: "PATCH",
        operationId: "updateTicketStatus",
        summary: "Move a ticket to another status.",
        description:
          "Applies an optimistically-concurrent status change. `expectedVersion` is the version the caller read; a mismatch is a 409 and never a silent overwrite. Returns 503 rather than 200 if the write could not be persisted.",
        tag: "Operations",
        permission: "tickets:update",
        rateLimit: WRITE_LIMIT,
        audit: { action: "ticket.status_changed", entity: "service_tickets" },
        requiresPersistence: true,
        requestSchema: "updateTicketStatusSchema",
        responses: [200, 404, 409, 503],
      },
    ],
  },
  {
    path: "/api/site-management/activities",
    dir: "site-management/activities",
    operations: [
      {
        method: "GET",
        operationId: "getActivities",
        summary: "List site activities.",
        description: "Returns scheduled and completed site activities.",
        tag: "Operations",
        permission: "activities:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "status",
            description: "Filter to one activity status.",
            schema: { type: "string", maxLength: 32 },
          },
          {
            name: "category",
            description: "Filter to one category.",
            schema: { type: "string", maxLength: 32 },
          },
          {
            name: "upcomingOnly",
            description: "Keep only activities that have not started yet.",
            schema: { type: "boolean" },
          },
          ...PAGE_QUERY,
        ],
        responses: [200],
      },
      {
        method: "POST",
        operationId: "createActivity",
        summary: "Schedule an activity.",
        description:
          "Not implemented: no repository write path exists for activities.",
        tag: "Operations",
        permission: "activities:create",
        rateLimit: WRITE_LIMIT,
        audit: { action: "activity.created", entity: "activities" },
        requiresPersistence: true,
        idempotent: true,
        requestSchema: "createActivitySchema",
        writeGap: gap("Scheduling an activity", W2A),
        responses: [503],
      },
    ],
  },
  {
    path: "/api/site-management/reports",
    dir: "site-management/reports",
    operations: [
      {
        method: "GET",
        operationId: "getMediaReports",
        summary: "List media reports.",
        description:
          "Returns damage and condition reports, including those submitted through the public intake endpoint.",
        tag: "Operations",
        permission: "reports:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "status",
            description: "Filter to one report status.",
            schema: { type: "string", maxLength: 32 },
          },
          {
            name: "untriagedOnly",
            description: "Keep only reports that have not been triaged.",
            schema: { type: "boolean" },
          },
          {
            name: "isPublicIntake",
            description:
              "Keep only reports from the public intake endpoint, or only internal ones.",
            schema: { type: "boolean" },
          },
          ...PAGE_QUERY,
        ],
        responses: [200],
      },
      {
        method: "POST",
        operationId: "createMediaReport",
        summary: "File a media report.",
        description:
          "Not implemented: no repository write path exists for media reports.",
        tag: "Operations",
        permission: "reports:create",
        rateLimit: WRITE_LIMIT,
        audit: { action: "media_report.created", entity: "media_reports" },
        requiresPersistence: true,
        idempotent: true,
        requestSchema: "createReportSchema",
        writeGap: gap("Filing a media report", W2A),
        responses: [503],
      },
    ],
  },

  // -- Documents ------------------------------------------------------------
  {
    path: "/api/site-management/documents",
    dir: "site-management/documents",
    operations: [
      {
        method: "GET",
        operationId: "getDocuments",
        summary: "List documents.",
        description:
          "Returns role-scoped document metadata. File contents are never returned inline; a document body is reached through a short-lived signed URL requested with `view=signed-url`.",
        tag: "Documents",
        permission: "documents:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "view",
            description:
              "`list` (default) or `signed-url`, which requires `id`.",
            schema: { type: "string", enum: ["list", "signed-url"] },
          },
          {
            name: "id",
            description: "The document to mint a signed URL for.",
            schema: { type: "string", maxLength: 64 },
          },
          {
            name: "unitId",
            description: "Filter to one unit.",
            schema: { type: "string", maxLength: 64 },
          },
          {
            name: "category",
            description: "Filter to one document category.",
            schema: { type: "string", maxLength: 48 },
          },
          ...PAGE_QUERY,
        ],
        responses: [200, 404],
      },
      {
        method: "POST",
        operationId: "createDocument",
        summary: "Register a document.",
        description:
          "Not implemented: no repository write path exists for documents, and the storage buckets `pnpm setup:supabase` would create have not been created.",
        tag: "Documents",
        permission: "documents:create",
        rateLimit: WRITE_LIMIT,
        audit: { action: "document.created", entity: "documents" },
        requiresPersistence: true,
        idempotent: true,
        requestSchema: "createDocumentSchema",
        writeGap: gap("Registering a document", W2A),
        responses: [503],
      },
    ],
  },
  {
    path: "/api/site-management/compliance",
    dir: "site-management/compliance",
    operations: [
      {
        method: "GET",
        operationId: "getComplianceDocuments",
        summary: "List compliance documents and checks.",
        description:
          "Returns compliance-category documents with their expiry state, or the compliance check queue when `view=checks`.",
        tag: "Governance",
        permission: "compliance:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "view",
            description: "`documents` (default) or `checks`.",
            schema: { type: "string", enum: ["documents", "checks"] },
          },
          {
            name: "expiringWithinDays",
            description: "Keep only documents expiring within this many days.",
            schema: { type: "integer", minimum: 0, maximum: 3650 },
          },
          {
            name: "humanDecisionRequired",
            description:
              "With `view=checks`, narrow to the queue a human still has to clear.",
            schema: { type: "boolean" },
          },
          ...PAGE_QUERY,
        ],
        responses: [200],
      },
    ],
  },

  // -- Communications -------------------------------------------------------
  {
    path: "/api/site-management/communications",
    dir: "site-management/communications",
    operations: [
      {
        method: "GET",
        operationId: "getCommunications",
        summary: "List threads, messages, or notifications.",
        description:
          "Returns role-scoped communications. `view=messages` requires `threadId`; access to the thread is checked before its messages are read, so a thread id the caller cannot see yields nothing.",
        tag: "Communications",
        permission: "communications:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "view",
            description: "`threads` (default), `messages`, or `notifications`.",
            schema: {
              type: "string",
              enum: ["threads", "messages", "notifications"],
            },
          },
          {
            name: "threadId",
            description: "Required with `view=messages`.",
            schema: { type: "string", maxLength: 64 },
          },
          {
            name: "status",
            description: "Filter threads to one status.",
            schema: { type: "string", maxLength: 32 },
          },
          {
            name: "unreadOnly",
            description: "With `view=notifications`, keep only unread ones.",
            schema: { type: "boolean" },
          },
          ...PAGE_QUERY,
        ],
        responses: [200, 404],
      },
      {
        method: "POST",
        operationId: "createMessage",
        summary: "Post a message to a thread.",
        description:
          "Not implemented: no repository write path exists for communications.",
        tag: "Communications",
        permission: "communications:create",
        rateLimit: WRITE_LIMIT,
        audit: { action: "message.created", entity: "messages" },
        requiresPersistence: true,
        idempotent: true,
        requestSchema: "createMessageSchema",
        writeGap: gap("Posting a message", W2A),
        responses: [503],
      },
    ],
  },

  // -- Governance -----------------------------------------------------------
  {
    path: "/api/site-management/users",
    dir: "site-management/users",
    operations: [
      {
        method: "GET",
        operationId: "getProfiles",
        summary: "List profiles, guardianships, or audit events.",
        description:
          "Returns governance records. Governance is not part of the public showcase: an anonymous caller sees nothing here regardless of parameters.",
        tag: "Governance",
        permission: "users:view",
        rateLimit: READ_LIMIT,
        query: [
          {
            name: "view",
            description:
              "`profiles` (default), `guardianships`, `audit`, or `access`.",
            schema: {
              type: "string",
              enum: ["profiles", "guardianships", "audit", "access"],
            },
          },
          {
            name: "subjectRole",
            description:
              "Filter profiles by the role stored on the row, not the caller's role.",
            schema: { type: "string", maxLength: 24 },
          },
          {
            name: "isActive",
            description: "Filter profiles by active state.",
            schema: { type: "boolean" },
          },
          {
            name: "decision",
            description: "With `view=access`, filter to `allow` or `deny`.",
            schema: { type: "string", enum: ["allow", "deny"] },
          },
          ...PAGE_QUERY,
        ],
        responses: [200],
      },
      {
        method: "POST",
        operationId: "createProfile",
        summary: "Create a profile.",
        description:
          "Not implemented: creating a profile requires Supabase Auth admin calls that need the service-role key. Doing that from a request handler is out of scope for this window.",
        tag: "Governance",
        permission: "users:create",
        rateLimit: WRITE_LIMIT,
        audit: { action: "profile.created", entity: "profiles" },
        requiresPersistence: true,
        idempotent: true,
        requestSchema: "createProfileSchema",
        writeGap: gap("Creating a profile", W1A),
        responses: [503],
      },
      {
        method: "PATCH",
        operationId: "updateProfileRole",
        summary: "Change a profile's role.",
        description:
          "Not implemented: a role change is the single highest-authority mutation in this system and needs the audited RPC W1-A owns. It is not going to be hand-rolled here.",
        tag: "Governance",
        permission: "users:manage",
        rateLimit: WRITE_LIMIT,
        audit: { action: "profile.authority_changed", entity: "profiles" },
        requiresPersistence: true,
        requestSchema: "updateProfileRoleSchema",
        writeGap: gap("Changing a profile's role", W1A),
        responses: [503],
      },
    ],
  },

  // -- Search ---------------------------------------------------------------
  {
    path: "/api/site-management/search",
    dir: "site-management/search",
    operations: [
      {
        method: "GET",
        operationId: "searchOperationalRecords",
        summary: "Search operational records.",
        description:
          "Full-text and trigram search across units, tickets, documents and people. Results are scoped to the caller's role on the server; the same boundary is enforced by the database function, so a client that forges a parameter gains nothing.",
        tag: "Dashboard",
        permission: "dashboard:view",
        rateLimit: { windowMs: 60_000, max: 60 },
        query: [
          {
            name: "q",
            description: "The search term.",
            schema: { type: "string", minLength: 1, maxLength: 120 },
            required: true,
          },
          {
            name: "limit",
            description: "Maximum hits. Clamped to [1, 50].",
            schema: { type: "integer", minimum: 1, maximum: 50 },
          },
        ],
        responses: [200],
      },
    ],
  },

  // -- Commands -------------------------------------------------------------
  {
    path: "/api/site-management/actions",
    dir: "site-management/actions",
    operations: [
      {
        method: "POST",
        operationId: "executeCommand",
        summary: "Execute a domain command.",
        description:
          "The one write endpoint backed by real repository mutations. The body is a discriminated union on `command`, and each command declares its own permission, which is checked in addition to the endpoint's. Supported: `ticket.appendEvent`, `ticket.updateStatus`, `ledger.reverseEntry`, `vendorInvoice.settle`. Commands carrying `expectedVersion` are optimistically concurrent: a mismatch is 409, never a silent overwrite. Every outcome writes an audit row.",
        tag: "Commands",
        permission: "dashboard:view",
        rateLimit: WRITE_LIMIT,
        audit: { action: "command.executed", entity: "audit_events" },
        requiresPersistence: true,
        idempotent: true,
        requestSchema: "commandSchema",
        responses: [200, 404, 409, 503],
      },
    ],
  },

  // -- Public ---------------------------------------------------------------
  {
    path: "/api/site-management/public/report",
    dir: "site-management/public/report",
    operations: [
      {
        method: "POST",
        operationId: "submitPublicReport",
        summary: "Submit a damage report without an account.",
        description:
          "Unauthenticated intake for site damage reports. Requires an `Idempotency-Key` header so a retried submission cannot create a duplicate. Not implemented as a write: no repository path exists for public intake, so the endpoint validates and rate-limits the submission and then reports 503 rather than acknowledging a report nobody will receive.",
        tag: "Public",
        permission: null,
        publicJustification:
          "Site damage must be reportable by a resident's visitor or a passer-by, who has no account. The endpoint accepts no identifiers beyond a free-text contact the submitter chooses to give, is the most tightly rate-limited route in the app, and requires an idempotency key.",
        rateLimit: PUBLIC_LIMIT,
        audit: { action: "public_report.submitted", entity: "media_reports" },
        requiresPersistence: true,
        idempotent: true,
        requestSchema: "publicReportSchema",
        writeGap: gap("Public report intake", W2A),
        responses: [503],
      },
    ],
  },
  {
    path: "/api/calendar/ics/{token}",
    dir: "calendar/ics/[token]",
    pathParams: ["token"],
    operations: [
      {
        method: "GET",
        operationId: "getCalendarFeed",
        summary: "Get an iCalendar feed for a subscription token.",
        description:
          "Returns a `text/calendar` feed of site activities for the given opaque subscription token. There is no session: the token IS the credential, so it is compared in constant time and a bad token is reported as not found rather than forbidden, to keep the endpoint from confirming which tokens exist.",
        tag: "Calendar",
        permission: null,
        publicJustification:
          "Calendar clients cannot carry a session cookie. The token is opaque, single-purpose, read-only, grants access to activity times only, and is checked in constant time.",
        rateLimit: { windowMs: 60_000, max: 30 },
        responses: [200, 404],
      },
    ],
  },
  // -- Externally owned, declared so they are not shadow endpoints ----------
  {
    path: "/api/access-profile",
    dir: "access-profile",
    operations: (["GET", "POST", "DELETE"] as const).map((method) => ({
      method,
      operationId:
        method === "GET"
          ? "getAccessProfile"
          : method === "POST"
            ? "setAccessProfile"
            : "clearAccessProfile",
      summary:
        method === "GET"
          ? "Read the current QA access profile."
          : method === "POST"
            ? "Adopt a QA access profile role."
            : "Clear the QA access profile.",
      description:
        "Local-QA role switching. Not a production authentication path: `lib/access-profile-policy.ts` throws at module load if access profiles are ever enabled in production, so this endpoint cannot exist there. Owned by W1-B.",
      tag: "Meta",
      permission: null,
      publicJustification:
        "It is the mechanism by which a QA session acquires a role, so it cannot itself require one. It is inert unless ENABLE_ACCESS_PROFILES is set, and enabling it in production is a startup failure rather than a configuration choice.",
      external: {
        owner: "W1-B (auth and RBAC)",
        note: "Environment-gated rather than rate-limited, and writes no audit row.",
      },
      responses: [200],
    })),
  },
  {
    path: "/api/ai/chat",
    dir: "ai/chat",
    operations: [
      {
        method: "POST",
        operationId: "postAiChat",
        summary: "Ask the authenticated AI concierge.",
        description:
          "Role-aware retrieval-grounded chat. Refuses rather than answers when retrieval returns no grounding, and performs the RBAC check before any outbound request. Owned by W2-C.",
        tag: "AI",
        permission: "dashboard:view",
        external: {
          owner: "W2-C (AI layer)",
          note: "Rate-limited by lib/ai-rate-limit.ts; writes an AI trace rather than an audit_events row.",
        },
        responses: [200],
      },
    ],
  },
  {
    path: "/api/ai/public-chat",
    dir: "ai/public-chat",
    operations: [
      {
        method: "POST",
        operationId: "postPublicAiChat",
        summary: "Ask the public AI assistant.",
        description:
          "Unauthenticated assistant restricted to the public showcase knowledge base. Owned by W2-C.",
        tag: "AI",
        permission: null,
        publicJustification:
          "It answers questions from prospective buyers who have no account, over a knowledge base that contains only already-published material, and refuses anything it cannot ground in that material.",
        external: {
          owner: "W2-C (AI layer)",
          note: "Rate-limited by lib/ai-rate-limit.ts.",
        },
        responses: [200],
      },
    ],
  },
  {
    path: "/api/ai/public-chat/feedback",
    dir: "ai/public-chat/feedback",
    operations: [
      {
        method: "POST",
        operationId: "postPublicAiFeedback",
        summary: "Rate a public AI answer.",
        description:
          "Records a thumbs-up or thumbs-down against a public assistant answer. Owned by W2-C.",
        tag: "AI",
        permission: null,
        publicJustification:
          "It is attached to the unauthenticated assistant above and accepts only a rating against an answer id — no free text, no identifiers.",
        external: {
          owner: "W2-C (AI layer)",
          note: "Rate-limited by lib/ai-rate-limit.ts.",
        },
        responses: [200],
      },
    ],
  },
  {
    path: "/api/ai/public-chat/stream",
    dir: "ai/public-chat/stream",
    operations: [
      {
        method: "POST",
        operationId: "postPublicAiChatStream",
        summary: "Ask the public AI assistant, streamed.",
        description:
          "The streaming form of the public assistant, returning server-sent events. Owned by W2-C.",
        tag: "AI",
        permission: null,
        publicJustification:
          "Same surface and same guardrails as the non-streaming public assistant; only the response encoding differs.",
        external: {
          owner: "W2-C (AI layer)",
          note: "Rate-limited by lib/ai-rate-limit.ts.",
        },
        responses: [200],
      },
    ],
  },
  {
    path: "/api/openapi",
    dir: "openapi",
    operations: [
      {
        method: "GET",
        operationId: "getOpenApiDocument",
        summary: "Get this API's OpenAPI document.",
        description:
          "Serves `docs/api/openapi.yaml` verbatim. The document is generated from the route manifest, so what this returns is what the code declares — it cannot describe an endpoint that does not exist, or omit one that does.",
        tag: "Meta",
        permission: null,
        publicJustification:
          "The spec describes only the shape of the surface, which an unauthenticated caller can discover by probing anyway. Publishing it costs nothing and makes the parity guarantee externally checkable.",
        rateLimit: { windowMs: 60_000, max: 30 },
        responses: [200],
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Derived views (used by the generator, the validator and the routes)
// ---------------------------------------------------------------------------

export interface FlatOperation extends RouteOperation {
  path: string
  dir: string
}

export function flattenOperations(): FlatOperation[] {
  return apiRoutes.flatMap((entry) =>
    entry.operations.map((operation) => ({
      ...operation,
      path: entry.path,
      dir: entry.dir,
    }))
  )
}

export function isMutatingMethod(method: HttpMethod): boolean {
  return method === "POST" || method === "PATCH" || method === "DELETE"
}

/** Every tag used, in the order the generator should emit them. */
export const apiTags: readonly { name: string; description: string }[] = [
  {
    name: "Dashboard",
    description: "Role-scoped overview and cross-module search.",
  },
  {
    name: "Evidence",
    description: "Sources, findings and the dataset's own coverage report.",
  },
  { name: "Inventory", description: "Site, blocks, floors and the 656 units." },
  {
    name: "Listings",
    description: "Captured external portal listings and their disagreements.",
  },
  {
    name: "Hotel",
    description: "The hotel, its rooms and guest-review evidence.",
  },
  { name: "Sales", description: "Leads and the buyer pipeline." },
  {
    name: "Finance",
    description: "Ledger, wallets, vendor invoices and payments.",
  },
  {
    name: "Operations",
    description: "Service tickets, activities and media reports.",
  },
  {
    name: "Documents",
    description: "Document metadata and short-lived signed URLs.",
  },
  {
    name: "Communications",
    description: "Threads, messages and notifications.",
  },
  {
    name: "Governance",
    description: "Profiles, guardianships, audit and compliance.",
  },
  { name: "Commands", description: "The audited write endpoint." },
  { name: "Public", description: "Unauthenticated intake." },
  { name: "Calendar", description: "Token-scoped iCalendar feeds." },
  { name: "AI", description: "Retrieval-grounded assistants. Owned by W2-C." },
  {
    name: "Meta",
    description: "The API's description of itself, and QA role switching.",
  },
]
