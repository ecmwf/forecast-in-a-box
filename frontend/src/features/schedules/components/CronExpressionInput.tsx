/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CronFrequency } from '@/features/schedules/utils/cron'
import {
  cronToHumanReadable,
  frequencyToCron,
  parseCronForUI,
} from '@/features/schedules/utils/cron'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

interface CronExpressionInputProps {
  value: string
  onChange: (cron: string) => void
}

const FREQUENCY_OPTIONS: Array<{ value: CronFrequency; label: string }> = [
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'custom', label: 'Custom' },
]

const DAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

export function CronExpressionInput({
  value,
  onChange,
}: CronExpressionInputProps) {
  const { t } = useTranslation('executions')
  const parsed = parseCronForUI(value)

  const [frequency, setFrequency] = useState<CronFrequency>(
    parsed?.frequency ?? 'custom',
  )
  const [hour, setHour] = useState(parsed?.hour ?? 6)
  const [minute, setMinute] = useState(parsed?.minute ?? 0)
  const [dayOfWeek, setDayOfWeek] = useState(parsed?.dayOfWeek ?? 1)
  const [showRaw, setShowRaw] = useState(false)

  function handleFrequencyChange(newFrequency: CronFrequency) {
    setFrequency(newFrequency)
    if (newFrequency !== 'custom') {
      onChange(frequencyToCron(newFrequency, hour, minute, dayOfWeek))
    }
  }

  function handleHourChange(newHour: number) {
    setHour(newHour)
    if (frequency !== 'custom') {
      onChange(frequencyToCron(frequency, newHour, minute, dayOfWeek))
    }
  }

  function handleMinuteChange(newMinute: number) {
    setMinute(newMinute)
    if (frequency !== 'custom') {
      onChange(frequencyToCron(frequency, hour, newMinute, dayOfWeek))
    }
  }

  function handleDayChange(newDay: number) {
    setDayOfWeek(newDay)
    if (frequency !== 'custom') {
      onChange(frequencyToCron(frequency, hour, minute, newDay))
    }
  }

  return (
    <div className="space-y-3">
      <Label>{t('submit.cronExpression')}</Label>

      {/* Frequency selector */}
      <div className="flex gap-1">
        {FREQUENCY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => handleFrequencyChange(option.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              frequency === option.value
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Time/day inputs */}
      {frequency !== 'custom' && (
        <div className="flex items-center gap-3">
          {frequency === 'weekly' && (
            <select
              value={dayOfWeek}
              onChange={(e) => handleDayChange(Number(e.target.value))}
              className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            >
              {DAY_OPTIONS.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
          )}
          {frequency !== 'hourly' && (
            <>
              <Label className="text-sm text-muted-foreground">at</Label>
              <Input
                type="number"
                min={0}
                max={23}
                value={hour}
                onChange={(e) => handleHourChange(Number(e.target.value))}
                className="w-20"
              />
              <span className="text-muted-foreground">:</span>
              <Input
                type="number"
                min={0}
                max={59}
                value={minute}
                onChange={(e) => handleMinuteChange(Number(e.target.value))}
                className="w-20"
              />
              <span className="text-sm text-muted-foreground">UTC</span>
            </>
          )}
          {frequency === 'hourly' && (
            <>
              <Label className="text-sm text-muted-foreground">at minute</Label>
              <Input
                type="number"
                min={0}
                max={59}
                value={minute}
                onChange={(e) => handleMinuteChange(Number(e.target.value))}
                className="w-20"
              />
            </>
          )}
        </div>
      )}

      {/* Raw cron toggle */}
      <div>
        <button
          type="button"
          onClick={() => setShowRaw(!showRaw)}
          className="text-sm text-muted-foreground underline"
        >
          {showRaw ? 'Hide' : 'Show'} cron expression
        </button>
        {(showRaw || frequency === 'custom') && (
          <Input
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
              setFrequency('custom')
            }}
            placeholder="* * * * *"
            className="mt-2 font-mono"
          />
        )}
      </div>

      {/* Human-readable preview */}
      <P className="text-sm text-muted-foreground">
        {cronToHumanReadable(value)}
      </P>
    </div>
  )
}
