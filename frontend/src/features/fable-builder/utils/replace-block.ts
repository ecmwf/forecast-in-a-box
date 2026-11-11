/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Swapping a block for another of the same kind, in place. */

import type {
  BlockFactory,
  BlockFactoryCatalogue,
  BlockInstance,
  BlockInstanceId,
  FableBuilderV1,
  FableValidationState,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import type { FableType } from '@/components/base/fields/fable-type'
import {
  factoryIdToKey,
  getFactory,
  pluginIdToDisplayKey,
} from '@/api/types/fable.types'
import { parseFableType } from '@/components/base/fields/fable-type'
import {
  collidingTitles,
  qualifiedFactoryTitle,
} from '@/features/fable-builder/utils/block-names'

function expansionsOf(
  validation: FableValidationState,
  blockId: BlockInstanceId,
): Array<PluginBlockFactoryId> | undefined {
  const state = validation.blockStates[blockId] as
    FableValidationState['blockStates'][string] | undefined
  return state?.possibleExpansions
}

export interface ReplacementCandidate {
  factoryId: PluginBlockFactoryId
  factory: BlockFactory
  /** The title, plus the plugin when another factory shares it. */
  label: string
}

/** Same-kind blocks that fit every parent, by label; other sources for a source. */
export function replacementCandidates(
  blockId: BlockInstanceId,
  fable: FableBuilderV1,
  catalogue: BlockFactoryCatalogue,
  validation: FableValidationState | null,
): Array<ReplacementCandidate> {
  const block = fable.blocks[blockId] as BlockInstance | undefined
  const current = block && getFactory(catalogue, block.factory_id)
  if (!block || !current || !validation) return []

  const parents = Object.values(block.input_ids).filter(Boolean)
  const fitting = parents.map(
    (parent) =>
      new Set((expansionsOf(validation, parent) ?? []).map(factoryIdToKey)),
  )
  const pool =
    parents.length === 0
      ? validation.possibleSources
      : (expansionsOf(validation, parents[0]) ?? [])
  const ownKey = factoryIdToKey(block.factory_id)
  const colliding = collidingTitles(catalogue)

  const seen = new Set<string>()
  const candidates: Array<ReplacementCandidate> = []
  for (const factoryId of pool) {
    const key = factoryIdToKey(factoryId)
    if (key === ownKey || seen.has(key)) continue
    if (!fitting.every((keys) => keys.has(key))) continue
    const factory = getFactory(catalogue, factoryId)
    if (factory?.kind !== current.kind) continue
    seen.add(key)
    const label = qualifiedFactoryTitle(
      factory.title,
      pluginIdToDisplayKey(factoryId.plugin),
      colliding,
    )
    candidates.push({ factoryId, factory, label })
  }
  return candidates.sort((a, b) => a.label.localeCompare(b.label))
}

function baseKind(type: FableType | null): string | undefined {
  if (!type) return undefined
  if (type.kind === 'list') return `list:${baseKind(type.item)}`
  if (type.kind === 'enum') return baseKind(type.subtype)
  return type.kind
}

/** Same type, or a value the new type still accepts. */
function valueFits(value: string, from: string, to: string): boolean {
  if (value === '') return false
  if (from === to) return true
  const target = parseFableType(to)
  const closed =
    target?.kind === 'enum'
      ? target
      : target?.kind === 'list' && target.item.kind === 'enum'
        ? target.item
        : undefined
  if (closed?.closed) {
    const items = new Set(closed.items.map(String))
    return value.split(',').every((item) => items.has(item.trim()))
  }
  return baseKind(parseFableType(from)) === baseKind(target)
}

export interface Replacement {
  instance: BlockInstance
  /** Option ids whose value moved to the new block. */
  kept: Array<string>
  /** Option ids with a value the new block doesn't take. */
  dropped: Array<string>
}

function sameValues(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
  )
}

/** True if both have the same factory, settings and inputs. */
export function sameBlockInstance(a: BlockInstance, b: BlockInstance): boolean {
  return (
    factoryIdToKey(a.factory_id) === factoryIdToKey(b.factory_id) &&
    sameValues(a.configuration_values, b.configuration_values) &&
    sameValues(a.input_ids, b.input_ids)
  )
}

/** Keeps the wiring and the options that still fit. */
export function replaceBlockInstance(
  block: BlockInstance,
  from: BlockFactory,
  factoryId: PluginBlockFactoryId,
  to: BlockFactory,
): Replacement {
  const configuration: Record<string, string> = {}
  const kept: Array<string> = []
  for (const [key, option] of Object.entries(to.configuration_options)) {
    const value = block.configuration_values[key] as string | undefined
    const previous = from.configuration_options[key] as
      (typeof from.configuration_options)[string] | undefined
    if (
      value !== undefined &&
      previous &&
      valueFits(value, previous.value_type, option.value_type)
    ) {
      configuration[key] = value
      kept.push(key)
    } else {
      configuration[key] = option.default_value ?? ''
    }
  }
  const dropped = Object.entries(block.configuration_values)
    .filter(([key, value]) => value !== '' && !kept.includes(key))
    .map(([key]) => key)

  // A lone input maps to a lone input even when the names differ.
  const oldInputs = Object.entries(block.input_ids)
  const inputs: Record<string, string> = {}
  for (const name of to.inputs) {
    inputs[name] =
      block.input_ids[name] ??
      (to.inputs.length === 1 && oldInputs.length === 1 ? oldInputs[0][1] : '')
  }

  return {
    instance: {
      factory_id: factoryId,
      configuration_values: configuration,
      input_ids: inputs,
    },
    kept,
    dropped,
  }
}
