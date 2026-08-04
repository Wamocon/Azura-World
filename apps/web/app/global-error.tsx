"use client"

/**
 * Root error boundary — the last thing standing.
 *
 * ZERO DEPENDENCIES BY DESIGN. `global-error.tsx` replaces the root layout when
 * the root layout itself threw, so it must render its own <html> and <body> and
 * may not import `globals.css`, a component library, or i18n. Inline styles
 * only.
 *
 * SYSTEM-PROMPT §2.11: exception text leaks internals. Nothing from `error` is
 * rendered — not `error.message`, not `error.stack`, not the full `error.digest`.
 * The only thing shown is a short opaque reference derived from the digest, so
 * a user can quote it and an operator can grep the server log for the matching
 * entry. The digest is already a hash Next computes server-side; truncating it
 * keeps it quotable without turning the page into a fingerprint of the build.
 *
 * Copy is German (the default locale, CONTRACTS §7) with a plain English second
 * line.
 */

const REFERENCE_LENGTH = 8

function toReference(digest: string | undefined): string | null {
  if (typeof digest !== "string") return null
  const trimmed = digest.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, REFERENCE_LENGTH).toUpperCase()
}

const page = {
  minHeight: "100svh",
  display: "grid",
  placeItems: "center",
  margin: 0,
  padding: "24px",
  background: "#ffffff",
  color: "#111111",
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
} as const

const card = {
  width: "min(100%, 34rem)",
  textAlign: "center",
} as const

const heading = {
  margin: 0,
  fontSize: "clamp(1.5rem, 4vw, 2.25rem)",
  lineHeight: 1.15,
  fontWeight: 700,
} as const

const subheading = {
  margin: "0.5rem 0 0",
  fontSize: "1rem",
  lineHeight: 1.6,
  color: "#4a4a4a",
} as const

const reference = {
  margin: "1.25rem 0 0",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  color: "#6b6b6b",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const

const actions = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.75rem",
  justifyContent: "center",
  marginTop: "1.75rem",
} as const

const button = {
  // CONVENTIONS §7 / §5: tap targets ≥ 24px. 44px is the comfortable minimum.
  minHeight: "44px",
  padding: "0 1.25rem",
  border: "1px solid #111111",
  borderRadius: "999px",
  background: "#111111",
  color: "#ffffff",
  fontSize: "0.9375rem",
  fontWeight: 600,
  cursor: "pointer",
} as const

const link = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "44px",
  padding: "0 1.25rem",
  border: "1px solid #111111",
  borderRadius: "999px",
  color: "#111111",
  fontSize: "0.9375rem",
  fontWeight: 600,
  textDecoration: "none",
} as const

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const ref = toReference(error.digest)

  return (
    // `lang="tr"`, the default locale. This replaces the root document
    // entirely, so it cannot know the reader's locale — but asserting German
    // was the one answer guaranteed wrong for the primary audience, and a
    // screen reader was being told to pronounce four languages as German.
    <html lang="tr" dir="ltr">
      <body style={page}>
        <main id="main" style={card}>
          {/* Four languages, Turkish first — same reason as `not-found.tsx`.
              This component replaces the whole document when the root layout
              itself has failed, so there is no `next-intl` provider and no
              locale to read. Rendering all four is the honest answer to having
              none, and an error page is the last place to make somebody read a
              language they do not speak. */}
          <h1 style={heading}>Bir hata oluştu.</h1>
          <p style={subheading}>Something went wrong. Please try again.</p>
          <p style={subheading}>Произошла ошибка.</p>
          <p style={subheading}>Es ist ein Fehler aufgetreten.</p>
          {ref !== null ? (
            <p style={reference}>Referans · reference: {ref}</p>
          ) : null}
          <div style={actions}>
            <button type="button" onClick={() => reset()} style={button}>
              Tekrar dene · Try again
            </button>
            {/* Plain anchor, not next/link: a full reload is the correct
                recovery when the router may itself be the thing that failed.

                `/` and not `/de` — the locale router resolves the reader's
                language from their cookie and Accept-Language, which beats
                ejecting everybody into German. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
            deliberate and argued above: a full navigation is the correct
            recovery when the router may itself be the thing that failed.
            `<Link>` would prefetch and soft-navigate with the same broken
            router. */}
            <a href="/" style={link}>
              Ana sayfa · Home · На главную · Startseite
            </a>
          </div>
        </main>
      </body>
    </html>
  )
}
