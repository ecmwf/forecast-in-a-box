/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo } from 'react'
import type { BlockFactory } from '@/api/types/fable.types'
import { factoryIdToKey } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'

/** Factory keys that can join the canvas now; `null` means every factory. */
export type AvailableFactoryIds = Set<string> | 'sources-only' | null

/** Which factories the current validation state lets the user add. */
export function useAvailableFactoryIds(): AvailableFactoryIds {
  const blockCount = useFableBuilderStore(
    (state) => Object.keys(state.fable.blocks).length,
  )
  const validationState = useFableBuilderStore((state) => state.validationState)

  return useMemo(() => {
    if (blockCount === 0) {
      if (!validationState) {
        // Validation not available yet — signal sources-only mode.
        // TODO: Change when backend validation works properly
        return 'sources-only' as const
      }
      return new Set(
        validationState.possibleSources.map((id) => factoryIdToKey(id)),
      )
    }

    if (!validationState) return null

    const allExpansions = new Set<string>()
    for (const blockState of Object.values(validationState.blockStates)) {
      for (const expansion of blockState.possibleExpansions) {
        allExpansions.add(factoryIdToKey(expansion))
      }
    }
    // No expansions (e.g. a block has errors) → keep every block available
    // instead of greying the palette. Mirrors AddNodeButton's fallback.
    return allExpansions.size > 0 ? allExpansions : null
  }, [validationState, blockCount])
}

export function isFactoryAvailable(
  available: AvailableFactoryIds,
  factory: BlockFactory,
  key: string,
): boolean {
  if (available === null) return true
  if (available === 'sources-only') return factory.kind === 'source'
  return available.has(key)
}
