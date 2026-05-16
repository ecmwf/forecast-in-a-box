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
 * Pure utility functions for converting between cron expressions and
 * human-readable formats. Time inputs/outputs face the user in the application
 * timezone; cron expressions are stored in server time.
 */

import {
  formatInZone,
  nowPartsInZone,
  timeZoneOffsetLabel,
  todayInZone,
  zonedNaiveToInstant,
} from '@/lib/datetime'

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
 * Convert a server-time hour:minute to its application-timezone equivalent.
 *
 * `offsetMs` is (server wall clock − browser wall clock), so `ref − offsetMs`
 * is the instant whose server wall clock is `hour:minute`; that instant is then
 * projected into `timeZone`. The reference date is "today", so the result can
 * be off by an hour for part of the year when the server and app timezones
 * observe DST differently — an accepted approximation, since a cron hour:minute
 * is a recurring wall-clock time rather than a fixed instant.
 */
export function serverHourMinuteToLocal(
  hour: number,
  minute: number,
  offsetMs: number,
  timeZone: string,
): { hour: number; minute: number } {
  const ref = new Date()
  ref.setHours(hour, minute, 0, 0)
  const instant = new Date(ref.getTime() - offsetMs)
  const parts = nowPartsInZone(timeZone, instant)
  return { hour: parts.hour, minute: parts.minute }
}

/**
 * Convert an application-timezone hour:minute back to server time — the strict
 * inverse of `serverHourMinuteToLocal`.
 */
export function localHourMinuteToServer(
  hour: number,
  minute: number,
  offsetMs: number,
  timeZone: string,
): { hour: number; minute: number } {
  const instant = zonedNaiveToInstant(
    `${todayInZone(timeZone)}T${formatHourMinute(hour, minute)}:00`,
    timeZone,
  )
  const server = new Date(instant.getTime() + offsetMs)
  return { hour: server.getHours(), minute: server.getMinutes() }
}

/**
 * Convert a cron expression to a human-readable string in the application
 * timezone. Falls back to the raw expression for complex patterns, and to a
 * "(server time)" suffix when the server offset is not yet known.
 */
export function cronToHumanReadable(
  cronExpr: string,
  offsetMs: number | null | undefined,
  timeZone: string,
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
          timeZone,
        )
        return `Every day at ${formatHourMinute(local.hour, local.minute)} ${timeZoneOffsetLabel(timeZone)}`
      }
      return `Every day at ${formatHourMinute(parsed.hour, parsed.minute)} (server time)`
    }
    case 'weekly': {
      if (offsetMs != null) {
        const local = serverHourMinuteToLocal(
          parsed.hour,
          parsed.minute,
          offsetMs,
          timeZone,
        )
        return `Every ${DAY_NAMES[parsed.dayOfWeek]} at ${formatHourMinute(local.hour, local.minute)} ${timeZoneOffsetLabel(timeZone)}`
      }
      return `Every ${DAY_NAMES[parsed.dayOfWeek]} at ${formatHourMinute(parsed.hour, parsed.minute)} (server time)`
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

function formatHourMinute(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * Format a Date in the application timezone with the UTC-offset label,
 * e.g. "26/03/2026, 14:20 UTC+7".
 */
export function formatLocalDateTime(
  date: Date,
  timeZone: string,
  opts?: { includeSeconds?: boolean },
): string {
  const pattern = opts?.includeSeconds
    ? 'dd/MM/yyyy, HH:mm:ss'
    : 'dd/MM/yyyy, HH:mm'
  return `${formatInZone(date, timeZone, pattern)} ${timeZoneOffsetLabel(timeZone)}`
}
