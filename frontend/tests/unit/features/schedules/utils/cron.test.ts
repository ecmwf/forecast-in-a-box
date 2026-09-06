/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cronToHumanReadable,
  formatLocalDateTime,
  frequencyToCron,
  localHourMinuteToUtc,
  parseCronForUI,
  utcHourMinuteToLocal,
} from '@/features/schedules/utils/cron'

describe('parseCronForUI', () => {
  it('parses hourly expressions', () => {
    expect(parseCronForUI('0 * * * *')).toEqual({
      frequency: 'hourly',
      hour: 0,
      minute: 0,
      dayOfWeek: 0,
    })
    expect(parseCronForUI('30 * * * *')?.minute).toBe(30)
  })

  it('parses daily expressions', () => {
    expect(parseCronForUI('0 14 * * *')).toEqual({
      frequency: 'daily',
      hour: 14,
      minute: 0,
      dayOfWeek: 0,
    })
  })

  it('parses weekly expressions', () => {
    expect(parseCronForUI('15 9 * * 1')).toEqual({
      frequency: 'weekly',
      hour: 9,
      minute: 15,
      dayOfWeek: 1,
    })
  })

  it('returns null for non-preset expressions', () => {
    expect(parseCronForUI('0 0 1 * *')).toBeNull() // day-of-month set
    expect(parseCronForUI('not a cron')).toBeNull()
    expect(parseCronForUI('99 14 * * *')).toBeNull() // minute out of range
  })
})

describe('frequencyToCron', () => {
  it('builds cron strings for each frequency', () => {
    expect(frequencyToCron('hourly', 0, 30)).toBe('30 * * * *')
    expect(frequencyToCron('daily', 14, 0)).toBe('0 14 * * *')
    expect(frequencyToCron('weekly', 9, 15, 1)).toBe('15 9 * * 1')
  })
})

describe('cronToHumanReadable', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('describes hourly schedules without timezone conversion', () => {
    expect(cronToHumanReadable('0 * * * *', 'UTC')).toBe('Every hour')
    expect(cronToHumanReadable('30 * * * *', 'UTC')).toBe(
      'Every hour at minute 30',
    )
  })

  it('renders a UTC cron in the app timezone with its offset label', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
    expect(cronToHumanReadable('0 14 * * *', 'Europe/Berlin')).toBe(
      'Every day at 16:00 UTC+2',
    )
    expect(cronToHumanReadable('30 1 * * 1', 'Asia/Kolkata')).toBe(
      'Every Monday at 07:00 UTC+5:30',
    )
  })

  it('returns the raw expression for unrecognized patterns', () => {
    expect(cronToHumanReadable('0 0 1 * *', 'UTC')).toBe('0 0 1 * *')
  })
})

describe('cron time conversion', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // The scheduler evaluates cron in UTC; the browser zone must not leak in.
  it('maps UTC cron hours into the app timezone', () => {
    expect(utcHourMinuteToLocal(8, 0, 'UTC')).toEqual({ hour: 8, minute: 0 })
    expect(utcHourMinuteToLocal(8, 0, 'Asia/Bangkok')).toEqual({
      hour: 15,
      minute: 0,
    })
    expect(utcHourMinuteToLocal(23, 30, 'Asia/Kolkata')).toEqual({
      hour: 5,
      minute: 0,
    })
  })

  it('maps app-timezone hours back to UTC', () => {
    expect(localHourMinuteToUtc(8, 0, 'UTC')).toEqual({ hour: 8, minute: 0 })
    expect(localHourMinuteToUtc(15, 0, 'Asia/Bangkok')).toEqual({
      hour: 8,
      minute: 0,
    })
    expect(localHourMinuteToUtc(5, 0, 'Asia/Kolkata')).toEqual({
      hour: 23,
      minute: 30,
    })
  })

  it('round-trips across zones on both sides of DST', () => {
    const cases = [
      { h: 10, m: 0 },
      { h: 0, m: 30 },
      { h: 23, m: 45 },
    ]
    const zones = ['UTC', 'Europe/Berlin', 'Asia/Kolkata', 'America/New_York']
    for (const date of ['2026-01-15T12:00:00Z', '2026-07-15T12:00:00Z']) {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(date))
      for (const zone of zones) {
        for (const { h, m } of cases) {
          const utc = localHourMinuteToUtc(h, m, zone)
          expect(
            utcHourMinuteToLocal(utc.hour, utc.minute, zone),
            `h=${h} m=${m} zone=${zone} date=${date}`,
          ).toEqual({ hour: h, minute: m })
        }
      }
      vi.useRealTimers()
    }
  })
})

describe('formatLocalDateTime', () => {
  it('formats an instant in the given timezone with an offset label', () => {
    const instant = new Date('2026-03-26T14:20:00Z')
    expect(formatLocalDateTime(instant, 'UTC')).toBe('26/03/2026, 14:20 UTC')
    expect(formatLocalDateTime(instant, 'Asia/Kolkata')).toBe(
      '26/03/2026, 19:50 UTC+5:30',
    )
  })

  it('includes seconds when requested', () => {
    const instant = new Date('2026-03-26T14:20:35Z')
    expect(formatLocalDateTime(instant, 'UTC', { includeSeconds: true })).toBe(
      '26/03/2026, 14:20:35 UTC',
    )
  })
})
