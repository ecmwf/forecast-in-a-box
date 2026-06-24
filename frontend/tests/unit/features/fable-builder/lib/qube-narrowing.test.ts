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
import type { BlockInstance, FableBuilderV1 } from '@/api/types/fable.types'
import { computeEdgeNarrowing } from '@/features/fable-builder/lib/qube-narrowing'

const PLUGIN = { store: 'ecmwf', local: 'ecmwf-base' }

function leaf(key: string, values: Array<string>): QubeNode {
  return {
    key,
    values: { type: 'enum', dtype: 'str', values },
    metadata: {},
    children: [],
  }
}

function single(dims: Record<string, Array<string>>): QubeNode {
  // Build a simple linear qube: one node per dimension, in object order.
  const keys = Object.keys(dims)
  let node: QubeNode = leaf(keys[keys.length - 1], dims[keys[keys.length - 1]])
  for (let i = keys.length - 2; i >= 0; i -= 1) {
    node = {
      key: keys[i],
      values: { type: 'enum', dtype: 'str', values: dims[keys[i]] },
      metadata: {},
      children: [node],
    }
  }
  return {
    key: 'root',
    values: { type: 'enum', dtype: 'str', values: ['root'] },
    metadata: {},
    children: [node],
  }
}

function fableWith(source: BlockInstance): FableBuilderV1 {
  return {
    blocks: {
      src: {
        factory_id: { plugin: PLUGIN, factory: 'operationalForecastSource' },
        configuration_values: {},
        input_ids: {},
      },
      sel: source,
    },
    local_glyphs: {},
  }
}

describe('computeEdgeNarrowing', () => {
  // Input has param=8, stream=2, levtype=2; selecting param=2t prunes all three.
  const inputQube = single({
    stream: ['enfo', 'oper'],
    levtype: ['pl', 'sfc'],
    param: ['a', 'b', 'c', 'd', 'e', 'f', 'g', '2t'],
  })
  const selOutput = single({
    stream: ['enfo'],
    levtype: ['sfc'],
    param: ['2t'],
  })

  it('flags only the Select-chosen dimension, not pruned side effects', () => {
    const fable = fableWith({
      factory_id: { plugin: PLUGIN, factory: 'select' },
      configuration_values: { dimension: 'param', values: '2t' },
      input_ids: { dataset: 'src' },
    })
    const result = computeEdgeNarrowing(
      fable,
      { src: inputQube, sel: selOutput },
      'sel',
    )
    expect(result).toEqual([{ dimension: 'param', from: 8, to: 1 }])
  })

  it('flags every shrunk dimension for a non-Select block', () => {
    const fable = fableWith({
      factory_id: { plugin: PLUGIN, factory: 'ensembleStatistics' },
      configuration_values: {},
      input_ids: { dataset: 'src' },
    })
    const result = computeEdgeNarrowing(
      fable,
      { src: inputQube, sel: selOutput },
      'sel',
    )
    expect(result.map((r) => r.dimension).sort()).toEqual([
      'levtype',
      'param',
      'stream',
    ])
  })

  it('returns [] for an origin block with no upstream qube', () => {
    const fable = fableWith({
      factory_id: { plugin: PLUGIN, factory: 'select' },
      configuration_values: { dimension: 'param', values: '2t' },
      input_ids: { dataset: 'src' },
    })
    expect(computeEdgeNarrowing(fable, { sel: selOutput }, 'sel')).toEqual([])
  })
})
