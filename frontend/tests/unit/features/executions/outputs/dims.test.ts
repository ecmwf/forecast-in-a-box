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
import type { OutputItem } from '@/features/executions/outputs/types'
import type { OutputDim } from '@/features/executions/outputs/dims'
import {
  SETTING_PREFIX,
  compareDimValues,
  compareDims,
  dimLine,
  dimNeighbor,
  dimValueCounts,
  formatRuns,
  matchesDimFilter,
  orderDims,
  outputTitle,
  parseDimFilter,
  segmentKey,
  serializeDimFilter,
  stepDay,
  stepGrid,
  stepHour,
  summarizeSteps,
} from '@/features/executions/outputs/dims'

function item(
  taskId: string,
  dims: ReadonlyArray<OutputDim>,
  block = 'map_plot',
): OutputItem {
  return {
    jobId: 'job',
    taskId,
    mimeType: 'image/png',
    originalBlock: block,
    blockName: 'Map Plot',
    dims,
    isAvailable: true,
  }
}

/** 2 params x 3 steps, wire order [param, step]. */
const grid = ['151', '167'].flatMap((param) =>
  ['0', '6', '12'].map((step) =>
    item(`${param}/${step}`, [
      ['param', param],
      ['step', step],
    ]),
  ),
)

describe('compareDimValues', () => {
  it('orders numbers numerically', () => {
    expect(['12', '6', '0', '120'].sort(compareDimValues)).toEqual([
      '0',
      '6',
      '12',
      '120',
    ])
  })

  it('falls back to natural string order', () => {
    expect(['msl', '2t', '10u'].sort(compareDimValues)).toEqual([
      '2t',
      '10u',
      'msl',
    ])
  })
})

describe('orderDims', () => {
  it('moves time dimensions innermost, keeping the rest in wire order', () => {
    const dims: Array<OutputDim> = [
      ['step', '6'],
      ['number', '3'],
      ['param', '167'],
    ]
    expect(orderDims(dims).map(([key]) => key)).toEqual([
      'number',
      'param',
      'step',
    ])
  })
})

describe('compareDims', () => {
  it('sorts outer coordinates first and time innermost', () => {
    const shuffled = [...grid].reverse()
    shuffled.sort(compareDims)
    expect(shuffled.map((i) => i.taskId)).toEqual([
      '151/0',
      '151/6',
      '151/12',
      '167/0',
      '167/6',
      '167/12',
    ])
  })
})

describe('dimValueCounts', () => {
  it('lists distinct values in order with counts', () => {
    const counts = dimValueCounts(grid)
    expect(counts.get('param')).toEqual([
      ['151', 3],
      ['167', 3],
    ])
    expect(counts.get('step')).toEqual([
      ['0', 2],
      ['6', 2],
      ['12', 2],
    ])
  })

  it('lists block settings before coordinates', () => {
    const style = `${SETTING_PREFIX}style`
    const styled = (taskId: string, value: string): OutputItem => ({
      ...item(taskId, [['step', '6']]),
      settings: [[style, value]],
    })
    const counts = dimValueCounts([
      styled('a', 'MetNorway'),
      styled('b', 'ECMWF'),
      styled('c', 'ECMWF'),
    ])
    expect([...counts.keys()]).toEqual([style, 'step'])
    expect(counts.get(style)).toEqual([
      ['ECMWF', 2],
      ['MetNorway', 1],
    ])
  })
})

describe('dimNeighbor', () => {
  const at = (taskId: string) => grid.find((i) => i.taskId === taskId)!

  it('steps one coordinate and keeps the others fixed', () => {
    expect(dimNeighbor(grid, at('151/6'), 'step', 1)?.taskId).toBe('151/12')
    expect(dimNeighbor(grid, at('151/6'), 'param', 1)?.taskId).toBe('167/6')
    expect(dimNeighbor(grid, at('167/6'), 'param', -1)?.taskId).toBe('151/6')
  })

  it('stops at the ends unless wrapping', () => {
    expect(dimNeighbor(grid, at('151/12'), 'step', 1)).toBeNull()
    expect(dimNeighbor(grid, at('151/0'), 'step', -1)).toBeNull()
    expect(dimNeighbor(grid, at('151/12'), 'step', 1, true)?.taskId).toBe(
      '151/0',
    )
  })

  it('skips gaps and ignores other blocks', () => {
    const sparse = grid.filter((i) => i.taskId !== '151/6')
    expect(dimNeighbor(sparse, at('151/0'), 'step', 1)?.taskId).toBe('151/12')
    const foreign = item('x', [['step', '3']], 'other_block')
    expect(dimNeighbor([foreign, at('151/0')], at('151/0'), 'step', 1)).toBe(
      null,
    )
  })

  it('returns null for a single value or a missing coordinate', () => {
    const lone = item('lone', [['step', '0']])
    expect(dimNeighbor([lone], lone, 'step', 1, true)).toBeNull()
    expect(dimNeighbor(grid, at('151/0'), 'number', 1)).toBeNull()
  })
})

describe('segmentKey', () => {
  it('ignores the innermost coordinate', () => {
    const [a, b, , d] = grid
    expect(segmentKey(a)).toBe(segmentKey(b))
    expect(segmentKey(a)).not.toBe(segmentKey(d))
  })
})

