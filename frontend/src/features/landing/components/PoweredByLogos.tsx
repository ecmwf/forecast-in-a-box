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
import { Link } from '@/components/base/typography'
import { cn } from '@/lib/utils'

const PROJECTS = [
  {
    key: 'anemoi',
    href: 'https://github.com/ecmwf/anemoi',
    logo: '/logos/packages/anemoi.webp',
  },
  {
    key: 'earthkit',
    href: 'https://earthkit.ecmwf.int',
    logo: '/logos/packages/earthkit-light.svg',
  },
] as const

/** Anemoi and Earthkit logos with one-line descriptions; shared by landing and About. */
export function PoweredByLogos({ spread = false }: { spread?: boolean }) {
  const { t } = useTranslation('landing')
  return (
    <div className="grid w-full grid-cols-2 gap-x-8 gap-y-6">
      {PROJECTS.map(({ key, href, logo }, i) => (
        <div
          key={key}
          // spread: second block hugs the right edge so the pair spans the row
          className={cn(
            'flex flex-col gap-4',
            spread && i > 0 && 'justify-self-end',
          )}
        >
          {/* Fixed logo row keeps both descriptions on one line regardless of logo aspect. */}
          <a href={href} className="flex h-20 items-center">
            <img
              src={logo}
              alt={t(`brand.${key}`)}
              className="max-h-20 w-auto"
            />
          </a>
          <Link href={href} underline={false} color="muted" className="text-sm">
            {t(`stack.${key}Description`)}
          </Link>
        </div>
      ))}
    </div>
  )
}
