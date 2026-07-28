/**
 * Locale-aware navigation primitives.
 *
 * Import `Link`, `redirect`, `usePathname`, `useRouter` and `getPathname` from
 * here (or from the `@/app/navigation` re-export) rather than from `next/link`
 * and `next/navigation`. These variants know about the locale prefix, so
 * `<Link href="/dashboard">` resolves to `/de/dashboard` without any caller
 * having to concatenate the locale — which is exactly the concatenation that
 * produces `/en/en/dashboard` when someone gets it wrong.
 *
 * `usePathname()` from here returns the path WITHOUT the locale prefix. That is
 * the property `components/locale-switcher.tsx` depends on.
 */

import { createNavigation } from "next-intl/navigation"
import { routing } from "./routing"

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing)
