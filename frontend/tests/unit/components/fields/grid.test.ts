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
import type { GridSpec } from '@/components/base/fields/fields/grid'
import {
  DEFAULT_GRID_SUGGESTIONS,
  canonicalGrid,
  gridPoints,
  gridSpacingKm,
  groupGridOptions,
  isSameGrid,
  parseGrid,
} from '@/components/base/fields/fields/grid'

function spec(raw: string): GridSpec {
  const parsed = parseGrid(raw)
  if (!parsed.ok) throw new Error(`${raw} is not a grid`)
  return parsed.spec
}

function errorCode(raw: string): string | null {
  const parsed = parseGrid(raw)
  return parsed.ok ? null : parsed.error.code
}

describe('parseGrid', () => {
  // fiab-core's conformance grid rows (ecmwf#667).
  it('accepts what the backend accepts', () => {
    for (const valid of [
      '0.25',
      '0.1',
      '0.25/0.5',
      'n320',
      'O1280',
      'O96',
      'auto',
      '1',
      '2/1',
      '0.5/1',
      'n1280',
    ]) {
      expect(errorCode(valid), valid).toBeNull()
    }
  })

  it('rejects what the backend rejects, with its reason', () => {
    expect(errorCode('0.01')).toBe('tooFine')
    expect(errorCode('0.099')).toBe('tooFine')
    expect(errorCode('0.25/0.01')).toBe('tooFine')
    expect(errorCode('1/2/3')).toBe('tooManyParts')
    expect(errorCode('N0')).toBe('gaussianRange')
    expect(errorCode('O0')).toBe('gaussianRange')
    expect(errorCode('O1281')).toBe('gaussianRange')
    expect(errorCode('N1281')).toBe('gaussianRange')
    expect(errorCode('O096')).toBe('leadingZeros')
    expect(errorCode('AUTO')).toBe('notGrid')
    expect(errorCode('F80')).toBe('notGrid')
    expect(errorCode('inf')).toBe('notPositive')
    expect(errorCode('nan')).toBe('notPositive')
    expect(errorCode('-1')).toBe('notPositive')
    expect(errorCode('0')).toBe('notPositive')
  })

  it('reads the three grid kinds', () => {
    expect(spec('auto')).toEqual({ kind: 'auto' })
    expect(spec('0.25')).toEqual({
      kind: 'latlon',
      dx: 0.25,
      dy: 0.25,
      pair: false,
    })
    expect(spec('0.25/0.5')).toEqual({
      kind: 'latlon',
      dx: 0.25,
      dy: 0.5,
      pair: true,
    })
    expect(spec('n320')).toEqual({ kind: 'gaussian', family: 'N', number: 320 })
  })
})

describe('canonicalGrid', () => {
  it('upper-cases names and shortens decimals like GridType.value_to_str', () => {
    expect(canonicalGrid('n320')).toBe('N320')
    expect(canonicalGrid('o96')).toBe('O96')
    expect(canonicalGrid('0.250')).toBe('0.25')
    expect(canonicalGrid('1.0')).toBe('1')
    expect(canonicalGrid('1e-1')).toBe('0.1')
    expect(canonicalGrid(' 0.25 / 0.50 ')).toBe('0.25/0.5')
    expect(canonicalGrid('auto')).toBe('auto')
    expect(canonicalGrid('N0')).toBeNull()
  })

  it('compares grids by their canonical form', () => {
    expect(isSameGrid('n320', 'N320')).toBe(true)
    expect(isSameGrid('0.250', '0.25')).toBe(true)
    expect(isSameGrid('O320', 'N320')).toBe(false)
  })
})

describe('gridPoints / gridSpacingKm', () => {
  it('counts global points', () => {
    expect(gridPoints(spec('0.25'))).toEqual({
      count: 1_038_240,
      approx: false,
    })
    expect(gridPoints(spec('0.1'))).toEqual({ count: 6_483_600, approx: false })
    expect(gridPoints(spec('1'))).toEqual({ count: 65_160, approx: false })
    expect(gridPoints(spec('O96'))).toEqual({ count: 40_320, approx: false })
    expect(gridPoints(spec('O1280'))).toEqual({
      count: 6_599_680,
      approx: false,
    })
    expect(gridPoints(spec('N320'))).toEqual({ count: 542_080, approx: false })
    expect(gridPoints(spec('N640'))?.approx).toBe(true)
    expect(gridPoints(spec('auto'))).toBeNull()
  })

  it('gives the spacing people quote for common grids', () => {
    expect(gridSpacingKm(spec('0.25'))).toBe(28)
    expect(gridSpacingKm(spec('1'))).toBe(111)
    expect(gridSpacingKm(spec('0.25/0.5'))).toBe(56)
    expect(gridSpacingKm(spec('N320'))).toBe(31)
    expect(gridSpacingKm(spec('O1280'))).toBe(9)
    expect(gridSpacingKm(spec('auto'))).toBeNull()
  })
})

describe('groupGridOptions', () => {
  it('groups the plugin suggestions by family', () => {
    expect(groupGridOptions(DEFAULT_GRID_SUGGESTIONS, 'auto', null)).toEqual([
      { value: 'keep', items: ['auto'] },
      { value: 'latlon', items: ['0.25', '0.5', '1'] },
      { value: 'octahedral', items: ['O96', 'O320'] },
      { value: 'reduced', items: ['N320'] },
    ])
  })

  it('adds the current value to its family, sorted', () => {
    const groups = groupGridOptions(['auto', '0.25', '1'], '0.1', null)
    expect(groups[1]).toEqual({ value: 'latlon', items: ['0.1', '0.25', '1'] })
  })

  it('offers a typed grid only when no entry names it', () => {
    expect(groupGridOptions(['O96'], '', 'O400')[0]).toEqual({
      value: 'custom',
      items: ['O400'],
    })
    expect(
      groupGridOptions(['N320'], '', 'N320').map((group) => group.value),
    ).toEqual(['reduced'])
    expect(
      groupGridOptions(['N320'], 'n320', null).flatMap((group) => group.items),
    ).toEqual(['N320'])
  })

  it('leaves out entries that are not grids', () => {
    expect(groupGridOptions(['O96', 'bogus'], '${grid}', null)).toEqual([
      { value: 'octahedral', items: ['O96'] },
    ])
  })
})
