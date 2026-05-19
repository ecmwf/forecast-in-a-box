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
  getDefaultValueForType,
  parseValueType,
} from '@/components/base/fields/value-type-parser'
import { useUiStore } from '@/stores/uiStore'

describe('parseValueType', () => {
  describe('simple types', () => {
    it('returns string for undefined', () => {
      expect(parseValueType(undefined)).toEqual({ type: 'string' })
    })

    it('returns string for "str"', () => {
      expect(parseValueType('str')).toEqual({ type: 'string' })
    })

    it('returns string for "string"', () => {
      expect(parseValueType('string')).toEqual({ type: 'string' })
    })

    it('returns int for "int"', () => {
      expect(parseValueType('int')).toEqual({ type: 'int' })
    })

    it('returns int for "integer"', () => {
      expect(parseValueType('integer')).toEqual({ type: 'int' })
    })

    it('returns float for "float"', () => {
      expect(parseValueType('float')).toEqual({ type: 'float' })
    })

    it('returns float for "number"', () => {
      expect(parseValueType('number')).toEqual({ type: 'float' })
    })

    it('returns datetime for "datetime"', () => {
      expect(parseValueType('datetime')).toEqual({ type: 'datetime' })
    })

    it('returns date for "date-iso8601"', () => {
      expect(parseValueType('date-iso8601')).toEqual({ type: 'date' })
    })

    it('returns date for "date"', () => {
      expect(parseValueType('date')).toEqual({ type: 'date' })
    })
  })

  describe('list types', () => {
    it('returns list with string itemType for "list[str]"', () => {
      expect(parseValueType('list[str]')).toEqual({
        type: 'list',
        itemType: 'string',
      })
    })

    it('returns list with string itemType for "list[string]"', () => {
      expect(parseValueType('list[string]')).toEqual({
        type: 'list',
        itemType: 'string',
      })
    })

    it('parses list with int item type "list[int]"', () => {
      expect(parseValueType('list[int]')).toEqual({
        type: 'list',
        itemType: 'int',
      })
    })

    it('parses list with closed enum item type', () => {
      expect(parseValueType('list[enumClosed[2t,msl]]')).toEqual({
        type: 'enumList',
        options: ['2t', 'msl'],
      })
    })
  })

  describe('enum types', () => {
    it('parses single-quoted enum options', () => {
      expect(parseValueType("enum['a','b','c']")).toEqual({
        type: 'enum',
        options: ['a', 'b', 'c'],
      })
    })

    it('parses double-quoted enum options', () => {
      expect(parseValueType('enum["x","y","z"]')).toEqual({
        type: 'enum',
        options: ['x', 'y', 'z'],
      })
    })

    it('parses enum with single option', () => {
      expect(parseValueType("enum['only']")).toEqual({
        type: 'enum',
        options: ['only'],
      })
    })

    it('parses enumClosed options', () => {
      expect(parseValueType("enumClosed['mars','ecmwf-open-data']")).toEqual({
        type: 'enum',
        options: ['mars', 'ecmwf-open-data'],
      })
    })

    it('parses unquoted enumClosed options', () => {
      expect(parseValueType('enumClosed[2t,msl]')).toEqual({
        type: 'enum',
        options: ['2t', 'msl'],
      })
    })
  })

  describe('whitespace and case handling', () => {
    it('trims whitespace', () => {
      expect(parseValueType('  str  ')).toEqual({ type: 'string' })
    })

    it('handles uppercase input', () => {
      expect(parseValueType('STR')).toEqual({ type: 'string' })
    })

    it('handles mixed case input', () => {
      expect(parseValueType('Integer')).toEqual({ type: 'int' })
    })

    it('handles case-insensitive list types', () => {
      expect(parseValueType('List[Str]')).toEqual({
        type: 'list',
        itemType: 'string',
      })
    })
  })

  describe('unknown types', () => {
    it('returns unknown for unrecognized string', () => {
      expect(parseValueType('foobar')).toEqual({
        type: 'unknown',
        raw: 'foobar',
      })
    })

    it('returns unknown for empty string', () => {
      expect(parseValueType('')).toEqual({ type: 'string' })
    })
  })

  describe('optional types', () => {
    it('parses optional[int] as int with optional flag', () => {
      expect(parseValueType('optional[int]')).toEqual({
        type: 'int',
        optional: true,
      })
    })

    it('parses optional[str] as string with optional flag', () => {
      expect(parseValueType('optional[str]')).toEqual({
        type: 'string',
        optional: true,
      })
    })

    it('parses optional[float] as float with optional flag', () => {
      expect(parseValueType('optional[float]')).toEqual({
        type: 'float',
        optional: true,
      })
    })

    it('is case-insensitive', () => {
      expect(parseValueType('Optional[Int]')).toEqual({
        type: 'int',
        optional: true,
      })
    })

    it('preserves inner details (list itemType) when wrapped', () => {
      expect(parseValueType('optional[list[int]]')).toEqual({
        type: 'list',
        itemType: 'int',
        optional: true,
      })
    })

    it('preserves enum options when wrapped', () => {
      expect(parseValueType("optional[enum['a','b']]")).toEqual({
        type: 'enum',
        options: ['a', 'b'],
        optional: true,
      })
    })

    it('preserves enumClosed options when wrapped', () => {
      expect(parseValueType("optional[enumClosed['mean','std']]")).toEqual({
        type: 'enum',
        options: ['mean', 'std'],
        optional: true,
      })
    })

    it('marks unknown inner as optional unknown', () => {
      expect(parseValueType('optional[weirdo]')).toEqual({
        type: 'unknown',
        raw: 'weirdo',
        optional: true,
      })
    })
  })
})

