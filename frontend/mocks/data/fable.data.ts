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
 * Mock Fable Data
 *
 * Test data for fable builder features.
 * Uses the new backend format with PluginCompositeId structure.
 *
 * Note: The backend returns catalogue keys in Python repr format: "store='ecmwf' local='toy1'"
 * The frontend normalizes these to display format: "ecmwf/toy1"
 */

import type {
  BlockFactory,
  BlockFactoryCatalogue,
  FableBuilderV1,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import type { PluginCompositeId } from '@/api/types/plugins.types'
import { getFactory } from '@/api/types/fable.types'

/**
 * Helper to create a PluginCompositeId
 */
function pluginId(store: string, local: string): PluginCompositeId {
  return { store, local }
}

/**
 * Mock catalogue in normalized display format (keys use "store/local" format)
 *
 * Note: The actual backend returns keys in Python repr format "store='...' local='...'",
 * but the frontend normalizes these to display format when fetching via useBlockCatalogue.
 * This mock is already in display format for direct use with getFactory() helper.
 */
export const mockCatalogue: BlockFactoryCatalogue = {
  // ECMWF base plugin - matches live backend exactly
  ['ecmwf/ecmwf-base']: {
    factories: {
      ekdSource: {
        kind: 'source',
        title: 'Earthkit Data Source',
        description: 'Fetch data from mars or ecmwf open data',
        configuration_options: {
          source: {
            title: 'Source',
            description: 'Top level source for earthkit data',
            value_type: "enum['mars', 'ecmwf-open-data']",
          },
          date: {
            title: 'Date',
            description: 'The date dimension of the data',
            value_type: 'date-iso8601',
          },
          expver: {
            title: 'Expver',
            description: 'The expver value of the forecast',
            value_type: 'str',
          },
        },
        inputs: [],
      },
      ensembleStatistics: {
        kind: 'product',
        title: 'Ensemble Statistics',
        description: 'Computes ensemble mean or standard deviation',
        configuration_options: {
          variable: {
            title: 'Variable',
            description: "Variable name like '2t'",
            value_type: 'str',
          },
          statistic: {
            title: 'Statistic',
            description: 'Statistic to compute over the ensemble',
            value_type: "enum['mean', 'std']",
          },
        },
        inputs: ['dataset'],
      },
      temporalStatistics: {
        kind: 'product',
        title: 'Temporal Statistics',
        description: 'Computes temporal statistics',
        configuration_options: {
          variable: {
            title: 'Variable',
            description: "Variable name like '2t'",
            value_type: 'str',
          },
          statistic: {
            title: 'Statistic',
            description: 'Statistic to compute over steps',
            value_type: "enum['mean', 'std', 'min', 'max']",
          },
        },
        inputs: ['dataset'],
      },
      zarrSink: {
        kind: 'sink',
        title: 'Zarr Sink',
        description: 'Write dataset to a zarr on the local filesystem',
        configuration_options: {
          path: {
            title: 'Zarr Path',
            description: 'Filesystem path where the zarr should be written',
            value_type: 'str',
          },
        },
        inputs: ['dataset'],
      },
    },
  },
}

/**
 * Get blocks grouped by kind for UI display
 */
export function getBlocksByKind(
  catalogue: BlockFactoryCatalogue,
): Record<string, Array<{ id: PluginBlockFactoryId; factory: BlockFactory }>> {
  const result: Record<
    string,
    Array<{ id: PluginBlockFactoryId; factory: BlockFactory }>
  > = {
    source: [],
    transform: [],
    product: [],
    sink: [],
  }

  for (const [pluginKey, pluginCatalogue] of Object.entries(catalogue)) {
    // Parse the plugin key (could be Python repr or display format)
    let plugin: PluginCompositeId
    if (pluginKey.includes("store='") && pluginKey.includes("local='")) {
      // Python repr format
      const storeMatch = pluginKey.match(/store='([^']+)'/)
      const localMatch = pluginKey.match(/local='([^']+)'/)
      plugin = {
        store: storeMatch?.[1] ?? '',
        local: localMatch?.[1] ?? '',
      }
    } else if (pluginKey.includes('/')) {
      // Display format
      const slashIndex = pluginKey.indexOf('/')
      plugin = {
        store: pluginKey.substring(0, slashIndex),
        local: pluginKey.substring(slashIndex + 1),
      }
    } else {
      // Fallback - treat as local name only
      plugin = { store: '', local: pluginKey }
    }

    for (const [factoryId, factory] of Object.entries(
      pluginCatalogue.factories,
    )) {
      result[factory.kind].push({
        id: { plugin, factory: factoryId },
        factory,
      })
    }
  }

  return result
}

/**
 * Mock saved fables with new PluginBlockFactoryId format
 */
