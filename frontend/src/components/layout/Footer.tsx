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
import { useStatus } from '@/api/hooks/useStatus'
import { StatusDetailsPopover } from '@/components/common/StatusDetailsPopover'
import { StatusIndicator } from '@/components/common/StatusIndicator'
import { cn, isExternalUrl } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'

const links = [
  {
    title: 'ECMWF',
    href: 'https://www.ecmwf.int/',
  },
  {
    title: 'Destination Earth',
    href: 'https://destination-earth.eu',
  },
  {
    title: 'Help',
    href: '/about', // TODO: Create dedicated help page
  },
  {
    title: 'About',
    href: '/about',
  },
]

export function Footer() {
  const { trafficLightStatus, isLoading } = useStatus()
  const layoutMode = useUiStore((state) => state.layoutMode)

  return (
    <footer
      role="contentinfo"
      className="border-t border-border bg-muted/50 pt-8 sm:pt-12"
    >
      <div
        className={cn(
          'space-y-8 px-6',
          layoutMode === 'boxed' ? 'mx-auto max-w-5xl' : 'mx-auto max-w-7xl',
        )}
      >
        <div className="flex flex-wrap justify-center gap-6 text-sm">
          {links.map((link, index) =>
            isExternalUrl(link.href) ? (
              <a
                key={index}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-foreground/70 duration-150 hover:text-foreground"
              >
                <span>{link.title}</span>
              </a>
            ) : (
              <Link
                key={index}
                to={link.href}
                className="block text-foreground/70 duration-150 hover:text-foreground"
              >
                <span>{link.title}</span>
              </Link>
            ),
          )}
        </div>

        <div className="flex flex-wrap justify-between gap-4 border-t border-border py-6">
          <span className="text-sm text-muted-foreground">
            © European Centre for Medium-Range Weather Forecasts{' '}
          </span>
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
