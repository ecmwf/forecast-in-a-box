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

import { useMemo } from 'react'
import { format } from 'date-fns'
import { ArrowRight, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import type { ReactNode } from 'react'
import { useJobStatusCounts } from '@/api/hooks/useJobStatusCounts'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'

/** Months of history shown in the bar chart. */
const MONTHS = 6

interface JobActivityPopoverProps {
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export function JobActivityPopover({
  children,
  align = 'start',
  side = 'bottom',
}: JobActivityPopoverProps) {
  const { t } = useTranslation('dashboard')
  const { runs } = useJobStatusCounts()

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
      const date = new Date(run.created_at)
      const bucket = byKey.get(`${date.getFullYear()}-${date.getMonth()}`)
      if (bucket) {
        bucket.count += 1
        total += 1
      }
    }
    return { data: buckets, recentTotal: total }
  }, [runs])

  return (
    <Popover>
      <PopoverTrigger
        render={<button type="button" className="h-full cursor-pointer" />}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align={align} side={side} className="w-80">
        <PopoverHeader>
          <PopoverTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            {t('welcome.activity.title')}
          </PopoverTitle>
        </PopoverHeader>

        <p className="mb-2 text-sm text-muted-foreground">
          {t('welcome.activity.summary', { count: recentTotal })}
        </p>

        <div className="h-36 w-full text-muted-foreground">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
            >
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                tick={{ fontSize: 11, fill: 'currentColor' }}
              />
              <Tooltip
                cursor={{ fill: 'var(--muted)' }}
                contentStyle={{
                  borderRadius: '0.5rem',
                  border: '1px solid var(--border)',
                  background: 'var(--popover)',
                  color: 'var(--popover-foreground)',
                  fontSize: '0.75rem',
                }}
              />
              <Bar
                dataKey="count"
                name={t('welcome.activity.title')}
                fill="#10b981"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-2 border-t pt-2">
          <Link
            to="/executions"
            className="flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-muted/80"
          >
            {t('welcome.actions.manageExecutions')}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
