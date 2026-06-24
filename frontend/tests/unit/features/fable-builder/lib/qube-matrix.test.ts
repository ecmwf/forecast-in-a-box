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
import type { QubeNode } from '@/api/types/artifacts.types'
import { parseQubeDimensions } from '@/features/fable-builder/lib/qube-matrix'

function node(
  key: string,
  values: Array<string | number>,
  children: Array<QubeNode> = [],
): QubeNode {
  return {
    key,
    values: { type: 'enum', dtype: 'str', values },
    metadata: {},
    children,
  }
}

// root → number[0,1] → param[t,q] → level[1000,500]
const qube: QubeNode = node(
  'root',
  ['root'],
  [
    node(
      'number',
      [0, 1],
      [node('param', ['t', 'q'], [node('level', [1000, 500], [])])],
    ),
  ],
)

describe('parseQubeDimensions', () => {
  it('lists every dimension in tree order with its value union', () => {
    const dims = parseQubeDimensions(qube)
    expect(dims.map((d) => d.key)).toEqual(['number', 'param', 'level'])
    // Numeric values are sorted ascending; string values keep first-seen order.
    expect(dims.find((d) => d.key === 'level')?.values).toEqual(['500', '1000'])
    expect(dims.find((d) => d.key === 'param')?.values).toEqual(['t', 'q'])
  })

  it('unions values across branches that share a dimension', () => {
    // param=t carries level 1000; param=q carries level 500 → level union {500,1000}.
    const sparse = node(
      'root',
      ['root'],
      [
        node('param', ['t'], [node('level', [1000], [])]),
        node('param', ['q'], [node('level', [500], [])]),
      ],
    )
    const level = parseQubeDimensions(sparse).find((d) => d.key === 'level')
    expect(level?.values).toEqual(['500', '1000'])
  })

  it('returns no dimensions for a bare root', () => {
    expect(parseQubeDimensions(node('root', ['root']))).toEqual([])
  })
})
