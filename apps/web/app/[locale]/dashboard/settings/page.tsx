import { Bell, ShieldCheck } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Link } from "@/app/navigation"
import { AccessRefusal } from "@/components/governance/access-refusal"
import { GovernanceNotice } from "@/components/governance/governance-notice"
import { PreferencesForm } from "@/components/governance/preferences-form"
import {
  DashboardPageHeader,
  DashboardSection,
} from "@/components/dashboard/section"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getUserProfile } from "@/lib/auth"
import { locales, type Locale } from "@/lib/contracts"
import { getCompany } from "@/lib/inventory-repository"
import { hasPermission } from "@/lib/rbac"

import { savePreferences } from "./actions"

/**
 * /[locale]/dashboard/settings — your account, and the way in to admin.
 *                                                              Owner: W3-F
 *
 * ## Three sections that do not exist, said out loud
 *
 * The brief asks for profile, locale, theme, notifications and organisation
 * settings. Two of those cannot be built honestly today and one is deliberately
 * fixed:
 *
 *   - **Theme** is pinned. `components/providers/theme-provider.tsx` sets
 *     `forcedTheme="light"` on the repository owner's explicit instruction, and
 *     `forcedTheme` overrides both `defaultTheme` and any stored preference. A
 *     theme picker here would be a control that changes nothing, which is the
 *     same failure as an unconfigured integration rendered as healthy. So the
 *     section states the fixed value instead. SEC-022 records the consequence.
 *   - **Notifications** have no table. Fifteen migrations, none of them a
 *     preference store.
 *   - **Organisation settings** are read-only here: `companies` exists but has
 *     no editable settings surface, and inventing one would be a stub.
 *
 * ## This page is the way to `/dashboard/admin`
 *
 * That route has no sidebar entry — `lib/dashboard-routing.ts` is W3-B's file
 * and `CONTRACTS.md` §3 has no `admin` resource, so the record is requested in
 * HANDOFF/W3-F.md rather than added. The link below is how an administrator
 * reaches it in the meantime, and it is rendered only for the role that holds
 * the permission the page itself enforces.
 */

