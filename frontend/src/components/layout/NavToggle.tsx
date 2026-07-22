/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Primary section nav (Overview / Configure / Runs / Visualise). On a run
 * detail page the open run appears as a breadcrumb child of Runs.
 */

import {
  ChevronRight,
  Earth,
  FileText,
  LayoutDashboard,
  Play,
  SlidersHorizontal,
} from 'lucide-react'
import { Link, useParams } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useFableRetrieve } from '@/api/hooks/useFable'
import { useJobStatus } from '@/api/hooks/useJobs'
import { useComparisonCount } from '@/features/visualise/stores/comparisonStore'
import { cn } from '@/lib/utils'

const navItems = [
  {
    to: '/overview',
    labelKey: 'nav.overview',
    Icon: LayoutDashboard,
    exact: false,
  },
  {
    to: '/configure',
    labelKey: 'nav.configuration',
    Icon: SlidersHorizontal,
    exact: false,
  },
  // Exact: an open run highlights the run item, not this one — "Execute" stays a link to the list.
  { to: '/execute', labelKey: 'nav.executions', Icon: Play, exact: true },
] as const

const itemClass = cn(
  'inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors',
  'hover:bg-background/50',
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
)

const activeItemClass =
  'bg-background text-foreground shadow-sm hover:bg-background'

/**
 * The open run, rendered as a breadcrumb child of Runs (chevron + compact
 * muted style) so it doesn't read as another main tab.
 */
function RunNavItem({ jobId }: { jobId: string }) {
  const { data: jobData } = useJobStatus(jobId)
  const { data: fableData } = useFableRetrieve(jobData?.blueprint_id)
  const label = fableData?.display_name?.trim() || jobId.slice(0, 8)

  return (
    <span className="flex min-w-0 items-center">
      <ChevronRight
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
      />
      <Link
        to="/execute/$jobId"
        params={{ jobId }}
        activeOptions={{ includeSearch: false }}
        className={cn(itemClass, 'max-w-40 gap-1 px-2 text-xs')}
        activeProps={{ className: activeItemClass, 'aria-current': 'page' }}
      >
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate" title={label}>
          {label}
        </span>
      </Link>
    </span>
  )
}

/**
 * Permanent Visualise item; the badge shows the source-basket count. The
 * count subscription lives in this leaf so basket changes re-render one
 * link, not the whole nav.
 */
function VisualiseNavItem() {
  const { t } = useTranslation('common')
  const count = useComparisonCount()
  return (
    <Link
      to="/visualise"
      activeOptions={{ includeSearch: false }}
      className={itemClass}
      activeProps={{ className: activeItemClass, 'aria-current': 'page' }}
    >
      <Earth className="h-4 w-4" />
      {t('nav.visualise')}
      {count > 0 && (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums">
          {count}
        </span>
      )}
    </Link>
  )
}

export function NavToggle() {
  const { t } = useTranslation('common')
  // `jobId` is only present on the /runs/$jobId route.
  const { jobId } = useParams({ strict: false })

  return (
    <nav
      aria-label={t('nav.label')}
      className="inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1"
    >
      {navItems.map(({ to, labelKey, Icon, exact }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ includeSearch: false, exact }}
          className={itemClass}
          activeProps={{ className: activeItemClass, 'aria-current': 'page' }}
        >
          <Icon className="h-4 w-4" />
          {t(labelKey)}
        </Link>
      ))}
      {/* Child of Runs (last static item) — before the Visualise tab. */}
      {jobId && <RunNavItem jobId={jobId} />}
      <VisualiseNavItem />
    </nav>
  )
}
