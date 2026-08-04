import { FlaskConical } from "lucide-react"
import { getTranslations } from "next-intl/server"

import type { Locale } from "@/lib/contracts"
import { countDemonstrationRecords } from "@/lib/demo-data"

/**
 * "This activity is demonstration data." Said once, on every dashboard page.
 *                                                             Owner: W-NIGHT
 *
 * ## Why this exists
 *
 * The landing page tells every visitor: "The units, blocks and hotel rooms are
 * your own. The activity inside them is sample data: reports, entries and
 * documents were created for this demonstration and **are marked as sample data
 * throughout the system**."
 *
 * They were not. Eighteen dashboard pages carry a `seedNotice`, and every one of
 * them is gated on the repository returning `source === "local-seed"` — the
 * in-code fallback used when Supabase is *unconfigured*. Supabase is configured,
 * so the branch is dead and nothing was marked. A finance ledger, a compliance
 * register, a buyer pipeline with forecast probabilities and a document vault,
 * all fixtures, all presented as records.
 *
 * The promise is what makes the unmarked data dangerous. A reader who has been
 * told fixtures are labelled will reasonably read an unlabelled figure as real.
 *
 * ## Why in the shell and not per page
 *
 * Because the claim is "throughout the system", and eighteen separately-wired
 * notices is how it came to be true in eighteen places and false in the product.
 * One component, mounted once, cannot drift out of sync with itself.
 *
 * ## Why it counts rather than asserts
 *
 * Every seeded row carries `metadata.demo = true`. This reads that, so the line
 * disappears by itself the day real operational data replaces the fixtures —
 * rather than becoming the next stale claim somebody has to find. A hardcoded
 * `true` here would be the same defect in a different place.
 */
export async function DemonstrationDataNotice({
  locale,
}: {
  locale: Locale
}): Promise<React.JSX.Element | null> {
  const demonstration = await countDemonstrationRecords()
  if (demonstration === null || demonstration.records === 0) return null

  const t = await getTranslations({ locale, namespace: "dashboard.common" })

  return (
    <p
      role="status"
      className="mb-6 flex items-start gap-2.5 rounded-lg border border-confidence-single/30 bg-confidence-single/5 px-3.5 py-2.5 text-sm leading-relaxed text-muted-foreground"
    >
      <FlaskConical
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-confidence-single"
      />
      <span>{t("demonstrationData")}</span>
    </p>
  )
}