/**
 * The browser tab, in the reader's language. This was a German literal, so a
 * Turkish page carried a German tab; the heading beside it was already
 * translated, which made the mismatch worse rather than invisible.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.settings" })
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  }
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.settings" })
  const profile = await getUserProfile()

  const mayView =
    profile.authenticated && hasPermission(profile.role, "settings:view")

  if (!mayView) {
    return (
      <AccessRefusal
        title={t("forbidden.title")}
        message={t("forbidden.message")}
        detailLabel={t("forbidden.permissionLabel")}
        detail="settings:view"
      />
    )
  }

  const mayAdminister = hasPermission(profile.role, "settings:manage")

  // Job titles for the eleven role slugs. Held in the users module because that
  // is where roles are assigned; read here rather than duplicated, so a wording
  // change lands in both places at once.
  const tRoles = await getTranslations({
    locale,
    namespace: "dashboard.users.roles",
  })

  // Only read for the section that shows it. `companies` is world-readable —
  // the developer's name is on the landing page — but a read nobody displays is
  // still a round trip.
  const company =
    mayAdminister && profile.companyId !== null
      ? ((await getCompany(profile.companyId)).data ?? null)
      : null

  const localeNames: Record<Locale, string> = {
    de: t("locales.de"),
    en: t("locales.en"),
    tr: t("locales.tr"),
    ru: t("locales.ru"),
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <DashboardPageHeader title={t("title")} description={t("lead")} />

      {profile.degradedReason === null ? null : (
        <GovernanceNotice tone="warning">
          {t("profileDegraded")}
        </GovernanceNotice>
      )}

      <DashboardSection title={t("account")} description={t("accountLead")}>
        <dl className="grid [grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
          <Fact label={t("email")} value={profile.email ?? t("noEmail")} />
          {/* The stored value is `service_provider`; the person reading it is
              a service provider. Show the second one. */}
          <Fact label={t("role")} value={tRoles(profile.role)} />
          <Fact
            label={t("sessionSource")}
            value={t(`sessionSources.${profile.source}`)}
          />
        </dl>

        {/* The role is shown and is not editable here, on any surface, for
            anybody. Changing a role is the users module's business and it
            refuses a self change outright. */}
        <GovernanceNotice tone="info">{t("roleFixedNotice")}</GovernanceNotice>
      </DashboardSection>

      <DashboardSection
        title={t("preferences")}
        description={t("preferencesLead")}
      >
        <PreferencesForm
          action={savePreferences}
          formLocale={locale}
          availableLocales={locales}
          initialLocale={
            profile.locale !== null &&
            (locales as readonly string[]).includes(profile.locale)
              ? (profile.locale as Locale)
              : locale
          }
          initialFullName={profile.fullName ?? ""}
          initialPhone={profile.phone ?? ""}
          labels={{
            fullName: t("fullName"),
            phone: t("phone"),
            language: t("language"),
            languageHint: t("languageHint"),
            submit: t("save"),
            submitting: t("saving"),
            resultHeading: t("resultHeading"),
            savedAs: t("savedAs"),
            forbidden: t("forbidden.message"),
            localeNames,
          }}
        />
      </DashboardSection>

      <DashboardSection
        title={t("appearance")}
        description={t("appearanceLead")}
      >
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-input px-3 py-2.5">
          <span className="text-sm font-medium">{t("theme.label")}</span>
          <Badge variant="outline">{t("theme.light")}</Badge>
        </div>
        <GovernanceNotice tone="info">{t("themeFixedNotice")}</GovernanceNotice>
      </DashboardSection>

      <DashboardSection
        title={t("notifications")}
        description={t("notificationsLead")}
      >
        {/* This said "Notifications are not possible yet" long after they
            became possible: they are written, delivered, linked and marked
            read on the communications page. What is genuinely absent is
            delivery OUTSIDE the app and per-event control, so that is what it
            says now — and it points at the place they do arrive rather than
            leaving a reader to find it. */}
        <GovernanceNotice tone="info">
          {t("notificationsUnavailable")}
        </GovernanceNotice>

        <div>
          <Button
            size="sm"
            variant="outline"
            render={<Link href="/dashboard/communications" locale={locale} />}
          >
            <Bell aria-hidden="true" />
            {t("openNotifications")}
          </Button>
        </div>
      </DashboardSection>

      {mayAdminister ? (
        <DashboardSection
          title={t("organisation")}
          description={t("organisationLead")}
        >
          {company === null ? (
            <GovernanceNotice tone="warning">
              {t("noCompany")}
            </GovernanceNotice>
          ) : (
            <dl className="grid [grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
              <Fact label={t("companyName")} value={company.name} />
              <Fact
                label={t("companyLegalName")}
                value={company.legalName ?? t("notStated")}
              />
              <Fact label={t("companyCountry")} value={company.country} />
              <Fact
                label={t("companyCurrency")}
                value={company.defaultCurrency}
              />
              <Fact
                label={t("companyFounded")}
                value={
                  company.foundedYear === null
                    ? t("notStated")
                    : String(company.foundedYear)
                }
              />
              <Fact
                label={t("companyWebsite")}
                value={company.website ?? t("notStated")}
                href={company.website}
              />
            </dl>
          )}

          <GovernanceNotice tone="info">
            {t("organisationReadOnly")}
          </GovernanceNotice>

          <div>
            <Button
              size="sm"
              render={<Link href="/dashboard/admin" locale={locale} />}
            >
              <ShieldCheck aria-hidden="true" />
              {t("openAdmin")}
            </Button>
          </div>
        </DashboardSection>
      ) : null}
    </div>
  )
}

function Fact({
  label,
  value,
  mono = false,
  href = null,
}: {
  label: string
  value: string
  mono?: boolean
  /** When the value is somewhere you can go, make it go there. */
  href?: string | null
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-input px-3 py-2.5">
      <dt className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={
          mono
            ? "min-w-0 truncate font-mono text-sm"
            : "min-w-0 truncate text-sm"
        }
      >
        {href === null ? (
          value
        ) : (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
          >
            {value}
          </a>
        )}
      </dd>
    </div>
  )
}
