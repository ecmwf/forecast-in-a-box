/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  convertNaive,
  formatInZone,
  getAppTimeZone,
  instantToZonedNaive,
  isValidTimeZone,
  listTimeZones,
  nowPartsInZone,
  timeZoneAbbreviation,
  timeZoneOffsetLabel,
  todayInZone,
  zonedNaiveToInstant,
} from '@/lib/datetime'
import { useUiStore } from '@/stores/uiStore'

const ROUND_TRIP_ZONES = [
  'UTC',
  'Europe/Berlin',
  'America/New_York',
  'Asia/Kolkata', // +5:30 — half-hour offset
  'Asia/Kathmandu', // +5:45 — quarter-hour offset
  'Pacific/Chatham', // +12:45 / +13:45
]

describe('zonedNaiveToInstant / instantToZonedNaive', () => {
  it('interprets a naive string as wall-clock time in the zone', () => {
    // Berlin in May is CEST (UTC+2): 00:00 local == 22:00 UTC the day before.
    expect(
      zonedNaiveToInstant('2026-05-15T00:00:00', 'Europe/Berlin').toISOString(),
    ).toBe('2026-05-14T22:00:00.000Z')
    expect(
      zonedNaiveToInstant('2026-05-15T00:00:00', 'UTC').toISOString(),
    ).toBe('2026-05-15T00:00:00.000Z')
  })

  it('renders an instant as the naive wall-clock string in the zone', () => {
    expect(
      instantToZonedNaive(new Date('2026-05-14T22:00:00Z'), 'Europe/Berlin'),
    ).toBe('2026-05-15T00:00:00')
    expect(instantToZonedNaive(new Date('2026-05-15T00:00:00Z'), 'UTC')).toBe(
      '2026-05-15T00:00:00',
    )
  })

  it('round-trips naive -> instant -> naive in every zone', () => {
    const naive = '2026-07-15T13:45:30'
    for (const zone of ROUND_TRIP_ZONES) {
      expect(instantToZonedNaive(zonedNaiveToInstant(naive, zone), zone)).toBe(
        naive,
      )
    }
  })

  it('accepts a naive string without seconds (defaults to :00)', () => {
    expect(zonedNaiveToInstant('2026-05-15T06:30', 'UTC').toISOString()).toBe(
      '2026-05-15T06:30:00.000Z',
    )
  })

  it('returns an invalid Date for non-date-time input', () => {
    expect(Number.isNaN(zonedNaiveToInstant('', 'UTC').getTime())).toBe(true)
    expect(Number.isNaN(zonedNaiveToInstant('${glyph}', 'UTC').getTime())).toBe(
      true,
    )
    expect(
      Number.isNaN(zonedNaiveToInstant('2026-05-15', 'UTC').getTime()),
    ).toBe(true)
  })

  it('handles the spring-forward DST gap without crashing', () => {
    // 2026-03-29 02:30 does not exist in Europe/Berlin (02:00 -> 03:00).
    const instant = zonedNaiveToInstant('2026-03-29T02:30:00', 'Europe/Berlin')
    expect(Number.isNaN(instant.getTime())).toBe(false)
    expect(instantToZonedNaive(instant, 'Europe/Berlin')).toMatch(
      /^2026-03-29T0[0-9]:30:00$/,
    )
  })

  it('round-trips cleanly through the fall-back DST overlap', () => {
    // 2026-10-25 02:30 occurs twice in Europe/Berlin (03:00 -> 02:00).
    const naive = '2026-10-25T02:30:00'
    const instant = zonedNaiveToInstant(naive, 'Europe/Berlin')
    expect(Number.isNaN(instant.getTime())).toBe(false)
    expect(instantToZonedNaive(instant, 'Europe/Berlin')).toBe(naive)
  })
})

describe('convertNaive', () => {
  it('is the identity when the zones match', () => {
    expect(convertNaive('2026-05-15T00:00:00', 'UTC', 'UTC')).toBe(
      '2026-05-15T00:00:00',
    )
  })

  it('converts UTC wall-clock to another zone and back', () => {
    expect(convertNaive('2026-05-15T00:00:00', 'UTC', 'Europe/Berlin')).toBe(
      '2026-05-15T02:00:00',
    )
    expect(convertNaive('2026-05-15T02:00:00', 'Europe/Berlin', 'UTC')).toBe(
      '2026-05-15T00:00:00',
    )
  })

  it('round-trips through a zone', () => {
    const utc = '2026-01-15T12:34:56'
    const berlin = convertNaive(utc, 'UTC', 'Europe/Berlin')
    expect(convertNaive(berlin, 'Europe/Berlin', 'UTC')).toBe(utc)
  })

  it('passes non-date-time input through unchanged', () => {
    expect(convertNaive('', 'UTC', 'Europe/Berlin')).toBe('')
    expect(convertNaive('${baseDate}', 'UTC', 'Europe/Berlin')).toBe(
      '${baseDate}',
    )
    expect(convertNaive('not a date', 'UTC', 'Europe/Berlin')).toBe(
      'not a date',
    )
  })
})

