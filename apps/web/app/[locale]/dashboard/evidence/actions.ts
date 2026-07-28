"use server"

import { z } from "zod"

import { getUserProfile } from "@/lib/auth"
import { isSupabaseConfigured } from "@/lib/env"
import { hasPermission } from "@/lib/rbac"

/**
 * Annotating a finding.                                           Owner: W3-C
 *
 * `tasks/W3-C`'s permission requirement is three-way and this action is the
 * half of it that is not a read: **`manager` reads findings but cannot
 * annotate, `admin` can, `tenant` gets 403.**
 *
 * ## It refuses to pretend
 *
 * There is no `finding_annotations` table and no repository write path, so with
 * no data plane configured this returns **503 `persistence_unavailable`** — it
 * does not return success and it does not keep the note in memory where a
 * reviewer would believe it had been saved.
 *
 * `tasks/W2-B` states the rule this follows: *"503 must be honest. When Supabase
 * is unconfigured and the route writes, return 503 — do not pretend success
 * against seed data. Reads may serve seed; writes may not."* The reference
 * project puts it more bluntly: *"Seed- oder Prozessdaten sind kein
 * Persistenznachweis."*
 *
 * So what this action proves today is the **authorisation** half, completely and
 * for real: an `admin` reaches the write path and is told the store is missing,
 * a `manager` is refused before the store is even consulted, and the difference
 * between those two answers is observable. When W1-A adds the table and W2-A
 * adds the repository call, the only edit here is replacing the 503 branch.
 */

const annotationSchema = z.strictObject({
  findingId: z
    .string()
    .trim()
    .min(1, "A finding id is required.")
    .max(64)
    .regex(/^F-\d{3}$/, "That is not a finding id."),
  // Bounded like every other free-text field in this app. The ceiling is the
  // same 4000 as `longText` in W2-B's validation primitives, so an annotation
  // and a ticket description behave the same way.
  note: z
    .string()
    .trim()
    .min(8, "Give a note of at least 8 characters.")
    .max(4_000, "A note must be 4000 characters or fewer."),
})

export type AnnotationState =
  | { status: "idle" }
  | { status: "forbidden" }
  | { status: "invalid"; message: string }
  | { status: "unavailable"; message: string }
  | { status: "saved" }

/**
 * The order is the security property, and it mirrors `createHandler`'s:
 * authenticate → authorise → validate → write. Authorisation comes **before**
 * validation here rather than after, which is the one place this deliberately
 * diverges from W2-B's documented sequence: a caller with no right to annotate
 * should not be able to map the schema by watching which fields it complains
 * about.
 */
export async function annotateFinding(
  _previous: AnnotationState,
  formData: FormData,
): Promise<AnnotationState> {
  const profile = await getUserProfile()

  if (!profile.authenticated || !hasPermission(profile.role, "evidence:manage")) {
    return { status: "forbidden" }
  }

  const parsed = annotationSchema.safeParse({
    findingId: formData.get("findingId"),
    note: formData.get("note"),
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      status: "invalid",
      message: issue === undefined ? "That annotation is not valid." : issue.message,
    }
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "unavailable",
      message:
        "Annotations need a database. Nothing was saved — this build is running on the local seed.",
    }
  }

  // Supabase IS configured and there is still no table to write to (W1-A owns
  // the migration, W2-A the repository call). Reporting success here would be
  // the fake-write-success the honesty audit calls a HIGH finding, so it stays
  // a 503 until the write path exists.
  return {
    status: "unavailable",
    message:
      "The annotation store is not implemented yet (finding_annotations, W1-A). Nothing was saved.",
  }
}
