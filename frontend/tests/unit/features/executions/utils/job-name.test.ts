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
} from '@/api/types/fable.types'
import { buildDefaultJobName } from '@/features/executions/utils/job-name'

const CATALOGUE: BlockFactoryCatalogue = {
  'ecmwf/ecmwf-base': {
    factories: {
      ekdSource: {
        kind: 'source',
        title: 'Earthkit Data Source',
        description: '',
        configuration_options: {},
        inputs: [],
      },
      anemoiSource: {
        kind: 'source',
        title: 'Anemoi Source',
        description: '',
        configuration_options: {},
        inputs: [],
      },
      mapPlot: {
        kind: 'sink',
        title: 'Map Plot',
        description: '',
        configuration_options: {},
        inputs: ['dataset'],
      },
      zarrSink: {
        kind: 'sink',
        title: 'Zarr Output',
        description: '',
        configuration_options: {},
        inputs: ['dataset'],
      },
    },
  },
}

const FIXED_NOW = new Date('2026-04-24T14:40:00')
const TIMESTAMP_LABEL = '2026-04-24 14:40'

function source(factory: string): FableBuilderV1['blocks'][string] {
  return {
    factory_id: { plugin: { store: 'ecmwf', local: 'ecmwf-base' }, factory },
    configuration_values: {},
    input_ids: {},
  }
}

function sink(factory: string): FableBuilderV1['blocks'][string] {
  return {
    factory_id: { plugin: { store: 'ecmwf', local: 'ecmwf-base' }, factory },
    configuration_values: {},
    input_ids: { dataset: 'src_1' },
  }
}

describe('buildDefaultJobName', () => {
  it('falls back to "Run · <timestamp>" for an empty fable', () => {
    expect(
      buildDefaultJobName({
        fable: { blocks: {} },
        catalogue: CATALOGUE,
        now: FIXED_NOW,
      }),
    ).toBe(`Run · ${TIMESTAMP_LABEL}`)
  })

  it('falls back when the catalogue is unavailable', () => {
    expect(
      buildDefaultJobName({
        fable: { blocks: { src_1: source('anemoiSource') } },
        catalogue: undefined,
        now: FIXED_NOW,
      }),
    ).toBe(`Run · ${TIMESTAMP_LABEL}`)
  })

  it('combines source + sink + timestamp when no datetime config exists', () => {
    expect(
      buildDefaultJobName({
        fable: {
          blocks: {
            src_1: source('anemoiSource'),
            snk_1: sink('mapPlot'),
          },
        },
        catalogue: CATALOGUE,
        now: FIXED_NOW,
      }),
    ).toBe(`Anemoi Source · Map Plot · ${TIMESTAMP_LABEL}`)
  })

  it('prefers a datetime config value (e.g. base_time) over the timestamp', () => {
    const src = source('anemoiSource')
    src.configuration_values = { base_time: '2025-12-01T06:00' }
    expect(
      buildDefaultJobName({
        fable: { blocks: { src_1: src, snk_1: sink('zarrSink') } },
        catalogue: CATALOGUE,
        now: FIXED_NOW,
      }),
    ).toBe('Anemoi Source · Zarr Output · 2025-12-01')
  })

  it('inherits a saved blueprint display_name with a timestamp suffix', () => {
    expect(
      buildDefaultJobName({
        fable: { blocks: { src_1: source('anemoiSource') } },
        catalogue: CATALOGUE,
        fableData: { display_name: 'Morning Europe Forecast' },
        now: FIXED_NOW,
      }),
    ).toBe(`Morning Europe Forecast · ${TIMESTAMP_LABEL}`)
  })

  it('drops a missing sink gracefully', () => {
    expect(
      buildDefaultJobName({
        fable: { blocks: { src_1: source('ekdSource') } },
        catalogue: CATALOGUE,
        now: FIXED_NOW,
      }),
    ).toBe(`Earthkit Data Source · ${TIMESTAMP_LABEL}`)
  })

  it('truncates very long names to 72 characters', () => {
    const longDisplayName = 'A'.repeat(200)
    const result = buildDefaultJobName({
      fable: { blocks: {} },
      catalogue: CATALOGUE,
      fableData: { display_name: longDisplayName },
      now: FIXED_NOW,
    })
    expect(result.length).toBeLessThanOrEqual(72)
    expect(result.endsWith('…')).toBe(true)
  })
})
