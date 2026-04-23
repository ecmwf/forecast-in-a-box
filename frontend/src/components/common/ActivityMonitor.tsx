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
 * Notification Center
 *
 * Header icon with badge showing active long-running tasks. Click to open a
 * popover with a filterable list split into Ongoing and Completed sections.
 * Completed entries persist until dismissed individually (X) or via Clear.
 */

import { useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertCircle,
  ArrowRight,
  Bell,
  Blocks,
  BrushCleaning,
  Check,
  ChevronRight,
  Download,
  HelpCircle,
  Play,
  Search,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import type { ActivityTask, ActivityTaskType } from '@/stores/activityStore'
import { useActivityStore } from '@/stores/activityStore'
import { useActivityCollector } from '@/hooks/useActivityCollector'
import { P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const TYPE_CONFIG: Record<
  ActivityTaskType,
  { icon: typeof Bell; badgeColor: string }
> = {
  plugin: { icon: Blocks, badgeColor: 'bg-purple-500' },
  download: { icon: Download, badgeColor: 'bg-blue-500' },
  job: { icon: Play, badgeColor: 'bg-emerald-500' },
}

function matchesFilter(task: ActivityTask, needle: string): boolean {
  if (!needle) return true
  const hay = `${task.label} ${task.description}`.toLowerCase()
  return hay.includes(needle)
}

export function ActivityMonitor() {
  const { t } = useTranslation('common')
  useActivityCollector()

  const tasks = useActivityStore((state) => state.tasks)
  const removeTask = useActivityStore((state) => state.removeTask)
  const clearCompleted = useActivityStore((state) => state.clearCompleted)
  const clearAll = useActivityStore((state) => state.clearAll)

  const [filter, setFilter] = useState('')

  const { ongoing, completed } = useMemo(() => {
    const items = Object.values(tasks).filter(
      (item): item is ActivityTask => item !== undefined,
    )
    const needle = filter.trim().toLowerCase()

    const ongoingTasks = items
      .filter((task) => task.status === 'active' && matchesFilter(task, needle))
      .sort((a, b) => b.startedAt - a.startedAt)

    const completedTasks = items
      .filter((task) => task.status !== 'active' && matchesFilter(task, needle))
      .sort(
        (a, b) =>
          (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt),
      )

    return { ongoing: ongoingTasks, completed: completedTasks }
  }, [tasks, filter])

  const activeCount = useMemo(
    () =>
      Object.values(tasks).filter(
        (task) => task !== undefined && task.status === 'active',
      ).length,
    [tasks],
  )
  const hasFailed = useMemo(
    () =>
      Object.values(tasks).some(
        (task) => task !== undefined && task.status === 'failed',
      ),
    [tasks],
  )

  const totalVisible = ongoing.length + completed.length
  const totalStored = Object.values(tasks).filter(
    (task) => task !== undefined,
  ).length
  const hasAny = totalStored > 0
  const hasAnyCompleted = useMemo(
    () =>
      Object.values(tasks).some(
        (task) => task !== undefined && task.status !== 'active',
      ),
    [tasks],
  )

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative text-muted-foreground"
            aria-label={t('activity.label')}
          />
        }
      >
        <Bell className={cn('h-5 w-5', activeCount > 0 && 'animate-pulse')} />
        {activeCount > 0 && (
          <span
            className={cn(
              'absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white',
              hasFailed ? 'bg-destructive' : 'bg-primary',
            )}
          >
            {activeCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-1.5">
            <P className="text-sm font-medium">{t('activity.title')}</P>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="text-muted-foreground/60 hover:text-muted-foreground"
                  />
                }
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-64">
                {t('activity.help')}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-1">
            {hasAny && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={t('activity.clearAll')}
                      onClick={clearAll}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    />
                  }
                >
                  <BrushCleaning className="h-3.5 w-3.5" />
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t('activity.clearAll')}
                </TooltipContent>
              </Tooltip>
            )}
            <PopoverClose
              aria-label={t('close')}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </PopoverClose>
          </div>
        </div>

        {/* Filter */}
        {hasAny && (
          <div className="border-b border-border px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('activity.filterPlaceholder')}
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>
        )}

        {/* Body */}
        {!hasAny ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            {t('activity.empty')}
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {/* Ongoing section */}
            <SectionHeader title={t('activity.sectionOngoing')} />
            {ongoing.length > 0 ? (
              <div className="divide-y divide-border">
                {ongoing.map((task) => (
                  <ActivityTaskRow key={task.id} task={task} />
                ))}
              </div>
            ) : (
              <div className="px-4 py-3 text-sm text-muted-foreground/70">
                {filter ? t('activity.noMatches') : t('activity.emptyOngoing')}
              </div>
            )}

            {/* Completed section */}
            <SectionHeader
              title={t('activity.sectionCompleted')}
              action={
                hasAnyCompleted ? (
                  <button
                    type="button"
                    onClick={clearCompleted}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    {t('activity.clear')}
                  </button>
                ) : null
              }
            />
            {completed.length > 0 ? (
              <div className="divide-y divide-border">
                {completed.map((task) => (
                  <ActivityTaskRow
                    key={task.id}
                    task={task}
                    onDismiss={() => removeTask(task.id)}
                    dismissLabel={t('activity.dismiss')}
                  />
                ))}
              </div>
            ) : (
              <div className="px-4 py-3 text-sm text-muted-foreground/70">
                {filter
                  ? t('activity.noMatches')
                  : t('activity.emptyCompleted')}
              </div>
            )}

            {/* No-matches overall hint */}
            {filter && totalVisible === 0 && (
              <div className="border-t border-border px-4 py-3 text-center text-sm text-muted-foreground">
                {t('activity.noMatches')}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-border px-4 py-2">
          <Link
            to="/executions"
            className="flex items-center justify-between text-sm text-muted-foreground hover:text-foreground"
          >
            {t('activity.viewAll')}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function SectionHeader({
  title,
  action,
}: {
  title: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between bg-muted/30 px-4 py-1.5">
      <P className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </P>
      {action}
    </div>
  )
}

function ActivityTaskRow({
  task,
  onDismiss,
  dismissLabel,
}: {
  task: ActivityTask
  onDismiss?: () => void
  dismissLabel?: string
}) {
  const StatusIcon = getStatusIcon(task)
  const statusColor = getStatusColor(task)

  const timeAgo = formatDistanceToNow(task.completedAt ?? task.startedAt, {
    addSuffix: true,
  })

  const body = (
    <div
      className={cn(
        'group flex items-center gap-3 px-4 py-3 transition-colors',
        task.navigateTo && 'hover:bg-muted/50',
        task.status !== 'active' && 'opacity-75',
      )}
    >
      {/* Type/status icon */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          statusColor,
        )}
      >
        <StatusIcon className="h-4 w-4 text-white" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <P className="truncate text-sm font-medium">{task.label}</P>
        <div className="flex items-center gap-2">
          <P className="truncate text-sm text-muted-foreground">
            {task.description}
          </P>
        </div>
        {/* Progress bar for downloads */}
        {task.type === 'download' &&
          task.status === 'active' &&
          task.progress != null && (
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${task.progress}%` }}
              />
            </div>
          )}
        {/* Time */}
        <P className="mt-0.5 text-sm text-muted-foreground/60">{timeAgo}</P>
      </div>

      {/* Trailing actions: dismiss X (completed) or nav chevron (active + navigateTo) */}
      {onDismiss ? (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDismiss()
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : task.navigateTo ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
      ) : null}
    </div>
  )

  if (task.navigateTo) {
    return (
      <Link to={task.navigateTo} className="block">
        {body}
      </Link>
    )
  }

  return body
}

function getStatusIcon(task: ActivityTask) {
  if (task.status === 'completed') return Check
  if (task.status === 'failed') return AlertCircle
  return TYPE_CONFIG[task.type].icon
}

function getStatusColor(task: ActivityTask): string {
  if (task.status === 'completed') return 'bg-muted-foreground/50'
  if (task.status === 'failed') return 'bg-destructive'
  return TYPE_CONFIG[task.type].badgeColor
}
