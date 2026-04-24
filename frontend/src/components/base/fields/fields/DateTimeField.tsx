/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { GlyphFieldWrapper } from './GlyphFieldWrapper'
import { InputGroupInput } from '@/components/ui/input-group'

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
  // The datetime-local wire format is `YYYY-MM-DDTHH:MM`; tolerate a seconds
  // suffix from pasted values by slicing down to HH:MM.
  return {
    date: value.slice(0, tIndex),
    time: value.slice(tIndex + 1, tIndex + 6),
  }
}

function todayLocalISO(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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
 * Renders a date input beside a time input and recombines them on change.
 * The time defaults to `00:00` so the native time picker opens at midnight
 * instead of the current wall-clock minute — forecast base-times round to
 * the hour anyway.
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
  const { date, time } = splitDatetime(value)
  const displayedTime = time || DEFAULT_TIME

  function handleDateChange(nextDate: string) {
    if (!nextDate) {
      // Clearing the date clears the whole value; the stored form is all-or-nothing.
      onChange('')
      return
    }
    onChange(`${nextDate}T${time || DEFAULT_TIME}`)
  }

  function handleTimeChange(nextTime: string) {
    const effective = nextTime || DEFAULT_TIME
    // If the user picks a time before a date, default the date to today so
    // the time they just typed doesn't silently revert on re-render.
    const effectiveDate = date || todayLocalISO()
    onChange(`${effectiveDate}T${effective}`)
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
        aria-label="Time"
      />
    </>
  )
}
