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
  displayKindOf,
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
      expect(parseValueType('list[enumClosed[str](2t,msl)]')).toEqual({
        type: 'enumList',
        options: ['2t', 'msl'],
        closed: true,
      })
    })

    it('parses list with open enum item type', () => {
      expect(parseValueType("list[enum[str]('a','b')]")).toEqual({
        type: 'enumList',
        options: ['a', 'b'],
        closed: false,
      })
    })
  })

  describe('enum types', () => {
    it('parses single-quoted enum options', () => {
      expect(parseValueType("enum[str]('a','b','c')")).toEqual({
        type: 'enum',
        options: ['a', 'b', 'c'],
        closed: false,
      })
    })

    it('parses double-quoted enum options', () => {
      expect(parseValueType('enum[str]("x","y","z")')).toEqual({
        type: 'enum',
        options: ['x', 'y', 'z'],
        closed: false,
      })
    })

    it('parses enum with single option', () => {
      expect(parseValueType("enum[str]('only')")).toEqual({
        type: 'enum',
        options: ['only'],
        closed: false,
      })
    })

    it('parses enumClosed options', () => {
      expect(
        parseValueType("enumClosed[str]('mars','ecmwf-open-data')"),
      ).toEqual({
        type: 'enum',
        options: ['mars', 'ecmwf-open-data'],
        closed: true,
      })
    })

    it('parses unquoted enumClosed options', () => {
      expect(parseValueType('enumClosed[str](2t,msl)')).toEqual({
        type: 'enum',
        options: ['2t', 'msl'],
        closed: true,
      })
    })

    // anemoiSource.input_source ships this (the serializer emits no
    // spaces after commas; tolerate both).
    it('parses enumOpen options as an open enum', () => {
      expect(
        parseValueType("enumOpen[str]('mars', 'opendata', 'polytope')"),
      ).toEqual({
        type: 'enum',
        options: ['mars', 'opendata', 'polytope'],
        closed: false,
      })
    })

    it('parses int-subtype enums as selects over the wire strings', () => {
      expect(parseValueType('enumClosed[int](1,2,3)')).toEqual({
        type: 'enum',
        options: ['1', '2', '3'],
        closed: true,
      })
    })

    it('parses float-subtype enums', () => {
      expect(parseValueType('enumOpen[float](0.5,1.5)')).toEqual({
        type: 'enum',
        options: ['0.5', '1.5'],
        closed: false,
      })
    })

    it('parses a list of int-subtype enums as a closed multi-select', () => {
      expect(parseValueType('list[enumClosed[int](1,2)]')).toEqual({
        type: 'enumList',
        options: ['1', '2'],
        closed: true,
      })
    })

    it('falls back to unknown for unsupported enum subtypes', () => {
      expect(
        parseValueType('enumClosed[datetime](2026-01-01T00:00:00)'),
      ).toEqual({
        type: 'unknown',
        raw: 'enumClosed[datetime](2026-01-01T00:00:00)',
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

    // Grammar-valid since fiab-core #691/#704 but still widget-less: they
    // must land on the text fallback, not be rejected.
    it('returns unknown for timedelta and none-bearing unions', () => {
      expect(parseValueType('timedelta')).toEqual({
        type: 'unknown',
        raw: 'timedelta',
      })
      expect(parseValueType('union[str,none]')).toEqual({
        type: 'unknown',
        raw: 'union[str,none]',
      })
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
      expect(parseValueType("optional[enum[str]('a','b')]")).toEqual({
        type: 'enum',
        options: ['a', 'b'],
        closed: false,
        optional: true,
      })
    })

    it('preserves enumClosed options when wrapped', () => {
      expect(parseValueType("optional[enumClosed[str]('mean','std')]")).toEqual(
        {
          type: 'enum',
          options: ['mean', 'std'],
          closed: true,
          optional: true,
        },
      )
    })

    it('marks unknown inner as optional unknown', () => {
      expect(parseValueType('optional[weirdo]')).toEqual({
        type: 'unknown',
        raw: 'weirdo',
        optional: true,
      })
    })
  })

  describe('artifact and param types', () => {
    it('parses "artifact" as a catalogue picker', () => {
      expect(parseValueType('artifact')).toEqual({ type: 'artifact' })
    })

    it('parses "param" as string', () => {
      expect(parseValueType('param')).toEqual({ type: 'string' })
    })

    it('parses optional[artifact] as a picker with optional flag', () => {
      expect(parseValueType('optional[artifact]')).toEqual({
        type: 'artifact',
        optional: true,
      })
    })

    it('parses enumClosed[artifact] as a picker restricted to its ids', () => {
      expect(
        parseValueType("enumClosed[artifact]('ecmwf:aifs-a','ecmwf:aifs-b')"),
      ).toEqual({
        type: 'artifact',
        options: ['ecmwf:aifs-a', 'ecmwf:aifs-b'],
      })
    })

    it('parses enumOpen[param] as a labelled enum', () => {
      expect(parseValueType("enumOpen[param]('167','151')")).toEqual({
        type: 'enum',
        options: ['167', '151'],
        closed: false,
        lookup: 'param',
      })
    })

    it('parses list[enumClosed[param]] as a labelled enum list', () => {
      expect(parseValueType("list[enumClosed[param]('167','151')]")).toEqual({
        type: 'enumList',
        options: ['167', '151'],
        closed: true,
        lookup: 'param',
      })
    })

    it('parses list[param] as a labelled tag list', () => {
      expect(parseValueType('list[param]')).toEqual({
        type: 'list',
        itemType: 'string',
        lookup: 'param',
      })
    })

    it('keeps str enums unlabelled', () => {
      expect(
        parseValueType("list[enumClosed[str]('a','b')]"),
      ).not.toHaveProperty('lookup')
    })
  })

  describe('displayKindOf', () => {
    it.each([
      ['param', 'param'],
      ['list[param]', 'param'],
      ["enumClosed[param]('167')", 'param'],
      ["list[enumClosed[param]('167','151')]", 'param'],
      ['artifact', 'artifact'],
      ["enumClosed[artifact]('ecmwf:a')", 'artifact'],
      ['str', null],
      ["list[enumClosed[str]('a')]", null],
      ['int{positive}', null],
      [undefined, null],
      ['not a type[[', null],
    ])('%s → %s', (valueType, kind) => {
      expect(displayKindOf(valueType)).toBe(kind)
    })
  })

  describe('geodomain type', () => {
    it('parses "geodomain"', () => {
      expect(parseValueType('geodomain')).toEqual({ type: 'geodomain' })
    })

    it('is case-insensitive', () => {
      expect(parseValueType('GeoDomain')).toEqual({ type: 'geodomain' })
    })

    it('parses optional[geodomain] with optional flag', () => {
      expect(parseValueType('optional[geodomain]')).toEqual({
        type: 'geodomain',
        optional: true,
      })
    })
  })

  describe('traits', () => {
    // *TODO* once traits feed the UI, assert on the parsed trait info
    // instead of just the base widget type.
    it('ignores a trailing traits suffix on a plain type', () => {
      expect(parseValueType('int{positive}')).toEqual({ type: 'int' })
    })

    it('ignores a traits suffix with an argument', () => {
      expect(parseValueType('float{nonNegative,divisibleBy(3)}')).toEqual({
        type: 'float',
      })
    })

    it('ignores a traits suffix nested inside a list', () => {
      expect(parseValueType('list[int{positive}]')).toEqual({
        type: 'list',
        itemType: 'int',
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

  it('returns the first restricted id for an artifact picker', () => {
    expect(
      getDefaultValueForType({ type: 'artifact', options: ['ecmwf:a'] }),
    ).toBe('ecmwf:a')
    expect(getDefaultValueForType({ type: 'artifact' })).toBe('')
  })

  it('returns empty string for enum list type', () => {
    expect(
      getDefaultValueForType({
        type: 'enumList',
        options: ['2t', 'msl'],
        closed: true,
      }),
    ).toBe('')
  })

  it('returns first option for enum type', () => {
    expect(
      getDefaultValueForType({
        type: 'enum',
        options: ['alpha', 'beta'],
        closed: true,
      }),
    ).toBe('alpha')
  })

  it('returns empty string for enum with no options', () => {
    expect(
      getDefaultValueForType({ type: 'enum', options: [], closed: true }),
    ).toBe('')
  })

  it('returns empty string for unknown type', () => {
    expect(getDefaultValueForType({ type: 'unknown', raw: 'xyz' })).toBe('')
  })

  it('returns empty string for geodomain', () => {
    expect(getDefaultValueForType({ type: 'geodomain' })).toBe('')
  })
})
