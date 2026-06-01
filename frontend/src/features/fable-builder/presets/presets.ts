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
import { getAppTimeZone, todayInZone, yesterdayInZone } from '@/lib/datetime'
import i18n from '@/lib/i18n'

export type PresetId =
  | 'quick-start'
  | 'standard'
  | 'custom-model'
  | 'dataset'
  | 'ecmwf-open-data'
  | 'aifs-forecast'
  | 'aifs-dataset'

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
    name: i18n.t('configure:presets.quickStartName'),
    description: i18n.t('configure:presets.quickStartDescription'),
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
    name: i18n.t('configure:presets.standardName'),
    description: i18n.t('configure:presets.standardDescription'),
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
    name: i18n.t('configure:presets.customModelName'),
    description: i18n.t('configure:presets.customModelDescription'),
    fable: {
      blocks: {},
    },
  }
}

function datasetPreset(): FablePreset {
  return {
    id: 'dataset',
    name: i18n.t('configure:presets.datasetName'),
    description: i18n.t('configure:presets.datasetDescription'),
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
    name: i18n.t('configure:presets.ecmwfOpenDataName'),
    description: i18n.t('configure:presets.ecmwfOpenDataDescription'),
    fable: {
      blocks: {
        source_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'ekdSource',
          },
          configuration_values: {
            source: 'ecmwf-open-data',
            date: yesterday(),
            expver: '1',
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
    name: i18n.t('configure:presets.aifsForecastName'),
    description: i18n.t('configure:presets.aifsForecastDescription'),
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
        transform_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'selectSteps',
          },
          configuration_values: {
            step: '6,12,18,24,30,36,42,48,54,60,66,72',
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
            param: '10u,10v',
            domain: 'europe',
            format: 'png',
            groupby: 'none',
            splitby: 'none',
          },
          input_ids: {
            dataset: 'transform_1',
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
            splitby: 'none',
          },
          input_ids: {
            dataset: 'transform_1',
          },
        },
      },
    },
  }
}

function aifsDatasetPreset(): FablePreset {
  return {
    id: 'aifs-dataset',
    name: i18n.t('configure:presets.aifsDatasetName'),
    description: i18n.t('configure:presets.aifsDatasetDescription'),
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
            factory: 'zarrSink',
          },
          configuration_values: {
            path: '/tmp/${runId}__${attemptCount}.zarr',
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
