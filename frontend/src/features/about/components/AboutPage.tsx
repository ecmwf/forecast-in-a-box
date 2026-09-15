/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Trans, useTranslation } from 'react-i18next'
import type { BlockKind } from '@/api/types/fable.types'
import { BLOCK_KIND_METADATA, getBlockKindIcon } from '@/api/types/fable.types'
import { H1, H2, H3, Link, P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

const DESTINE_URL = 'https://destination-earth.eu'
const ANEMOI_URL = 'https://github.com/ecmwf/anemoi'
const EARTHKIT_URL = 'https://earthkit.ecmwf.int'

/** Each stage of the chain is a blueprint block kind, so reuse the block icons and hues. */
const STEPS: ReadonlyArray<{
  key: 'initialisation' | 'modelRun' | 'productGeneration' | 'dissemination'
  kind: BlockKind
}> = [
  { key: 'initialisation', kind: 'source' },
  { key: 'modelRun', kind: 'transform' },
  { key: 'productGeneration', kind: 'product' },
  { key: 'dissemination', kind: 'sink' },
]

const PARTNER_LOGOS = [
  // Widths compensate for the padding baked into the ECMWF and MET Norway PNGs.
  {
    key: 'ecmwf',
    src: '/logos/org/ECMWF.png',
    href: 'https://www.ecmwf.int',
    size: 'w-48',
  },
  {
    key: 'metNorway',
    src: '/logos/org/MetNorway.png',
    href: 'https://www.met.no',
    size: 'w-44',
  },
  {
    key: 'destinE',
    src: '/logos/org/destine.png',
    href: DESTINE_URL,
    size: 'w-56',
  },
] as const

const TOOL_LOGOS = [
  { key: 'anemoi', src: '/logos/packages/anemoi.webp', href: ANEMOI_URL },
  {
    key: 'earthkit',
    src: '/logos/packages/earthkit-light.svg',
    href: EARTHKIT_URL,
  },
] as const

/** Radial fade so the globe mesh melts into the page. */
const GLOBE_MASK = {
  maskImage:
    'radial-gradient(ellipse 55% 55% at 50% 50%, black 30%, transparent 72%)',
  WebkitMaskImage:
    'radial-gradient(ellipse 55% 55% at 50% 50%, black 30%, transparent 72%)',
} as const

// Same container as the site header so section edges line up with the brand.
const SECTION = 'mx-auto max-w-7xl px-6 lg:px-12'

const PROJECT_LINKS = {
  anemoi: <Link href={ANEMOI_URL} />,
  earthkit: <Link href={EARTHKIT_URL} />,
  destinE: <Link href={DESTINE_URL} />,
}

export function AboutPage() {
  const { t } = useTranslation('landing')

  return (
    <div className="pb-20">
      <section className={`${SECTION} relative overflow-hidden pt-16 md:pt-24`}>
        <img
          src="/logos/ecmwf-globe-mesh.webp"
          alt=""
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-20 w-[560px] opacity-10 select-none dark:opacity-20 dark:invert"
          style={GLOBE_MASK}
        />
        <div className="relative">
          <P className="text-sm font-medium tracking-wide text-primary uppercase">
            {t('about.eyebrow')}
          </P>
          <H1 className="mt-3 text-4xl font-semibold text-balance md:text-5xl">
            {t('hero.subtitle')}
          </H1>
          {/* Two columns keep a readable measure across the full width. */}
          <P className="mt-8 text-lg leading-relaxed text-pretty md:columns-2 md:gap-12">
            <Trans t={t} i18nKey="about.lead" components={PROJECT_LINKS} />
          </P>
        </div>
      </section>

      <section className={`${SECTION} pt-20`}>
        <H2 className="border-0 pb-0 text-2xl">{t('about.box.title')}</H2>
        <P className="mt-2 max-w-2xl text-muted-foreground">
          {t('about.box.subtitle')}
        </P>
        <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ key, kind }, i) => {
            const meta = BLOCK_KIND_METADATA[kind]
            const Icon = getBlockKindIcon(kind)
            return (
              <li key={key} className="space-y-3">
                {/* Kind-coloured rule and tile, as on the canvas nodes. */}
                <div className={cn('h-0.5 rounded-full', meta.topBarColor)} />
                <div
                  className={cn(
                    'inline-flex rounded-lg border p-2.5',
                    meta.bgColor,
                    meta.borderColor,
                  )}
                >
                  <Icon className={cn('h-6 w-6', meta.color)} aria-hidden />
                </div>
                <div>
                  <H3 className="border-0 pb-0 text-base">
                    {t(`about.box.${key}.title`)}
                  </H3>
                  <P className="text-xs text-muted-foreground">
                    {t('about.box.step', { n: i + 1, kind: meta.label })}
                  </P>
                </div>
                <P className="text-sm text-muted-foreground">
                  {t(`about.box.${key}.description`)}
                </P>
              </li>
            )
          })}
        </ol>
      </section>

      <section className={`${SECTION} pt-20`}>
        <H2 className="border-0 pb-0 text-2xl">{t('collaboration.title')}</H2>
        <div className="mt-10 grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {PARTNER_LOGOS.map(({ key, src, href, size }) => (
            <a
              key={key}
              href={href}
              className="flex items-center justify-center px-8 py-5"
            >
              <img
                src={src}
                alt={t(`brand.${key}`)}
                className={cn(size, 'h-auto object-contain')}
              />
            </a>
          ))}
        </div>
        <P className="mt-10 mb-4 text-sm font-semibold tracking-wide text-foreground/70 uppercase">
          {t('about.people.builtWith')}
        </P>
        {/* Same row shape as the partners: hairline cells, logos at one scale. */}
        <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          {TOOL_LOGOS.map(({ key, src, href }) => (
            <a
              key={key}
              href={href}
              className="flex flex-col items-center gap-3 px-8 py-5 text-center"
            >
              <img src={src} alt={t(`brand.${key}`)} className="h-11 w-auto" />
              <P className="max-w-xs text-xs text-muted-foreground">
                {t(`stack.${key}Description`)}
              </P>
            </a>
          ))}
        </div>
      </section>
    </div>
  )
}
