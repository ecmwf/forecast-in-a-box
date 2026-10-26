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
import type {
  BlockFactory,
  BlockFactoryCatalogue,
  BlockInstance,
  FableBuilderV1,
} from '@/api/types/fable.types'
import { blockDisplayNames } from '@/features/fable-builder/utils/block-names'

const factory = (title: string): BlockFactory => ({
  kind: 'sink',
  title,
  description: '',
  configuration_options: {},
  inputs: [],
})

const catalogue: BlockFactoryCatalogue = {
  'ecmwf/ecmwf-base': {
    factories: { mapPlot: factory('Map Plot'), grib: factory('GRIB Sink') },
  },
  'acme/plots': { factories: { mapPlot: factory('Map Plot') } },
  'ecmwf/solo': { factories: { select: factory('Select') } },
}

const block = (store: string, local: string, id: string): BlockInstance => ({
  factory_id: { plugin: { store, local }, factory: id },
  configuration_values: {},
  input_ids: {},
})

const fable = (blocks: Record<string, BlockInstance>): FableBuilderV1 => ({
  blocks,
})

describe('blockDisplayNames', () => {
  it('gives repeats of the same block the same name', () => {
    const names = blockDisplayNames(
      fable({
        a: block('ecmwf', 'solo', 'select'),
        b: block('ecmwf', 'solo', 'select'),
      }),
      catalogue,
    )
    expect(names).toEqual({ a: 'Select', b: 'Select' })
  })

  it('names the plugin only when two plugins share a title', () => {
    const names = blockDisplayNames(
      fable({
        a: block('ecmwf', 'ecmwf-base', 'mapPlot'),
        b: block('acme', 'plots', 'mapPlot'),
        c: block('ecmwf', 'ecmwf-base', 'grib'),
      }),
      catalogue,
    )
    expect(names).toEqual({
      a: 'Map Plot · ecmwf-base',
      b: 'Map Plot · plots',
      c: 'GRIB Sink',
    })
  })

  it('falls back to the factory id without a catalogue entry', () => {
    const names = blockDisplayNames(
      fable({ a: block('gone', 'plugin', 'oldBlock') }),
      catalogue,
    )
    expect(names).toEqual({ a: 'oldBlock' })
  })
})
