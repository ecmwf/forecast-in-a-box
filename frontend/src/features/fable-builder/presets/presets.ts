/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import type { BlockInstance, FableBuilderV1 } from '@/api/types/fable.types'
import type { PluginCompositeId } from '@/api/types/plugins.types'
import { getAppTimeZone, yesterdayInZone } from '@/lib/datetime'
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

function ecmwfBasePlugin(): PluginCompositeId {
  return pluginId('ecmwf', 'ecmwf-base')
}

function operationalForecastSourceBlock(
  source: string,
  forecast = 'aifs-ens',
): BlockInstance {
  return {
    factory_id: {
      plugin: ecmwfBasePlugin(),
      factory: 'operationalForecastSource',
    },
    configuration_values: {
      source,
      forecast,
      base_time: yesterdayBaseTime(),
    },
    input_ids: {},
  }
}

function selectBlock(
  inputId: string,
  dimension: string,
  values: string,
): BlockInstance {
  return {
    factory_id: {
      plugin: ecmwfBasePlugin(),
      factory: 'select',
    },
    configuration_values: {
      dimension,
      values,
    },
    input_ids: {
      dataset: inputId,
    },
  }
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
        source_1: operationalForecastSourceBlock('ecmwf-open-data'),
        select_param_1: selectBlock('source_1', 'param', '2t'),
        select_step_1: selectBlock('select_param_1', 'step', '0'),
        select_number_1: selectBlock('select_step_1', 'number', '1,2,3,4,5,6'),
        product_1: {
          factory_id: {
            plugin: ecmwfBasePlugin(),
            factory: 'ensembleStatistics',
          },
          configuration_values: {
            param: '2t',
            statistic: 'mean',
          },
          input_ids: {
            dataset: 'select_number_1',
          },
        },
        sink_1: {
          factory_id: {
            plugin: ecmwfBasePlugin(),
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
        source_1: operationalForecastSourceBlock('mars'),
        select_param_1: selectBlock('source_1', 'param', '2t'),
        select_step_1: selectBlock('select_param_1', 'step', '0'),
        select_number_1: selectBlock('select_step_1', 'number', '0'),
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
        source_1: operationalForecastSourceBlock('ecmwf-open-data'),
        select_param_1: selectBlock('source_1', 'param', '2t'),
        select_step_1: selectBlock('select_param_1', 'step', '0'),
        select_number_1: selectBlock('select_step_1', 'number', '0'),
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
        source_1: operationalForecastSourceBlock('ecmwf-open-data'),
        select_param_1: selectBlock('source_1', 'param', '2t'),
        select_step_1: selectBlock('select_param_1', 'step', '24,48,72,360'),
        select_number_1: selectBlock('select_step_1', 'number', '1,2,3,4,5,6'),
        product_1: {
          factory_id: {
            plugin: ecmwfBasePlugin(),
            factory: 'ensembleStatistics',
          },
          configuration_values: {
            param: '2t',
            statistic: 'mean',
          },
          input_ids: {
            dataset: 'select_number_1',
          },
        },
        sink_1: {
          factory_id: {
            plugin: ecmwfBasePlugin(),
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
            factory: 'select',
          },
          configuration_values: {
            dimension: 'step',
            values: '6,12,18,24,30,36,42,48,54,60,66,72',
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
