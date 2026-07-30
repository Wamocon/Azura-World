import { getTranslations } from "next-intl/server"

import type { PhotoGalleryLabels } from "./photo-gallery"

/**
 * Resolve the `PhotoGallery` label set once, for any section that mounts one.
 *
 * `counter` and `open` carry literal `{index}`/`{total}` that the gallery
 * replaces itself, so they come through `t.raw` — otherwise next-intl reads the
 * braces as ICU arguments and throws. Importing the label *type* from the
 * `"use client"` gallery is free: types are erased, no client code crosses.
 */
export async function getGalleryLabels(
  locale: string
): Promise<PhotoGalleryLabels> {
  const t = await getTranslations({ locale, namespace: "landing.gallery" })
  return {
    render: t("render"),
    floorplan: t("floorplan"),
    siteplan: t("siteplan"),
    credit: t("credit"),
    stale: t("stale"),
    close: t("close"),
    prev: t("prev"),
    next: t("next"),
    counter: t.raw("counter"),
    open: t.raw("open"),
    alt: t("alt"),
  }
}