export const mockSavedFables: Record<
  string,
  {
    fable: FableBuilderV1
    name: string
    tags: Array<string>
    user_id: string
    created_at: string
    updated_at: string
  }
> = {
  'fable-001': {
    fable: {
      blocks: {
        block_source_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'ekdSource',
          },
          configuration_values: {
            source: 'mars',
            date: '2024-01-15',
            expver: '0001',
          },
          input_ids: {},
        },
        block_product_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'ensembleStatistics',
          },
          configuration_values: {
            variable: '2t',
            statistic: 'mean',
          },
          input_ids: {
            dataset: 'block_source_1',
          },
        },
        block_sink_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'zarrSink',
          },
          configuration_values: {
            path: '/data/output/european_temperature.zarr',
          },
          input_ids: {
            dataset: 'block_product_1',
          },
        },
      },
    },
    name: 'European Temperature Forecast',
    tags: ['europe', 'temperature', 'daily'],
    user_id: 'user-123',
    created_at: '2024-01-10T10:00:00Z',
    updated_at: '2024-01-15T14:30:00Z',
  },

  'fable-002': {
    fable: {
      blocks: {
        block_source_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'ekdSource',
          },
          configuration_values: {
            source: 'ecmwf-open-data',
            date: '2024-01-14',
            expver: '0001',
          },
          input_ids: {},
        },
        block_sink_1: {
          factory_id: {
            plugin: pluginId('ecmwf', 'ecmwf-base'),
            factory: 'zarrSink',
          },
          configuration_values: {
            path: '/data/output/open_data_archive.zarr',
          },
          input_ids: {
            dataset: 'block_source_1',
          },
        },
      },
    },
    name: 'Open Data Archive',
    tags: ['open-data', 'archive'],
    user_id: 'user-123',
    created_at: '2024-01-12T08:00:00Z',
    updated_at: '2024-01-12T08:00:00Z',
  },
}

/**
 * Calculate expansion (validation) for a fable
 *
 * Returns validation errors and possible next blocks that can be added.
 */
export function calculateExpansion(fable: FableBuilderV1): {
  global_errors: Array<string>
  block_errors: Record<string, Array<string>>
  possible_sources: Array<PluginBlockFactoryId>
  possible_expansions: Record<string, Array<PluginBlockFactoryId>>
} {
  const block_errors: Record<string, Array<string>> = {}
  const possible_expansions: Record<string, Array<PluginBlockFactoryId>> = {}

  // Available blocks by kind (using new PluginCompositeId format)
  // Only ecmwf-base plugin is loaded
  const sourceBlocks: Array<PluginBlockFactoryId> = [
    { plugin: pluginId('ecmwf', 'ecmwf-base'), factory: 'ekdSource' },
  ]
  const productBlocks: Array<PluginBlockFactoryId> = [
    {
      plugin: pluginId('ecmwf', 'ecmwf-base'),
      factory: 'ensembleStatistics',
    },
    {
      plugin: pluginId('ecmwf', 'ecmwf-base'),
      factory: 'temporalStatistics',
    },
  ]
  const sinkBlocks: Array<PluginBlockFactoryId> = [
    { plugin: pluginId('ecmwf', 'ecmwf-base'), factory: 'zarrSink' },
  ]

  for (const [blockId, instance] of Object.entries(fable.blocks)) {
    const errors: Array<string> = []

    const factory = getFactory(mockCatalogue, instance.factory_id)
    if (!factory) {
      const pluginDisplay = `${instance.factory_id.plugin.store}/${instance.factory_id.plugin.local}`
      errors.push(
        `Block factory '${pluginDisplay}:${instance.factory_id.factory}' not found`,
      )
      block_errors[blockId] = errors
      continue
    }

    // Check for missing required config
    for (const configKey of Object.keys(factory.configuration_options)) {
      const value = instance.configuration_values[configKey]
      if (!value || value.trim() === '') {
        errors.push(`Missing required configuration: ${configKey}`)
      }
    }

    // Check for missing inputs
    for (const inputName of factory.inputs) {
      const sourceId = instance.input_ids[inputName]

      if (!sourceId || sourceId.trim() === '') {
        errors.push(`Missing required input: ${inputName}`)
      } else if (!(sourceId in fable.blocks)) {
        errors.push(`Input '${inputName}' references non-existent block`)
      }
    }

    if (errors.length > 0) {
      block_errors[blockId] = errors
    }

    // Calculate possible expansions based on block kind
    if (factory.kind === 'source') {
      possible_expansions[blockId] = productBlocks
    } else if (factory.kind === 'product') {
      possible_expansions[blockId] = sinkBlocks
    }
  }

  return {
    global_errors: [],
    block_errors,
    possible_sources: sourceBlocks,
    possible_expansions,
  }
}
