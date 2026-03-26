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
import {
  ArrowLeft,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Pencil,
  Search,
  User,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useBlockCatalogue, useFable } from '@/api/hooks/useFable'
import {
  useSchedule,
  useScheduleNextRun,
  useScheduleRuns,
  useServerTime,
  useUpdateSchedule,
} from '@/api/hooks/useSchedules'
import {
  cronToHumanReadable,
  formatLocalDateTime,
} from '@/features/schedules/utils/cron'
import { CronExpressionInput } from '@/features/schedules/components/CronExpressionInput'
import { ExecutionCanvas } from '@/features/executions/components/ExecutionCanvas'
import { JobStatusIcon } from '@/features/executions/components/JobStatusIcon'
import { StatCard } from '@/features/dashboard/components/StatCard'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { H2, P } from '@/components/base/typography'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

/** Extract the ISO scheduled_at value from experiment_context (e.g. "scheduled_at=2026-03-24T12:00:00"). */
function parseScheduledAt(context: string | null): string | null {
  if (!context) return null
  const prefix = 'scheduled_at='
  if (context.startsWith(prefix)) return context.slice(prefix.length)
  return null
}

/** Derive trigger label from attempt_count: first attempt is cron, subsequent are reruns. */
function deriveTrigger(attemptCount: number): 'cron' | 'rerun' {
  return attemptCount === 1 ? 'cron' : 'rerun'
}

type RunStatusFilter = 'all' | 'submitted' | 'running' | 'completed' | 'failed'

const RUN_STATUS_FILTERS: Array<RunStatusFilter> = [
  'all',
  'submitted',
  'running',
  'completed',
  'failed',
]

