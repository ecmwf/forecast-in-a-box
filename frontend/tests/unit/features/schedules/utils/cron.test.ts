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
  localHourMinuteToServer,
  parseCronForUI,
  serverHourMinuteToLocal,
} from '@/features/schedules/utils/cron'
import { timeZoneOffsetLabel } from '@/lib/datetime'

const MIN = 60_000

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
    expect(cronToHumanReadable('0 * * * *', 0, 'UTC')).toBe('Every hour')
    expect(cronToHumanReadable('30 * * * *', 0, 'UTC')).toBe(
      'Every hour at minute 30',
    )
  })

  it('falls back to "(server time)" when the offset is unknown', () => {
    expect(cronToHumanReadable('0 14 * * *', null, 'UTC')).toBe(
      'Every day at 14:00 (server time)',
    )
    expect(cronToHumanReadable('30 9 * * 1', null, 'UTC')).toBe(
      'Every Monday at 09:30 (server time)',
    )
  })

  it('renders a converted daily cron with the app-timezone label', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
    const result = cronToHumanReadable('0 14 * * *', 120 * MIN, 'Europe/Berlin')
    expect(result).toMatch(/^Every day at \d{2}:\d{2} /)
    expect(result).toContain(timeZoneOffsetLabel('Europe/Berlin'))
  })

  it('returns the raw expression for unrecognized patterns', () => {
    expect(cronToHumanReadable('0 0 1 * *', 0, 'UTC')).toBe('0 0 1 * *')
  })
})

describe('cron time round-trip', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('round-trips local <-> server hour:minute across zones, offsets and DST', () => {
    const cases = [
      { h: 10, m: 0 },
      { h: 0, m: 30 },
      { h: 23, m: 45 },
    ]
    const offsets = [0, 120 * MIN, -300 * MIN, 90 * MIN]
    const zones = ['UTC', 'Europe/Berlin', 'Asia/Kolkata']
    // Winter and summer pins exercise both sides of a DST transition.
    const dates = ['2026-01-15T12:00:00Z', '2026-07-15T12:00:00Z']

    for (const date of dates) {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(date))
      for (const zone of zones) {
        for (const offset of offsets) {
          for (const { h, m } of cases) {
            const server = localHourMinuteToServer(h, m, offset, zone)
            const back = serverHourMinuteToLocal(
              server.hour,
              server.minute,
              offset,
              zone,
            )
            expect(
              back,
              `h=${h} m=${m} zone=${zone} offset=${offset} date=${date}`,
            ).toEqual({ hour: h, minute: m })
          }
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
