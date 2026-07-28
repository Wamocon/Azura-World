/**
 * The close: Action → Like/Loyalty → Share → Love.                   Owner: W3-A
 *
 * Four short sections, one file. They share a register — this is the part of
 * the page that talks about the analysis rather than the property — and keeping
 * them together is what stops each of them growing into a full section it does
 * not have the content to fill.
 *
 * No figure appears here that is not already sourced above. A closing section
 * that introduces a new number is a closing section that introduces an
 * unsourced number.
 */

import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"

import { Link } from "@/app/navigation"
import { Reveal } from "@/components/anim/reveal"
import { Container, Section } from "@/components/azura/section"
import { ShareLink } from "@/components/azura/share-link"

export async function ActionSection({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  return (
    <Section
      id="access"
      designation={t("designation.action")}
      title={t("action.title")}
      lead={t("action.lead")}
    >
      <Container className="px-0 sm:px-0">
        <Reveal className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link
            href="/login"
            className="azura-tap inline-flex items-center rounded-full bg-accent px-6 text-[0.9375rem] font-semibold text-accent-foreground transition-transform duration-[var(--duration-instant)] ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] active:scale-[0.97]"
          >
            {t("action.cta")}
          </Link>
          <Link
            href="/#evidence"
            className="azura-tap inline-flex items-center text-[0.9375rem] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            {t("action.secondary")}
          </Link>
        </Reveal>
      </Container>
    </Section>
  )
}

/**
 * What the system does after the sale — named as three things it actually
 * carries, not three adjectives. A section that restates its own lead in
 * different words adds length, not substance; this one had exactly that
 * problem in the first build and the fix was content, not spacing.
 *
 * A definition list rather than three cards: cards are the lazy container, and
 * these are term-and-description pairs, which is what a `<dl>` is for.
 */
export async function AfterSection({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  const items = ["1", "2", "3"] as const

  return (
    <Section
      id="after"
      designation={t("designation.loyalty")}
      title={t("after.title")}
      lead={t("after.lead")}
    >
      <Container className="px-0 sm:px-0">
        <Reveal>
          <dl className="grid gap-x-12 gap-y-8 sm:grid-cols-3">
            {items.map((key) => (
              <div key={key} className="flex min-w-0 flex-col gap-2">
                <dt className="border-t border-foreground/20 pt-3 font-display text-[1.0625rem] leading-[1.25] tracking-[-0.01em]">
                  {t(`after.items.${key}.title`)}
                </dt>
                <dd className="text-[0.9375rem] leading-[1.6] text-muted-foreground">
                  {t(`after.items.${key}.body`)}
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </Container>
    </Section>
  )
}

export async function ShareSection({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  return (
    <Section
      id="share"
      designation={t("designation.share")}
      title={t("share.title")}
      lead={t("share.lead")}
    >
      <Container className="px-0 sm:px-0">
        <Reveal>
          <ShareLink
            copyLabel={t("share.copyLink")}
            copiedLabel={t("share.linkCopied")}
          />
        </Reveal>
      </Container>
    </Section>
  )
}

/**
 * Love, in this register, is not a photograph of a sunset. It is the sentence
 * that explains why the page is built the way it is — which for this audience
 * is the thing that earns the return visit.
 */
export async function LoveSection({
  locale,
}: {
  locale: string
}): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: "landing" })
  return (
    <Section id="why-built" designation={t("designation.love")}>
      <Container className="px-0 sm:px-0">
        <Reveal>
          <p className="max-w-[30ch] font-display text-[clamp(1.75rem,5vw,3rem)] leading-[1.12] tracking-[-0.03em] text-balance">
            {t("love.title")}
          </p>
          <p className="mt-6 max-w-[62ch] text-[1.0625rem] leading-[1.65] text-muted-foreground">
            {t("love.lead")}
          </p>
        </Reveal>
      </Container>
    </Section>
  )
}
