/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Monthly forecast-activity bar chart shown from the "Total Forecasts" stat card. */

import { Suspense, lazy, useMemo } from 'react'
import { format } from 'date-fns'
import { ArrowRight, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useJobStatusCounts } from '@/api/hooks/useJobStatusCounts'
import { useServerTime } from '@/api/hooks/useSchedules'
import { SummaryPopover } from '@/components/common/SummaryPopover'

// Keep `recharts` out of the dashboard chunk — only fetched when the popover opens.
const RunActivityChart = lazy(() => import('./RunActivityChart'))

/** Months of history shown in the bar chart. */
const MONTHS = 6

interface RunActivityPopoverProps {
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export function RunActivityPopover({
  children,
  align = 'start',
  side = 'bottom',
}: RunActivityPopoverProps) {
  const { t } = useTranslation('dashboard')
  const { runs } = useJobStatusCounts()
  const { serverTimeToLocal } = useServerTime()

  const { data, recentTotal } = useMemo(() => {
    const now = new Date()
    const buckets = Array.from({ length: MONTHS }, (_, index) => {
      const date = new Date(
        now.getFullYear(),
        now.getMonth() - (MONTHS - 1 - index),
        1,
      )
      return {
        key: `${date.getFullYear()}-${date.getMonth()}`,
        month: format(date, 'MMM'),
        count: 0,
      }
    })
    const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]))
    let total = 0
    for (const run of runs) {
      // created_at is naive server-local — correct it before bucketing.
      const date = serverTimeToLocal(run.created_at)
      const bucket = byKey.get(`${date.getFullYear()}-${date.getMonth()}`)
      if (bucket) {
        bucket.count += 1
        total += 1
      }
    }
    return { data: buckets, recentTotal: total }
  }, [runs, serverTimeToLocal])

  return (
    <SummaryPopover
      trigger={children}
      align={align}
      side={side}
      contentClassName="w-80"
      title={
        <>
          <TrendingUp className="h-4 w-4 text-primary" />
          {t('welcome.activity.title')}
        </>
      }
      footer={
        <div className="mt-2 border-t pt-2">
          <Link
            to="/executions"
            className="flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-muted/80"
          >
            {t('welcome.actions.manageExecutions')}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      }
    >
      <p className="mb-2 text-sm text-muted-foreground">
        {t('welcome.activity.summary', { count: recentTotal })}
      </p>

      <Suspense
        fallback={
          <div className="h-36 w-full animate-pulse rounded bg-muted" />
        }
      >
        <RunActivityChart
          data={data}
          seriesName={t('welcome.activity.title')}
        />
      </Suspense>
    </SummaryPopover>
  )
}
