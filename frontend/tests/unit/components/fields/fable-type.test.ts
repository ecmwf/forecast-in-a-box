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
  artifactType,
  closedEnum,
  dateType,
  datetimeType,
  floatType,
  geodomainType,
  intType,
  listOf,
  openEnum,
  paramType,
  parseFableType,
  serializeValueType,
  stringType,
  unionOf,
} from '@/components/base/fields/fable-type'

describe('serializeValueType', () => {
  // Pinned to the exact strings fiab-core's FableType.serialize() emits —
  // if one of these fails, the backend grammar moved and the whole module
  // needs re-alignment, not just the test.
  it('serializes atoms to the backend wire strings', () => {
    expect(serializeValueType(stringType)).toBe('str')
    expect(serializeValueType(intType)).toBe('int')
    expect(serializeValueType(floatType)).toBe('float')
    expect(serializeValueType(dateType)).toBe('date')
    expect(serializeValueType(datetimeType)).toBe('datetime')
    expect(serializeValueType(geodomainType)).toBe('geodomain')
    expect(serializeValueType(artifactType)).toBe('artifact')
    expect(serializeValueType(paramType)).toBe('param')
  })

  // fiab-core `_serialize_enum_item` dispatches on the declared subtype.
  it('leaves date and datetime enum items unquoted', () => {
    expect(serializeValueType(closedEnum(['2026-01-01'], dateType))).toBe(
      'enumClosed[date](2026-01-01)',
    )
    expect(
      serializeValueType(openEnum(['2026-01-01T00:00:00'], datetimeType)),
    ).toBe('enumOpen[datetime](2026-01-01T00:00:00)')
    // str-ish subtypes stay quoted, including artifact and param.
    expect(serializeValueType(closedEnum(['fc:t:step0'], artifactType))).toBe(
      "enumClosed[artifact]('fc:t:step0')",
    )
  })

  // Real emitters from fiab-plugin-ecmwf blocks.py / anemoi blocks.py.
  it('serializes enums exactly like the backend emitters', () => {
    expect(serializeValueType(closedEnum(['mars', 'ecmwf-open-data']))).toBe(
      "enumClosed[str]('mars','ecmwf-open-data')",
    )
    expect(serializeValueType(closedEnum(['png', 'pdf', 'svg']))).toBe(
      "enumClosed[str]('png','pdf','svg')",
    )
    expect(serializeValueType(openEnum(['mars', 'opendata', 'polytope']))).toBe(
      "enumOpen[str]('mars','opendata','polytope')",
    )
  })

  it('serializes numeric enums with inferred subtype and unquoted items', () => {
    expect(serializeValueType(closedEnum([1, 2, 3]))).toBe(
      'enumClosed[int](1,2,3)',
    )
    expect(serializeValueType(openEnum([0.5, 1.5]))).toBe(
      'enumOpen[float](0.5,1.5)',
    )
  })

  it('serializes lists and unions recursively', () => {
    expect(serializeValueType(listOf(stringType))).toBe('list[str]')
    expect(serializeValueType(listOf(closedEnum(['2t', 'msl'])))).toBe(
      "list[enumClosed[str]('2t','msl')]",
    )
    expect(serializeValueType(unionOf([intType, stringType]))).toBe(
      'union[int,str]',
    )
  })
})

describe('parseFableType', () => {
  it('round-trips every representative type', () => {
    const representatives = [
      stringType,
      intType,
      floatType,
      dateType,
      datetimeType,
      geodomainType,
      artifactType,
      paramType,
      closedEnum(['mars', 'ecmwf-open-data']),
      closedEnum(['fc:t:step0', 'fc:t:step6'], artifactType),
      closedEnum(['2026-01-01', '2026-01-02'], dateType),
      openEnum(['2026-01-01T00:00:00'], datetimeType),
      listOf(closedEnum(['2026-01-01'], dateType)),
      openEnum(['mars', 'opendata', 'polytope']),
      closedEnum([1, 2, 3]),
      openEnum([0.5, 1.5]),
      listOf(stringType),
      listOf(intType),
      listOf(closedEnum(['2t', 'msl'])),
      unionOf([intType, stringType]),
      unionOf([listOf(intType), closedEnum(['a', 'b'])]),
    ]
    for (const t of representatives) {
      expect(parseFableType(serializeValueType(t))).toEqual(t)
    }
  })

  it('tolerates legacy aliases, casing, spaces, and unquoted items', () => {
    expect(parseFableType('date-iso8601')).toEqual(dateType)
    expect(parseFableType('Integer')).toEqual(intType)
    expect(parseFableType('number')).toEqual(floatType)
    expect(parseFableType('List[String]')).toEqual(listOf(stringType))
    expect(parseFableType("enumOpen[str]('mars', 'opendata')")).toEqual(
      openEnum(['mars', 'opendata']),
    )
    expect(parseFableType('enumClosed[str](2t,msl)')).toEqual(
      closedEnum(['2t', 'msl']),
    )
    // Legacy bare `enum` reads as the open form.
    expect(parseFableType("enum[str]('a')")).toEqual(openEnum(['a']))
  })

  it('rejects strings outside the grammar', () => {
    expect(parseFableType('foobar')).toBeNull()
    expect(parseFableType('enumClosed[str]()')).toBeNull()
    expect(parseFableType('list[foobar]')).toBeNull()
    expect(parseFableType('str trailing')).toBeNull()
    expect(parseFableType('union[]')).toBeNull()
    // optional[] left the canonical grammar in #570 — the widget
    // projection peels it, the grammar itself does not.
    expect(parseFableType('optional[int]')).toBeNull()
  })
})
