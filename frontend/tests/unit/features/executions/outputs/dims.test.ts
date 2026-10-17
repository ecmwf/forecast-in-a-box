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
  compareDimValues,
  compareDims,
  orderDims,
  outputTitle,
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

describe('outputTitle', () => {
  it('appends the subtitle to the block name', () => {
    expect(outputTitle({ ...grid[0], subtitle: 'msl · step 0' })).toBe(
      'Map Plot · msl · step 0',
    )
    expect(outputTitle(grid[0])).toBe('Map Plot')
  })
})
