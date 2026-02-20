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
 * JobStatusDetailsPopover Component
 *
 * Shows job status breakdown in a popover (mirrors StatusDetailsPopover pattern)
 */

import { Clock, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { JobStatus } from '@/api/types/job.types'
import { JOB_STATUS_META } from '@/api/types/job.types'
import { useJobStatusCounts } from '@/api/hooks/useJobStatusCounts'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface JobStatusDetailsPopoverProps {
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
}

const statusDotColors: Record<string, string> = {
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  green: 'bg-emerald-500',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  gray: 'bg-gray-400',
}

/** Statuses always shown regardless of count */
const PRIMARY_STATUSES: ReadonlyArray<JobStatus> = [
  'running',
  'submitted',
  'completed',
  'errored',
]

interface StatusRowProps {
  status: JobStatus
  count: number
  isLoading?: boolean
}

function StatusRow({ status, count, isLoading }: StatusRowProps) {
  const meta = JOB_STATUS_META[status]
  const dotColor = statusDotColors[meta.color] ?? 'bg-gray-400'

  return (
    <div className="flex items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            dotColor,
            status === 'running' && count > 0 && 'animate-pulse',
          )}
        />
        <span className="text-sm">{meta.label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {isLoading ? (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/30" />
        ) : (
          <span className="text-sm font-medium tabular-nums">{count}</span>
        )}
      </div>
    </div>
  )
}

export function JobStatusDetailsPopover({
  children,
  align = 'end',
  side = 'bottom',
}: JobStatusDetailsPopoverProps) {
  const { t } = useTranslation('dashboard')
  const { counts, total, isLoading, isFetching, refetch } = useJobStatusCounts()

  // Determine which statuses to show: primary ones always, others only if count > 0
  const visibleStatuses: Array<JobStatus> = [...PRIMARY_STATUSES]
  for (const status of Object.keys(counts) as Array<JobStatus>) {
    if (!PRIMARY_STATUSES.includes(status) && counts[status] > 0) {
      visibleStatuses.push(status)
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        render={<button type="button" className="h-full cursor-pointer" />}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align={align} side={side} className="w-64">
        <PopoverHeader>
          <div className="flex items-center justify-between">
            <PopoverTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              {t('welcome.stats.executionStatus')}
            </PopoverTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-6 w-6"
            >
              <RefreshCw
                className={cn('h-3 w-3', isFetching && 'animate-spin')}
              />
            </Button>
          </div>
        </PopoverHeader>

        <div className="space-y-1">
          {isLoading
            ? PRIMARY_STATUSES.map((status) => (
                <StatusRow key={status} status={status} count={0} isLoading />
              ))
            : visibleStatuses.map((status) => (
                <StatusRow
                  key={status}
                  status={status}
                  count={counts[status]}
                />
              ))}
        </div>

        <div className="border-t pt-2">
          <div className="flex items-center justify-between px-2">
            <span className="text-sm font-medium">
              {t('welcome.stats.totalJobs')}
            </span>
            <span className="text-sm font-medium tabular-nums">
              {isLoading ? '...' : total}
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
