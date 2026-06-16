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
 * Detect which dimension(s) a block narrowed, by comparing the qube flowing
 * into it (its upstream blocks' output) with the qube it emits. The diff is
 * purely on per-dimension value counts, so it never expands the cartesian.
 */

import { parseQubeDimensions } from './qube-matrix'
import type { QubeNode } from '@/api/types/artifacts.types'
import type { FableBuilderV1 } from '@/api/types/fable.types'

export interface DimensionNarrowing {
  dimension: string
  from: number
  to: number
}

/** Per-dimension value counts for a qube, keyed by dimension name. */
function dimensionCounts(root: QubeNode): Map<string, number> {
  const counts = new Map<string, number>()
  for (const dim of parseQubeDimensions(root)) {
    counts.set(dim.key, dim.values.length)
  }
  return counts
}

/**
 * Dimensions the source block deliberately narrowed (input → output count drop).
 * For a Select, only its chosen dimension counts — other dims shrink merely as a
 * side effect of pruning the qube. Sorted by largest drop; `[]` for an
 * origin/missing qube.
 */
export function computeEdgeNarrowing(
  fable: FableBuilderV1,
  blockOutputQubes: Record<string, QubeNode>,
  sourceBlockId: string,
): Array<DimensionNarrowing> {
  const outputQube = blockOutputQubes[sourceBlockId] as QubeNode | undefined
  const block = fable.blocks[sourceBlockId] as
    | FableBuilderV1['blocks'][string]
    | undefined
  if (!outputQube || !block) return []

  const inputCounts = new Map<string, number>()
  for (const upstreamId of Object.values(block.input_ids)) {
    const upstreamQube = blockOutputQubes[upstreamId] as QubeNode | undefined
    if (!upstreamQube) continue
    for (const [dimension, count] of dimensionCounts(upstreamQube)) {
      const existing = inputCounts.get(dimension)
      // Union across upstream qubes: keep the widest count per dimension.
      if (existing === undefined || count > existing) {
        inputCounts.set(dimension, count)
      }
    }
  }
  if (inputCounts.size === 0) return []

  const outputCounts = dimensionCounts(outputQube)
  const narrowings: Array<DimensionNarrowing> = []
  for (const [dimension, from] of inputCounts) {
    const to = outputCounts.get(dimension)
    if (to !== undefined && from > to) {
      narrowings.push({ dimension, from, to })
    }
  }

  // A Select only deliberately narrows its chosen dimension; keep just that one.
  const isSelect = block.factory_id.factory === 'select'
  const selectedDim = block.configuration_values['dimension'] as
    | string
    | undefined
  const deliberate = isSelect
    ? narrowings.filter((item) => item.dimension === selectedDim)
    : narrowings

  deliberate.sort((a, b) => b.from - b.to - (a.from - a.to))
  return deliberate
}
