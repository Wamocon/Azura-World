/**
 * Barrel for the i18n layer.
 *
 * The real files are `i18n/routing.ts`, `i18n/request.ts` and
 * `i18n/navigation.ts`. This module exists so that application code has one
 * import specifier to remember (`@/i18n`) and so that the 1Çatı reference's
 * `apps/web/i18n.ts` path keeps meaning the same thing in this repository.
 *
 * `i18n/request.ts` is deliberately NOT re-exported: it is a server-only module
 * loaded by the next-intl plugin, and pulling it through a barrel that client
 * components also import would drag it into the browser bundle.
 */

export { routing, localePrefix, locales, defaultLocale } from "./i18n/routing"
export type { Locale } from "./i18n/routing"
export {
  Link,
  redirect,
  usePathname,
  useRouter,
  getPathname,
} from "./i18n/navigation"
