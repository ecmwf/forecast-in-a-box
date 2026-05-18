/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import {
  capitalize,
  formatDate,
  formatDateTime,
  formatTime,
  truncate,
} from '@/utils/formatters'

describe('formatDate', () => {
  it('formats Date object', () => {
    const date = new Date('2024-01-15T12:00:00Z')
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
    const date = new Date('2024-01-15T14:30:00Z')
    const result = formatTime(date)
    expect(result).toMatch(/14:30|2:30/)
  })

  it('formats string date to time', () => {
    const result = formatTime('2024-01-15T09:15:00Z')
    expect(result).toMatch(/9:15|09:15/)
  })
})

describe('formatDateTime', () => {
  it('formats Date object to date-time string', () => {
    const date = new Date('2024-01-15T14:30:00Z')
    const result = formatDateTime(date)
    expect(result).toMatch(/2024/)
    expect(result).toMatch(/14:30|2:30/)
  })

  it('renders the same instant differently per timezone', () => {
    const instant = new Date('2024-01-15T20:00:00Z')
    expect(formatDateTime(instant, 'UTC')).not.toBe(
      formatDateTime(instant, 'Asia/Tokyo'),
    )
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
