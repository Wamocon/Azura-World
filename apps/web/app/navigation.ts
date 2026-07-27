/**
 * `@/app/navigation` — the import path every component uses for locale-aware
 * navigation. Mirrors `D:\Real Estate CRM\Cati\apps\web\app\navigation.ts` so
 * that a component moved between the two repositories keeps compiling.
 *
 * There is no logic here on purpose. The configuration lives in
 * `i18n/routing.ts`; this file only re-exports, so there is exactly one place
 * where `localePrefix` is decided.
 */

export {
  Link,
  redirect,
  usePathname,
  useRouter,
  getPathname,
} from "@/i18n/navigation"

export { locales, defaultLocale, localePrefix } from "@/i18n/routing"
export type { Locale } from "@/i18n/routing"
