import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join, normalize, sep } from "node:path"

import { conflict, notFound } from "@/lib/api-errors"
import { createManifestHandler } from "@/lib/api-handler"
import { RepositoryError } from "@/lib/repository-base"
import { createServiceRoleClient } from "@/lib/supabase/server"

/**
 * GET /api/evidence/snapshot/[hash] — the stored copy of a source page.
 *                                                             Owner: W-NIGHT
 *
 * ## What was wrong
 *
 * The evidence cockpit renders an archive link beside every citation, labelled
 * "Stored copy of the <publisher> page", pointing at
 * `/api/evidence/snapshot/<sha256>`. Nineteen of them on one page. **This route
 * did not exist**, so every one answered 404 — measured 2026-08-04.
 *
 * That link is not decoration. This product's entire claim is that a figure can
 * be re-checked against the page it came from, after that page changes or
 * disappears; the hash-addressed copy is what makes the claim redeemable. A
 * reader who follows the check is exactly the reader the evidence module exists
 * for, and they were the one person guaranteed to hit a JSON 404.
 *
 * The data was never the problem: 55 snapshot rows, 51 sources with one, and the
 * files are on disk under `sources/raw/<host>/<timestamp>__<slug>.html`. Only
 * the route was missing.
 *
 * ## It goes through `createManifestHandler`, and the first version did not
 *
 * The first version exported a hand-rolled `GET`. `scripts/validate-openapi.mjs`
 * caught it twice over — once as a shadow endpoint (reachable, undocumented)
 * and once under "SECURITY — every route is built by createManifestHandler",
 * whose whole point is that no route quietly skips the auth, rate-limit and
 * audit sequence. It was right: the hand-rolled version did its own permission
 * check and had no rate limit at all, on an endpoint that reads files off disk.
 *
 * `serialize` is how a non-JSON body goes through that sequence — the same seam
 * the iCalendar feed uses.
 *
 * ## The hash is a lookup key, not a path
 *
 * The URL segment is never joined to a filesystem path. It is matched against
 * `source_snapshots.snapshot_sha256` and the path comes back **from the
 * database row**, which is the only thing that stops this being a directory
 * traversal: a segment of `../../.env` matches no row and 404s at the query.
 * The shape check before the query keeps a malformed segment from reaching
 * Postgres at all, and the containment check after it is the belt to that
 * braces — a row whose stored path escaped the archive root is a corrupted row
 * and is refused rather than served.
 *
 * ## Why it re-hashes before serving
 *
 * The whole point of the artefact is that it is the bytes that were fetched. If
 * the file on disk no longer hashes to the id it is addressed by, serving it
 * would be worse than serving nothing: the reader would check a figure against
 * a document they believe is the original and is not. So a mismatch is a 409
 * that says so, not a silent success.
 *
 * The hash is taken over the **bytes**, before any decoding, because that is
 * what was hashed at harvest time. Decoding first and hashing the string would
 * compare a different thing and pass files that had been re-encoded.
 *
 * ## Who may read it
 *
 * `evidence:view`, declared in the manifest and enforced by the handler. The
 * snapshots are copies of pages that were public when they were fetched, but
 * they are also this project's working material — the harvest, with its
 * timestamps and its coverage gaps — and the evidence module is gated, so its
 * artefacts are gated the same way.
 *
 * The read uses the service client because `source_snapshots` is not granted to
 * `authenticated`; the manifest's permission check runs first.
 */

/** 64 lowercase hex characters, and nothing else, ever. */
const SHA256 = /^[0-9a-f]{64}$/u

/** Everything served from here lives under this directory, and only this one. */
const ARCHIVE_ROOT = "sources"

/**
 * One answer for every "no such snapshot" case.
 *
 * A malformed segment, an unknown hash and an unreadable row are one outcome to
 * the caller on purpose: whether a given hash exists is itself information, and
 * distinguishing them would let somebody probe the archive's contents.
 */
function noSnapshot(): RepositoryError {
  return new RepositoryError(notFound("No stored copy is available."))
}

export const GET = createManifestHandler("getEvidenceSnapshot", {
  handler: async ({ params }) => {
    const hash = params.hash ?? ""

    // Shape first, so a malformed segment never becomes a query.
    if (!SHA256.test(hash)) throw noSnapshot()

    const client = createServiceRoleClient()
    if (client === null) throw noSnapshot()

    // `source_snapshots` is a harvest table and is not in the generated
    // database types, so the row arrives as `never` and is read through
    // `unknown` rather than cast into a shape TypeScript cannot check. Two
    // fields are used and both are validated below.
    const { data, error } = await client
      .from("source_snapshots")
      .select("snapshot_path, snapshot_sha256, sources(publisher)")
      .eq("snapshot_sha256", hash)
      .limit(1)
      .maybeSingle()

    if (error !== null || data === null) throw noSnapshot()

    const row = data as unknown as {
      snapshot_path?: unknown
      sources?: unknown
    }

    const storedPath =
      typeof row.snapshot_path === "string" ? row.snapshot_path : ""
    if (storedPath === "") throw noSnapshot()

    // The stored path is repository-relative. Containment is checked on the
    // NORMALISED path, because `sources/../../etc/passwd` starts with `sources`
    // as a string and does not live under it as a path.
    const relative = normalize(storedPath)
    if (
      !relative.startsWith(`${ARCHIVE_ROOT}${sep}`) &&
      !relative.startsWith(`${ARCHIVE_ROOT}/`)
    ) {
      throw noSnapshot()
    }

    // `process.cwd()` is `apps/web` when Next runs; the archive is at the
    // repository root, one level up from the workspace.
    const absolute = join(process.cwd(), "..", "..", relative)

    let bytes: Buffer
    try {
      bytes = await readFile(absolute)
    } catch {
      // The row exists and the file does not — a real state, since the archive
      // is not deployed with the application. Reported as the same "no stored
      // copy" so the endpoint still does not confirm which hashes exist.
      throw noSnapshot()
    }

    // Over the bytes, before decoding. See the header.
    if (createHash("sha256").update(bytes).digest("hex") !== hash) {
      throw new RepositoryError(
        conflict(
          "The stored copy no longer matches the hash it is filed under, so it cannot be shown as the original."
        )
      )
    }

    // PostgREST returns an embedded one-to-one as an object and a one-to-many
    // as an array, and which one it picks depends on the foreign key it
    // inferred. Both are handled rather than assumed.
    const joined = Array.isArray(row.sources) ? row.sources[0] : row.sources
    const publisherValue = (joined as { publisher?: unknown } | null | undefined)
      ?.publisher
    const publisher =
      typeof publisherValue === "string" && publisherValue !== ""
        ? publisherValue
        : "source"

    return {
      data: { text: bytes.toString("utf8"), publisher, hash },
      source: "supabase" as const,
    }
  },

  serialize: ({ text, publisher, hash }) => ({
    body: text,
    // **Never** the document's own type. These are captured third-party HTML
    // pages, and serving them as `text/html` from this origin would execute
    // whatever script they contain with this application's cookies. Served as
    // plain text they are readable, diffable, and inert.
    contentType: "text/plain; charset=utf-8",
    headers: {
      "Content-Disposition": `inline; filename="${publisher.replace(/[^\w.-]+/gu, "-")}-${hash.slice(0, 12)}.html.txt"`,
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "X-Content-Type-Options": "nosniff",
      // Addressed by the hash of its own content, so it can never change.
      "Cache-Control": "private, max-age=3600, immutable",
      "X-Robots-Tag": "noindex, nofollow",
    },
  }),
})
