/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { GlyphFieldWrapper } from './GlyphFieldWrapper'
import { InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  convertNaive,
  timeZoneOffsetLabel,
  todayInZone,
  useAppTimeZone,
} from '@/lib/datetime'

export interface DateTimeFieldProps {
  id: string
  configKey: string
  value: string
  onChange: (value: string) => void
  isDateOnly?: boolean
  placeholder?: string
  disabled?: boolean
  className?: string
}

const DEFAULT_TIME = '00:00'

function splitDatetime(value: string): { date: string; time: string } {
  if (!value) return { date: '', time: '' }
  const tIndex = value.indexOf('T')
  if (tIndex === -1) return { date: value, time: '' }
  // The wire format is `YYYY-MM-DDTHH:MM:SS`; the time input wants `HH:MM`.
  return {
    date: value.slice(0, tIndex),
    time: value.slice(tIndex + 1, tIndex + 6),
  }
}

export function DateTimeField({
  id,
  configKey,
  value,
  onChange,
  isDateOnly = false,
  placeholder,
  disabled,
  className,
}: DateTimeFieldProps) {
  return (
    <GlyphFieldWrapper
      id={id}
      configKey={configKey}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      isDateOnly={isDateOnly}
    >
      {isDateOnly ? (
        // A calendar date has no instant — stored and shown verbatim.
        <InputGroupInput
          id={id}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
      ) : (
        <DateAndTimeInputs
          id={id}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      )}
    </GlyphFieldWrapper>
  )
}

/**
 * Renders a date input beside a time input. The stored `value` is canonical
 * naive UTC (`YYYY-MM-DDTHH:MM:SS`); the inputs present it in the application
 * timezone and convert back on every edit, so the wire value stays UTC. A
 * badge shows the active timezone, making the entered time unambiguous. The
 * time defaults to `00:00` so the native picker opens at midnight rather than
 * the current wall-clock minute — forecast base-times round to the hour.
 */
function DateAndTimeInputs({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('common')
  const timeZone = useAppTimeZone()
  const { date, time } = useMemo(
    () => splitDatetime(convertNaive(value, 'UTC', timeZone)),
    [value, timeZone],
  )
  const displayedTime = time || DEFAULT_TIME

  // Recombine the zoned date + time, then store back as canonical UTC.
  function emit(zonedDate: string, hhmm: string) {
    onChange(convertNaive(`${zonedDate}T${hhmm}:00`, timeZone, 'UTC'))
  }

  function handleDateChange(nextDate: string) {
    if (!nextDate) {
      // Clearing the date clears the value; the stored form is all-or-nothing.
      onChange('')
      return
    }
    emit(nextDate, time || DEFAULT_TIME)
  }

  function handleTimeChange(nextTime: string) {
    // If the user picks a time before a date, default the date to today (in
    // the app timezone) so the time they just typed doesn't silently revert.
    emit(date || todayInZone(timeZone), nextTime || DEFAULT_TIME)
  }

  return (
    <>
      <InputGroupInput
        id={id}
        type="date"
        value={date}
        onChange={(e) => handleDateChange(e.target.value)}
        disabled={disabled}
      />
      <div className="mx-0.5 h-5 w-px bg-border" aria-hidden />
      <InputGroupInput
        id={`${id}-time`}
        type="time"
        value={displayedTime}
        onChange={(e) => handleTimeChange(e.target.value)}
        disabled={disabled}
        aria-label={t('dateTimeField.timeLabel')}
      />
      <InputGroupAddon align="inline-end">
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                data-testid="datetime-tz-badge"
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
              />
            }
          >
            {timeZoneOffsetLabel(timeZone)}
          </TooltipTrigger>
          <TooltipContent side="top">
            {t('dateTimeField.timezoneTooltip', { timeZone })}
          </TooltipContent>
        </Tooltip>
      </InputGroupAddon>
    </>
  )
}
