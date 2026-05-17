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

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Clock, Eye, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import type { ScheduleDefinitionResponse } from '@/api/types/schedule.types'
import type { FacetToken } from '@/features/journal/facets/facet-types'
import { showToast } from '@/lib/toast'
import { useServerTime, useUpdateSchedule } from '@/api/hooks/useSchedules'
import { cronToHumanReadable } from '@/features/schedules/utils/cron'
import { EditScheduleDialog } from '@/features/schedules/components/EditScheduleDialog'
import { JournalChip } from '@/features/journal/components/JournalChip'
import {
  STATUS_BADGE_VARIANTS,
  StatusBadge,
} from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

interface ScheduleListItemProps {
  scheduleId: string
  schedule: ScheduleDefinitionResponse
  /** Clicking a tag chip adds it to the schedules search. */
  onAddFacet: (token: FacetToken) => void
}

export function ScheduleListItem({
  scheduleId,
  schedule,
  onAddFacet,
}: ScheduleListItemProps) {
  const { t } = useTranslation('schedules')
  const updateSchedule = useUpdateSchedule()
  const { offsetMs, serverTimeToLocal, timeZone } = useServerTime()
  const [editOpen, setEditOpen] = useState(false)

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
    ? cronToHumanReadable(schedule.cron_expr, offsetMs, timeZone)
    : null

  async function handleToggleEnabled(newEnabled: boolean) {
    try {
      await updateSchedule.mutateAsync({
        experimentId: scheduleId,
        version: schedule.experiment_version,
        update: { enabled: newEnabled },
      })
      showToast.success(
        newEnabled ? t('actions.enableSuccess') : t('actions.disableSuccess'),
      )
    } catch {
      // Error handled by mutation
    }
  }

  return (
    <div
      className={cn(
        'group/row p-6 transition-colors hover:bg-muted/50',
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
            {/* Reveal on row hover; always shown where hover is unavailable. */}
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              aria-label={t('actions.editSchedule')}
              className="shrink-0 text-muted-foreground opacity-0 transition-[color,opacity] group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:text-primary [@media(hover:none)]:opacity-100"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-sm text-muted-foreground">
              #{truncatedId}
            </span>
            {schedule.tags?.map((tag) => (
              <JournalChip
                key={tag}
                label={tag}
                variant="tag"
                onClick={() => onAddFacet({ key: 'tag', value: tag })}
              />
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
            {t('actions.viewRuns')}
          </Button>

          {/* Enable/disable toggle — was a secondary-menu item. */}
          <Switch
            checked={schedule.enabled}
            onCheckedChange={(checked) => handleToggleEnabled(checked)}
            disabled={updateSchedule.isPending}
            aria-label={
              schedule.enabled ? t('actions.disable') : t('actions.enable')
            }
          />
        </div>
      </div>
      <EditScheduleDialog
        experimentId={scheduleId}
        version={schedule.experiment_version}
        cronExpr={schedule.cron_expr}
        maxDelayHours={schedule.max_acceptable_delay_hours}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </div>
  )
}
