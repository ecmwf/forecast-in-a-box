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
 * ScheduleDetailPage Component
 *
 * Schedule detail view with info cards and paginated runs table.
 */

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useBlockCatalogue, useFable } from '@/api/hooks/useFable'
import {
  useSchedule,
  useScheduleNextRun,
  useScheduleRuns,
  useUpdateSchedule,
} from '@/api/hooks/useSchedules'
import { cronToHumanReadable } from '@/features/schedules/utils/cron'
import { ExecutionCanvas } from '@/features/executions/components/ExecutionCanvas'
import { LoadingSpinner } from '@/components/common'
import { H2, P } from '@/components/base/typography'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

export function ScheduleDetailPage() {
  const { t } = useTranslation('schedules')
  const { scheduleId } = useParams({
    from: '/_authenticated/schedules/$scheduleId',
  })
  const layoutMode = useUiStore((state) => state.layoutMode)
  const [runsPage, setRunsPage] = useState(1)

  const { data: schedule, isLoading, isError } = useSchedule(scheduleId)
  const { data: nextRun } = useScheduleNextRun(scheduleId)
  const { data: runsData } = useScheduleRuns(scheduleId, runsPage, PAGE_SIZE)
  const updateSchedule = useUpdateSchedule()
  const { data: catalogue } = useBlockCatalogue()
  const { data: fableBuilder } = useFable(schedule?.job_definition_id)

  if (isLoading) {
    return (
      <div
        className={cn(
          'mx-auto space-y-8 px-4 py-8 sm:px-6 lg:px-8',
          layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
        )}
      >
        <div className="flex justify-center py-12">
          <LoadingSpinner text={t('list.loading')} />
        </div>
      </div>
    )
  }

  if (isError || !schedule) {
    return (
      <div
        className={cn(
          'mx-auto space-y-8 px-4 py-8 sm:px-6 lg:px-8',
          layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
        )}
      >
        <P className="text-destructive">Schedule not found</P>
      </div>
    )
  }

  const displayName =
    schedule.display_name ||
    `${t('detail.untitledSchedule')} ${scheduleId.slice(0, 8)}`

  const cronDescription = schedule.cron_expr
    ? cronToHumanReadable(schedule.cron_expr)
    : null

  async function handleToggleEnabled() {
    const newEnabled = !schedule!.enabled
    try {
      await updateSchedule.mutateAsync({
        experimentId: scheduleId,
        update: { enabled: newEnabled },
      })
      toast.success(
        newEnabled ? t('actions.enableSuccess') : t('actions.disableSuccess'),
      )
    } catch {
      // Error handled by mutation
    }
  }

  const runs = runsData?.runs ?? []
  const sortedRuns = [...runs].sort((a, b) =>
    b.scheduled_at.localeCompare(a.scheduled_at),
  )
  const totalRunPages = runsData?.total_pages ?? 1

  const hasDynamicExpr = Object.keys(schedule.dynamic_expr).length > 0

  return (
    <div
      className={cn(
        'mx-auto space-y-6 px-4 py-8 sm:px-6 lg:px-8',
        layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/schedules"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('detail.backLink')}
        </Link>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <H2 className="text-xl font-semibold">{displayName}</H2>
          {cronDescription && (
            <P className="text-sm text-muted-foreground">{cronDescription}</P>
          )}
        </div>
        <Button
          variant={schedule.enabled ? 'outline' : 'default'}
          onClick={handleToggleEnabled}
          disabled={updateSchedule.isPending}
        >
          {schedule.enabled ? t('actions.disable') : t('actions.enable')}
        </Button>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <P className="text-sm text-muted-foreground">{t('detail.status')}</P>
          <P className="font-medium">
            {schedule.enabled ? t('detail.enabled') : t('detail.disabled')}
          </P>
        </Card>
        <Card className="p-4">
          <P className="text-sm text-muted-foreground">
            {t('detail.createdAt')}
          </P>
          <P className="font-medium">
            {formatDistanceToNow(new Date(schedule.created_at), {
              addSuffix: true,
            })}
          </P>
        </Card>
        <Card className="p-4">
          <P className="text-sm text-muted-foreground">{t('detail.nextRun')}</P>
          <P className="font-medium">{nextRun || '-'}</P>
        </Card>
        {schedule.created_by && (
          <Card className="p-4">
            <P className="text-sm text-muted-foreground">
              {t('detail.createdBy')}
            </P>
            <P className="font-medium">{schedule.created_by}</P>
          </Card>
        )}
      </div>

      {/* Dynamic expressions */}
      {hasDynamicExpr && (
        <Card className="p-4">
          <P className="mb-2 text-sm font-medium text-muted-foreground">
            {t('detail.dynamicExpressions')}
          </P>
          <pre className="rounded bg-muted p-3 text-sm">
            {JSON.stringify(schedule.dynamic_expr, null, 2)}
          </pre>
        </Card>
      )}

      {/* Configuration overview */}
      {fableBuilder && catalogue && (
        <ExecutionCanvas fable={fableBuilder} catalogue={catalogue} />
      )}

      {/* Runs table */}
      <Card className="overflow-hidden">
        <div className="border-b border-border p-6">
          <H2 className="text-lg font-semibold">{t('detail.runsTitle')}</H2>
        </div>

        <div className="divide-y divide-border">
          {sortedRuns.length > 0 ? (
            sortedRuns.map((run) => (
              <div
                key={run.execution_id}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {new Date(run.scheduled_at).toLocaleString()}
                  </span>
                  <Badge variant="outline" className="text-sm">
                    {t(`trigger.${run.trigger}`)}
                  </Badge>
                  {run.status && (
                    <Badge
                      variant={
                        run.status === 'completed'
                          ? 'default'
                          : run.status === 'failed'
                            ? 'destructive'
                            : 'outline'
                      }
                      className="text-sm"
                    >
                      {run.status}
                    </Badge>
                  )}
                  {run.attempt_count > 1 && (
                    <span className="text-sm text-muted-foreground">
                      {t('detail.attempts')}: {run.attempt_count}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {run.execution_id && (
                    <Link
                      to="/executions/$jobId"
                      params={{ jobId: run.execution_id }}
                      className="font-mono text-sm text-primary hover:underline"
                    >
                      {run.execution_id.slice(0, 12)}...
                    </Link>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="p-12 text-center text-muted-foreground">
              {t('detail.noRuns')}
            </div>
          )}
        </div>

        {totalRunPages > 1 && (
          <div className="border-t border-border p-4 text-center">
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={runsPage <= 1}
                onClick={() => setRunsPage((p) => p - 1)}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                {t('pagination.previous')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('pagination.page', {
                  current: runsPage,
                  total: totalRunPages,
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={runsPage >= totalRunPages}
                onClick={() => setRunsPage((p) => p + 1)}
              >
                {t('pagination.next')}
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
