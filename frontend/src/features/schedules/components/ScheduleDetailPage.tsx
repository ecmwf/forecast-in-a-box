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
 * ScheduleDetailPage — schedule metadata, configuration overview, and the
 * schedule's runs rendered through the shared Forecast Journal.
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
  User,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from '@tanstack/react-router'
import type { RunFilter } from '@/features/journal/types'
import type { GroupBy } from '@/features/journal/grouping/group-runs'
import { showToast } from '@/lib/toast'
import { useBlockCatalogue, useFableRetrieve } from '@/api/hooks/useFable'
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
import { EditScheduleDialog } from '@/features/schedules/components/EditScheduleDialog'
import { ExecutionCanvas } from '@/features/executions/components/ExecutionCanvas'
import { StatCard } from '@/features/dashboard/components/StatCard'
import { scheduleRunToViewModel } from '@/features/journal/adapters'
import { filterRuns } from '@/features/journal/utils/filter-runs'
import { addToken, parseQuery } from '@/features/journal/facets/parse-query'
import { ForecastRunList } from '@/features/journal/components/ForecastRunList'
import { ForecastRunSearchHeader } from '@/features/journal/components/ForecastRunSearchHeader'
import { useRunFavourites } from '@/features/journal/hooks/useRunFavourites'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { H2, P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

const SCHEDULE_RUN_FILTERS: ReadonlyArray<RunFilter> = [
  'all',
  'submitted',
  'running',
  'completed',
  'failed',
  'bookmarked',
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
  const [runFilter, setRunFilter] = useState<RunFilter>('all')
  const [runQuery, setRunQuery] = useState('')
  const [runGroupBy, setRunGroupBy] = useState<GroupBy>('date')
  const [editScheduleOpen, setEditScheduleOpen] = useState(false)

  const { data: schedule, isLoading, isError } = useSchedule(scheduleId)
  const { data: nextRun } = useScheduleNextRun(scheduleId)
  const { data: runsData } = useScheduleRuns(scheduleId, runsPage, PAGE_SIZE)
  const updateSchedule = useUpdateSchedule()
  const { data: catalogue } = useBlockCatalogue()
  const { data: blueprint } = useFableRetrieve(schedule?.blueprint_id)
  const { offsetMs, serverTimeToLocal, timeZone } = useServerTime()
  const { isBookmarked, toggleBookmark } = useRunFavourites()

  const containerClass = cn(
    'mx-auto space-y-6 px-4 py-8 sm:px-6 lg:px-8',
    layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
  )

  if (isLoading) {
    return (
      <div className={containerClass}>
        <div className="flex justify-center py-12">
          <LoadingSpinner text={t('list.loading')} />
        </div>
      </div>
    )
  }

  if (isError || !schedule) {
    return (
      <div className={containerClass}>
        <P className="text-destructive">Schedule not found</P>
      </div>
    )
  }

  const displayName =
    schedule.display_name ||
    `${t('detail.untitledSchedule')} ${scheduleId.slice(0, 8)}`

  const cronDescription = schedule.cron_expr
    ? cronToHumanReadable(schedule.cron_expr, offsetMs, timeZone)
    : null

  async function handleToggleEnabled(newEnabled?: boolean) {
    newEnabled = newEnabled ?? !schedule!.enabled
    try {
      await updateSchedule.mutateAsync({
        experimentId: scheduleId,
        version: schedule!.experiment_version,
        update: { enabled: newEnabled },
      })
      showToast.success(
        newEnabled ? t('actions.enableSuccess') : t('actions.disableSuccess'),
      )
    } catch {
      // Error handled by mutation
    }
  }

  const runViewModels = (runsData?.runs ?? []).map((run) =>
    scheduleRunToViewModel({
      run,
      blueprintId: schedule.blueprint_id,
      blueprint,
      catalogue,
      isBookmarked: isBookmarked(run.run_id),
    }),
  )
  const filteredRuns = filterRuns(
    runViewModels,
    runFilter,
    parseQuery(runQuery),
  )
  const totalRunPages = runsData?.total_pages ?? 1

  return (
    <div className={containerClass}>
      {/* Header */}
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 self-start"
        nativeButton={false}
        render={<Link to="/schedules" />}
      >
        <ArrowLeft className="h-4 w-4" />
        {t('detail.backLink')}
      </Button>

      <div>
        <div className="flex items-center gap-2">
          <H2 className="text-xl font-semibold">{displayName}</H2>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setEditScheduleOpen(true)}
            aria-label={t('actions.editSchedule')}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
        {cronDescription && (
          <P className="text-sm text-muted-foreground">{cronDescription}</P>
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
                    timeZone,
                  )
                : '-'}
            </span>
          }
        />
        <StatCard
          label={t('detail.createdBy')}
          icon={<User className="h-4 w-4" />}
          value={
            <span className="text-lg font-semibold">{schedule.created_by}</span>
          }
        />
      </div>

      {/* Configuration overview */}
      {blueprint && catalogue && (
        <ExecutionCanvas fable={blueprint.builder} catalogue={catalogue} />
      )}

      {/* Runs — rendered through the shared Forecast Journal */}
      <ForecastRunList
        runs={filteredRuns}
        groupBy={runGroupBy}
        emptyText={t('detail.noRuns')}
        onToggleBookmark={toggleBookmark}
        onAddFacet={(token) => setRunQuery((prev) => addToken(prev, token))}
        variant={dashboardVariant}
        shadow={panelShadow}
        header={
          <ForecastRunSearchHeader
            title={t('schedules:detail.runsTitle')}
            query={runQuery}
            onQueryChange={setRunQuery}
            activeFilter={runFilter}
            onFilterChange={(filter) => {
              setRunFilter(filter)
              setRunsPage(1)
            }}
            filters={SCHEDULE_RUN_FILTERS}
            groupBy={runGroupBy}
            onGroupByChange={setRunGroupBy}
          />
        }
        footer={
          totalRunPages > 1 ? (
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
          ) : null
        }
      />

      {/* Edit Schedule Dialog */}
      <EditScheduleDialog
        experimentId={scheduleId}
        version={schedule.experiment_version}
        cronExpr={schedule.cron_expr}
        maxDelayHours={schedule.max_acceptable_delay_hours}
        open={editScheduleOpen}
        onOpenChange={setEditScheduleOpen}
      />
    </div>
  )
}
