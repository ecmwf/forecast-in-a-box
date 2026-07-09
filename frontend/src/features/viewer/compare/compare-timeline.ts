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
 * Cross-source valid-time alignment, keyed on epoch milliseconds — NEVER
 * on strings. Two servers can advertise the same instant in different
 * forms (`…T06:00:00Z` vs `…T06:00:00.000Z`), so the shared timeline
 * unions epochs while each source keeps the exact raw string IT
 * advertised, which is what goes back out as the WMS TIME parameter.
 */

import { expandTimeSteps } from '../wms-capabilities'
import type { ParsedLayer } from '../wms-capabilities'
import type { SourceSlot } from './layer-pairing'

export interface SourceTimeIndex {
  /** Sorted ascending; empty when no active layer is time-aware. */
  epochs: Array<number>
  /** Exact string THIS server advertised for each epoch → send as TIME. */
  rawByEpoch: Map<number, string>
}

export function buildSourceTimeIndex(
  layers: ReadonlyArray<ParsedLayer>,
  activeNames: ReadonlyArray<string>,
): SourceTimeIndex {
  const rawByEpoch = new Map<number, string>()
  for (const name of activeNames) {
    const layer = layers.find((l) => l.name === name)
    if (!layer?.time) continue
    for (const step of expandTimeSteps(layer.time.raw)) {
      const epoch = Date.parse(step)
      if (!Number.isFinite(epoch)) continue
      if (!rawByEpoch.has(epoch)) rawByEpoch.set(epoch, step)
    }
  }
  return { epochs: [...rawByEpoch.keys()].sort((x, y) => x - y), rawByEpoch }
}

export interface CompareTimeline {
  /** Union of both sources' epochs, sorted ascending. */
  epochs: Array<number>
  /** Per union index: does the source have data at exactly this instant? */
  availability: Record<SourceSlot, Array<boolean>>
  /** Epochs available in both sources. */
  intersectionCount: number
}

export function buildCompareTimeline(
  a: SourceTimeIndex,
  b: SourceTimeIndex,
): CompareTimeline {
  const union = new Set<number>([...a.epochs, ...b.epochs])
  const epochs = [...union].sort((x, y) => x - y)
  const availability: CompareTimeline['availability'] = {
    a: epochs.map((e) => a.rawByEpoch.has(e)),
    b: epochs.map((e) => b.rawByEpoch.has(e)),
  }
  const intersectionCount = epochs.filter(
    (e) => a.rawByEpoch.has(e) && b.rawByEpoch.has(e),
  ).length
  return { epochs, availability, intersectionCount }
}

/** Index of `epoch` in `epochs`, or the nearest position to re-locate a
 *  previously selected instant after the union changed. -1 when empty. */
export function locateEpoch(
  epochs: ReadonlyArray<number>,
  epoch: number | null,
): number {
  if (epochs.length === 0) return -1
  if (epoch === null) return 0
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  epochs.forEach((e, i) => {
    const dist = Math.abs(e - epoch)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  })
  return best
}

/** [first, last] index where the source has data; null when it never does. */
export function availabilityRange(
  availability: ReadonlyArray<boolean>,
): [number, number] | null {
  const first = availability.indexOf(true)
  if (first === -1) return null
  return [first, availability.lastIndexOf(true)]
}

/** Window where BOTH sources have data somewhere; null when disjoint. */
export function overlapRange(
  a: ReadonlyArray<boolean>,
  b: ReadonlyArray<boolean>,
): [number, number] | null {
  const ra = availabilityRange(a)
  const rb = availabilityRange(b)
  if (!ra || !rb) return null
  const start = Math.max(ra[0], rb[0])
  const end = Math.min(ra[1], rb[1])
  return start <= end ? [start, end] : null
}
