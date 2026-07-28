import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { AccessRefusal } from "@/components/governance/access-refusal"
import { GovernanceNotice } from "@/components/governance/governance-notice"
import {
  RoleAssignmentPanel,
  type DirectoryOption,
  type RoleOption,
} from "@/components/governance/role-assignment-panel"
import {
  DashboardKpiGrid,
  DashboardPageHeader,
  DashboardSection,
} from "@/components/dashboard/section"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { GovernanceTableFrame } from "@/components/governance/governance-table"
import { getUserProfile } from "@/lib/auth"
import { roles, type Locale, type Role } from "@/lib/contracts"
import { formatDate } from "@/lib/format"
import { getProfiles } from "@/lib/governance-repository"
import { hasPermission } from "@/lib/rbac"

import { assignRole } from "./actions"

/**
 * /[locale]/dashboard/users — the people directory.             Owner: W3-F
 *
 * ## The permission check is the first thing in the function
 *
 * `SECURITY-REVIEW.md` SEC-003: a Server Component that reads its repositories
 * and leaves the refusal to a client guard puts the data in the RSC payload for
 * every role. This page checks `users:view` **before** `getProfiles` is called,
 * so a refused caller causes no read and there is nothing to serialise.
 *
 * `users:view` is held by `admin` and `manager` only. `users:manage` — the gate
 * on the assignment panel below — is `admin` only. Both are asked of
 * `hasPermission`, never of the role name (CONTRACTS §8).
 *
 * ## What a manager sees, and what it does not get to do
 *
 * A `manager` reads the directory and the role coverage and is offered no
 * assignment control. That is not a UI preference: `decideRoleChange` refuses
 * them server-side with `not_permitted` whether or not the panel renders.
 *
 * ## Rendering mode
 *
 * No `export const dynamic`. W-INT §4: the root layout reads `headers()`, so
 * every route below it is already dynamic, and `force-static` would ship a page
 * whose scripts are all CSP-blocked while still looking right (S-009).
 */

