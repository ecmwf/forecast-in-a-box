/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import type { FableBuilderV1 } from '@/api/types/fable.types'
import type { PluginCompositeId } from '@/api/types/plugins.types'
import { getAppTimeZone, todayInZone } from '@/lib/datetime'

export type PresetId = 'quick-start' | 'standard' | 'custom-model' | 'dataset'

export interface FablePreset {
  id: PresetId
  name: string
  description: string
  fable: FableBuilderV1
}

/**
 * Helper to create PluginCompositeId
 */
function pluginId(store: string, local: string): PluginCompositeId {
  return { store, local }
}

/** Today's calendar date in the application timezone, evaluated per call. */
function today(): string {
  return todayInZone(getAppTimeZone())
}

function quickStartPreset(): FablePreset {
  return {
    id: 'quick-start',
    name: 'Quick Start',
    description: 'Ready to run with optimized defaults',
    fable: {
      blocks: {
        source_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'ekdSource',
          },
          configuration_values: {
            source: 'ecmwf-open-data',
            date: today(),
            expver: '0001',
          },
          input_ids: {},
        },
        product_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'ensembleStatistics',
          },
          configuration_values: {
            variable: '2t',
            statistic: 'mean',
          },
          input_ids: {
            dataset: 'source_1',
          },
        },
        sink_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'zarrSink',
          },
          configuration_values: {
            path: '/data/output/quick_start.zarr',
          },
          input_ids: {
            dataset: 'product_1',
          },
        },
      },
    },
  }
}

function standardPreset(): FablePreset {
  return {
    id: 'standard',
    name: 'Standard Forecast',
    description: 'Standard forecast data pipeline',
    fable: {
      blocks: {
        source_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'ekdSource',
          },
          configuration_values: {
            source: 'mars',
            date: today(),
            expver: '0001',
          },
          input_ids: {},
        },
      },
    },
  }
}

function customModelPreset(): FablePreset {
  return {
    id: 'custom-model',
    name: 'Custom Forecast',
    description: 'Start with empty canvas for full customization',
    fable: {
      blocks: {},
    },
  }
}

function datasetPreset(): FablePreset {
  return {
    id: 'dataset',
    name: 'Open Data Forecast',
    description: 'Start with ECMWF open data as source',
    fable: {
      blocks: {
        source_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'ekdSource',
          },
          configuration_values: {
            source: 'ecmwf-open-data',
            date: today(),
            expver: '0001',
          },
          input_ids: {},
        },
      },
    },
  }
}

/**
 * Preset builders — each is invoked per call so date defaults reflect the
 * current day in the application timezone rather than module-load time.
 */
const PRESET_BUILDERS: Record<PresetId, () => FablePreset> = {
  'quick-start': quickStartPreset,
  standard: standardPreset,
  'custom-model': customModelPreset,
  dataset: datasetPreset,
}

export function getPreset(id: PresetId): FablePreset | undefined {
  return PRESET_BUILDERS[id]()
}

export function getPresetIds(): Array<PresetId> {
  return Object.keys(PRESET_BUILDERS) as Array<PresetId>
}
