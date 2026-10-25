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
  BlockInstance,
} from '@/api/types/fable.types'
import { distinguishingSettings } from '@/features/executions/outputs/block-settings'

const option = (title: string, value_type = 'str') => ({
  title,
  description: '',
  value_type,
})

const catalogue: BlockFactoryCatalogue = {
  'ecmwf/ecmwf-base': {
    factories: {
      mapPlot: {
        kind: 'sink',
        title: 'Map Plot',
        description: '',
        configuration_options: {
          param: option('Parameters', 'list[param]'),
          style: option('Style'),
          format: option('Format'),
        },
        inputs: ['dataset'],
      },
    },
  },
}

const block = (
  values: Record<string, string>,
  factory = 'mapPlot',
): BlockInstance => ({
  factory_id: { plugin: { store: 'ecmwf', local: 'ecmwf-base' }, factory },
  configuration_values: values,
  input_ids: { dataset: 'src' },
})

describe('distinguishingSettings', () => {
  it('names the options that differ between blocks of one type', () => {
    const settings = distinguishingSettings(
      {
        blocks: {
          a: block({ param: '167', style: 'MetNorway', format: 'png' }),
          b: block({ param: '167', style: 'ECMWF', format: 'png' }),
        },
      },
      catalogue,
      undefined,
    )
    expect(settings).toEqual({
      a: [{ key: 'style', title: 'Style', value: 'MetNorway', isParam: false }],
      b: [{ key: 'style', title: 'Style', value: 'ECMWF', isParam: false }],
    })
  })

  it('compares as-run values of glyphed options', () => {
    const fable = {
      blocks: {
        a: block({ style: '${styleA}' }),
        b: block({ style: '${styleB}' }),
        c: block({ style: '${styleB}' }),
      },
    }
    expect(
      distinguishingSettings(fable, catalogue, {
        a: { style: 'MetNorway' },
        b: { style: 'ECMWF' },
        c: { style: 'ECMWF' },
      }),
    ).toEqual({
      a: [expect.objectContaining({ value: 'MetNorway' })],
      b: [expect.objectContaining({ value: 'ECMWF' })],
      c: [expect.objectContaining({ value: 'ECMWF' })],
    })
    // One shared glyph: nothing differs.
    expect(
      distinguishingSettings(
        {
          blocks: { a: block({ style: '${s}' }), b: block({ style: '${s}' }) },
        },
        catalogue,
        { a: { style: 'ECMWF' }, b: { style: 'ECMWF' } },
      ),
    ).toEqual({})
  })

  it('falls back to templates without a resolution or for null values', () => {
    const fable = {
      blocks: {
        a: block({ style: '${styleA}' }),
        b: block({ style: '${styleB}' }),
      },
    }
    expect(
      distinguishingSettings(fable, catalogue, { a: { style: null } }),
    ).toEqual({
      a: [expect.objectContaining({ value: '${styleA}' })],
      b: [expect.objectContaining({ value: '${styleB}' })],
    })
  })

  it('flags parameter options and leaves unset values out', () => {
    const settings = distinguishingSettings(
      {
        blocks: {
          a: block({ param: '167,151', style: '' }),
          b: block({ param: '167', style: 'ECMWF' }),
        },
      },
      catalogue,
      undefined,
    )
    expect(settings).toEqual({
      a: [
        { key: 'param', title: 'Parameters', value: '167,151', isParam: true },
      ],
      b: [
        { key: 'param', title: 'Parameters', value: '167', isParam: true },
        { key: 'style', title: 'Style', value: 'ECMWF', isParam: false },
      ],
    })
  })

  it('ignores lone blocks and identical twins, and keys without a catalogue', () => {
    const fable = {
      blocks: {
        a: block({ style: 'ECMWF' }),
        b: block({ style: 'ECMWF' }),
        c: block({ style: 'MetNorway' }, 'contourPlot'),
      },
    }
    expect(distinguishingSettings(fable, catalogue, undefined)).toEqual({})
    expect(
      distinguishingSettings(
        { blocks: { a: block({ style: 'A' }), b: block({ style: 'B' }) } },
        undefined,
        undefined,
      ).a,
    ).toEqual([{ key: 'style', title: 'style', value: 'A', isParam: false }])
  })
})
