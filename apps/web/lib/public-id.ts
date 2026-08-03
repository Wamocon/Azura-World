import { createCipheriv, createDecipheriv, hkdfSync } from "node:crypto"

import { serverEnv } from "@/lib/env"

/**
 * Opaque identifiers for URLs.                                  Owner: W-NIGHT
 *
 * ## What this is for
 *
 * Until now `/dashboard/tickets/a307145c-c50f-4b50-a4ef-c5bfdfe62378` put a
 * primary key from `public.service_tickets` in the address bar. RLS meant
 * possessing that id granted nothing — every read is still scoped by policy —
 * but the id itself is information, and it travelled further than the page did:
 *
 *   * into the `Referer` header of every outbound link the user then clicked,
 *     which hands a third party a live record id from a private system;
 *   * into browser history, bookmarks, and any screenshot or screen share;
 *   * into every access log, proxy log and analytics event in the path;
 *   * and into a support ticket, pasted by a user asking for help.
 *
 * It also tells an attacker the shape of the system: that ids are v4 uuids, that
 * this table is keyed by one, and — for a table keyed by a running number, as
 * `service_tickets.ticket_no` is — how much of it exists.
 *
 * So the URL now carries a token that means nothing outside this deployment.
 *
 * ## The construction, and why it is this one
 *
 * A uuid is exactly 16 bytes. One AES block is exactly 16 bytes. So the token is
 * a single block-cipher call over the raw uuid:
 *
 *     token = base64url( AES-256( keyFor(kind), uuidBytes ) )
 *
 * 22 characters, shorter than the uuid it replaces, stable for the life of the
 * secret, and with no structure an outsider can read.
 *
 * **On `aes-256-ecb`.** ECB is normally a mistake, and it is worth being precise
 * about why it is not one here. ECB's weakness is that identical plaintext
 * blocks produce identical ciphertext blocks, which leaks the shape of a longer
 * message. There is exactly ONE block here and there can never be more: the
 * plaintext is a uuid, its length is fixed at 16 bytes, and `encodePublicId`
 * refuses anything else. With a single block, ECB *is* the block cipher — a
 * pseudorandom permutation on 16 bytes, which is precisely the primitive this
 * needs. A mode with an IV would be strictly worse for the job: the IV has to
 * travel in the token, so the URL grows by 16 characters, and either the IV is
 * random (a different URL for the same ticket on every render, so bookmarks and
 * shared links stop matching) or it is derived from the plaintext, which is the
 * same determinism with extra steps.
 *
 * **On integrity.** There is no authentication tag, deliberately. A tampered
 * token decrypts to 16 random bytes, which is a uuid that does not exist, which
 * is a 404. Nothing downstream trusts the decoded value: it goes into a query
 * whose rows RLS still scopes to the caller. An auth tag would add 22 characters
 * to every URL to convert one 404 into a different 404.
 *
 * **On `kind`.** The key is derived per resource type, so a token minted for a
 * ticket decrypts to garbage under the thread key. Without that binding, a token
 * from a surface a user can reach could be replayed at a surface they cannot,
 * and the id would resolve. It costs nothing and closes a whole class.
 *
 * ## What it is NOT
 *
 * Not an access control. RLS is the boundary and stays the boundary — a token is
 * a name, not a capability. If a user obtains another user's token, the page
 * still returns nothing, exactly as it did when the uuid was in the URL. This
 * removes an information leak; it does not replace an authorisation check, and
 * any code that starts treating "holds a valid token" as "may read the row" has
 * misread this file.
 */

/**
 * The resource types that appear in a URL. Adding one is deliberate: each gets
 * its own derived key, so tokens never cross between them.
 */
export const PUBLIC_ID_KINDS = ["ticket", "thread", "document"] as const

export type PublicIdKind = (typeof PUBLIC_ID_KINDS)[number]

/** A v4-shaped uuid, the only thing this module will encode. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** base64url of 16 bytes is always 22 characters with no padding. */
const TOKEN_LENGTH = 22
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/

