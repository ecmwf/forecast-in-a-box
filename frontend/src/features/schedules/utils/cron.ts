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
 * Cron Expression Utilities
 *
 * Pure utility functions for converting between cron expressions and human-readable formats.
 */

export type CronFrequency = 'hourly' | 'daily' | 'weekly' | 'custom'

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

export interface CronPreset {
  frequency: CronFrequency
  hour: number
  minute: number
  dayOfWeek: number
}

/**
 * Convert a cron expression to a human-readable string.
 * Handles common patterns; falls back to raw expression for complex ones.
 */
export function cronToHumanReadable(cronExpr: string): string {
  const parsed = parseCronForUI(cronExpr)
  if (!parsed) return cronExpr

  switch (parsed.frequency) {
    case 'hourly':
      return parsed.minute === 0
        ? 'Every hour'
        : `Every hour at minute ${String(parsed.minute).padStart(2, '0')}`
    case 'daily':
      return `Every day at ${formatTime(parsed.hour, parsed.minute)} UTC`
    case 'weekly':
      return `Every ${DAY_NAMES[parsed.dayOfWeek]} at ${formatTime(parsed.hour, parsed.minute)} UTC`
    default:
      return cronExpr
  }
}

/**
 * Convert a frequency preset to a cron expression string.
 */
export function frequencyToCron(
  frequency: CronFrequency,
  hour: number,
  minute: number,
  dayOfWeek: number = 0,
): string {
  switch (frequency) {
    case 'hourly':
      return `${minute} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly':
      return `${minute} ${hour} * * ${dayOfWeek}`
    default:
      return `${minute} ${hour} * * *`
  }
}

/**
 * Parse a cron expression back into UI-friendly preset values.
 * Returns null if the expression doesn't match a known pattern.
 */
export function parseCronForUI(cronExpr: string): CronPreset | null {
  const parts = cronExpr.trim().split(/\s+/)
  if (parts.length !== 5) return null

  const [minuteStr, hourStr, dayOfMonth, month, dayOfWeekStr] = parts

  // All must be valid for preset patterns
  if (month !== '*' || dayOfMonth !== '*') return null

  const minute = minuteStr === '*' ? 0 : parseInt(minuteStr, 10)
  if (isNaN(minute) || minute < 0 || minute > 59) return null

  // Hourly: N * * * *
  if (hourStr === '*' && dayOfWeekStr === '*') {
    return { frequency: 'hourly', hour: 0, minute, dayOfWeek: 0 }
  }

  const hour = parseInt(hourStr, 10)
  if (isNaN(hour) || hour < 0 || hour > 23) return null

  // Daily: N H * * *
  if (dayOfWeekStr === '*') {
    return { frequency: 'daily', hour, minute, dayOfWeek: 0 }
  }

  // Weekly: N H * * D
  const dayOfWeek = parseInt(dayOfWeekStr, 10)
  if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return null

  return { frequency: 'weekly', hour, minute, dayOfWeek }
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
