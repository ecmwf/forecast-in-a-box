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
  BlockValidationState,
  FableBuilderV1,
  FableValidationState,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import {
  replaceBlockInstance,
  replacementCandidates,
  sameBlockInstance,
} from '@/features/fable-builder/utils/replace-block'

const id = (factory: string): PluginBlockFactoryId => ({
  plugin: { store: 'ecmwf', local: 'base' },
  factory,
})

const option = (value_type: string, default_value = '') => ({
  title: value_type,
  description: '',
  value_type,
  default_value,
})

const factories: Record<string, BlockFactory> = {
  source: {
    kind: 'source',
    title: 'Source',
    description: '',
    configuration_options: {},
    inputs: [],
  },
  otherSource: {
    kind: 'source',
    title: 'Other source',
    description: '',
    configuration_options: {},
    inputs: [],
  },
  threshold: {
    kind: 'product',
    title: 'Threshold',
    description: '',
    configuration_options: {
      param: option('param'),
      threshold: option('float', '0'),
      operator: option('enumClosed[str](lt,gt)', 'gt'),
    },
    inputs: ['dataset'],
  },
  quantiles: {
    kind: 'product',
    title: 'Quantiles',
    description: '',
    configuration_options: {
      param: option('param'),
      operator: option('enumClosed[str](min,max)', 'max'),
      quantiles: option('list[float]', '0.5'),
    },
    inputs: ['data'],
  },
  mean: {
    kind: 'product',
    title: 'Ensemble mean',
    description: '',
    configuration_options: {},
    inputs: ['dataset'],
  },
  plot: {
    kind: 'sink',
    title: 'Map plot',
    description: '',
    configuration_options: {},
    inputs: ['dataset'],
  },
}

const catalogue: BlockFactoryCatalogue = { 'ecmwf/base': { factories } }

const fable: FableBuilderV1 = {
  blocks: {
    src: { factory_id: id('source'), configuration_values: {}, input_ids: {} },
    thr: {
      factory_id: id('threshold'),
      configuration_values: { param: '2t', threshold: '273', operator: 'lt' },
      input_ids: { dataset: 'src' },
    },
    out: {
      factory_id: id('plot'),
      configuration_values: {},
      input_ids: { dataset: 'thr' },
    },
  },
}

const blockState = (expansions: Array<string>): BlockValidationState => ({
  errors: [],
  hasErrors: false,
  possibleExpansions: expansions.map(id),
  possibleExpansionRestrictions: {},
  configurationRestrictions: {},
  missingGlyphs: {},
})

const validation = {
  isValid: true,
  globalErrors: [],
  blockStates: {
    src: blockState(['quantiles', 'mean', 'plot', 'threshold']),
  },
  possibleSources: [id('source'), id('otherSource')],
  resolvedConfigurationOptions: {},
} as unknown as FableValidationState

describe('replacementCandidates', () => {
  it('offers same-kind blocks that fit the parent, by title', () => {
    expect(
      replacementCandidates('thr', fable, catalogue, validation).map(
        (c) => c.factory.title,
      ),
    ).toEqual(['Ensemble mean', 'Quantiles'])
  })

  it('offers the other sources for a source', () => {
    expect(
      replacementCandidates('src', fable, catalogue, validation).map(
        (c) => c.factory.title,
      ),
    ).toEqual(['Other source'])
  })

  it('names the plugin when another plugin offers the same title', () => {
    const extra: PluginBlockFactoryId = {
      plugin: { store: 'ecmwf', local: 'extra' },
      factory: 'quantiles',
    }
    const twoPlugins: BlockFactoryCatalogue = {
      ...catalogue,
      'ecmwf/extra': { factories: { quantiles: factories.quantiles } },
    }
    const withExtra = {
      ...validation,
      blockStates: {
        src: {
          ...validation.blockStates.src,
          possibleExpansions: [
            ...validation.blockStates.src.possibleExpansions,
            extra,
          ],
        },
      },
    }
    expect(
      replacementCandidates('thr', fable, twoPlugins, withExtra).map(
        (c) => c.label,
      ),
    ).toEqual(['Ensemble mean', 'Quantiles · base', 'Quantiles · extra'])
  })

  it('offers nothing before validation', () => {
    expect(replacementCandidates('thr', fable, catalogue, null)).toEqual([])
  })
})

describe('replaceBlockInstance', () => {
  it('keeps wiring and the options that still fit', () => {
    const { instance, kept, dropped } = replaceBlockInstance(
      fable.blocks.thr,
      factories.threshold,
      id('quantiles'),
      factories.quantiles,
    )
    expect(instance.factory_id).toEqual(id('quantiles'))
    // The lone input moves to the new input name.
    expect(instance.input_ids).toEqual({ data: 'src' })
    expect(instance.configuration_values).toEqual({
      param: '2t',
      operator: 'max',
      quantiles: '0.5',
    })
    expect(kept).toEqual(['param'])
    expect(dropped).toEqual(['threshold', 'operator'])
  })

  it('keeps a value the new closed enum also allows', () => {
    const { instance } = replaceBlockInstance(
      {
        ...fable.blocks.thr,
        configuration_values: { operator: 'max' },
      },
      {
        ...factories.threshold,
        configuration_options: { operator: option('str') },
      },
      id('quantiles'),
      factories.quantiles,
    )
    expect(instance.configuration_values.operator).toBe('max')
  })
})

describe('sameBlockInstance', () => {
  const block = {
    factory_id: id('threshold'),
    configuration_values: { value: '1', unit: '' },
    input_ids: { dataset: 'src' },
  }

  it('compares factory, settings and inputs by value', () => {
    expect(sameBlockInstance(block, structuredClone(block))).toBe(true)
    expect(
      sameBlockInstance(block, {
        ...block,
        factory_id: id('ensembleStatistics'),
      }),
    ).toBe(false)
    expect(
      sameBlockInstance(block, {
        ...block,
        configuration_values: { value: '2', unit: '' },
      }),
    ).toBe(false)
    expect(
      sameBlockInstance(block, {
        ...block,
        configuration_values: { value: '1' },
      }),
    ).toBe(false)
    expect(sameBlockInstance(block, { ...block, input_ids: {} })).toBe(false)
  })
})