describe('dim filter', () => {
  it('round-trips through the URL form', () => {
    const filter = { param: ['167', '151'], step: ['6'] }
    const raw = serializeDimFilter(filter)
    expect(raw).toBe('param=167,151;step=6')
    expect(parseDimFilter(raw)).toEqual(filter)
  })

  it('keeps an explicit empty selection as none', () => {
    expect(serializeDimFilter({})).toBeUndefined()
    expect(serializeDimFilter({ step: [] })).toBe('step=')
    expect(parseDimFilter('step=;=6')).toEqual({ step: [] })
    expect(matchesDimFilter(grid[0], { step: [] })).toBe(false)
  })

  it('encodes list separators inside values', () => {
    const filter = { [`${SETTING_PREFIX}param`]: ['2t,msl', '100%=a;b'] }
    const raw = serializeDimFilter(filter)
    expect(raw).toBe('setting:param=2t%2cmsl,100%25%3da%3bb')
    expect(parseDimFilter(raw)).toEqual(filter)
  })

  it('matches block settings like coordinates', () => {
    const styled: OutputItem = {
      ...grid[0],
      settings: [[`${SETTING_PREFIX}style`, 'ECMWF']],
    }
    expect(
      matchesDimFilter(styled, { [`${SETTING_PREFIX}style`]: ['ECMWF'] }),
    ).toBe(true)
    expect(
      matchesDimFilter(styled, { [`${SETTING_PREFIX}style`]: ['MetNorway'] }),
    ).toBe(false)
    // Setting keys never read coordinates.
    expect(
      matchesDimFilter(styled, { [`${SETTING_PREFIX}param`]: ['151'] }),
    ).toBe(false)
  })

  it('matches every filtered coordinate', () => {
    const [first] = grid
    expect(matchesDimFilter(first, {})).toBe(true)
    expect(matchesDimFilter(first, { param: ['151'], step: ['0', '6'] })).toBe(
      true,
    )
    expect(matchesDimFilter(first, { step: ['6'] })).toBe(false)
    expect(matchesDimFilter(first, { number: ['1'] })).toBe(false)
  })
})

describe('outputTitle', () => {
  it('appends the subtitle to the block name', () => {
    expect(outputTitle({ ...grid[0], subtitle: 'msl · step 0' })).toBe(
      'Map Plot · msl · step 0',
    )
    expect(outputTitle(grid[0])).toBe('Map Plot')
  })
})

describe('dimLine', () => {
  it('lists one series in order, other coordinates fixed', () => {
    const at = grid.find((i) => i.taskId === '167/6')!
    expect(dimLine(grid, at, 'step').map(([v, i]) => [v, i.taskId])).toEqual([
      ['0', '167/0'],
      ['6', '167/6'],
      ['12', '167/12'],
    ])
    expect(dimLine(grid, at, 'number')).toEqual([])
  })
})

describe('step grid', () => {
  const run = Array.from({ length: 12 }, (_, i) => (i + 1) * 6)

  it('buckets steps into calendar days and hours of day', () => {
    expect([0, 6, 24, 30, 372].map(stepDay)).toEqual([0, 0, 1, 1, 15])
    expect([0, 6, 24, 30, 372].map(stepHour)).toEqual([0, 6, 0, 6, 12])
  })

  it('lays multi-day steps out as days by hours, 0 h first', () => {
    const layout = { days: [0, 1, 2, 3], hours: [0, 6, 12, 18] }
    expect(stepGrid(run)).toEqual(layout)
    expect(stepGrid([0, ...run])).toEqual(layout)
    expect(stepGrid([0, 6, 12])).toBeNull()
    expect(stepGrid([0, 25, 50])).toBeNull()
    expect(stepGrid([NaN, 24, 48])).toBeNull()
  })

  it('summarises whole days and hours, else a count', () => {
    expect(summarizeSteps([24, 30, 36, 42], run)).toEqual({
      days: [1],
      hours: null,
    })
    expect(summarizeSteps([12, 36, 60], run)).toEqual({
      days: null,
      hours: [12],
    })
    expect(summarizeSteps([12, 36], run)).toEqual({ days: [0, 1], hours: [12] })
    expect(summarizeSteps([6, 36], run)).toEqual({ count: 2 })
    expect(summarizeSteps([0], [0, ...run])).toEqual({ days: [0], hours: [0] })
  })

  it('handles uneven spacing, e.g. hourly to day 3 then 6-hourly', () => {
    const hourly = Array.from({ length: 72 }, (_, i) => i + 1)
    const sixHourly = Array.from({ length: 28 }, (_, i) => 78 + i * 6)
    const mixed = [...hourly, ...sixHourly]
    const layout = stepGrid(mixed)
    expect(layout?.days).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(layout?.hours).toEqual(Array.from({ length: 24 }, (_, i) => i))
    const sixes = mixed.filter((step) => step % 6 === 0)
    expect(summarizeSteps(sixes, mixed)).toEqual({
      days: null,
      hours: [0, 6, 12, 18],
    })
    const day4 = mixed.filter((step) => stepDay(step) === 4)
    expect(day4).toEqual([96, 102, 108, 114])
    expect(summarizeSteps(day4, mixed)).toEqual({ days: [4], hours: null })
  })

  it('formats consecutive runs', () => {
    expect(formatRuns([1, 2, 3, 5, 7, 8])).toBe('1\u20133, 5, 7\u20138')
  })
})