export const metadata: Metadata = {
  title: "Benutzer",
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 200

export default async function UsersPage({
  params,
}: {
  // Next 16: `params` is a Promise.
  params: Promise<{ locale: Locale }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.users" })
  const profile = await getUserProfile()

  const mayView =
    profile.authenticated && hasPermission(profile.role, "users:view")

  if (!mayView) {
    return (
      <AccessRefusal
        title={t("forbidden.title")}
        message={t("forbidden.message")}
        detailLabel={t("forbidden.permissionLabel")}
        detail="users:view"
      />
    )
  }

  const mayManage = hasPermission(profile.role, "users:manage")

  const directory = await getProfiles({
    role: profile.role,
    ...(profile.id === null ? {} : { profileId: profile.id }),
    limit: PAGE_SIZE,
  })

  const roleLabel = (role: Role | null): string =>
    role === null ? t("unknownRole") : t(`roles.${role}`)

  // Coverage over ALL eleven roles, not only the ones present. A role with zero
  // holders is the interesting row: "nobody can post a ledger entry" is a fact
  // this view exists to surface, and filtering to the roles that exist would
  // hide exactly that.
  const coverage = roles.map((role) => ({
    role,
    total: directory.data.filter((entry) => entry.role === role).length,
    active: directory.data.filter(
      (entry) => entry.role === role && entry.isActive
    ).length,
  }))

  const activeAdmins = coverage.find((row) => row.role === "admin")?.active ?? 0

  const candidates: DirectoryOption[] = directory.data
    // The current user is excluded because `decideRoleChange` refuses a self
    // change. The UI agrees with the rule rather than offering an option that
    // can only fail.
    .filter((entry) => entry.id !== profile.id)
    .map((entry) => ({
      id: entry.id,
      label: `${entry.fullName ?? t("unnamed")} · ${roleLabel(entry.role)}`,
      role: entry.role,
      isActive: entry.isActive,
    }))

  const roleOptions: RoleOption[] = roles.map((role) => ({
    value: role,
    label: t(`roles.${role}`),
  }))

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <DashboardPageHeader title={t("title")} description={t("lead")} />

      {directory.source === "local-seed" ? (
        <GovernanceNotice tone="seed">{t("seedNotice")}</GovernanceNotice>
      ) : null}

      {/* SEC-002 recorded `degradedReason` as having zero consumers, so a user
          whose profile could not be read saw a minimal dashboard and was never
          told why. This is one of the consumers it asked for. */}
      {profile.degradedReason === null ? null : (
        <GovernanceNotice tone="warning">
          {t("profileDegraded")}
        </GovernanceNotice>
      )}

      {directory.degradedReason === null ? null : (
        <GovernanceNotice tone="info">{t("restrictedNotice")}</GovernanceNotice>
      )}

      <DashboardKpiGrid>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-6">
            <span className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t("countLabel")}
            </span>
            <span className="font-display text-2xl font-semibold">
              {directory.data.length}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-6">
            <span className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t("adminCount")}
            </span>
            <span className="font-display text-2xl font-semibold">
              {activeAdmins}
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              {t("adminCountLead")}
            </span>
          </CardContent>
        </Card>
      </DashboardKpiGrid>

      <DashboardSection title={t("directory")} description={t("directoryLead")}>
        {directory.data.length === 0 ? (
          <EmptyState title={t("empty")} description={t("emptyLead")} />
        ) : (
          <GovernanceTableFrame>
            <Table>
              <TableCaption>{t("directoryCaption")}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.name")}</TableHead>
                  <TableHead>{t("columns.email")}</TableHead>
                  <TableHead>{t("columns.role")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead>{t("columns.created")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {directory.data.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">
                      {entry.fullName ?? t("unnamed")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.email ?? t("noEmail")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={entry.role === "admin" ? "default" : "muted"}
                      >
                        {roleLabel(entry.role)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={entry.isActive ? "confirmed" : "destructive"}
                      >
                        {entry.isActive ? t("active") : t("inactive")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatDate(entry.createdAt, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </GovernanceTableFrame>
        )}
      </DashboardSection>

      <DashboardSection title={t("coverage")} description={t("coverageLead")}>
        <GovernanceTableFrame>
          <Table>
            <TableCaption>{t("coverageCaption")}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.role")}</TableHead>
                <TableHead>{t("columns.active")}</TableHead>
                <TableHead>{t("columns.total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coverage.map((row) => (
                <TableRow key={row.role}>
                  <TableCell className="font-medium">
                    {t(`roles.${row.role}`)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {row.active === 0 ? (
                      <Badge variant="gap">{t("noHolder")}</Badge>
                    ) : (
                      row.active
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {row.total}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </GovernanceTableFrame>
      </DashboardSection>

      {mayManage ? (
        <DashboardSection title={t("assign")} description={t("assignLead")}>
          <RoleAssignmentPanel
            action={assignRole}
            locale={locale}
            candidates={candidates}
            roleOptions={roleOptions}
            labels={{
              person: t("person"),
              role: t("columns.role"),
              submit: t("submit"),
              submitting: t("submitting"),
              noCandidates: t("noCandidates"),
              elevationWarning: t("elevationWarning"),
              statusHeading: t("statusHeading"),
            }}
          />
        </DashboardSection>
      ) : (
        <GovernanceNotice tone="info">{t("readOnlyNotice")}</GovernanceNotice>
      )}

      <DashboardSection
        title={t("invitations.title")}
        description={t("invitations.lead")}
      >
        {/* An invitation is a single-use, expiring, scoped token, and there is no
            table for one: `supabase/migrations` has no `invitations`, and
            `tasks/W3-F` forbids stubbing a missing target to make a surface look
            finished. So this states the gap rather than rendering a form whose
            submit button would have nowhere to write. */}
        <GovernanceNotice tone="info">
          {t("invitations.unavailable")}
        </GovernanceNotice>
      </DashboardSection>
    </div>
  )
}
