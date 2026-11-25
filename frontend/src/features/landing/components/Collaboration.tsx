/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { H2 } from '@/components/base/typography'
import { cn } from '@/lib/utils'

// Hairlines are the 1px gaps showing the border-coloured grid behind;
// multiply blends opaque white logo backgrounds into the hover wash.
const CELL =
  'flex items-center justify-center bg-background p-6 outline-none sm:p-8 lg:p-12 transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset [&_img]:mix-blend-multiply dark:[&_img]:mix-blend-normal'

const CO_DEVELOPERS: ReadonlyArray<{
  key: 'metNorway' | 'fmi'
  href: string
  src: string
  darkSrc?: string
  size: string
}> = [
  {
    key: 'metNorway',
    href: 'https://www.met.no',
    src: '/logos/org/MetNorway.png',
    size: 'w-44',
  },
  {
    key: 'fmi',
    href: 'https://en.ilmatieteenlaitos.fi',
    src: '/logos/org/FMI.png',
    darkSrc: '/logos/org/FMI-dark.png',
    size: 'h-9 w-auto',
  },
]

function PartnerLink({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="nofollow noopener noreferrer"
      className={cn(CELL, className)}
    >
      {children}
    </a>
  )
}

export function Collaboration() {
  const { t } = useTranslation('landing')
  return (
    <section className="bg-zinc-50 py-16 dark:bg-zinc-900">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mx-auto mb-12 max-w-xl text-center text-balance md:mb-16">
          <H2 className="border-0 pb-0 text-4xl">{t('collaboration.title')}</H2>
        </div>
        {/* Initiator on top, co-developers below at a smaller scale. */}
        <div className="mx-auto grid max-w-4xl gap-px border bg-border">
          <PartnerLink href="https://www.ecmwf.int" className="lg:p-8">
            <img
              src="/logos/org/ECMWF.png"
              alt={t('brand.ecmwf')}
              className="w-64 object-contain"
            />
          </PartnerLink>
          {/* flex-wrap keeps the hairline grid hole-free as more join. */}
          <div className="flex flex-wrap gap-px">
            {CO_DEVELOPERS.map(({ key, href, src, darkSrc, size }) => (
              <PartnerLink
                key={key}
                href={href}
                className="flex-1 basis-56 lg:p-8"
              >
                <img
                  src={src}
                  alt={t(`brand.${key}`)}
                  className={cn(
                    'object-contain',
                    size,
                    darkSrc && 'dark:hidden',
                  )}
                />
                {darkSrc && (
                  <img
                    src={darkSrc}
                    alt={t(`brand.${key}`)}
                    className={cn('hidden object-contain dark:block', size)}
                  />
                )}
              </PartnerLink>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
