import { NextResponse, type NextRequest } from "next/server"

import {
  buildLedgerCsv,
  financeCsvFilename,
  type ExportFilter,
} from "@/components/finance/finance-csv"
import { resolveFinanceScope } from "@/components/finance/finance-scope"
import {
  currencyCodes,
  getLedgerEntries,
  type CurrencyCode,
  type LedgerEntryStatus,
} from "@/lib/finance-repository"
import { ledgerEntryStatuses } from "@/lib/finance-data"

/**
 * `GET /[locale]/dashboard/finance/export` — the ledger as CSV.  Owner: W3-D
 *
 * A route handler rather than a server action, for the same reason W3-C's
 * evidence export is one: a download needs `Content-Disposition`, and it has to
 * work when a reviewer pastes the URL rather than only when a hydrated button
 * is clicked. It lives under this module's own path, not under
 * `app/api/site-management/**` — that tree is W2-B's, and this is one screen's
 * download gated by that screen's permission, not a public API.
 *
 * ## The filter is read from the query, not from a session
 *
 * The page builds this URL with its current filter already in it, so the file
 * and the screen cannot disagree. Both are re-validated here against the same
 * enum lists the page uses: a hand-typed `?status=deleted` produces the
 * unfiltered export rather than an error, because an unrecognised filter is not
 * a filter, and the filename then says `all` so the reader can tell.
 *
 * ## Permission, and the order it is checked in
 *
 * `finance:export` — held by admin, manager and accountant, not by `owner`.
 * Checked before the repository is touched: CONVENTIONS §2, assume the user
 * typed the URL. An `owner` gets 403 with nothing worth reading in the body.
 *
 * Note that `finance:view` alone is not enough. An owner can read its own
 * statement on screen but cannot pull a file, which is deliberate: a file
 * leaves the building.
 *
 * ## Seed data
 *
 * The export still works on seed data, and says so in three places: the
 * `X-Azura-Data-Source` header, the filename, and a comment row inside the
 * file. A CSV cannot carry a banner, and a seed export forwarded as though it
 * were live is the "seed presented as live" failure the honesty audit grades
 * HIGH.
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
  const scope = await resolveFinanceScope("finance")

  if (!scope.allowed) {
    return scope.reason === "unauthenticated"
      ? apiError("unauthorized", "Sign in to continue.", 401)
      : apiError("forbidden", "This page is not available for your role.", 403)
  }
  if (!scope.can("finance:export")) {
    return apiError(
      "forbidden",
      "This export is not available for your role.",
      403
    )
  }

  const url = new URL(request.url)
  const rawStatus = url.searchParams.get("status")
  const rawCurrency = url.searchParams.get("currency")

  const status = (ledgerEntryStatuses as readonly string[]).includes(
    rawStatus ?? ""
  )
    ? (rawStatus as LedgerEntryStatus)
    : undefined
  const currency = (currencyCodes as readonly string[]).includes(
    rawCurrency ?? ""
  )
    ? (rawCurrency as CurrencyCode)
    : undefined

  const result = await getLedgerEntries({
    ...scope.access,
    limit: EXPORT_LIMIT,
    ...(status === undefined ? {} : { status }),
    ...(currency === undefined ? {} : { currency }),
  })

  const pairs: Array<readonly [string, string]> = []
  if (status !== undefined) pairs.push(["status", status])
  if (currency !== undefined) pairs.push(["currency", currency])

  const filter: ExportFilter = {
    pairs,
    dataSource: result.source,
    generatedAt: result.fetchedAt,
  }

  const body = buildLedgerCsv(result.data, filter)
  const filename = financeCsvFilename("azura-ledger", filter)

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Machine-readable twin of the filename hint, so a script pulling this
      // endpoint can refuse seed data without parsing a filename.
      "X-Azura-Data-Source": result.source,
      "X-Azura-Row-Count": String(result.data.length),
      // A ledger export is per-user by RLS. A shared cache holding one role's
      // rows and serving them to another is the whole reason this is here.
      "Cache-Control": "private, no-store",
    },
  })
}
