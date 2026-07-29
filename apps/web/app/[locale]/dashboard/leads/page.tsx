import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"

import { Link } from "@/app/navigation"
import { CurrencyTotals } from "@/components/inventory/currency-totals"
import { formatMoney } from "@/components/evidence/format"
import { getUserProfile } from "@/lib/auth"
import { cn } from "@/lib/cn"
import type { Locale } from "@/lib/contracts"
import {
  leadSources,
  leadStatuses,
  type LeadRecord,
  type LeadSource,
  type LeadStatus,
} from "@/lib/lead-data"
import { getProfiles } from "@/lib/governance-repository"
import { getLeads } from "@/lib/lead-repository"
import { hasPermission } from "@/lib/rbac"
import { totalsByCurrency } from "@/lib/repository-base"
import { intlLocaleTag } from "@/lib/format"

/**
 * /[locale]/dashboard/leads — the enquiry list.              Owner: W3-C / N1
 *
 * ## What this screen is, and what it deliberately is not
 *
 * It is the read side of the CRM: who asked, through which channel, what they
 * said they could spend, who is looking after them, and what happens next.
 *
 * It is **not** a capture form. `POST /api/site-management/leads` is a declared
 * write gap — it authenticates, authorises and validates, then answers 503
 * naming W2-A, because no repository write path exists. A "Neue Anfrage"
 * button here would either fake a success or dead-end every time it was
 * pressed. OVERNIGHT-2 §4.6 is explicit that a write with no data plane returns
 * 503 and never a fake success; the honest UI equivalent is to say so once, in
 * words, rather than to ship a control that cannot work.
 *
 * ## Budgets are never added up across currencies
 *
 * The seven seeded leads carry budgets in **EUR, USD, TRY and GBP**, and one
 * carries none at all. A single "Gesamtbudget" would read 10.485.000 — a figure
 * dominated by the lira line that the next person to see it would quote as
 * euros. `CurrencyTotals` has no prop that could produce one number.
 *
 * ## RBAC, and the divergence worth knowing about
 *
 * `lib/rbac.ts` grants `leads:view` to **admin and manager only**.
 * `lib/lead-repository.ts` scopes at `roleLevel >= staff`, mirroring the RLS
 * predicate `is_admin() or has_role_level(40)` in migration 14. The repository
 * therefore returns rows for `staff`, which RBAC does not admit — so this page
 * checks `hasPermission` itself, before the call. RLS is the security boundary,
 * RBAC is the UX boundary, and the gap between them is real rather than a bug
 * to paper over (the repository's own header says so).
 *
 * No `export const dynamic`: the root layout reads `headers()` (W-INT §4), so
 * every route beneath it is already dynamic.
 */

export const metadata: Metadata = {
  title: "Anfragen",
  robots: { index: false, follow: false },
}

/** 7 rows today; the ceiling is a guard, not an expectation. */
const PAGE_LIMIT = 200

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function isStatus(value: string | undefined): value is LeadStatus {
  return (
    value !== undefined && (leadStatuses as readonly string[]).includes(value)
  )
}

