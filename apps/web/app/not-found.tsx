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
        {/* Four languages, Turkish first.

            This file sits ABOVE `[locale]`, so it has no locale and no
            `next-intl` provider — which is why it was written in German with an
            English subtitle. The consequence: `/tr/nope` returned
            `<html lang="tr">` wrapping German prose, and so did `/ru/nope`. A
            mistyped or stale URL is a routine event and the recovery page is
            exactly where a lost reader needs their own language.

            Rendering all four is the honest answer to having none: it costs
            three short lines, it is correct for every reader, and it does not
            require guessing a locale from a URL that is by definition wrong.
            Turkish leads because it is the default locale. */}
        <p style={code}>404</p>
        <h1 style={heading}>Bu sayfa bulunamadı.</h1>
        <p style={subheading}>This page could not be found.</p>
        <p style={subheading}>Эта страница не найдена.</p>
        <p style={subheading}>Diese Seite wurde nicht gefunden.</p>
        {/* Plain anchor, not next/link: a full navigation is the correct
            recovery when the router may itself be the thing that failed.

            `/` and not `/de`. The hardcoded German homepage ejected a Turkish
            or Russian reader into a language they had not chosen, losing the
            locale on the one screen where they are already lost. `/` is the
            locale router — `proxy.ts` resolves it from the cookie and the
            Accept-Language header, which is a better guess than any constant. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
        deliberate and argued above: a full navigation is the correct recovery
        when the router may itself be the thing that failed. `<Link>` would
        prefetch and soft-navigate with the same broken router. */}
        <a href="/" style={link}>
          Ana sayfa · Home · На главную · Startseite
        </a>
      </div>
    </main>
  )
}
