"use server"

import { getTranslations } from "next-intl/server"
import { z } from "zod"

import { getUserProfile } from "@/lib/auth"
import { locales, type Locale } from "@/lib/contracts"
import { isSupabaseConfigured } from "@/lib/env"
import { writeAuditEvent } from "@/lib/governance-audit"
import { createClient } from "@/lib/supabase/server"

/**
 * Your own settings, and nobody else's.                         Owner: W3-F
 *
 * ## The subject is always `profile.id`, and it is never a parameter
 *
 * `tasks/W3-F`: *"Changing your own locale must not change anyone else's."* The
 * enforcement is structural rather than a check: this action takes **no subject
 * id at all**. There is no field a caller could set, no id to tamper with, and
 * the `.eq("id", profile.id)` below reads from the resolved session. A caller
 * cannot express the request "change someone else's locale" through this
 * surface, which is a stronger guarantee than validating that they did not.
 *
 * RLS agrees independently: `profiles_update_own` scopes an UPDATE to
 * `auth.uid()`, so even a bug here could not reach another row.
 *
 * ## Nothing here can change authority
 *
 * The update names three columns and none of them is `role`, `company_id` or
 * `is_active`. `prevent_profile_privilege_escalation()` would raise `42501` if
 * one appeared, which is the same trigger that makes the users module's
 * self-elevation refusal true at the database as well as in the application.
 *
 * ## Last write wins, and it says what it wrote
 *
 * `tasks/W3-F` accepts last-write-wins for concurrent saves from two tabs, and
 * asks that the result show what was saved. The success state carries the saved
 * locale back, so a tab that lost the race displays the value that is now
 * stored rather than the one it submitted.
 */

export type SettingsState =
  | { status: "idle" }
  | { status: "forbidden" }
  | { status: "invalid"; message: string }
  | { status: "unavailable"; httpStatus: 503; message: string }
  /** Saved. `savedLocale` is what is now stored, not what was submitted. */
  | { status: "saved"; message: string; savedLocale: Locale }
  | { status: "incomplete"; message: string; savedLocale: Locale }

const preferencesSchema = z.strictObject({
  // The locale the FORM was rendered in, used only to translate the reply.
  formLocale: z.enum(locales),
  // The locale being saved.
  preferredLocale: z.enum(locales),
  fullName: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
})

export async function savePreferences(
  _previous: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const profile = await getUserProfile()

  // Any authenticated profile may edit its own preferences. There is no
  // permission gate because there is no other person's data in reach — the
  // subject is the caller, always.
  if (!profile.authenticated || profile.id === null) {
    return { status: "forbidden" }
  }

  const rawName = formData.get("fullName")
  const rawPhone = formData.get("phone")

  const parsed = preferencesSchema.safeParse({
    formLocale: formData.get("formLocale"),
    preferredLocale: formData.get("preferredLocale"),
    ...(typeof rawName === "string" ? { fullName: rawName } : {}),
    ...(typeof rawPhone === "string" ? { phone: rawPhone } : {}),
  })

  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      status: "invalid",
      message: issue?.message ?? "That request is not valid.",
    }
  }

  const { formLocale, preferredLocale, fullName, phone } = parsed.data
  const t = await getTranslations({
    locale: formLocale,
    namespace: "dashboard.settings",
  })

  if (!isSupabaseConfigured()) {
    return {
      status: "unavailable",
      httpStatus: 503,
      message: t("noDatabase"),
    }
  }

  const client = await createClient()
  if (client === null) {
    return { status: "unavailable", httpStatus: 503, message: t("noDatabase") }
  }

  // Three columns, named explicitly. Not a spread of the parsed object: a spread
  // would carry whatever the schema grows next straight into an UPDATE on a
  // table that also holds `role`.
  const update: ProfilePreferenceUpdate = {
    locale: preferredLocale,
    full_name:
      fullName === undefined || fullName.length === 0 ? null : fullName,
    phone: phone === undefined || phone.length === 0 ? null : phone,
  }

  // Same cast, same reason, as `lib/governance-audit.ts`: no generated
  // `Database` types exist yet (W1-A), so the untyped client infers `never`.
  const { error } = await client
    .from("profiles")
    .update(update as unknown as never)
    .eq("id", profile.id)

  if (error !== null) {
    return { status: "unavailable", httpStatus: 503, message: t("writeFailed") }
  }

  const audit = await writeAuditEvent({
    action: "settings.preferences_updated",
    entityTable: "profiles",
    entityId: profile.id,
    actorProfileId: profile.id,
    companyId: profile.companyId,
    beforeData: { locale: profile.locale },
    afterData: { locale: preferredLocale },
  })

  if (audit.status !== "recorded") {
    const admin = await getTranslations({
      locale: formLocale,
      namespace: "dashboard.admin",
    })
    return {
      status: "incomplete",
      message: `${t("auditIncomplete")} ${admin(`auditReason.${audit.reason}`)}`,
      savedLocale: preferredLocale,
    }
  }

  return {
    status: "saved",
    message: t("saved"),
    savedLocale: preferredLocale,
  }
}

/** The three columns this action may touch. Deliberately not a wider type. */
interface ProfilePreferenceUpdate {
  locale: Locale
  full_name: string | null
  phone: string | null
}
