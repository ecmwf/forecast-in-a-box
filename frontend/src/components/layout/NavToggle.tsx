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
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/dashboard', labelKey: 'nav.overview' },
  { to: '/configure', labelKey: 'nav.configuration' },
  { to: '/executions', labelKey: 'nav.executions' },
] as const

export function NavToggle() {
  const { t } = useTranslation('common')

  return (
    <nav
      aria-label={t('nav.label')}
      className="inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1"
    >
      {navItems.map(({ to, labelKey }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ includeSearch: false }}
          className={cn(
            'rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors',
            'hover:bg-background/50',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
          )}
          activeProps={{
            className:
              'bg-background text-foreground shadow-sm hover:bg-background',
            'aria-current': 'page',
          }}
        >
          {t(labelKey)}
        </Link>
      ))}
    </nav>
  )
}
