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
import { getAppTimeZone, yesterdayInZone } from '@/lib/datetime'

/**
 * @deprecated The hardcoded `PresetId` union is deprecated as of this release.
 * All presets are now managed as backend high-level presets (HighLevelPreset)
 * and referenced by their slug-style `preset_id` strings (e.g. "quick-temperature-map").
 * Use the `hlPreset` URL search param instead of `preset`.
 * This type will be removed in a future release.
 */
export type PresetId =
  | 'quick-start'
  | 'standard'
  | 'custom-model'
  | 'dataset'
  | 'ecmwf-open-data'
  | 'aifs-forecast'
  | 'aifs-dataset'

/**
 * Maps legacy hardcoded preset IDs (used in the `?preset=` URL param) to their
 * corresponding backend high-level preset IDs (used in the `?hlPreset=` URL param).
 *
 * This mapping exists for backward compatibility so that bookmarked URLs such as
 * `?preset=quick-start` continue to work after the migration to backend-managed
 * presets.  The `?preset=` param is deprecated and will be removed in a future
 * release — new links should use `?hlPreset=<backend-preset-id>` directly.
 *
 * Mapping rationale:
 *   quick-start      → global-ensemble-statistics  (ported from quick-start: open data → ensemble stats → zarr)
 *   standard         → global-ensemble-statistics  (closest equivalent for MARS-based ensemble source)
 *   custom-model     → blank-canvas                (ported from custom-model: empty pipeline)
 *   dataset          → global-ensemble-statistics  (open data source, upgraded to full pipeline)
 *   ecmwf-open-data  → quick-temperature-map       (ported directly from ecmwf-open-data preset)
 *   aifs-forecast    → regional-surface-forecast   (ported directly from aifs-forecast preset)
 *   aifs-dataset     → aifs-ensemble-to-grib       (ported directly from aifs-dataset preset)
 *
 * @deprecated Will be removed once the `?preset=` search param is dropped.
 */
export const LEGACY_PRESET_MAP: Record<string, string> = {
  'quick-start': 'global-ensemble-statistics',
  standard: 'global-ensemble-statistics',
  'custom-model': 'blank-canvas',
  dataset: 'global-ensemble-statistics',
  'ecmwf-open-data': 'quick-temperature-map',
  'aifs-forecast': 'regional-surface-forecast',
  'aifs-dataset': 'aifs-ensemble-to-grib',
}

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

/** Yesterday's calendar date in the application timezone, evaluated per call. */
function yesterday(): string {
  return yesterdayInZone(getAppTimeZone())
}

/** Yesterday at 00:00:00 — anemoi base_time format (naive, treated as UTC). */
function yesterdayBaseTime(): string {
  return `${yesterday()}T00:00:00`
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
            factory: 'operationalForecastSource',
          },
          configuration_values: {
            source: 'ecmwf-open-data',
            forecast: 'aifs-ens',
            base_time: yesterdayBaseTime(),
            param: '2t',
            step: '0',
            number: '1,2,3,4,5,6',
          },
          input_ids: {},
        },
        product_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'ensembleStatistics',
          },
          configuration_values: {
            param: '2t',
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
            factory: 'operationalForecastSource',
          },
          configuration_values: {
            source: 'mars',
            forecast: 'aifs-ens',
            base_time: yesterdayBaseTime(),
            param: '2t',
            step: '0',
            number: '0',
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
    name: 'Start from Scratch',
    description: 'Empty canvas — build a forecast with full control',
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
            factory: 'operationalForecastSource',
          },
          configuration_values: {
            source: 'ecmwf-open-data',
            forecast: 'aifs-ens',
            base_time: yesterdayBaseTime(),
            param: '2t',
            step: '0',
            number: '0',
          },
          input_ids: {},
        },
      },
    },
  }
}

function ecmwfOpenDataPreset(): FablePreset {
  return {
    id: 'ecmwf-open-data',
    name: 'ECMWF Open Data',
    description: 'Ensemble-mean 2 m temperature maps from ECMWF IFS Open Data',
    fable: {
      blocks: {
        source_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'operationalForecastSource',
          },
          configuration_values: {
            source: 'ecmwf-open-data',
            forecast: 'aifs-ens',
            base_time: yesterdayBaseTime(),
            param: '2t',
            step: '24,48,72,360',
            number: '1,2,3,4,5,6',
          },
          input_ids: {},
        },
        product_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'ensembleStatistics',
          },
          configuration_values: {
            param: '2t',
            statistic: 'mean',
          },
          input_ids: {
            dataset: 'source_1',
          },
        },
        sink_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'mapPlotSink',
          },
          configuration_values: {
            param: '2t',
            domain: 'global',
            format: 'png',
            groupby: 'none',
            splitby: 'none',
          },
          input_ids: {
            dataset: 'product_1',
          },
        },
      },
    },
  }
}

function aifsForecastPreset(): FablePreset {
  return {
    id: 'aifs-forecast',
    name: 'AIFS 72h Forecast',
    description:
      '72-hour AIFS Open Data forecast with global PDF and European PNG map plots',
    fable: {
      blocks: {
        source_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'anemoiSource',
          },
          configuration_values: {
            checkpoint: 'ecmwf:aifs-global-o48',
            input_source: 'opendata',
            lead_time: '72',
            base_time: yesterdayBaseTime(),
            number: '1',
          },
          input_ids: {},
        },
        sink_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'mapPlotSink',
          },
          configuration_values: {
            param: '10u',
            domain: 'europe',
            format: 'png',
            groupby: 'none',
            splitby: 'step',
          },
          input_ids: {
            dataset: 'source_1',
          },
        },
        sink_2: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'mapPlotSink',
          },
          configuration_values: {
            param: '2t,msl',
            domain: 'global',
            format: 'pdf',
            groupby: 'none',
            splitby: 'step',
          },
          input_ids: {
            dataset: 'source_1',
          },
        },
      },
    },
  }
}

function aifsDatasetPreset(): FablePreset {
  return {
    id: 'aifs-dataset',
    name: 'AIFS Ensemble Dataset',
    description: '10-member AIFS Open Data ensemble exported as a GRIB file',
    fable: {
      blocks: {
        source_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'anemoiSource',
          },
          configuration_values: {
            checkpoint: 'ecmwf:aifs-global-o48',
            input_source: 'opendata',
            lead_time: '72',
            base_time: yesterdayBaseTime(),
            number: '10',
          },
          input_ids: {},
        },
        sink_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'gribSink',
          },
          configuration_values: {
            path: '/tmp/${runId}__${attemptCount}.grib2',
          },
          input_ids: {
            dataset: 'source_1',
          },
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
  'ecmwf-open-data': ecmwfOpenDataPreset,
  'aifs-forecast': aifsForecastPreset,
  'aifs-dataset': aifsDatasetPreset,
}

export function getPreset(id: PresetId): FablePreset {
  return PRESET_BUILDERS[id]()
}
