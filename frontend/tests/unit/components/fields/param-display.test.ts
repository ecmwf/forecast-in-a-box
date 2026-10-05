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
  formatUnits,
  listItems,
  paramLabel,
  paramListLabel,
  parseParamDisplay,
} from '@/components/base/fields/param-display'
import { matchesParam } from '@/components/base/fields/fields/ParamOptionLabel'

const labels: ReadonlyMap<string, string> = new Map([
  ['167', '2 metre temperature [K] (2t)'],
  ['129', 'Geopotential [m**2 s**-2] (z)'],
])

describe('parseParamDisplay', () => {
  it('splits name, units and shortname', () => {
    expect(parseParamDisplay('2 metre temperature [K] (2t)')).toEqual({
      name: '2 metre temperature',
      units: 'K',
      short: '2t',
    })
  })

  it('keeps compound units intact', () => {
    expect(parseParamDisplay('Geopotential [m**2 s**-2] (z)').units).toBe(
      'm**2 s**-2',
    )
  })

  it('falls back to the whole string when the format differs', () => {
    expect(parseParamDisplay('Something else')).toEqual({
      name: 'Something else',
    })
  })
})

describe('formatUnits', () => {
  it('turns ecCodes exponents into superscripts', () => {
    expect(formatUnits('m**2 s**-2')).toBe('m\u00B2 s\u207B\u00B2')
    expect(formatUnits('m s**-1')).toBe('m s\u207B\u00B9')
  })

  it('leaves plain units alone', () => {
    expect(formatUnits('K')).toBe('K')
  })
})

describe('paramLabel', () => {
  it('gives the shortname compact and the backend string full', () => {
    expect(paramLabel('167', labels, 'compact')).toBe('2t')
    expect(paramLabel('167', labels, 'full')).toBe(
      '2 metre temperature [K] (2t)',
    )
  })

  it('formats the units of the full label', () => {
    expect(paramLabel('129', labels, 'full')).toBe(
      'Geopotential [m\u00B2 s\u207B\u00B2] (z)',
    )
  })

  it('returns the raw id when unresolved', () => {
    expect(paramLabel('999', labels, 'compact')).toBe('999')
  })
})

describe('paramListLabel', () => {
  it('labels every item of a list value', () => {
    expect(paramListLabel('167, 129,999', labels, 'compact')).toBe('2t, z, 999')
  })
})

describe('listItems', () => {
  it('splits, trims and drops blanks', () => {
    expect(listItems(' 167,,151 ')).toEqual(['167', '151'])
  })
})

describe('matchesParam', () => {
  it.each([
    ['167', true],
    ['TEMPERATURE', true],
    ['2t', true],
    ['[k]', true],
    ['pressure', false],
  ])('query %s → %s', (query, expected) => {
    expect(matchesParam('167', query, labels)).toBe(expected)
  })

  it('matches everything on an empty query', () => {
    expect(matchesParam('999', '  ', labels)).toBe(true)
  })
})