function isSource(value: string | undefined): value is LeadSource {
  return (
    value !== undefined && (leadSources as readonly string[]).includes(value)
  )
}

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  const query = await searchParams

  const t = await getTranslations({ locale, namespace: "dashboard.leads" })
  const tCommon = await getTranslations({ locale, namespace: "common" })

  const profile = await getUserProfile()

  // Before the repository call, not after. CONVENTIONS §2: assume the user
  // typed the URL. And the SEC-003 lesson — a client guard decides after this
  // Server Component has already rendered personal data into the RSC payload.
  if (!hasPermission(profile.role, "leads:view")) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.018em] text-foreground">
          {t("title")}
        </h1>
        <p role="alert" className="max-w-prose text-sm text-muted-foreground">
          {tCommon("errors.forbidden")}
        </p>
      </div>
    )
  }

  const statusParam = first(query["status"])
  const sourceParam = first(query["source"])
  const activeStatus = isStatus(statusParam) ? statusParam : undefined
  const activeSource = isSource(sourceParam) ? sourceParam : undefined

  // One fetch of the whole list; both the totals and the table read from it, so
  // the header cannot disagree with the rows beneath it.
  //
  // The people directory is fetched alongside so `assigned_to` can render a
  // NAME. The first served version printed the raw profile uuid
  // ("0a1b2c3d-0001-4000-8000-000000000002") at a property manager, which is the
  // database showing through the product (azura-ui-ux §7b). `getProfiles`
  // enforces `users:view` itself and returns an empty, labelled result for a
  // role that lacks it, so calling it here cannot widen anyone's access.
  const [result, profilesResult] = await Promise.all([
    getLeads({ role: profile.role, limit: PAGE_LIMIT }),
    getProfiles({
      role: profile.role,
      ...(profile.id === null ? {} : { profileId: profile.id }),
      limit: PAGE_LIMIT,
    }),
  ])
  const all = result.data
  const degraded = result.source === "local-seed"

  const nameByProfileId = new Map<string, string>()
  for (const person of profilesResult.data) {
    if (person.fullName !== null && person.fullName.length > 0) {
      nameByProfileId.set(person.id, person.fullName)
    }
  }

  // Knowing WHICH of the two absences happened matters: "you may not see the
  // name" and "the name is not on record" are different facts, and telling a
  // manager the first when the truth is the second sends them to the wrong
  // person for a fix.
  //
  // The test is `users:view`, which is the exact gate `canReadDirectory()`
  // applies inside the repository. It is NOT `degradedReason === undefined`:
  // that field also carries the local-seed fallback, so in seed mode it would
  // report every manager as permission-blocked. Measured - the first version did
  // exactly that.
  //
  // In local-seed mode the answer is always "not on record", and that is a real
  // dataset defect rather than a UI one: `lead-data.ts` assigns to
  // `0a1b2c3d-0001-…` profile ids while `governance-data.ts` seeds the directory
  // with `b0000000-…`, so no assignee resolves. Reported to W2-A.
  const directoryReadable = hasPermission(profile.role, "users:view")

  const rows = all.filter((lead) => {
    if (activeStatus !== undefined && lead.status !== activeStatus) return false
    if (activeSource !== undefined && lead.source !== activeSource) return false
    return true
  })

  // Totals over the FILTERED set, because the header sits above the filtered
  // table and a figure that ignored the filter would describe rows that are not
  // on screen. The unfiltered count is stated separately so the filter can
  // never make the pipeline look smaller than it is without saying so.
  const budgets = rows.flatMap((lead) =>
    lead.budget === null ? [] : [lead.budget]
  )
  const budgetTotals = totalsByCurrency(budgets)
  const withoutBudget = rows.length - budgets.length

  const statusLabel = (status: LeadStatus): string =>
    t(`status.${status}` as "status.new")
  const sourceLabel = (source: LeadSource): string =>
    t(`source.${source}` as "source.website")

  const statusCounts = new Map<LeadStatus, number>()
  for (const lead of all) {
    statusCounts.set(lead.status, (statusCounts.get(lead.status) ?? 0) + 1)
  }

  const hrefFor = (next: {
    status?: LeadStatus | null
    source?: LeadSource | null
    clear?: true
  }) => {
    const sp = new URLSearchParams()
    if (next.clear !== true) {
      const status =
        next.status === undefined ? activeStatus : (next.status ?? undefined)
      if (status !== undefined) sp.set("status", status)
      const source =
        next.source === undefined ? activeSource : (next.source ?? undefined)
      if (source !== undefined) sp.set("source", source)
    }
    const s = sp.toString()
    return `/dashboard/leads${s ? `?${s}` : ""}`
  }

  // Which single filter emptied the list, when exactly one did. "No results" on
  // its own leaves a reader unable to tell a working filter from a broken page.
  const blamed =
    rows.length === 0
      ? activeStatus !== undefined && activeSource !== undefined
        ? "combination"
        : activeStatus !== undefined
          ? "status"
          : activeSource !== undefined
            ? "source"
            : "none"
      : null

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.018em] text-foreground">
          {t("title")}
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t("lead")}</p>
      </header>

      {degraded ? (
        <p
          role="status"
          className="rounded-lg border border-confidence-gap/30 bg-confidence-gap/10 px-3 py-2 text-sm text-foreground"
        >
          {t("seedNotice")}
        </p>
      ) : null}

      {/* The write gap, stated once. Never a button that cannot work. */}
      <p
        role="status"
        className="max-w-prose rounded-lg border border-confidence-gap/30 bg-background/50 px-3 py-2 text-sm text-muted-foreground"
      >
        {t("readOnlyNotice")}
      </p>

      {/* ---- totals ------------------------------------------------------ */}
      <section aria-labelledby="leads-summary" className="flex flex-col gap-3">
        <h2
          id="leads-summary"
          className="font-display text-lg font-semibold tracking-[-0.012em] text-foreground"
        >
          {t("summary.heading")}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5">
            <dt className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t("summary.count")}
            </dt>
            <dd
              data-numeric
              className="font-display text-2xl font-semibold tracking-[-0.018em] text-foreground tabular-nums"
            >
              {new Intl.NumberFormat(intlLocaleTag(locale)).format(rows.length)}
              {rows.length !== all.length ? (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {t("summary.ofTotal", { total: all.length })}
                </span>
              ) : null}
            </dd>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5">
            <dt className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t("summary.budget")}
            </dt>
            <dd className="text-base">
              {/* One line per currency. There is no combined figure, and no
                  component here can produce one. */}
              <CurrencyTotals
                totals={budgetTotals}
                locale={locale}
                missing={withoutBudget}
                missingLabel={t("summary.withoutBudget")}
                emptyLabel={t("summary.noBudgets")}
              />
            </dd>
          </div>
        </dl>
        <p className="max-w-prose text-sm text-muted-foreground">
          {t("summary.currencyNote")}
        </p>
      </section>

      {/* ---- filters ----------------------------------------------------- */}
      <section aria-labelledby="leads-list" className="flex flex-col gap-4">
        <h2
          id="leads-list"
          className="font-display text-lg font-semibold tracking-[-0.012em] text-foreground"
        >
          {t("list.heading")}
        </h2>

        <nav
          aria-label={t("list.filterLabel")}
          className="flex flex-wrap items-center gap-2"
        >
          <Chip
            href={hrefFor({ clear: true })}
            active={activeStatus === undefined && activeSource === undefined}
          >
            {t("list.filterAll")}
          </Chip>
          {leadStatuses
            .filter((status) => (statusCounts.get(status) ?? 0) > 0)
            .map((status) => (
              <Chip
                key={status}
                href={hrefFor({
                  status: activeStatus === status ? null : status,
                })}
                active={activeStatus === status}
              >
                {statusLabel(status)}
                <span className="ml-1.5 tabular-nums opacity-70">
                  {statusCounts.get(status) ?? 0}
                </span>
              </Chip>
            ))}
        </nav>

        {rows.length === 0 ? (
          <div
            role="status"
            className="flex flex-col items-start gap-3 rounded-xl border border-border bg-background/50 p-6"
          >
            <p className="max-w-prose text-sm text-foreground">
              {blamed === "status"
                ? t("list.emptyByStatus")
                : blamed === "source"
                  ? t("list.emptyBySource")
                  : blamed === "combination"
                    ? t("list.emptyCombination")
                    : t("empty")}
            </p>
            {blamed !== "none" && blamed !== null ? (
              <Link
                href={hrefFor({ clear: true })}
                className="inline-flex min-h-9 items-center rounded-lg border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {t("list.clearFilters")}
              </Link>
            ) : null}
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                locale={locale}
                assignedName={
                  lead.assignedTo === null
                    ? null
                    : (nameByProfileId.get(lead.assignedTo) ?? null)
                }
                statusLabel={statusLabel(lead.status)}
                sourceLabel={sourceLabel(lead.source)}
                labels={{
                  budget: t("card.budget"),
                  noBudget: t("card.noBudget"),
                  layout: t("card.layout"),
                  noLayout: t("card.noLayout"),
                  assigned: t("card.assigned"),
                  unassigned: t("card.unassigned"),
                  assignedUnnamed: directoryReadable
                    ? t("card.assignedUnknown")
                    : t("card.assignedUnnamed"),
                  score: t("card.score"),
                  noScore: t("card.noScore"),
                  nextAction: t("card.nextAction"),
                  noNextAction: t("card.noNextAction"),
                  lastContact: t("card.lastContact"),
                  neverContacted: t("card.neverContacted"),
                  consentYes: t("card.consentYes"),
                  consentNo: t("card.consentNo"),
                  lostReason: t("card.lostReason"),
                  note: t("card.note"),
                  channel: t("card.channel"),
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------

interface LeadCardLabels {
  budget: string
  noBudget: string
  layout: string
  noLayout: string
  assigned: string
  unassigned: string
  assignedUnnamed: string
  score: string
  noScore: string
  nextAction: string
  noNextAction: string
  lastContact: string
  neverContacted: string
  consentYes: string
  consentNo: string
  lostReason: string
  note: string
  channel: string
}

/**
 * One enquiry.
 *
 * A card rather than a table row, for a reason the data forces: half these
 * fields are legitimately absent — no budget, no layout, nobody assigned, never
 * contacted — and a table renders each of those as a lonely dash in a column,
 * which reads as missing data rather than as a lead nobody has worked yet. A
 * card can say "Kein Budget genannt" in the space the figure would have used.
 */
function LeadCard({
  lead,
  locale,
  statusLabel,
  sourceLabel,
  /** The assignee's name, or `null` when the viewer may not read the directory. */
  assignedName,
  labels,
}: {
  lead: LeadRecord
  locale: string
  statusLabel: string
  sourceLabel: string
  assignedName: string | null
  labels: LeadCardLabels
}) {
  const isLost = lead.status === "lost"
  const isDormant = lead.status === "dormant"

  return (
    <li
      data-slot="lead-card"
      data-lead-status={lead.status}
      data-lead-source={lead.source}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5",
        "shadow-[0_1px_0_0_var(--color-border),0_12px_32px_-24px_rgb(0_0_0/0.35)]",
        // A lost or dormant lead is recessed rather than alarmed: it is
        // legitimate history, it simply must not read as live work.
        isLost || isDormant ? "border-border bg-muted/20" : "border-border"
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="font-display text-base font-semibold tracking-[-0.012em] text-foreground">
            {lead.fullName}
          </h3>
          <p className="text-xs text-muted-foreground tabular-nums">
            {lead.reference}
            {" · "}
            <span className="normal-case">
              {labels.channel}: {sourceLabel}
              {lead.sourceDetail === null ? "" : ` (${lead.sourceDetail})`}
            </span>
          </p>
        </div>
        <span
          data-slot="lead-status"
          className={cn(
            "inline-flex min-h-6 shrink-0 items-center rounded-md border px-2 text-xs font-semibold tracking-[0.04em] uppercase",
            isLost
              ? "border-quality-stale/45 bg-quality-stale/10 text-quality-stale"
              : "border-primary/40 bg-primary/10 text-primary"
          )}
        >
          {statusLabel}
        </span>
      </header>

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={labels.budget}>
          {lead.budget === null ? (
            // Never 0, never blank. "Kein Budget genannt" is the fact.
            <span className="text-muted-foreground">{labels.noBudget}</span>
          ) : (
            // In the currency the person named. TRY stays TRY.
            <span
              data-numeric
              data-currency={lead.budget.currency}
              className="font-display font-semibold tracking-[-0.01em] tabular-nums"
            >
              {formatMoney(lead.budget, locale)}
            </span>
          )}
        </Field>

        <Field label={labels.layout}>
          {lead.desiredLayout ?? (
            <span className="text-muted-foreground">{labels.noLayout}</span>
          )}
        </Field>

        <Field label={labels.score}>
          {/* 0 and null differ: 0 is a scored lead that scored badly. */}
          {lead.score === null ? (
            <span className="text-muted-foreground">{labels.noScore}</span>
          ) : (
            <span className="tabular-nums">{lead.score}</span>
          )}
        </Field>

        <Field label={labels.assigned}>
          {/* Never the raw uuid. Three honest states: nobody is assigned;
              somebody is and this is who; somebody is and the viewer may not
              read the directory to find out who. */}
          {lead.assignedTo === null ? (
            <span className="text-muted-foreground">{labels.unassigned}</span>
          ) : assignedName === null ? (
            <span className="text-muted-foreground">
              {labels.assignedUnnamed}
            </span>
          ) : (
            assignedName
          )}
        </Field>

        <Field label={labels.lastContact}>
          {lead.lastContactedAt === null ? (
            <span className="text-muted-foreground">
              {labels.neverContacted}
            </span>
          ) : (
            <time dateTime={lead.lastContactedAt} className="tabular-nums">
              {formatDay(lead.lastContactedAt, locale)}
            </time>
          )}
        </Field>

        <Field label={labels.nextAction}>
          {lead.nextActionAt === null ? (
            <span className="text-muted-foreground">{labels.noNextAction}</span>
          ) : (
            <time dateTime={lead.nextActionAt} className="tabular-nums">
              {formatDay(lead.nextActionAt, locale)}
            </time>
          )}
        </Field>
      </dl>

      {lead.lostReason !== null && lead.lostReason.length > 0 ? (
        <p className="text-sm text-foreground">
          <span className="font-semibold">{labels.lostReason}: </span>
          {lead.lostReason}
        </p>
      ) : null}

      {lead.notes !== null && lead.notes.length > 0 ? (
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          <span className="sr-only">{labels.note}: </span>
          {lead.notes}
        </p>
      ) : null}

      {/* Marketing consent is a legal fact about a real person, so it is stated
          in both directions rather than shown only when granted. An absent
          badge would be indistinguishable from a field nobody filled in. */}
      <p
        data-slot="lead-consent"
        data-consent={lead.consentMarketing ? "granted" : "withheld"}
        className={cn(
          "inline-flex min-h-6 w-fit items-center rounded-md border px-2 text-xs",
          lead.consentMarketing
            ? "border-confidence-confirmed/40 bg-confidence-confirmed/10 text-confidence-confirmed"
            : "border-border bg-background text-muted-foreground"
        )}
      >
        {lead.consentMarketing ? labels.consentYes : labels.consentNo}
      </p>
    </li>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

/** Fail-visible: an unparseable timestamp renders raw, never "Invalid Date". */
function formatDay(iso: string, locale: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  return new Intl.DateTimeFormat(intlLocaleTag(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(parsed))
}

function Chip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex min-h-8 items-center rounded-full border px-3 text-sm",
        "transition-colors duration-150 ease-[var(--ease-out)]",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground"
      )}
    >
      {children}
    </Link>
  )
}
