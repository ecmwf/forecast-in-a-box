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
  'flex items-center justify-center bg-background p-12 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset [&_img]:mix-blend-multiply dark:[&_img]:mix-blend-normal'

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
        {/* Met institutes fill the first row, EU programmes the second. */}
        <div className="mx-auto grid max-w-4xl auto-rows-fr gap-px border bg-border sm:grid-cols-2 lg:grid-cols-6">
          <PartnerLink href="https://www.ecmwf.int" className="lg:col-span-2">
            <img
              src="/logos/org/ECMWF.png"
              alt={t('brand.ecmwf')}
              className="w-50 object-contain"
            />
          </PartnerLink>
          <PartnerLink href="https://www.met.no" className="lg:col-span-2">
            <img
              src="/logos/org/MetNorway.png"
              alt={t('brand.metNorway')}
              className="w-50 object-contain"
            />
          </PartnerLink>
          <PartnerLink
            href="https://en.ilmatieteenlaitos.fi"
            className="lg:col-span-2"
          >
            <img
              src="/logos/org/FMI.png"
              alt={t('brand.fmi')}
              className="h-14 w-auto dark:hidden"
            />
            <img
              src="/logos/org/FMI-dark.png"
              alt={t('brand.fmi')}
              className="hidden h-14 w-auto dark:block"
            />
          </PartnerLink>
          <PartnerLink
            href="https://destination-earth.eu"
            className="lg:col-span-3"
          >
            <img
              src="/logos/org/destine-fund.png"
              alt={t('brand.destinE')}
              className="w-50 object-contain"
            />
          </PartnerLink>
          {/* ArcX has no logo of its own; its materials set the name in type. */}
          <PartnerLink
            href="https://africa-knowledge-platform.ec.europa.eu/arcx"
            className="flex-col sm:col-span-2 lg:col-span-3"
          >
            <span className="text-3xl font-bold tracking-tight">
              {t('brand.arcx')}
            </span>
            <span className="mt-1 text-center text-xs text-muted-foreground">
              {t('brand.arcxFull')}
            </span>
          </PartnerLink>
        </div>
      </div>
    </section>
  )
}
