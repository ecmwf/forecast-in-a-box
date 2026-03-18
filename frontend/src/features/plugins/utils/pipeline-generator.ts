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
 * Pipeline Generator
 *
 * Generate pre-connected fable configurations from plugin blocks.
 */

import type {
  BlockConfigurationOption,
  BlockFactory,
  BlockFactoryCatalogue,
  BlockInstanceId,
  BlockKind,
  FableBuilderV1,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import {
  BLOCK_KIND_ORDER,
  createBlockInstance,
  generateBlockInstanceId,
} from '@/api/types/fable.types'
import {
  getDefaultValueForType,
  parseValueType,
} from '@/components/base/fields'

export interface PipelineGeneratorOptions {
  pluginId: string
  catalogue: BlockFactoryCatalogue
  includeDefaults?: boolean
}

export interface GeneratedPipeline {
  fable: FableBuilderV1
  blockMapping: Map<string, BlockInstanceId>
}

/**
 * Generate a connected fable configuration from all blocks in a plugin
 *
 * Algorithm:
 * 1. Get plugin's factories from catalogue
 * 2. Group by kind: sources → transforms → products → sinks
 * 3. Create instances for each block (sorted alphabetically within kind)
 * 4. Connect sequentially by kind order:
 *    - All transforms connect their first input to the first source
 *    - All products connect their first input to the first transform (or source)
 *    - Each product gets its own sink instance (using the first sink factory)
 * 5. Optionally apply default values based on value_type
 */
export function generatePluginPipeline(
  options: PipelineGeneratorOptions,
): GeneratedPipeline {
  const { pluginId, catalogue, includeDefaults = true } = options

  const pluginCatalogue = catalogue[pluginId] as
    | (typeof catalogue)[string]
    | undefined
  if (!pluginCatalogue) {
    return { fable: { blocks: {} }, blockMapping: new Map() }
  }

  // Group factories by kind
  const factoriesByKind: Record<BlockKind, Array<[string, BlockFactory]>> = {
    source: [],
    transform: [],
    product: [],
    sink: [],
  }

  for (const [factoryName, factory] of Object.entries(
    pluginCatalogue.factories,
  )) {
    factoriesByKind[factory.kind].push([factoryName, factory])
  }

  // Sort each group alphabetically for determinism
  for (const kind of BLOCK_KIND_ORDER) {
    factoriesByKind[kind].sort((a, b) => a[0].localeCompare(b[0]))
  }

  // Create instances and track IDs
  const blocks: FableBuilderV1['blocks'] = {}
  const blockMapping = new Map<string, BlockInstanceId>()
  const firstBlockByKind: Record<BlockKind, BlockInstanceId | null> = {
    source: null,
    transform: null,
    product: null,
    sink: null,
  }

  // Track all product instance IDs for sink connections
  const productInstanceIds: Array<BlockInstanceId> = []

  // Parse plugin ID to get store/local
  const [store, local] = pluginId.split('/')

  // Create blocks for sources, transforms, and products
  for (const kind of ['source', 'transform', 'product'] as const) {
    for (const [factoryName, factory] of factoriesByKind[kind]) {
      const factoryId: PluginBlockFactoryId = {
        plugin: { store, local },
        factory: factoryName,
      }

      const instanceId = generateBlockInstanceId()
      const instance = createBlockInstance(factoryId, factory)

      // Apply default values if requested
      if (includeDefaults) {
        for (const [key, option] of Object.entries(
          factory.configuration_options,
        )) {
          const defaultValue = getDefaultValue(option, key)
          if (defaultValue) {
            instance.configuration_values[key] = defaultValue
          }
        }
      }

      // Connect to upstream block if this block has inputs
      if (factory.inputs.length > 0) {
        const upstreamId = findUpstreamBlock(kind, firstBlockByKind)
        if (upstreamId) {
          instance.input_ids[factory.inputs[0]] = upstreamId
        }
      }

      blocks[instanceId] = instance
      blockMapping.set(`${pluginId}:${factoryName}`, instanceId)

      // Track first block of each kind
      if (firstBlockByKind[kind] === null) {
        firstBlockByKind[kind] = instanceId
      }

      // Track all product instances for sink connections
      if (kind === 'product') {
        productInstanceIds.push(instanceId)
      }
    }
  }

  // Create sinks: one sink per product (using first sink factory)
  // If no products exist, create one sink connected to source/transform
  const sinkFactories = factoriesByKind['sink']
  if (sinkFactories.length > 0) {
    const [sinkFactoryName, sinkFactory] = sinkFactories[0]

    // Determine what to connect sinks to
    const upstreamIds =
      productInstanceIds.length > 0
        ? productInstanceIds
        : firstBlockByKind['transform']
          ? [firstBlockByKind['transform']]
          : firstBlockByKind['source']
            ? [firstBlockByKind['source']]
            : []

    for (const upstreamId of upstreamIds) {
      const factoryId: PluginBlockFactoryId = {
        plugin: { store, local },
        factory: sinkFactoryName,
      }

      const instanceId = generateBlockInstanceId()
      const instance = createBlockInstance(factoryId, sinkFactory)

      // Apply default values
      if (includeDefaults) {
        for (const [key, option] of Object.entries(
          sinkFactory.configuration_options,
        )) {
          const defaultValue = getDefaultValue(option, key)
          if (defaultValue) {
            instance.configuration_values[key] = defaultValue
          }
        }
      }

      // Connect to upstream (product/transform/source)
      if (sinkFactory.inputs.length > 0) {
        instance.input_ids[sinkFactory.inputs[0]] = upstreamId
      }

      blocks[instanceId] = instance
      // Map uses factory name with index to distinguish multiple instances
      const mapKey =
        upstreamIds.length > 1
          ? `${pluginId}:${sinkFactoryName}:${upstreamIds.indexOf(upstreamId)}`
          : `${pluginId}:${sinkFactoryName}`
      blockMapping.set(mapKey, instanceId)

      if (firstBlockByKind['sink'] === null) {
        firstBlockByKind['sink'] = instanceId
      }
    }
  }

  return {
    fable: { blocks },
    blockMapping,
  }
}

/**
 * Find the upstream block to connect to based on kind order
 */
function findUpstreamBlock(
  currentKind: BlockKind,
  firstBlockByKind: Record<BlockKind, BlockInstanceId | null>,
): BlockInstanceId | null {
  const kindIndex = BLOCK_KIND_ORDER.indexOf(currentKind)

  // Look backwards through kinds to find a source
  for (let i = kindIndex - 1; i >= 0; i--) {
    const kind = BLOCK_KIND_ORDER[i]
    if (firstBlockByKind[kind]) {
      return firstBlockByKind[kind]
    }
  }

  return null
}

/**
 * Known default values for specific configuration field names
 */
const KNOWN_FIELD_DEFAULTS: Record<string, string> = {
  // Common string fields
  expver: '0001',
  path: '/tmp/output.zarr',
  variable: '2t',
  // Common numeric fields (as strings)
  lead_time: '24',
  ensemble_members: '4',
}

/**
 * Get default value for a configuration option based on its value_type and name
 */
export function getDefaultValue(
  option: BlockConfigurationOption,
  fieldName?: string,
): string {
  // Check if we have a known default for this field name
  if (fieldName && KNOWN_FIELD_DEFAULTS[fieldName]) {
    return KNOWN_FIELD_DEFAULTS[fieldName]
  }

  const parsedType = parseValueType(option.value_type)
  return getDefaultValueForType(parsedType)
}

/**
 * Create a fable with a single block instance
 */
export function createSingleBlockFable(
  factoryId: PluginBlockFactoryId,
  factory: BlockFactory,
  includeDefaults = true,
): FableBuilderV1 {
  const instanceId = generateBlockInstanceId()
  const instance = createBlockInstance(factoryId, factory)

  if (includeDefaults) {
    for (const [key, option] of Object.entries(factory.configuration_options)) {
      const defaultValue = getDefaultValue(option, key)
      if (defaultValue) {
        instance.configuration_values[key] = defaultValue
      }
    }
  }

  return {
    blocks: {
      [instanceId]: instance,
    },
  }
}
