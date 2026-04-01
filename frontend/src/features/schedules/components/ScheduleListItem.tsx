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
import { Clock, Eye, MoreVertical, Pause, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { ScheduleDefinitionResponse } from '@/api/types/schedule.types'
import { useServerTime, useUpdateSchedule } from '@/api/hooks/useSchedules'
import { cronToHumanReadable } from '@/features/schedules/utils/cron'
import {
  STATUS_BADGE_VARIANTS,
  StatusBadge,
} from '@/components/common/StatusBadge'
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
  const { offsetMs, serverTimeToLocal } = useServerTime()

  const createdAt = schedule.created_at
    ? formatDistanceToNow(serverTimeToLocal(schedule.created_at), {
        addSuffix: true,
      })
    : null

  const truncatedId =
    scheduleId.length > 12 ? `${scheduleId.slice(0, 12)}...` : scheduleId

  const displayName =
    schedule.display_name ||
    `${t('detail.untitledSchedule')} ${scheduleId.slice(0, 8)}`

  const cronDescription = schedule.cron_expr
    ? cronToHumanReadable(schedule.cron_expr, offsetMs)
    : null

  async function handleToggleEnabled() {
    const newEnabled = !schedule.enabled
    try {
      await updateSchedule.mutateAsync({
        experimentId: scheduleId,
        version: schedule.experiment_version,
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
    <div
      className={cn(
        'p-6 transition-colors hover:bg-muted/50',
        !schedule.enabled && 'opacity-60',
      )}
    >
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="mt-1 shrink-0 sm:mt-0">
          <Clock
            className={cn(
              'h-5 w-5',
              schedule.enabled ? 'text-emerald-500' : 'text-muted-foreground',
            )}
          />
        </div>

        <div className="grow">
          <div className="mb-1 flex items-center gap-2">
            <Link
              to="/schedules/$scheduleId"
              params={{ scheduleId }}
              className={cn(
                'text-sm font-medium hover:underline',
                !schedule.enabled && 'text-muted-foreground',
              )}
            >
              {displayName}
            </Link>
            <StatusBadge
              variant={
                schedule.enabled
                  ? {
                      label: t('detail.enabled'),
                      ...STATUS_BADGE_VARIANTS.active,
                    }
                  : {
                      label: t('detail.disabled'),
                      ...STATUS_BADGE_VARIANTS.disabled,
                    }
              }
            />
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
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            nativeButton={false}
            render={
              <Link to="/schedules/$scheduleId" params={{ scheduleId }} />
            }
          >
            <Eye className="h-4 w-4" />
            {t('actions.viewDetails')}
          </Button>

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
