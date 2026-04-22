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

    it('returns unknown for unsupported list item type "list[int]"', () => {
      expect(parseValueType('list[int]')).toEqual({
        type: 'unknown',
        raw: 'list[int]',
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

  it('returns ISO datetime string for datetime type', () => {
    const result = getDefaultValueForType({ type: 'datetime' })
    // Should be a datetime-local compatible string (YYYY-MM-DDTHH:mm)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('returns ISO date string for date type', () => {
    const result = getDefaultValueForType({ type: 'date' })
    // Should be a date string (YYYY-MM-DD)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
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
