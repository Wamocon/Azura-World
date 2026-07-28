import { getTranslations } from "next-intl/server"
import type { NextRequest } from "next/server"

import { getUserProfile } from "@/lib/auth"
import { locales, type Locale } from "@/lib/contracts"
import { getEvidenceCoverage, getSourceHealth } from "@/lib/evidence-repository"
import { hasPermission } from "@/lib/rbac"
import {
  evidenceCoverageTable,
  reportDefinition,
  sourceRegisterTable,
  toCsv,
  type ReportTable,
} from "@/lib/report-artifacts"

/**
 * `GET /[locale]/dashboard/reports/export?report=…&format=csv`   Owner: W3-F
 *
 * A Route Handler co-located under this module's own segment, not under
 * `app/api/` — that tree is W2-B's and `ORCHESTRATION.md` §4 makes it theirs.
 * Living here also means it inherits `PROTECTED_PREFIXES` in `proxy.ts`, so an
 * unauthenticated request never reaches this function at all.
 *
 * ## Why a route handler and not a server action
 *
 * A file download needs `Content-Disposition`, and a server action returns a
 * value into the RSC payload rather than a response. This also gives W4-C
 * something it can hit with `curl` and a cookie, which is the right way for an
 * export's access control to be tested.
 *
 * ## The order
 *
 *   1. resolve the profile
 *   2. resolve the report definition — an unknown id is a 404, not a 400,
 *      because listing which report ids exist is itself information
 *   3. check the report's OWN permission (`evidence:export`, `units:export`, …)
 *   4. only then read
 *
 * ## PII and role scoping
 *
 * `tasks/W3-F`: *"An `accountant` export must not carry data an accountant
 * cannot see in the UI."* Two mechanisms, and neither is a filter written here.
 * The permission in step 3 is the report's own, so a role that cannot see a
 * surface cannot export it. And every read goes through the repositories, which
 * take the caller's role and mirror RLS. There is no service-role client on this
 * path — an export that bypassed RLS to "get the full picture" is the single
 * easiest way to leak a directory.
 *
 * The two reports available today carry no personal data at all: coverage
 * counts, and a register of published URLs.
 */

const CSV_CONTENT_TYPE = "text/csv; charset=utf-8"

function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string }> }
): Promise<Response> {
  const { locale: rawLocale } = await params
  const locale: Locale = isLocale(rawLocale) ? rawLocale : "de"

  const profile = await getUserProfile()
  if (!profile.authenticated) {
    // The proxy should have caught this. Answering 401 rather than redirecting
    // keeps the failure legible to a script.
    return new Response(null, { status: 401 })
  }

  const url = new URL(request.url)
  const definition = reportDefinition(url.searchParams.get("report") ?? "")

  // 404, not 400: a 400 that distinguishes "unknown report" from "forbidden
  // report" is an enumeration oracle for the report catalogue.
  if (definition === null || !definition.available) {
    return new Response(null, { status: 404 })
  }

  if (!hasPermission(profile.role, definition.permission)) {
    return new Response(null, { status: 403 })
  }

  const format = url.searchParams.get("format") ?? "csv"
  if (format !== "csv") {
    // Named formats that are declared but unbuilt answer 501, not 500 and not a
    // zero-byte file. `REPORT_FORMATS` says why.
    return new Response(null, { status: 501 })
  }

  const t = await getTranslations({ locale, namespace: "dashboard.reports" })

  let table: ReportTable
  try {
    if (definition.id === "evidence_coverage") {
      const coverage = await getEvidenceCoverage()
      table = evidenceCoverageTable({
        coverage: coverage.data,
        source: coverage.source,
      })
    } else if (definition.id === "source_register") {
      const health = await getSourceHealth()
      table = sourceRegisterTable({
        health: health.data,
        // The register has no `generatedAt` of its own, so the export states
        // when IT was produced rather than borrowing a timestamp from elsewhere.
        generatedAt: new Date().toISOString(),
        source: health.source,
      })
    } else {
      return new Response(null, { status: 501 })
    }
  } catch {
    // A configured repository that fails throws by design. No message body: an
    // exception's text leaks internals (SYSTEM-PROMPT §2.11).
    return new Response(null, { status: 502 })
  }

  const header: Record<string, string> = {}
  for (const column of table.columns) {
    header[column.key] = t(column.labelKey)
  }

  const csv = toCsv(table, {
    header,
    generatedAt: t("csv.generatedAt"),
    source: t("csv.source"),
  })

  // Date only, so the same report exported twice in a day overwrites rather than
  // filling a downloads folder. `toISOString().slice(0, 10)` is UTC and
  // therefore stable across the two time zones this project runs in.
  const stamp = new Date().toISOString().slice(0, 10)

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="azura-${definition.id}-${stamp}.csv"`,
      // A report is a snapshot of a moving dataset. A cached copy served to the
      // next caller would be a different person's scope as well as a stale file.
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
