import type { MetadataRoute } from "next"

/**
 * The web app manifest.
 *
 * `start_url` is `/de` rather than `/`: CONTRACTS §7 sets `localePrefix:
 * "always"`, so `/` is a redirect, and an installed app whose entry point is a
 * 307 shows a blank frame for the length of that round trip on every cold start.
 *
 * `scope` is `/` so the service worker controls the whole origin — it has to, in
 * order to *refuse* to cache the protected paths (`lib/pwa.ts`). A narrower
 * scope would leave `/de/dashboard/*` outside the worker's control, which sounds
 * safer and is the opposite: an uncontrolled path falls through to the browser's
 * ordinary HTTP cache, which this code cannot govern at all.
 *
 * No screenshots and no shortcuts: both would point at routes that do not exist
 * yet (W3-A owns the landing page), and a manifest referencing a 404 fails
 * installability checks in a way that is tedious to trace.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Azura World Residence & Hotel",
    short_name: "Azura World",
    description:
      "Belegte Wettbewerbsanalyse zu Azura World Residence & Hotel, Türkler · Alanya · Antalya. Jede Zahl mit ihrer Quelle.",
    start_url: "/de",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    lang: "de",
    dir: "ltr",
    // Kept in sync with W1-D's `globals.css` surface tokens by eye, not by
    // import: a manifest is generated at build time and cannot read CSS.
    background_color: "#0b0f14",
    theme_color: "#0b0f14",
    categories: ["business", "productivity"],
    icons: [
      {
        // This pointed at `/favicon.ico`, which **did not exist anywhere in the
        // tree** — not in `app/`, not in `public/`. It was the page's one
        // console 404, and the comment that used to sit here warned against
        // exactly the mistake it was making: "an entry pointing at a missing
        // file is worse than a sparse icon list, because it fails
        // installability silently."
        //
        // `app/icon.svg` is a real file. Next emits the `<link rel="icon">` for
        // it automatically; naming it here as well is what makes the app
        // installable rather than merely tabbed.
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  }
}
