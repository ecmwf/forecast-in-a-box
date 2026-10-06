/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import type {
  BlockInstanceId,
  FableBuilderV1,
  FableValidationState,
} from '@/api/types/fable.types'
import { findDownstreamBlocks } from '@/features/fable-builder/stores/fableBuilderStore'

/** Edited blocks and their downstream; all blocks if variables changed. */
export function staleBlockIds(
  validated: FableBuilderV1,
  current: FableBuilderV1,
): Set<BlockInstanceId> {
  const ids = Object.keys(current.blocks)
  if (validated.local_glyphs !== current.local_glyphs) return new Set(ids)
  const stale = new Set<BlockInstanceId>()
  for (const id of ids) {
    if (stale.has(id) || current.blocks[id] === validated.blocks[id]) continue
    stale.add(id)
    for (const downstream of findDownstreamBlocks(id, current.blocks)) {
      stale.add(downstream)
    }
  }
  return stale
}

/** Drops and flags `stale` blocks' errors; restrictions stay. */
export function dropBlockErrors(
  state: FableValidationState,
  stale: ReadonlySet<BlockInstanceId>,
): FableValidationState {
  if (stale.size === 0) return state
  return {
    ...state,
    blockStates: Object.fromEntries(
      Object.entries(state.blockStates).map(([id, blockState]) => [
        id,
        stale.has(id)
          ? {
              ...blockState,
              errors: [],
              hasErrors: false,
              missingGlyphs: {},
              stale: true,
            }
          : blockState,
      ]),
    ),
  }
}
