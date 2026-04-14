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
 * ActivityMonitor Component
 *
 * Header icon with badge showing active long-running tasks.
 * Click to open a popover with task details, progress, and navigation.
 */

import { useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertCircle,
  Bell,
  Blocks,
  Check,
  ChevronRight,
  Download,
  HelpCircle,
  Play,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import type { ActivityTask, ActivityTaskType } from '@/stores/activityStore'
import { useActivityStore } from '@/stores/activityStore'
import { useActivityCollector } from '@/hooks/useActivityCollector'
import { P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import {
  Popover,
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

export function ActivityMonitor() {
  const { t } = useTranslation('common')
  useActivityCollector()

  const tasks = useActivityStore((state) => state.tasks)
  const clearCompleted = useActivityStore((state) => state.clearCompleted)

  const taskList = useMemo(() => {
    const items = Object.values(tasks).filter(
      (item): item is ActivityTask => item !== undefined,
    )
    return items.sort((a, b) => {
      // Active first, then by most recent
      if (a.status === 'active' && b.status !== 'active') return -1
      if (a.status !== 'active' && b.status === 'active') return 1
      return b.startedAt - a.startedAt
    })
  }, [tasks])

  const activeCount = taskList.filter((task) => task.status === 'active').length
  const hasCompleted = taskList.some((task) => task.status !== 'active')
  const hasFailed = taskList.some((task) => task.status === 'failed')

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
      <PopoverContent align="end" className="w-80 p-0">
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
          {hasCompleted && (
            <button
              type="button"
              onClick={clearCompleted}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
              {t('activity.clear')}
            </button>
          )}
        </div>

        {/* Task list or empty state */}
        {taskList.length > 0 ? (
          <div className="max-h-72 divide-y divide-border overflow-y-auto">
            {taskList.map((task) => (
              <ActivityTaskRow key={task.id} task={task} />
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            {t('activity.empty')}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function ActivityTaskRow({ task }: { task: ActivityTask }) {
  const StatusIcon = getStatusIcon(task)
  const statusColor = getStatusColor(task)

  const timeAgo = formatDistanceToNow(task.completedAt ?? task.startedAt, {
    addSuffix: true,
  })

  const content = (
    <div
      className={cn(
        'group flex items-center gap-3 px-4 py-3 transition-colors',
        task.navigateTo && 'hover:bg-muted/50',
        task.status !== 'active' && 'opacity-60',
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

      {/* Navigation chevron */}
      {task.navigateTo && (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
      )}
    </div>
  )

  if (task.navigateTo) {
    return (
      <Link to={task.navigateTo} className="block">
        {content}
      </Link>
    )
  }

  return content
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