describe('todayInZone', () => {
  it('resolves the calendar date in the target zone across a UTC day boundary', () => {
    const instant = new Date('2026-05-15T23:30:00Z')
    expect(todayInZone('UTC', instant)).toBe('2026-05-15')
    expect(todayInZone('Asia/Tokyo', instant)).toBe('2026-05-16') // +9h
    expect(todayInZone('America/Los_Angeles', instant)).toBe('2026-05-15') // -7h
  })
})

describe('nowPartsInZone', () => {
  it('extracts wall-clock parts in the zone', () => {
    const instant = new Date('2026-05-15T08:30:45Z')
    expect(nowPartsInZone('UTC', instant)).toEqual({
      year: 2026,
      month: 5,
      day: 15,
      hour: 8,
      minute: 30,
      second: 45,
    })
    expect(nowPartsInZone('Europe/Berlin', instant).hour).toBe(10) // CEST +2
  })
})

describe('formatInZone', () => {
  it('formats the same instant differently per zone', () => {
    const instant = new Date('2026-05-15T00:00:00Z')
    expect(formatInZone(instant, 'UTC', 'yyyy-MM-dd HH:mm')).toBe(
      '2026-05-15 00:00',
    )
    expect(formatInZone(instant, 'Europe/Berlin', 'yyyy-MM-dd HH:mm')).toBe(
      '2026-05-15 02:00',
    )
  })

  it('accepts epoch ms and ISO strings', () => {
    const epoch = Date.parse('2026-05-15T00:00:00Z')
    expect(formatInZone(epoch, 'UTC', 'HH:mm')).toBe('00:00')
    expect(formatInZone('2026-05-15T00:00:00Z', 'UTC', 'HH:mm')).toBe('00:00')
  })

  it('returns an empty string for an invalid input', () => {
    expect(formatInZone('not a date', 'UTC', 'HH:mm')).toBe('')
  })
})

describe('timeZoneOffsetLabel', () => {
  const summer = new Date('2026-07-15T12:00:00Z')
  const winter = new Date('2026-01-15T12:00:00Z')

  it('labels UTC as UTC', () => {
    expect(timeZoneOffsetLabel('UTC', summer)).toBe('UTC')
  })

  it('reflects DST for whole-hour offsets', () => {
    expect(timeZoneOffsetLabel('Europe/Berlin', summer)).toBe('UTC+2')
    expect(timeZoneOffsetLabel('Europe/Berlin', winter)).toBe('UTC+1')
    expect(timeZoneOffsetLabel('America/New_York', summer)).toBe('UTC-4')
  })

  it('renders sub-hour offsets', () => {
    expect(timeZoneOffsetLabel('Asia/Kolkata', summer)).toBe('UTC+5:30')
  })
})

describe('timeZoneAbbreviation', () => {
  it('returns a short name for the zone', () => {
    expect(timeZoneAbbreviation('UTC')).toBe('UTC')
    expect(timeZoneAbbreviation('America/New_York').length).toBeGreaterThan(0)
  })

  it('falls back to the identifier for an unknown zone', () => {
    expect(timeZoneAbbreviation('Mars/Olympus')).toBe('Mars/Olympus')
  })
})

describe('isValidTimeZone', () => {
  it('accepts IANA identifiers and UTC', () => {
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Europe/Berlin')).toBe(true)
  })

  it('rejects unknown or empty values', () => {
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })
})

describe('listTimeZones', () => {
  it('returns a non-empty list including UTC and common zones', () => {
    const zones = listTimeZones()
    expect(zones.length).toBeGreaterThan(0)
    expect(zones).toContain('UTC')
    expect(zones).toContain('Europe/Berlin')
  })
})

describe('getAppTimeZone', () => {
  afterEach(() => {
    useUiStore.getState().reset()
  })

  it('returns the store timezone', () => {
    useUiStore.setState({ timeZone: 'Europe/Berlin' })
    expect(getAppTimeZone()).toBe('Europe/Berlin')
  })

  it('defaults to UTC', () => {
    expect(getAppTimeZone()).toBe('UTC')
  })

  it('falls back to UTC when the store holds an invalid zone', () => {
    useUiStore.setState({ timeZone: 'Mars/Olympus' })
    expect(getAppTimeZone()).toBe('UTC')
  })
})
