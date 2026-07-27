/**
 * Root 404.
 *
 * ZERO DEPENDENCIES BY DESIGN. This route renders when the requested path did
 * not resolve — which includes the case where the design system, i18n, or a
 * provider is what failed. No `globals.css`, no component library, no
 * `next/link`, no `next-intl`. Inline styles only.
 *
 * Copy is German (the default locale, CONTRACTS §7) with a plain English second
 * line. Deliberately short: a 404 that needs scrolling is a design failure, and
 * this file must stay translatable-by-nobody — W1-C does not wire i18n here.
 */

const page = {
  minHeight: "100svh",
  display: "grid",
  placeItems: "center",
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

const code = {
  margin: 0,
  fontSize: "0.75rem",
  fontWeight: 700,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "#6b6b6b",
} as const

const heading = {
  margin: "0.75rem 0 0",
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

const link = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  marginTop: "1.75rem",
  // CONVENTIONS §7 / §5: tap targets ≥ 24px. 44px is the comfortable minimum.
  minHeight: "44px",
  padding: "0 1.25rem",
  border: "1px solid #111111",
  borderRadius: "999px",
  color: "#111111",
  fontSize: "0.9375rem",
  fontWeight: 600,
  textDecoration: "none",
} as const

export default function NotFound() {
  return (
    <main id="main" style={page}>
      <div style={card}>
        <p style={code}>404</p>
        <h1 style={heading}>Diese Seite wurde nicht gefunden.</h1>
        <p style={subheading}>This page could not be found.</p>
        {/* Plain anchor, not next/link: a full navigation is the correct
            recovery when the router may itself be the thing that failed. */}
        <a href="/de" style={link}>
          Zur Startseite · Back to start
        </a>
      </div>
    </main>
  )
}
