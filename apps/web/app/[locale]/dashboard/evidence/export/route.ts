import { NextResponse } from "next/server"

import {
  buildEvidenceCsv,
  csvFilename,
} from "@/components/inventory/evidence-csv"
import type { PriceObservation } from "@/components/inventory/price-conflict-ladder"
import { getUserProfile } from "@/lib/auth"
import type { SourceRef } from "@/lib/contracts"
import { getFinding, getSources } from "@/lib/evidence-repository"
import { getPortalListings } from "@/lib/portal-repository"
import { hasPermission } from "@/lib/rbac"

/**
 * CSV export of the F-002 evidence.                               Owner: W3-C
 *
 * `GET /[locale]/dashboard/evidence/export`
 *
 * ## Why a route handler and not a server action
 *
 * A download needs `Content-Disposition`, and it needs to work when a reviewer
 * pastes the URL — a server action would tie the export to a click in a
 * hydrated page. It lives under this module's own path rather than in
 * `app/api/site-management/**` because that tree is W2-B's and this is not a
 * public API surface: it is one screen's download, gated by that screen's
 * permission. Flagged in `HANDOFF/W3-C.md` §7 as a boundary call.
 *
 * ## Permission
 *
 * `evidence:export`, held by `admin` and `manager`. Checked here and not only
 * in the UI — CONVENTIONS §2, assume the user typed the URL. `tenant` gets 403
 * with no body worth reading, and no repository is touched before the check.
 *
 * ## Seed data
 *
 * When the repositories answer `local-seed` the file still exports, and the
 * response carries `X-Azura-Data-Source: local-seed` plus a `data_source`
 * comment in `Content-Disposition`'s filename. A CSV cannot hold a banner, and
 * a silent seed export is exactly the "seed presented as live" failure the
 * honesty audit calls a HIGH — so the signal goes in the filename, where it
 * survives being forwarded.
 */

const F002_LAYOUT = "1+1"

function toObservation(listing: {
  publisher: string
  url: string
  fetchedAt: string
  layout: string | null
  interiorM2: number | null
  price: { amount: number; currency: "EUR" | "USD" | "TRY" | "GBP" } | null
  isStale: boolean
  note: string | null
}): PriceObservation | null {
  if (listing.price === null) return null
  return {
    money: listing.price,
    publisher: listing.publisher,
    layout: listing.layout,
    interiorM2: listing.interiorM2,
    stale: listing.isStale,
    url: listing.url,
    fetchedAt: listing.fetchedAt,
    note: listing.note,
  }
}

export async function GET(): Promise<NextResponse> {
  const profile = await getUserProfile()

  if (!profile.authenticated) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in to continue.", retryable: false } },
      { status: 401 },
    )
  }

  if (!hasPermission(profile.role, "evidence:export")) {
    return NextResponse.json(
      { ok: false, error: { code: "forbidden", message: "This export is not available for your role.", retryable: false } },
      { status: 403 },
    )
  }

  const [findingResult, listingsResult, allSaleResult, sourcesResult] = await Promise.all([
    getFinding("F-002"),
    getPortalListings({ layout: F002_LAYOUT, priceKind: "sale", limit: 200 }),
    getPortalListings({ priceKind: "sale", limit: 400 }),
    getSources(),
  ])

  const finding = findingResult.data
  if (finding === null) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "F-002 is not in this dataset.", retryable: false } },
      { status: 404 },
    )
  }

  // The same two sets the panel renders: the 1+1 observations, and the ones
  // whose publisher stated a price without a layout. Alanya-Home's figure is in
  // the second set and is one of the four F-002 names, so an export that
  // dropped it would understate the conflict — the one direction this product
  // must never fail in.
  const observations = [
    ...listingsResult.data,
    ...allSaleResult.data.filter((listing) => listing.layout === null),
  ]
    .map(toObservation)
    .filter((observation): observation is PriceObservation => observation !== null)

  const sourcesByUrl = new Map<string, SourceRef>(
    sourcesResult.data.map((source) => [source.url, source]),
  )

  const csv = buildEvidenceCsv(finding, observations, sourcesByUrl)
  const seeded =
    findingResult.source === "local-seed" || listingsResult.source === "local-seed"

  const name = csvFilename(
    seeded ? `${finding.id}-LOCAL-SEED` : finding.id,
    new Date().toISOString(),
  )

  // U+FEFF. Excel on Windows reads a BOM-less UTF-8 CSV as the system codepage
  // and turns "Türkler" into mojibake — for a file about a Turkish development
  // that is not cosmetic.
  return new NextResponse(`﻿${csv}`, {
    status: 200,
    headers: {
      // Content type only; the BOM is prepended to the body above.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-Azura-Data-Source": seeded ? "local-seed" : "supabase",
      "Cache-Control": "no-store",
    },
  })
}
