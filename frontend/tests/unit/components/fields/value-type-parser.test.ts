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
  getDefaultValueForType,
  parseValueType,
} from '@/components/base/fields/value-type-parser'

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
  it('returns empty string for string type', () => {
    expect(getDefaultValueForType({ type: 'string' })).toBe('')
  })

  it('returns "0" for int type', () => {
    expect(getDefaultValueForType({ type: 'int' })).toBe('0')
  })

  it('returns "0.0" for float type', () => {
    expect(getDefaultValueForType({ type: 'float' })).toBe('0.0')
  })

  it('returns today at local midnight for datetime type', () => {
    const result = getDefaultValueForType({ type: 'datetime' })
    // datetime-local compatible: YYYY-MM-DDTHH:mm, time pinned to 00:00
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T00:00$/)
    const today = new Date()
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, '0')
    const d = String(today.getDate()).padStart(2, '0')
    expect(result).toBe(`${y}-${m}-${d}T00:00`)
  })

  it('returns local today for date type', () => {
    const result = getDefaultValueForType({ type: 'date' })
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const today = new Date()
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, '0')
    const d = String(today.getDate()).padStart(2, '0')
    expect(result).toBe(`${y}-${m}-${d}`)
  })

  it('returns empty string for list type', () => {
    expect(getDefaultValueForType({ type: 'list', itemType: 'string' })).toBe(
      '',
    )
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
