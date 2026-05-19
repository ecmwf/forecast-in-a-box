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
  BlockFactoryCatalogue,
  FableBuilderV1,
  FableValidationExpansion,
} from '@/api/types/fable.types'
import { toValidationState } from '@/api/types/fable.types'

const mockCatalogue: BlockFactoryCatalogue = {
  'ecmwf/base': {
    factories: {
      source: {
        kind: 'source',
        title: 'Source',
        description: 'Test source',
        configuration_options: {
          required: {
            title: 'Required',
            description: 'Required value',
            value_type: 'str',
          },
          optional: {
            title: 'Optional',
            description: 'Optional value',
            value_type: 'optional[str]',
          },
        },
        inputs: [],
      },
      sink: {
        kind: 'sink',
        title: 'Sink',
        description: 'Test sink',
        configuration_options: {},
        inputs: ['dataset'],
      },
    },
  },
}

describe('toValidationState', () => {
  it('adds client-side missing-config errors when backend omits them', () => {
    const fable: FableBuilderV1 = {
      blocks: {
        b1: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'base' },
            factory: 'source',
          },
          configuration_values: { required: '', optional: '' },
          input_ids: {},
        },
      },
    }

    const expansion: FableValidationExpansion = {
      global_errors: [],
      block_errors: {},
      possible_sources: [],
      possible_expansions: {},
      resolved_configuration_options: {},
      missing_glyphs: {},
    }

    const result = toValidationState(expansion, fable, mockCatalogue)

    expect(result.isValid).toBe(false)
    expect(result.blockStates.b1.errors).toEqual([
      "Block contains missing config: {'required'}",
    ])
    expect(result.blockStates.b1.hasErrors).toBe(true)
  })

  it('exposes structured missing_glyphs per block and marks the block as invalid', () => {
    const expansion: FableValidationExpansion = {
      global_errors: [],
      block_errors: {},
      possible_sources: [],
      possible_expansions: {},
      resolved_configuration_options: {},
      missing_glyphs: {
        sink_file: {
          fname: ['missingRoot'],
          suffix: ['missingRoot', 'env'],
        },
      },
    }

    const result = toValidationState(expansion)

    expect(result.blockStates.sink_file.missingGlyphs).toEqual({
      fname: ['missingRoot'],
      suffix: ['missingRoot', 'env'],
    })
    expect(result.blockStates.sink_file.errors).toEqual([])
    expect(result.blockStates.sink_file.hasErrors).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('treats empty missing_glyphs entries as no warnings', () => {
    const expansion: FableValidationExpansion = {
      global_errors: [],
      block_errors: {},
      possible_sources: [],
      possible_expansions: {},
      resolved_configuration_options: {},
      missing_glyphs: { sink_file: {} },
    }

    const result = toValidationState(expansion)

    expect(result.blockStates.sink_file.missingGlyphs).toEqual({})
    expect(result.blockStates.sink_file.hasErrors).toBe(false)
  })

  it('maps expansion items with restrictions to factory IDs for existing UI flows', () => {
    const expansion: FableValidationExpansion = {
      global_errors: [],
      block_errors: {},
      possible_sources: [],
      possible_expansions: {
        b1: [
          {
            plugin: { store: 'ecmwf', local: 'base' },
            factory: 'sink',
            restrictions: { amount: 'enumClosed[1,2,3]' },
          },
        ],
      },
      resolved_configuration_options: {},
      missing_glyphs: {},
    }

    const result = toValidationState(expansion)

    expect(result.blockStates.b1.possibleExpansions).toEqual([
      {
        plugin: { store: 'ecmwf', local: 'base' },
        factory: 'sink',
      },
    ])
    expect(result.blockStates.b1.possibleExpansionRestrictions).toEqual({
      'ecmwf/base:sink': { amount: 'enumClosed[1,2,3]' },
    })
  })
})
