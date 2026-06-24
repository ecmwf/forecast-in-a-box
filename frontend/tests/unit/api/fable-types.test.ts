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
import {
  FableValidationExpansionSchema,
  getBlockConfigurationRestrictions,
  partitionBlueprintTags,
  toValidationState,
  unwrapBackendError,
} from '@/api/types/fable.types'

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
      configuration_restrictions: {},
      resolved_configuration_options: {},
      block_output_qubes: {},
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
      configuration_restrictions: {},
      resolved_configuration_options: {},
      block_output_qubes: {},
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
      configuration_restrictions: {},
      resolved_configuration_options: {},
      block_output_qubes: {},
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
      configuration_restrictions: {},
      resolved_configuration_options: {},
      block_output_qubes: {},
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

  it('exposes configuration restrictions for a block itself', () => {
    const fable: FableBuilderV1 = {
      blocks: {
        b1: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'base' },
            factory: 'source',
          },
          configuration_values: { required: 'ifs-ens', optional: '' },
          input_ids: {},
        },
      },
    }
    const expansion: FableValidationExpansion = {
      global_errors: [],
      block_errors: {},
      possible_sources: [],
      possible_expansions: {},
      configuration_restrictions: {
        b1: { param: 'list[enumClosed[2t,msl]]' },
      },
      resolved_configuration_options: {},
      block_output_qubes: {},
      missing_glyphs: {},
    }

    const validationState = toValidationState(expansion, fable, mockCatalogue)

    expect(validationState.blockStates.b1.configurationRestrictions).toEqual({
      param: 'list[enumClosed[2t,msl]]',
    })
    expect(
      getBlockConfigurationRestrictions(fable, validationState, 'b1'),
    ).toEqual({ param: 'list[enumClosed[2t,msl]]' })
  })
})

describe('unwrapBackendError', () => {
  it('unwraps a single-quoted Python exception repr to the bare message', () => {
    expect(
      unwrapBackendError(
        "ValueError('param 2t is not in the input parameters: [msl]')",
      ),
    ).toBe('param 2t is not in the input parameters: [msl]')
  })

  it('unwraps a double-quoted repr and un-escapes the embedded quote', () => {
    expect(unwrapBackendError('ValueError("can\'t resolve")')).toBe(
      "can't resolve",
    )
  })

  it('unwraps custom exception classes ending in Error/Exception', () => {
    expect(
      unwrapBackendError("BlockInstanceConfigurationError('missing input')"),
    ).toBe('missing input')
  })

  it('leaves already-clean messages untouched', () => {
    const clean =
      'Invalid filepath: directory path can not contain template values'
    expect(unwrapBackendError(clean)).toBe(clean)
  })

  it('does not strip text that merely looks function-like', () => {
    expect(unwrapBackendError('select(dataset) returned nothing')).toBe(
      'select(dataset) returned nothing',
    )
  })

  it('cleans backend block errors through toValidationState', () => {
    const result = toValidationState({
      global_errors: [],
      block_errors: { b1: ["ValueError('bad value')"] },
      possible_sources: [],
      possible_expansions: {},
      configuration_restrictions: {},
      resolved_configuration_options: {},
      block_output_qubes: {},
      missing_glyphs: {},
    })
    expect(result.blockStates.b1.errors).toEqual(['bad value'])
  })
})

describe('FableValidationExpansionSchema block_output_qubes', () => {
  const base = {
    global_errors: [],
    block_errors: {},
    possible_sources: [],
    possible_expansions: {},
    configuration_restrictions: {},
    resolved_configuration_options: {},
    missing_glyphs: {},
  }

  /** A well-formed qubed node tree (enum value-groups only). */
  const enumQube = {
    key: 'root',
    values: { type: 'enum', dtype: 'str', values: ['root'] },
    metadata: {},
    children: [
      {
        key: 'param',
        values: { type: 'enum', dtype: 'str', values: ['2t', 'msl'] },
        metadata: {},
        children: [],
      },
    ],
  }

  /** Wildcard value-groups serialize as the bare string `"*"`, which QubeNodeSchema rejects. */
  const wildcardQube = {
    key: 'root',
    values: { type: 'enum', dtype: 'str', values: ['root'] },
    metadata: {},
    children: [{ key: 'param', values: '*', metadata: {}, children: [] }],
  }

  it('keeps valid qubes and drops unmodellable ones without failing the response', () => {
    const result = FableValidationExpansionSchema.parse({
      ...base,
      block_output_qubes: { good: enumQube, bad: wildcardQube },
    })

    expect(Object.keys(result.block_output_qubes)).toEqual(['good'])
    expect(result.block_output_qubes.good).toEqual(enumQube)
  })

  it('defaults to an empty object when omitted', () => {
    const result = FableValidationExpansionSchema.parse({ ...base })
    expect(result.block_output_qubes).toEqual({})
  })
})

describe('partitionBlueprintTags', () => {
  it('returns plain keys and no mismatch for label tags', () => {
    expect(
      partitionBlueprintTags([{ key: 'prod', value: null }, { key: 'europe' }]),
    ).toEqual({ tags: ['prod', 'europe'], coreVersionMismatch: null })
  })

  it('extracts CoreVersionMismatch and strips it from the key list', () => {
    expect(
      partitionBlueprintTags([
        { key: 'prod', value: null },
        { key: 'CoreVersionMismatch', value: '!3 != 4' },
      ]),
    ).toEqual({ tags: ['prod'], coreVersionMismatch: '!3 != 4' })
  })

  it('handles an empty list', () => {
    expect(partitionBlueprintTags([])).toEqual({
      tags: [],
      coreVersionMismatch: null,
    })
  })
})
