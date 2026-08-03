import { getTranslations } from "next-intl/server"

import type { ExplainLabels } from "@/components/ui/explain"

/**
 * The glossary, resolved once per surface.                     Owner: W-NIGHT
 *
 * Every term the product uses that a property manager is not obliged to know.
 * `messages/*.json → glossary.*` holds the plain-language copy in four locales;
 * this turns a term key into the `ExplainLabels` bag `<Explain>` takes.
 *
 * Importing the label *type* from the `"use client"` component is free — types
 * are erased, so no client code crosses into a Server Component here.
 */

export const GLOSSARY_TERMS = [
  "modelled",
  "realListing",
  "official",
  "sourceMissing",
  "notStated",
  "confirmed",
  "conflicted",
  "singleSource",
  "inferred",
  "gap",
  "sla",
  // Read by the "report a problem" form. People hear "priority" as "how annoyed
  // am I", and then feel cheated when `urgent` does not summon anyone faster.
  // The entry says what each level actually commits the building to.
  "priority",
  "provenance",
  "dataQuality",
  "available",
  "reserved",
  "sold",
] as const

export type GlossaryTerm = (typeof GLOSSARY_TERMS)[number]

/** Every term, keyed, ready to hand to `<Explain>`. */
export type Glossary = Record<GlossaryTerm, ExplainLabels>

export async function getGlossary(locale: string): Promise<Glossary> {
  const t = await getTranslations({ locale, namespace: "glossary" })
  // `ariaLabel` carries `{term}`; read it raw once and substitute per entry
  // rather than paying an ICU parse for each of the sixteen.
  const ariaTemplate = t.raw("ariaLabel") as string

  const entries = GLOSSARY_TERMS.map((key): [GlossaryTerm, ExplainLabels] => {
    const term = t(`${key}.term` as "modelled.term")
    return [
      key,
      {
        term,
        body: t(`${key}.body` as "modelled.body"),
        ariaLabel: ariaTemplate.replace("{term}", term),
      },
    ]
  })

  return Object.fromEntries(entries) as Glossary
}

/** The glossary term that explains a unit's `dataQuality`. */
export function termForDataQuality(
  quality: "portal_listing" | "official" | "modelled" | "source_missing"
): GlossaryTerm {
  switch (quality) {
    case "portal_listing":
      return "realListing"
    case "official":
      return "official"
    case "modelled":
      return "modelled"
    default:
      return "sourceMissing"
  }
}

/** The glossary term that explains a unit's sale status. */
export function termForSaleStatus(
  status: "available" | "reserved" | "sold" | "unknown" | null
): GlossaryTerm {
  switch (status) {
    case "available":
      return "available"
    case "reserved":
      return "reserved"
    case "sold":
      return "sold"
    default:
      return "notStated"
  }
}
