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
 * timezone; the scheduler evaluates cron expressions in UTC.
 */

import {
  formatInZone,
  nowPartsInZone,
  timeZoneOffsetLabel,
  todayInZone,
  zonedNaiveToInstant,
} from '@/lib/datetime'
import i18n from '@/lib/i18n'

export type CronFrequency = 'hourly' | 'daily' | 'weekly' | 'custom'

/** Day-of-week index (0 = Sunday) → `executions` translation key. */
export const DAY_NAME_KEYS = [
  'cron.days.sunday',
  'cron.days.monday',
  'cron.days.tuesday',
  'cron.days.wednesday',
  'cron.days.thursday',
  'cron.days.friday',
  'cron.days.saturday',
] as const

export interface CronPreset {
  frequency: CronFrequency
  hour: number
  minute: number
  dayOfWeek: number
}

/**
 * Project a UTC cron hour:minute into the application timezone. Anchored on
 * today's date, so the result can shift by an hour around a DST change — an
 * accepted approximation for a recurring wall-clock time.
 */
export function utcHourMinuteToLocal(
  hour: number,
  minute: number,
  timeZone: string,
): { hour: number; minute: number } {
  const instant = zonedNaiveToInstant(
    `${todayInZone('UTC')}T${formatHourMinute(hour, minute)}:00`,
    'UTC',
  )
  const parts = nowPartsInZone(timeZone, instant)
  return { hour: parts.hour, minute: parts.minute }
}

/** Inverse of `utcHourMinuteToLocal`: an app-timezone hour:minute as UTC. */
export function localHourMinuteToUtc(
  hour: number,
  minute: number,
  timeZone: string,
): { hour: number; minute: number } {
  const instant = zonedNaiveToInstant(
    `${todayInZone(timeZone)}T${formatHourMinute(hour, minute)}:00`,
    timeZone,
  )
  return { hour: instant.getUTCHours(), minute: instant.getUTCMinutes() }
}

/**
 * Convert a cron expression to a human-readable string in the application
 * timezone. Falls back to the raw expression for complex patterns.
 */
export function cronToHumanReadable(
  cronExpr: string,
  timeZone: string,
): string {
  const parsed = parseCronForUI(cronExpr)
  if (!parsed) return cronExpr

  switch (parsed.frequency) {
    case 'hourly':
      return parsed.minute === 0
        ? i18n.t('executions:cron.humanReadable.everyHour')
        : i18n.t('executions:cron.humanReadable.everyHourAtMinute', {
            minute: String(parsed.minute).padStart(2, '0'),
          })
    case 'daily': {
      const local = utcHourMinuteToLocal(parsed.hour, parsed.minute, timeZone)
      return i18n.t('executions:cron.humanReadable.everyDayAt', {
        time: formatHourMinute(local.hour, local.minute),
        zone: timeZoneOffsetLabel(timeZone),
      })
    }
    case 'weekly': {
      const local = utcHourMinuteToLocal(parsed.hour, parsed.minute, timeZone)
      return i18n.t('executions:cron.humanReadable.everyDayOfWeekAt', {
        day: i18n.t(`executions:${DAY_NAME_KEYS[parsed.dayOfWeek]}`),
        time: formatHourMinute(local.hour, local.minute),
        zone: timeZoneOffsetLabel(timeZone),
      })
    }
    default:
      return cronExpr
  }
}

/**
 * Convert a frequency preset to a cron expression string.
 * `hour` and `minute` are UTC.
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
 * Parse a cron expression back into UI-friendly preset values (UTC).
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
