import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { Container, Section } from "@/components/azura/section"

/**
 * "What happens when the sources disagree" — the argument, animated.
 *                                                          Owner: W-CINEMA-3
 *
 * ## Why this section exists
 *
 * The page states its central claim in prose several times: we keep the
 * disagreement, we never average, a superseded reading stays visible. Prose is
 * the weakest way to make that claim, because every property site claims to be
 * trustworthy and the reader has no reason to believe this one.
 *
 * So this section does not describe it. It performs it, on the real F-002
 * observations, and lets the reader watch a confident figure get retracted.
 *
 * A visitor scrolls; a portal listing appears; a fact is drawn from it and
 * reads as settled. Then a second portal appears with a figure two and a half
 * times higher, and the first fact is struck through in place while the
 * replacements build underneath it. Nothing is hidden and nothing is smoothed:
 * the retraction is the thing being shown.
 *
 * ## The static page is the complete page
 *
 * Every stage, every fact and every strike-through is in the server-rendered
 * markup, in its FINAL state. `landing-choreography.tsx` does not build this
 * section, it only delays it: the strike lines start at `scaleX(1)` and the
 * stages at full opacity, and the choreography sets them back and plays them
 * forward only when it runs.
 *
 * That ordering matters and is the opposite of the usual one. Animating from a
 * hidden initial state means no-JS and reduced-motion readers get an empty
 * column, which azura-ui-ux §5.1 rejects outright. Starting from the finished
 * state means the worst case is a page that does not move.
 *
 * ## The strike is a transform
 *
 * `text-decoration: line-through` cannot be animated, and §4 forbids animating
 * width. So a superseded fact carries an absolutely positioned hairline that
 * scales on the x axis from its left edge. Transform only, compositor only.
 *
 * ## Every figure here is real
 *
 * The ranges, the publisher names, the count of observations and the 2.8×
 * spread are F-002 as the dataset records it. This section would be worthless
 * with invented numbers, since its entire subject is not inventing numbers.
 */

/** One fact drawn from a source. `superseded` ones are struck, never removed. */
interface LedgerFact {
  text: string
  superseded?: boolean
}

interface LedgerStage {
  /** The publisher whose page this reading came from. */
  source: string
  /** What that page said. */
  claim: string
  /** What the system recorded as a result. */
  facts: LedgerFact[]
}

function SourceCard({
  source,
  claim,
  index,
}: {
  source: string
  claim: string
  index: number
}): ReactNode {
  return (
    <div
      data-cine-ledger-card
      className="rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--foreground)_12%,transparent)] bg-[var(--card)] p-4 sm:p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="azura-label text-muted-foreground">{source}</span>
        <span
          data-numeric
          aria-hidden="true"
          className="font-mono text-[0.6875rem] text-muted-foreground/70"
        >
          {String(index).padStart(2, "0")}
        </span>
      </div>
      <p className="mt-2 text-[0.9375rem] leading-[1.5] text-foreground">
        {claim}
      </p>
    </div>
  )
}

function Fact({ fact }: { fact: LedgerFact }): ReactNode {
  return (
    <li
      data-cine-ledger-fact
      data-superseded={fact.superseded ? "true" : undefined}
      className="relative flex items-start gap-2.5 py-1.5"
    >
      <span
        aria-hidden="true"
        className={
          fact.superseded
            ? "mt-[0.55rem] size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
            : "mt-[0.55rem] size-1.5 shrink-0 rounded-full bg-primary"
        }
      />
      <span className="relative">
        <span
          className={
            fact.superseded
              ? "text-[0.9375rem] leading-[1.55] text-muted-foreground"
              : "text-[0.9375rem] leading-[1.55] text-foreground"
          }
        >
          {fact.text}
        </span>
        {/* The retraction. A hairline that scales from the left rather than a
            `line-through`, because a text decoration cannot be animated and a
            width cannot be animated either. Rendered at full scale so a static
            page shows the fact already struck; the choreography rewinds it. */}
        {fact.superseded ? (
          <span
            data-cine-ledger-strike
            aria-hidden="true"
            className="absolute top-1/2 left-0 h-px w-full origin-left bg-muted-foreground/60"
          />
        ) : null}
      </span>
    </li>
  )
}

export async function LedgerSection({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing.ledger" })

  const stages: LedgerStage[] = [
    {
      source: t("stages.first.source"),
      claim: t("stages.first.claim"),
      facts: [{ text: t("stages.first.fact") }],
    },
    {
      source: t("stages.second.source"),
      claim: t("stages.second.claim"),
      facts: [
        { text: t("stages.first.fact"), superseded: true },
        { text: t("stages.second.facts.disagree") },
        { text: t("stages.second.facts.range") },
        { text: t("stages.second.facts.factor") },
        { text: t("stages.second.facts.currency") },
      ],
    },
  ]

  return (
    <Section
      id="ledger"
      designation={t("designation")}
      title={t("title")}
      lead={t("lead")}
    >
      <Container className="px-0 sm:px-0">
        <div
          data-cine-ledger
          className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16"
        >
          {/* The claim. Sticky on wide screens so it holds while the evidence
              beside it moves, which is the whole point of the pairing: the
              sentence stays still and the thing it describes happens. */}
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="max-w-[46ch] text-[1.0625rem] leading-[1.65] text-muted-foreground sm:text-[1.125rem]">
              {t("body")}
            </p>
            <p className="mt-5 max-w-[46ch] text-[1.0625rem] leading-[1.65] text-muted-foreground sm:text-[1.125rem]">
              {t("bodyTwo")}
            </p>
            <p className="mt-7 border-l-2 border-confidence-conflicted/60 pl-4 text-[0.9375rem] leading-[1.6] text-foreground">
              {t("pull")}
            </p>
          </div>

          <div className="flex flex-col gap-8">
            {stages.map((stage, i) => (
              <div
                key={stage.source}
                data-cine-ledger-stage
                className="flex flex-col gap-4"
              >
                <SourceCard
                  source={stage.source}
                  claim={stage.claim}
                  index={i + 1}
                />
                <div className="pl-1">
                  <p className="azura-label text-muted-foreground">
                    {t("recorded")}
                  </p>
                  <ul className="mt-2">
                    {stage.facts.map((fact) => (
                      <Fact key={fact.text} fact={fact} />
                    ))}
                  </ul>
                </div>
              </div>
            ))}

            {/* Where it ends up: a numbered finding, not a resolution. */}
            <div
              data-cine-ledger-stage
              className="rounded-[var(--radius)] border border-confidence-conflicted/40 bg-[color-mix(in_srgb,var(--confidence-conflicted)_7%,transparent)] p-4 sm:p-5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="azura-label text-confidence-conflicted">
                  {t("finding.tag")}
                </span>
                <span className="azura-label text-muted-foreground">
                  {t("finding.severity")}
                </span>
              </div>
              <p className="mt-2 text-[0.9375rem] leading-[1.55] text-foreground">
                {t("finding.message")}
              </p>
              <p className="mt-3 text-[0.875rem] leading-[1.5] text-muted-foreground">
                {t("finding.resolution")}
              </p>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  )
}
