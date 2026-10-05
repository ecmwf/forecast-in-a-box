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
import { H2 } from '@/components/base/typography'
import { cn } from '@/lib/utils'

// Hairlines are the 1px gaps showing the border-coloured grid behind.
const CELL = 'flex items-center justify-center bg-background p-12'

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
          <div className={cn(CELL, 'lg:col-span-2')}>
            <img
              src="/logos/org/ECMWF.png"
              alt={t('brand.ecmwf')}
              className="w-50 object-contain"
            />
          </div>
          <div className={cn(CELL, 'lg:col-span-2')}>
            <img
              src="/logos/org/MetNorway.png"
              alt={t('brand.metNorway')}
              className="w-50 object-contain"
            />
          </div>
          <div className={cn(CELL, 'lg:col-span-2')}>
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
          </div>
          <div className={cn(CELL, 'lg:col-span-3')}>
            <img
              src="/logos/org/destine-fund.png"
              alt={t('brand.destinE')}
              className="w-50 object-contain"
            />
          </div>
          {/* ArcX has no logo of its own; its materials set the name in type. */}
          <div className={cn(CELL, 'flex-col sm:col-span-2 lg:col-span-3')}>
            <span className="text-3xl font-bold tracking-tight">
              {t('brand.arcx')}
            </span>
            <span className="mt-1 text-center text-xs text-muted-foreground">
              {t('brand.arcxFull')}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
