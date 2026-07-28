/**
 * robots.txt.                                                        Owner: W3-A
 *
 * The public landing surface is indexable in all four locales. Everything
 * behind the session — the dashboard, the login flow, the API — is not, and
 * `/api/` is disallowed rather than merely noindexed because a crawler hitting
 * the AI routes would burn a rate limit for nothing.
 *
 * This is a route handler, so `proxy.ts` does not match it and it carries no
 * CSP. That is correct: there is no script in a text file.
 */

import type { MetadataRoute } from "next"

import { publicEnv } from "@/lib/env"

const SITE_URL = publicEnv.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3200"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/de/dashboard", "/en/dashboard", "/tr/dashboard", "/ru/dashboard", "/de/login", "/en/login", "/tr/login", "/ru/login"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
