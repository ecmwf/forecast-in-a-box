/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  capitalize,
  formatBytes,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  formatTime,
  truncate,
} from '@/utils/formatters'

describe('formatDate', () => {
  it('formats Date object', () => {
    const date = new Date('2024-01-15T12:00:00')
    const result = formatDate(date)
    expect(result).toMatch(/2024|1\/15|15/)
  })

  it('formats string date', () => {
    const result = formatDate('2024-06-20')
    expect(result).toMatch(/2024|6\/20|20/)
  })

  it('formats timestamp number', () => {
    const timestamp = new Date('2024-03-10').getTime()
    const result = formatDate(timestamp)
    expect(result).toMatch(/2024|3\/10|10/)
  })
})

describe('formatTime', () => {
  it('formats Date object to time string', () => {
    const date = new Date('2024-01-15T14:30:00')
    const result = formatTime(date)
    expect(result).toMatch(/14:30|2:30/)
  })

  it('formats string date to time', () => {
    const result = formatTime('2024-01-15T09:15:00')
    expect(result).toMatch(/9:15|09:15/)
  })
})

describe('formatDateTime', () => {
  it('formats Date object to date-time string', () => {
    const date = new Date('2024-01-15T14:30:00')
    const result = formatDateTime(date)
    expect(result).toMatch(/2024/)
    expect(result).toMatch(/14:30|2:30/)
  })
})

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "just now" for less than 60 seconds ago', () => {
    const date = new Date('2024-06-15T11:59:30')
    expect(formatRelativeTime(date)).toBe('just now')
  })

  it('returns minutes ago for less than 60 minutes', () => {
    const date = new Date('2024-06-15T11:45:00')
    expect(formatRelativeTime(date)).toBe('15 minutes ago')
  })

  it('returns singular minute', () => {
    const date = new Date('2024-06-15T11:59:00')
    expect(formatRelativeTime(date)).toBe('1 minute ago')
  })

  it('returns hours ago for less than 24 hours', () => {
    const date = new Date('2024-06-15T09:00:00')
    expect(formatRelativeTime(date)).toBe('3 hours ago')
  })

  it('returns singular hour', () => {
    const date = new Date('2024-06-15T11:00:00')
    expect(formatRelativeTime(date)).toBe('1 hour ago')
  })

  it('returns days ago for less than 30 days', () => {
    const date = new Date('2024-06-10T12:00:00')
    expect(formatRelativeTime(date)).toBe('5 days ago')
  })

  it('returns singular day', () => {
    const date = new Date('2024-06-14T12:00:00')
    expect(formatRelativeTime(date)).toBe('1 day ago')
  })

  it('returns formatted date for 30+ days ago', () => {
    const date = new Date('2024-05-01T12:00:00')
    const result = formatRelativeTime(date)
    expect(result).toMatch(/2024|5\/1|1/)
  })
})

describe('truncate', () => {
  it('returns original string if shorter than max length', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('returns original string if equal to max length', () => {
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('truncates and adds ellipsis if longer than max length', () => {
    expect(truncate('hello world', 8)).toBe('hello...')
  })

  it('handles very short max length', () => {
    expect(truncate('hello', 4)).toBe('h...')
  })
})

describe('capitalize', () => {
  it('capitalizes first letter', () => {
    expect(capitalize('hello')).toBe('Hello')
  })

  it('lowercases rest of string', () => {
    expect(capitalize('hELLO')).toBe('Hello')
  })

  it('handles empty string', () => {
    expect(capitalize('')).toBe('')
  })

  it('handles single character', () => {
    expect(capitalize('a')).toBe('A')
  })

  it('handles already capitalized string', () => {
    expect(capitalize('Hello')).toBe('Hello')
  })
})

describe('formatNumber', () => {
  it('formats number with separators', () => {
    const result = formatNumber(1234567)
    expect(result).toMatch(/1.*234.*567/)
  })

  it('handles small numbers', () => {
    expect(formatNumber(42)).toBe('42')
  })

  it('handles zero', () => {
    expect(formatNumber(0)).toBe('0')
  })

  it('handles negative numbers', () => {
    const result = formatNumber(-1000)
    expect(result).toMatch(/-.*1.*000/)
  })
})

describe('formatBytes', () => {
  it('returns "0 Bytes" for zero', () => {
    expect(formatBytes(0)).toBe('0 Bytes')
  })

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 Bytes')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1 MB')
    expect(formatBytes(1572864)).toBe('1.5 MB')
  })

  it('formats gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1 GB')
  })

  it('formats terabytes', () => {
    expect(formatBytes(1099511627776)).toBe('1 TB')
  })

  it('respects decimals parameter', () => {
    expect(formatBytes(1536, 0)).toBe('2 KB')
    expect(formatBytes(1536, 1)).toBe('1.5 KB')
    expect(formatBytes(1536, 3)).toBe('1.5 KB')
  })

  it('handles negative decimals as zero', () => {
    expect(formatBytes(1536, -1)).toBe('2 KB')
  })
})
