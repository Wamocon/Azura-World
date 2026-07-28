/**
 * Builds `ProvenanceLabels` from the message catalogue.            Owner: W3-G
 *
 * `ProvenanceValue` (W1-D) takes its strings as a prop rather than reading
 * next-intl itself, which is the right call — it keeps the component usable
 * from a client boundary without a provider. The consequence is that every
 * surface has to assemble the object, and `app/[locale]/kitchen-sink/page.tsx`
 * does it with a hardcoded German literal. That is fine for a demo page and
 * would be a bug on a four-locale public page, so this module does it from the
 * catalogue instead.
 *
 * ## One gap, worked around rather than reached across
 *
 * `SourceChipLabels.tier` needs six tier names and `evidence.tier.*` does not
 * exist in the catalogue — `evidence.*` is W1-C's namespace and W3-G owns
 * `hotel.*` only (ORCHESTRATION §4). The tier names therefore live under
 * `hotel.provenance.tier.*`.
 *
 * That is the wrong long-term home: every surface rendering a SourceChip needs
 * the same six strings, and the second one to need them will either duplicate
 * this block or import from a hotel module. Filed as a request for W1-C in
 * HANDOFF/W3-G.md — moving them to `evidence.tier.*` is a rename, and doing it
 * unilaterally inside someone else's namespace is not.
 */

import type { ProvenanceLabels } from "@/components/evidence/provenance-value"

/** The subset of next-intl's translator this module needs. */
type Translator = (key: string) => string

export function buildProvenanceLabels(
  tEvidence: Translator,
  tHotel: Translator,
): ProvenanceLabels {
  const tier = {
    official: tHotel("provenance.tier.official"),
    developer: tHotel("provenance.tier.developer"),
    hotel: tHotel("provenance.tier.hotel"),
    portal: tHotel("provenance.tier.portal"),
    review: tHotel("provenance.tier.review"),
    press: tHotel("provenance.tier.press"),
  }

  const source = {
    openSource: tEvidence("label.openSource"),
    snapshot: tEvidence("label.snapshot"),
    unreachable: tEvidence("sourceUnreachable"),
    tier,
  }

  return {
    confidence: {
      confirmed: tEvidence("confidenceShort.confirmed"),
      official: tEvidence("confidenceShort.official"),
      single_source: tEvidence("confidenceShort.single_source"),
      conflicted: tEvidence("confidenceShort.conflicted"),
      inferred: tEvidence("confidenceShort.inferred"),
      gap: tEvidence("confidenceShort.gap"),
    },
    conflict: {
      trigger: tEvidence("confidence.conflicted"),
      heading: tEvidence("conflict.title"),
      summary: tHotel("provenance.conflictSummary"),
      displayed: tEvidence("conflict.displayedValue"),
      unresolvedNote: tHotel("provenance.unresolvedNote"),
      close: tHotel("provenance.close"),
      source,
    },
    source,
    gap: tEvidence("confidence.gap"),
    inferred: tEvidence("confidenceShort.inferred"),
    more: tHotel("provenance.more"),
    sources: tEvidence("label.sources"),
  }
}
