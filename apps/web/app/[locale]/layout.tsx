import { notFound } from "next/navigation"
import { hasLocale } from "next-intl"
import { NextIntlClientProvider } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import type { ReactNode } from "react"
import { locales, type Locale } from "@/lib/contracts"

/**
 * Locale segment layout.
 *
 * Every localised route in the app is a child of this file. Three jobs:
 *
 * 1. **404 an unknown locale.** `i18n/request.ts` has to fall back to German
 *    for an unrecognised segment — next-intl requires a valid locale back and
 *    throwing there is a 500, not a 404. So the rejection happens here instead:
 *    `/xx/dashboard` calls `notFound()` and renders the real 404. Without this,
 *    a typo'd locale would silently serve German and the broken link would
 *    never be noticed (W1-C brief, "Locale in the 404 path").
 *
 * 2. **Opt into static rendering.** `setRequestLocale` is what lets pages under
 *    this segment be statically rendered instead of forced dynamic by the first
 *    `useTranslations` call. Every page under `[locale]/` should call it too,
 *    with its own awaited `locale`; a layout call alone does not cover them.
 *
 * 3. **Provide messages to client components.** Server components read messages
 *    directly; anything with `"use client"` needs the provider.
 *
 * ## What this file deliberately does NOT do
 *
 * It does not render `<html>` or `<body>`. `app/layout.tsx` is the root layout
 * and owns those (W0-A), and a nested second `<html>` is invalid. That has one
 * visible consequence: **`<html lang>` is still hard-coded to `de`**, so it does
 * not track the active locale yet. Fixing it is a one-line change inside a file
 * this task does not own, and it is filed under "Requests for other windows" in
 * HANDOFF/W1-C.md rather than reached across for (SYSTEM-PROMPT §4.1).
 */

export function generateStaticParams(): Array<{ locale: Locale }> {
  return locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: ReactNode
  // Next 16: `params` is a Promise (CONVENTIONS §1).
  params: Promise<{ locale: string }>
}>) {
  const { locale } = await params

  if (!hasLocale(locales, locale)) {
    notFound()
  }

  setRequestLocale(locale)

  return <NextIntlClientProvider>{children}</NextIntlClientProvider>
}
