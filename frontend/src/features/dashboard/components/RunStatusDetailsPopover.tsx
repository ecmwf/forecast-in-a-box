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
 * RunStatusDetailsPopover Component
 *
 * Shows job status breakdown in a popover (mirrors StatusDetailsPopover pattern)
 */

import { ArrowRight, Clock, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { JobStatus } from '@/api/types/job.types'
import { useJobStatusCounts } from '@/api/hooks/useJobStatusCounts'
import { getJobStatusVariant } from '@/features/executions/utils/job-status'
import { SummaryPopover } from '@/components/common/SummaryPopover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface RunStatusDetailsPopoverProps {
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
}

/** Statuses always shown regardless of count */
const PRIMARY_STATUSES: ReadonlyArray<JobStatus> = [
  'running',
  'preparing',
  'submitted',
  'completed',
  'failed',
]

interface StatusRowProps {
  status: JobStatus
  count: number
  isLoading?: boolean
  /** When set, the row links directly to this run's detail page. */
  runId?: string
}

function StatusRow({ status, count, isLoading, runId }: StatusRowProps) {
  const variant = getJobStatusVariant(status)
  const dotColor = variant.dotClass
  const rowClass =
    'flex items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50'

  const content = (
    <>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            dotColor,
            status === 'running' && count > 0 && 'animate-pulse',
          )}
        />
        <span className="text-sm">{variant.label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {isLoading ? (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/30" />
        ) : (
          <span className="text-sm font-medium tabular-nums">{count}</span>
        )}
        {runId && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
      </div>
    </>
  )

  // A lone running run links straight to its detail page.
  if (runId) {
    return (
      <Link
        to="/runs/$jobId"
        params={{ jobId: runId }}
        className={rowClass}
      >
        {content}
      </Link>
    )
  }
  return <div className={rowClass}>{content}</div>
}

export function RunStatusDetailsPopover({
  children,
  align = 'end',
  side = 'bottom',
}: RunStatusDetailsPopoverProps) {
  const { t } = useTranslation('dashboard')
  const { counts, total, runningRunId, isLoading, isFetching, refetch } =
    useJobStatusCounts()

  // Determine which statuses to show: primary ones always, others only if count > 0
  const visibleStatuses: Array<JobStatus> = [...PRIMARY_STATUSES]
  for (const status of Object.keys(counts) as Array<JobStatus>) {
    if (!PRIMARY_STATUSES.includes(status) && counts[status] > 0) {
      visibleStatuses.push(status)
    }
  }

  return (
    <SummaryPopover
      trigger={children}
      align={align}
      side={side}
      title={
        <Link
          to="/runs"
          className="flex items-center gap-2 transition-colors hover:text-primary"
        >
          <Clock className="h-4 w-4 text-primary" />
          {t('welcome.stats.executionStatus')}
        </Link>
      }
      headerAction={
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-6 w-6"
        >
          <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
        </Button>
      }
      footer={
        <div className="space-y-2 border-t pt-2">
          <div className="flex items-center justify-between px-2">
            <span className="text-sm font-medium">
              {t('welcome.stats.totalJobs')}
            </span>
            <span className="text-sm font-medium tabular-nums">
              {isLoading ? '...' : total}
            </span>
          </div>
          <Link
            to="/runs"
            className="flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-muted/80"
          >
            {t('welcome.actions.manageExecutions')}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      }
    >
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
                runId={
                  status === 'running' ? (runningRunId ?? undefined) : undefined
                }
              />
            ))}
      </div>
    </SummaryPopover>
  )
}
