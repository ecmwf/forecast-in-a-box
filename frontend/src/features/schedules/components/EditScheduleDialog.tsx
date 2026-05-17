/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Edits a schedule's recurrence and max acceptable delay, via the shared ScheduleFields form. */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { showToast } from '@/lib/toast'
import { useUpdateSchedule } from '@/api/hooks/useSchedules'
import { ScheduleFields } from '@/features/schedules/components/ScheduleFields'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

interface EditScheduleDialogProps {
  experimentId: string
  version: number
  cronExpr: string
  maxDelayHours: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditScheduleDialog({
  experimentId,
  version,
  cronExpr,
  maxDelayHours,
  open,
  onOpenChange,
}: EditScheduleDialogProps) {
  const { t } = useTranslation(['schedules', 'executions'])
  const updateSchedule = useUpdateSchedule()
  const [editCronExpr, setEditCronExpr] = useState(cronExpr)
  const [editMaxDelay, setEditMaxDelay] = useState(maxDelayHours)

  // Seed the form from the schedule each time the dialog opens.
  useEffect(() => {
    if (open) {
      setEditCronExpr(cronExpr)
      setEditMaxDelay(maxDelayHours)
    }
  }, [open, cronExpr, maxDelayHours])

  async function handleSave() {
    try {
      await updateSchedule.mutateAsync({
        experimentId,
        version,
        update: {
          cron_expr: editCronExpr,
          max_acceptable_delay_hours: editMaxDelay,
        },
      })
      showToast.success(t('schedules:actions.scheduleUpdated'))
      onOpenChange(false)
    } catch {
      // Error handled by mutation
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('schedules:actions.editSchedule')}
          </AlertDialogTitle>
        </AlertDialogHeader>

        <ScheduleFields
          cronExpr={editCronExpr}
          onCronChange={setEditCronExpr}
          maxDelayHours={editMaxDelay}
          onMaxDelayChange={setEditMaxDelay}
        />

        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('executions:submit.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={updateSchedule.isPending}>
            {t('executions:actions.save')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