describe('getDefaultValueForType', () => {
  afterEach(() => {
    vi.useRealTimers()
    useUiStore.getState().reset()
  })

  it('returns empty string for string type', () => {
    expect(getDefaultValueForType({ type: 'string' })).toBe('')
  })

  it('returns "0" for int type', () => {
    expect(getDefaultValueForType({ type: 'int' })).toBe('0')
  })

  it('returns "0.0" for float type', () => {
    expect(getDefaultValueForType({ type: 'float' })).toBe('0.0')
  })

  it('returns today at 00:00 UTC for datetime type', () => {
    vi.useFakeTimers()
    // 23:30 UTC — a later calendar date in many browser timezones.
    vi.setSystemTime(new Date('2026-05-15T23:30:00Z'))
    expect(getDefaultValueForType({ type: 'datetime' })).toBe(
      '2026-05-15T00:00:00',
    )
  })

  it('keeps the datetime default in UTC regardless of the app timezone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-15T23:30:00Z'))
    useUiStore.setState({ timeZone: 'Asia/Tokyo' })
    expect(getDefaultValueForType({ type: 'datetime' })).toBe(
      '2026-05-15T00:00:00',
    )
  })

  it('returns today in the app timezone for date type', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-15T23:30:00Z'))
    useUiStore.setState({ timeZone: 'UTC' })
    expect(getDefaultValueForType({ type: 'date' })).toBe('2026-05-15')
    useUiStore.setState({ timeZone: 'Asia/Tokyo' }) // +9h -> next calendar day
    expect(getDefaultValueForType({ type: 'date' })).toBe('2026-05-16')
  })

  it('returns empty string for list type', () => {
    expect(getDefaultValueForType({ type: 'list', itemType: 'string' })).toBe(
      '',
    )
  })

  it('returns empty string for enum list type', () => {
    expect(
      getDefaultValueForType({ type: 'enumList', options: ['2t', 'msl'] }),
    ).toBe('')
  })

  it('returns first option for enum type', () => {
    expect(
      getDefaultValueForType({ type: 'enum', options: ['alpha', 'beta'] }),
    ).toBe('alpha')
  })

  it('returns empty string for enum with no options', () => {
    expect(getDefaultValueForType({ type: 'enum', options: [] })).toBe('')
  })

  it('returns empty string for unknown type', () => {
    expect(getDefaultValueForType({ type: 'unknown', raw: 'xyz' })).toBe('')
  })
})