/**
 * Per-kind keys, derived once.
 *
 * HKDF rather than using the secret directly: the secret is a printable string
 * of unknown length and distribution, and AES needs exactly 32 uniformly random
 * bytes. `info` is the kind, which is what makes the keys independent.
 */
const keyCache = new Map<PublicIdKind, Buffer>()

function keyFor(kind: PublicIdKind): Buffer {
  const cached = keyCache.get(kind)
  if (cached !== undefined) return cached

  const secret = serverEnv.PUBLIC_ID_SECRET
  if (secret === undefined) {
    // Fails closed, and says exactly what to do. The alternative — quietly
    // falling back to raw uuids — would mean a deployment that forgot the
    // variable silently reintroduces the leak this module exists to close,
    // with nothing in the interface to show it had happened.
    throw new Error(
      "PUBLIC_ID_SECRET is not set, so record identifiers cannot be encoded for URLs. " +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))" ' +
        "and add it to .env.local. Changing it invalidates every existing link, which is the intended way to rotate."
    )
  }

  const key = Buffer.from(
    hkdfSync("sha256", Buffer.from(secret, "utf8"), "azura-public-id", kind, 32)
  )
  keyCache.set(kind, key)
  return key
}

/**
 * A uuid → the token that stands for it in a URL.
 *
 * Throws on anything that is not a uuid rather than encoding it: the caller has
 * passed the wrong column, and producing a token for it would put whatever it
 * was into the address bar under a name suggesting it was safe.
 */
export function encodePublicId(kind: PublicIdKind, id: string): string {
  if (!UUID_PATTERN.test(id)) {
    throw new Error(
      `encodePublicId(${kind}) expects a uuid and was given ${JSON.stringify(id.slice(0, 24))}.`
    )
  }
  const cipher = createCipheriv("aes-256-ecb", keyFor(kind), null)
  cipher.setAutoPadding(false)
  const raw = Buffer.from(id.replace(/-/g, ""), "hex")
  const out = Buffer.concat([cipher.update(raw), cipher.final()])
  return out.toString("base64url")
}

/**
 * A token from a URL → the uuid, or `null`.
 *
 * `null` for anything malformed, and the caller's job is to turn that into the
 * same 404 an unknown id produces. Never throws on bad input: this reads
 * straight off the address bar, so a malformed value is an everyday event —
 * a truncated paste, a stale bookmark after a secret rotation, a crawler — and
 * not an exceptional one.
 */
export function decodePublicId(
  kind: PublicIdKind,
  token: string
): string | null {
  if (!TOKEN_PATTERN.test(token)) return null
  try {
    const raw = Buffer.from(token, "base64url")
    if (raw.length !== 16) return null
    const decipher = createDecipheriv("aes-256-ecb", keyFor(kind), null)
    decipher.setAutoPadding(false)
    const out = Buffer.concat([decipher.update(raw), decipher.final()])
    const hex = out.toString("hex")
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    // A tampered token decrypts to 16 random bytes. Those are still a
    // well-formed uuid, so this test almost always passes and the lookup
    // 404s instead — which is the intended outcome, not a gap. The check is
    // here for the shape, not as a filter.
    return UUID_PATTERN.test(uuid) ? uuid : null
  } catch {
    return null
  }
}

/**
 * `encodePublicId` for a value that may be absent, for the common case of
 * building a link only when there is something to link to.
 */
export function encodeOptionalPublicId(
  kind: PublicIdKind,
  id: string | null | undefined
): string | null {
  return id === null || id === undefined ? null : encodePublicId(kind, id)
}

/** Whether URL tokens can be produced at all — for a health check, not a branch. */
export function publicIdsConfigured(): boolean {
  return serverEnv.PUBLIC_ID_SECRET !== undefined
}

export { TOKEN_LENGTH as PUBLIC_ID_TOKEN_LENGTH }
