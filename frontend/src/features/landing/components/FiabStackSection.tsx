/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Link as RouterLink } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { PoweredByLogos } from './PoweredByLogos'
import { Button } from '@/components/ui/button.tsx'
import { H3, Link, P } from '@/components/base/typography.tsx'

export function FiabStackSection() {
  const { t } = useTranslation('landing')
  return (
    <section>
      <div className="relative mx-auto max-w-7xl border-x px-3 pt-24 pb-10 md:pt-16 md:pb-20">
        <div className="grid max-md:divide-y md:grid-cols-2 md:divide-x">
          <div className="row-span-2 gap-8 md:pr-12">
            <div className="flex h-full items-center">
              <P className="mx-auto max-w-xl text-balance">
                <Trans
                  t={t}
                  i18nKey="stack.paragraph"
                  components={{
                    destinE: <Link href="https://destination-earth.eu" />,
                    anemoi: <Link href="https://github.com/ecmwf/anemoi" />,
                    earthkit: <Link href="https://earthkit.ecmwf.int" />,
                  }}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="ml-1.5 gap-1 pr-1.5"
                  nativeButton={false}
                  render={
                    <RouterLink to="/about">
                      <span>{t('hero.learnMore')}</span>
                      <ChevronRight className="size-2" />
                    </RouterLink>
                  }
                />
              </P>
            </div>
          </div>
          <div className="row-span-2 grid grid-rows-subgrid gap-8 max-md:pt-12 md:pl-12">
            <H3 className="border-0 pb-0 text-balance">
              {t('stack.poweredBy')}
            </H3>
            <div className="flex h-full items-center">
              <PoweredByLogos />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