export function ScheduleDetailPage() {
  const { t } = useTranslation(['schedules', 'executions'])
  const { scheduleId } = useParams({
    from: '/_authenticated/schedules/$scheduleId',
  })
  const layoutMode = useUiStore((state) => state.layoutMode)
  const dashboardVariant = useUiStore((state) => state.dashboardVariant)
  const panelShadow = useUiStore((state) => state.panelShadow)
  const [runsPage, setRunsPage] = useState(1)
  const [runStatusFilter, setRunStatusFilter] = useState<RunStatusFilter>('all')
  const [runSearchQuery, setRunSearchQuery] = useState('')
  const [editScheduleOpen, setEditScheduleOpen] = useState(false)
  const [editCronExpr, setEditCronExpr] = useState('')

  const { data: schedule, isLoading, isError } = useSchedule(scheduleId)
  const { data: nextRun } = useScheduleNextRun(scheduleId)
  const { data: runsData } = useScheduleRuns(scheduleId, runsPage, PAGE_SIZE)
  const updateSchedule = useUpdateSchedule()
  const { data: catalogue } = useBlockCatalogue()
  const { data: fableBuilder } = useFable(schedule?.job_definition_id)
  const { offsetMs, serverTimeToLocal } = useServerTime()

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
    ? cronToHumanReadable(schedule.cron_expr, offsetMs)
    : null

  async function handleToggleEnabled(newEnabled?: boolean) {
    newEnabled = newEnabled ?? !schedule!.enabled
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

  function handleOpenEditSchedule() {
    setEditCronExpr(schedule!.cron_expr)
    setEditScheduleOpen(true)
  }

  async function handleSaveSchedule() {
    try {
      await updateSchedule.mutateAsync({
        experimentId: scheduleId,
        update: { cron_expr: editCronExpr },
      })
      toast.success(t('schedules:actions.scheduleUpdated'))
      setEditScheduleOpen(false)
    } catch {
      // Error handled by mutation
    }
  }

  const runs = runsData?.runs ?? []
  let sortedRuns = [...runs].sort((a, b) =>
    (parseScheduledAt(b.experiment_context) ?? b.created_at).localeCompare(
      parseScheduledAt(a.experiment_context) ?? a.created_at,
    ),
  )
  const totalRunPages = runsData?.total_pages ?? 1

  // Client-side status filter
  if (runStatusFilter !== 'all') {
    sortedRuns = sortedRuns.filter((run) => run.status === runStatusFilter)
  }

  // Client-side search filter on execution_id
  if (runSearchQuery) {
    const query = runSearchQuery.toLowerCase()
    sortedRuns = sortedRuns.filter(
      (run) =>
        run.execution_id.toLowerCase().includes(query) ||
        deriveTrigger(run.attempt_count).includes(query),
    )
  }

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

      <div>
        <H2 className="text-xl font-semibold">{displayName}</H2>
        {cronDescription && (
          <div className="flex items-center gap-2">
            <P className="text-sm text-muted-foreground">{cronDescription}</P>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleOpenEditSchedule}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label={t('detail.status')}
          icon={
            <Switch
              checked={schedule.enabled}
              onCheckedChange={(checked) => handleToggleEnabled(checked)}
              aria-label={
                schedule.enabled ? t('actions.disable') : t('actions.enable')
              }
            />
          }
          value={
            <span className="text-lg font-semibold">
              {schedule.enabled ? t('detail.enabled') : t('detail.disabled')}
            </span>
          }
        />
        <StatCard
          label={t('detail.createdAt')}
          icon={<Clock className="h-4 w-4" />}
          value={
            <span className="text-lg font-semibold">
              {formatDistanceToNow(serverTimeToLocal(schedule.created_at), {
                addSuffix: true,
              })}
            </span>
          }
        />
        <StatCard
          label={t('detail.nextRun')}
          icon={<Calendar className="h-4 w-4" />}
          value={
            <span className="text-lg font-semibold">
              {nextRun
                ? formatLocalDateTime(
                    serverTimeToLocal(nextRun, { roundMinute: true }),
                  )
                : '-'}
            </span>
          }
        />
        {schedule.created_by && (
          <StatCard
            label={t('detail.createdBy')}
            icon={<User className="h-4 w-4" />}
            value={
              <span className="text-lg font-semibold">
                {schedule.created_by}
              </span>
            }
          />
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
      <Card
        className="overflow-hidden"
        variant={dashboardVariant}
        shadow={panelShadow}
      >
        <div className="flex flex-col items-start justify-between gap-4 border-b border-border p-6 sm:flex-row sm:items-center">
          <H2 className="text-xl font-semibold">
            {t('schedules:detail.runsTitle')}
          </H2>

          <div className="flex w-full items-center gap-3 sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
                <Search className="h-4 w-4" />
              </span>
              <Input
                type="text"
                placeholder={t('schedules:filter.searchPlaceholder')}
                value={runSearchQuery}
                onChange={(e) => setRunSearchQuery(e.target.value)}
                className="w-full pl-10 sm:w-64"
              />
            </div>

            <div className="hidden items-center gap-1 text-sm font-medium text-muted-foreground md:flex">
              {RUN_STATUS_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => {
                    setRunStatusFilter(filter)
                    setRunsPage(1)
                  }}
                  className={cn(
                    'rounded-md px-3 py-1.5 transition-colors',
                    runStatusFilter === filter
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted',
                  )}
                >
                  {t(`executions:filter.${filter}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="divide-y divide-border">
          {sortedRuns.length > 0 ? (
            sortedRuns.map((run) => (
              <div
                key={run.execution_id}
                className="p-6 transition-colors hover:bg-muted/50"
              >
                <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                  <div className="grow">
                    <div className="mb-1 flex items-center gap-2">
                      <JobStatusIcon status={run.status} />
                      <span className="font-medium">
                        {formatLocalDateTime(
                          serverTimeToLocal(
                            parseScheduledAt(run.experiment_context) ??
                              run.created_at,
                            { roundMinute: true },
                          ),
                        )}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge variant="outline" className="text-sm">
                        {t(`trigger.${deriveTrigger(run.attempt_count)}`)}
                      </Badge>
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
                      {run.attempt_count > 1 && (
                        <span className="text-sm text-muted-foreground">
                          {t('detail.attempts')}: {run.attempt_count}
                        </span>
                      )}
                      {run.execution_id && (
                        <span className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-sm text-muted-foreground">
                          #{run.execution_id.slice(0, 12)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex w-full items-center justify-end gap-6 sm:mt-0 sm:w-auto">
                    {run.execution_id && run.status === 'completed' ? (
                      <Link
                        to="/executions/$jobId"
                        params={{ jobId: run.execution_id }}
                        className="text-sm font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
                      >
                        {t('executions:outputs.view')}
                      </Link>
                    ) : run.execution_id && run.status === 'failed' ? (
                      <Link
                        to="/executions/$jobId"
                        params={{ jobId: run.execution_id }}
                        className="text-sm font-semibold text-red-600 hover:underline dark:text-red-400"
                      >
                        {t('executions:errors.executionFailed')}
                      </Link>
                    ) : run.execution_id ? (
                      <Link
                        to="/executions/$jobId"
                        params={{ jobId: run.execution_id }}
                        className="text-sm font-semibold text-muted-foreground hover:underline"
                      >
                        {t('executions:outputs.inspect')}
                      </Link>
                    ) : null}
                  </div>
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

      {/* Edit Schedule Dialog */}
      <AlertDialog open={editScheduleOpen} onOpenChange={setEditScheduleOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('schedules:actions.editSchedule')}
            </AlertDialogTitle>
          </AlertDialogHeader>

          <CronExpressionInput
            value={editCronExpr}
            onChange={setEditCronExpr}
          />

          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditScheduleOpen(false)}
            >
              {t('executions:submit.cancel')}
            </Button>
            <Button
              onClick={handleSaveSchedule}
              disabled={updateSchedule.isPending}
            >
              {t('executions:actions.save')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
