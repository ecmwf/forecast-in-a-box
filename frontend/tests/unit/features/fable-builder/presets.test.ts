/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Guards the static config presets against block-schema drift.
 *
 * Presets hardcode each block's `configuration_values`. When the ECMWF plugin
 * renames/adds/removes a config option, a preset silently fails validation only
 * when a user opens it (e.g. `ensemble_members`→`number`, or the added
 * `groupby`/`splitby` on `mapPlotSink`). This test makes that loud at build time.
 *
 * `FACTORY_CONFIG_KEYS` mirrors the backend block definitions
 * (`fiab-plugin-ecmwf/.../blocks.py` + `anemoi/blocks.py`). Keep it in sync with
 * the plugin; the exact-match assertion then fails whenever a preset drifts.
 */

import { describe, expect, it } from 'vitest'
import type { PresetId } from '@/features/fable-builder/presets/presets'
import { getPreset } from '@/features/fable-builder/presets/presets'

// Full set of `configuration_options` keys per block factory (backend mirror).
const FACTORY_CONFIG_KEYS: Record<string, ReadonlyArray<string>> = {
  operationalForecastSource: ['source', 'forecast', 'base_time'],
  ensembleStatistics: ['param', 'statistic'],
  select: ['dimension', 'values'],
  zarrSink: ['path'],
  gribSink: ['path'],
  mapPlotSink: ['param', 'domain', 'format', 'groupby', 'splitby'],
  anemoiSource: [
    'checkpoint',
    'input_source',
    'lead_time',
    'base_time',
    'number',
  ],
}

const PRESET_IDS: ReadonlyArray<PresetId> = [
  'quick-start',
  'standard',
  'custom-model',
  'dataset',
  'ecmwf-open-data',
  'aifs-forecast',
  'aifs-dataset',
]

const OPERATIONAL_PRESET_SELECTS: Partial<
  Record<PresetId, ReadonlyArray<Readonly<[string, string]>>>
> = {
  'quick-start': [
    ['param', '2t'],
    ['step', '0'],
    ['number', '1,2,3,4,5,6'],
  ],
  standard: [
    ['param', '2t'],
    ['step', '0'],
    ['number', '0'],
  ],
  dataset: [
    ['param', '2t'],
    ['step', '0'],
    ['number', '0'],
  ],
  'ecmwf-open-data': [
    ['param', '2t'],
    ['step', '24,48,72,360'],
    ['number', '1,2,3,4,5,6'],
  ],
}

describe('config presets match the block factory schema', () => {
  it.each(PRESET_IDS)('preset %s has schema-complete block configs', (id) => {
    const { fable } = getPreset(id)

    for (const [blockId, block] of Object.entries(fable.blocks)) {
      const factory = block.factory_id.factory
      const expected = FACTORY_CONFIG_KEYS[factory]
      expect(
        expected,
        `unknown factory '${factory}' in block '${blockId}' — add it to FACTORY_CONFIG_KEYS`,
      ).toBeDefined()

      // Exact match: no stale keys (renames) and no missing keys (additions).
      expect(
        Object.keys(block.configuration_values).sort(),
        `block '${blockId}' (${factory}) config keys drifted from the schema`,
      ).toEqual([...expected].sort())
    }
  })

  it.each(Object.entries(OPERATIONAL_PRESET_SELECTS))(
    'preset %s applies operational source selections with select blocks',
    (id, expectedSelects) => {
      const { fable } = getPreset(id as PresetId)
      const selectConfigs = Object.values(fable.blocks)
        .filter((block) => block.factory_id.factory === 'select')
        .map((block) => [
          block.configuration_values.dimension,
          block.configuration_values.values,
        ])

      expect(selectConfigs).toEqual(expectedSelects)
    },
  )
})
