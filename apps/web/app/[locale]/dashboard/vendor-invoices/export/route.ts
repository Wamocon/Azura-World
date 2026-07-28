import { NextResponse, type NextRequest } from "next/server"

import {
  buildVendorInvoiceCsv,
  financeCsvFilename,
  type ExportFilter,
} from "@/components/finance/finance-csv"
import { resolveFinanceScope } from "@/components/finance/finance-scope"
import {
  duplicateInvoiceIds,
  findDuplicateInvoices,
} from "@/components/finance/ledger-analysis"
import { vendorInvoiceStatuses } from "@/lib/finance-data"
import {
  currencyCodes,
  getVendorInvoices,
  type CurrencyCode,
  type VendorInvoiceStatus,
} from "@/lib/finance-repository"

/**
 * `GET /[locale]/dashboard/vendor-invoices/export`             Owner: W3-D
 *
 * Same shape as the ledger export and gated on `vendor_invoices:export`, which
 * `service_provider` and `staff` do **not** hold. Both of those roles can read
 * invoices (their own, scoped by RLS) and neither can pull a file, which is the
 * distinction that matters once a file leaves the building.
 *
 * ## Duplicates are computed over the UNFILTERED set and exported per row
 *
 * A duplicate pair split by the active filter would export as two unremarkable
 * rows. So the flag comes from the whole visible list even when the file itself
 * is filtered, and it travels as a `possible_duplicate` column rather than as a
 * separate section the reader has to cross-reference.
 */

const EXPORT_LIMIT = 500

function apiError(
  code: "unauthorized" | "forbidden",
  message: string,
  status: number
): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message, retryable: false } },
    { status }
  )
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const scope = await resolveFinanceScope("vendor_invoices")

  if (!scope.allowed) {
    return scope.reason === "unauthenticated"
      ? apiError("unauthorized", "Sign in to continue.", 401)
      : apiError("forbidden", "This page is not available for your role.", 403)
  }
  if (!scope.can("vendor_invoices:export")) {
    return apiError(
      "forbidden",
      "This export is not available for your role.",
      403
    )
  }

  const url = new URL(request.url)
  const rawStatus = url.searchParams.get("status")
  const rawCurrency = url.searchParams.get("currency")

  const status = (vendorInvoiceStatuses as readonly string[]).includes(
    rawStatus ?? ""
  )
    ? (rawStatus as VendorInvoiceStatus)
    : undefined
  const currency = (currencyCodes as readonly string[]).includes(
    rawCurrency ?? ""
  )
    ? (rawCurrency as CurrencyCode)
    : undefined

  const [allResult, filteredResult] = await Promise.all([
    getVendorInvoices({ ...scope.access, limit: EXPORT_LIMIT }),
    getVendorInvoices({
      ...scope.access,
      limit: EXPORT_LIMIT,
      ...(status === undefined ? {} : { status }),
      ...(currency === undefined ? {} : { currency }),
    }),
  ])

  const duplicateIds = duplicateInvoiceIds(
    findDuplicateInvoices(allResult.data)
  )

  const pairs: Array<readonly [string, string]> = []
  if (status !== undefined) pairs.push(["status", status])
  if (currency !== undefined) pairs.push(["currency", currency])

  const filter: ExportFilter = {
    pairs,
    dataSource: filteredResult.source,
    generatedAt: filteredResult.fetchedAt,
  }

  const body = buildVendorInvoiceCsv(filteredResult.data, duplicateIds, filter)
  const filename = financeCsvFilename("azura-vendor-invoices", filter)

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Azura-Data-Source": filteredResult.source,
      "X-Azura-Row-Count": String(filteredResult.data.length),
      "Cache-Control": "private, no-store",
    },
  })
}
