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
 * ScheduleListItem Component
 *
 * A single schedule row in the schedules list.
 */

import { formatDistanceToNow } from 'date-fns'
import { Clock, MoreVertical, Pause, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { ScheduleDefinitionResponse } from '@/api/types/schedule.types'
import { useUpdateSchedule } from '@/api/hooks/useSchedules'
import { cronToHumanReadable } from '@/features/schedules/utils/cron'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

interface ScheduleListItemProps {
  scheduleId: string
  schedule: ScheduleDefinitionResponse
}

export function ScheduleListItem({
  scheduleId,
  schedule,
}: ScheduleListItemProps) {
  const { t } = useTranslation('schedules')
  const updateSchedule = useUpdateSchedule()

  const createdAt = schedule.created_at
    ? formatDistanceToNow(new Date(schedule.created_at), { addSuffix: true })
    : null

  const truncatedId =
    scheduleId.length > 12 ? `${scheduleId.slice(0, 12)}...` : scheduleId

  const displayName =
    schedule.display_name ||
    `${t('detail.untitledSchedule')} ${scheduleId.slice(0, 8)}`

  const cronDescription = schedule.cron_expr
    ? cronToHumanReadable(schedule.cron_expr)
    : null

  async function handleToggleEnabled() {
    const newEnabled = !schedule.enabled
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

  return (
    <div className="p-6 transition-colors hover:bg-muted/50">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="mt-1 shrink-0 sm:mt-0">
          <Clock
            className={cn(
              'h-5 w-5',
              schedule.enabled ? 'text-emerald-500' : 'text-gray-400',
            )}
          />
        </div>

        <div className="grow">
          <div className="mb-1 flex items-center gap-2">
            <Link
              to="/schedules/$scheduleId"
              params={{ scheduleId }}
              className="text-sm font-medium hover:underline"
            >
              {displayName}
            </Link>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-sm',
                schedule.enabled
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
              )}
            >
              {schedule.enabled ? t('detail.enabled') : t('detail.disabled')}
            </span>
          </div>
          {schedule.display_description && (
            <P className="mb-1 line-clamp-1 text-muted-foreground">
              {schedule.display_description}
            </P>
          )}
          <div className="mb-2 text-sm text-muted-foreground">
            {cronDescription}
            {createdAt && <> · {createdAt}</>}
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-sm text-muted-foreground">
              #{truncatedId}
            </span>
            {schedule.tags?.map((tag) => (
              <span
                key={tag}
                className="rounded border border-border bg-card px-2 py-0.5 text-sm text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-2 flex w-full items-center justify-between gap-6 sm:mt-0 sm:w-auto sm:justify-end">
          <Link
            to="/schedules/$scheduleId"
            params={{ scheduleId }}
            className="text-sm font-semibold text-muted-foreground hover:underline"
          >
            {t('actions.viewRuns')}
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon" className="h-8 w-8" />
              }
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleToggleEnabled}>
                {schedule.enabled ? (
                  <>
                    <Pause className="mr-2 h-4 w-4" />
                    {t('actions.disable')}
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    {t('actions.enable')}
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
