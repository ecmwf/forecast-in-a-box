/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Schedule form fields (recurrence, max acceptable delay), shared by the create and edit dialogs. */

import { useTranslation } from 'react-i18next'
import { CronExpressionInput } from '@/features/schedules/components/CronExpressionInput'
import { Label } from '@/components/ui/label'
import { NumericInput } from '@/components/ui/numeric-input'

interface ScheduleFieldsProps {
  cronExpr: string
  onCronChange: (cron: string) => void
  maxDelayHours: number
  onMaxDelayChange: (hours: number) => void
}

export function ScheduleFields({
  cronExpr,
  onCronChange,
  maxDelayHours,
  onMaxDelayChange,
}: ScheduleFieldsProps) {
  const { t } = useTranslation('executions')

  return (
    <>
      <CronExpressionInput value={cronExpr} onChange={onCronChange} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="schedule-max-delay">{t('submit.maxDelay')}</Label>
        <NumericInput
          id="schedule-max-delay"
          value={maxDelayHours}
          onChange={(event) => onMaxDelayChange(Number(event.target.value))}
          className="w-32"
        />
        <p className="text-sm text-muted-foreground">
          {t('submit.maxDelayHelp')}
        </p>
      </div>
    </>
  )
}
