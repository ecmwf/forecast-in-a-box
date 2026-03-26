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
 * All time inputs/outputs face the user in their local timezone.
 * Cron expressions are stored in server time.
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
 * Convert server hour:minute to the client's local equivalent using the offset.
 * offsetMs = (server time parsed as local) - (actual epoch), so:
 * local = server-parsed - offset
 */
export function serverHourMinuteToLocal(
  hour: number,
  minute: number,
  offsetMs: number,
): { hour: number; minute: number } {
  const ref = new Date()
  ref.setHours(hour, minute, 0, 0)
  const local = new Date(ref.getTime() - offsetMs)
  return { hour: local.getHours(), minute: local.getMinutes() }
}

/**
 * Convert local hour:minute back to server time using the offset.
 * Inverse of serverHourMinuteToLocal.
 */
export function localHourMinuteToServer(
  hour: number,
  minute: number,
  offsetMs: number,
): { hour: number; minute: number } {
  const ref = new Date()
  ref.setHours(hour, minute, 0, 0)
  const server = new Date(ref.getTime() + offsetMs)
  return { hour: server.getHours(), minute: server.getMinutes() }
}

/**
 * Convert a cron expression to a human-readable string in local time.
 * Falls back to raw expression for complex patterns.
 */
export function cronToHumanReadable(
  cronExpr: string,
  offsetMs?: number | null,
): string {
  const parsed = parseCronForUI(cronExpr)
  if (!parsed) return cronExpr

  switch (parsed.frequency) {
    case 'hourly':
      return parsed.minute === 0
        ? 'Every hour'
        : `Every hour at minute ${String(parsed.minute).padStart(2, '0')}`
    case 'daily': {
      if (offsetMs != null) {
        const local = serverHourMinuteToLocal(
          parsed.hour,
          parsed.minute,
          offsetMs,
        )
        return `Every day at ${formatTime(local.hour, local.minute)} ${getLocalTimezone()}`
      }
      return `Every day at ${formatTime(parsed.hour, parsed.minute)} (server time)`
    }
    case 'weekly': {
      if (offsetMs != null) {
        const local = serverHourMinuteToLocal(
          parsed.hour,
          parsed.minute,
          offsetMs,
        )
        return `Every ${DAY_NAMES[parsed.dayOfWeek]} at ${formatTime(local.hour, local.minute)} ${getLocalTimezone()}`
      }
      return `Every ${DAY_NAMES[parsed.dayOfWeek]} at ${formatTime(parsed.hour, parsed.minute)} (server time)`
    }
    default:
      return cronExpr
  }
}

/**
 * Convert a frequency preset to a cron expression string.
 * hour and minute are in SERVER time.
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
 * Parse a cron expression back into UI-friendly preset values (in server time).
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

/**
 * Format a Date as a locale string with the UTC-offset timezone label.
 * e.g. "26/03/2026, 14:20 UTC+7" instead of browser's "GMT+7"
 */
export function formatLocalDateTime(
  date: Date,
  opts?: { includeSeconds?: boolean },
): string {
  const formatted = date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(opts?.includeSeconds ? { second: '2-digit' } : {}),
  })
  return `${formatted} ${getLocalTimezone()}`
}

/** Get the short timezone name for the client in UTC offset format (e.g. "UTC+7", "UTC-5") */
export function getLocalTimezone(): string {
  const offsetMin = new Date().getTimezoneOffset()
  if (offsetMin === 0) return 'UTC'
  const sign = offsetMin < 0 ? '+' : '-'
  const absHours = Math.floor(Math.abs(offsetMin) / 60)
  const absMinutes = Math.abs(offsetMin) % 60
  return absMinutes === 0
    ? `UTC${sign}${absHours}`
    : `UTC${sign}${absHours}:${String(absMinutes).padStart(2, '0')}`
}
