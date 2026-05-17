/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useStatus } from '@/api/hooks/useStatus'
import { StatusDetailsPopover } from '@/components/common/StatusDetailsPopover'
import { StatusIndicator } from '@/components/common/StatusIndicator'
import { cn, isExternalUrl } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'

// Partner logos for the footer band. The SVGs are white-fill, so the footer
// keeps a fixed navy background regardless of theme; per-logo heights balance
// the wide ECMWF/DestinE wordmarks against the taller WMO emblem.
const partnerLogos = [
  {
    src: '/logos/ecmwf.svg',
    altKey: 'footer.logoEcmwf',
    href: 'https://www.ecmwf.int/',
    className: 'h-9',
  },
  {
    src: '/logos/destination_earth_logo.svg',
    altKey: 'footer.logoDestinationEarth',
    href: 'https://destination-earth.eu',
    className: 'h-8',
  },
  {
    src: '/logos/wmo.svg',
    altKey: 'footer.logoWmo',
    href: 'https://wmo.int',
    className: 'h-14',
  },
] as const

const links = [
  {
    titleKey: 'footer.help',
    href: '/about', // TODO: Create dedicated help page
  },
  {
    titleKey: 'footer.about',
    href: '/about',
  },
] as const

export function Footer() {
  const { trafficLightStatus, isLoading } = useStatus()
  const layoutMode = useUiStore((state) => state.layoutMode)
  const { t } = useTranslation('common')

  return (
    <footer
      role="contentinfo"
      className="bg-[#0e1f44] text-white dark:bg-[#0c1730]"
    >
      <div
        className={cn(
          'px-6',
          layoutMode === 'boxed' ? 'mx-auto max-w-5xl' : 'mx-auto max-w-7xl',
        )}
      >
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-8 py-10 md:justify-between">
          {partnerLogos.map((logo) => (
            <a
              key={logo.altKey}
              href={logo.href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-sm opacity-90 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
            >
              <img
                src={logo.src}
                alt={t(logo.altKey)}
                className={cn('block w-auto', logo.className)}
              />
            </a>
          ))}
        </div>

        <div className="flex flex-wrap justify-center gap-6 border-t border-white/10 py-6 text-sm">
          {links.map((link) =>
            isExternalUrl(link.href) ? (
              <a
                key={link.titleKey}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-white/70 duration-150 hover:text-white"
              >
                <span>{t(link.titleKey)}</span>
              </a>
            ) : (
              <Link
                key={link.titleKey}
                to={link.href}
                className="block text-white/70 duration-150 hover:text-white"
              >
                <span>{t(link.titleKey)}</span>
              </Link>
            ),
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 py-6">
          <span className="text-sm text-white/60">{t('footer.copyright')}</span>
          {!isLoading && (
            <StatusDetailsPopover side="top">
              <StatusIndicator
                status={trafficLightStatus}
                variant="badge"
                size="sm"
                showPulse
              />
            </StatusDetailsPopover>
          )}
        </div>
      </div>
    </footer>
  )
}
