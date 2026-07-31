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
 * Pair layers across two WMS sources for linked selection.
 *
 * Layers pair on (group key × pressure level): `groupLayers` already
 * normalizes parameter grouping per source (SkinnyWMS layer names like
 * `2t` / `q@pl_500` are pipeline-stable across runs), so two runs of the
 * same parameter land in groups with identical keys. A pair present in
 * only one source stays selectable — it simply renders on that side only,
 * with the gap surfaced in the browser UI.
 */

import { expandTimeSteps } from '../wms-capabilities'
import type { LayerGroup, ParsedLayer } from '../wms-capabilities'

export type SourceSlot = 'a' | 'b'

export interface PairedLayer {
  /** Stable pair identity: `<group.key>@<level|'sfc'>`. */
  key: string
  title: string
  subtitle: string | null
  level: number | null
  levelUnit: string | null
  perSource: Partial<Record<SourceSlot, ParsedLayer>>
}

// Mirrors buildSourceTimeIndex: only steps Date.parse accepts feed the
// axis, so a TIME dim expanding to unparseable strings is still static.
const timeAwareCache = new WeakMap<ParsedLayer, boolean>()
export function layerIsTimeAware(layer: ParsedLayer): boolean {
  if (!layer.time) return false
  const cached = timeAwareCache.get(layer)
  if (cached !== undefined) return cached
  const aware = expandTimeSteps(layer.time.raw).some((step) =>
    Number.isFinite(Date.parse(step)),
  )
  timeAwareCache.set(layer, aware)
  return aware
}

/** No side contributes time steps — renders unchanged at every step. */
export function pairIsStatic(pair: PairedLayer): boolean {
  return Object.values(pair.perSource).every(
    (layer) => !layerIsTimeAware(layer),
  )
}

export interface PairingResult {
  pairs: Array<PairedLayer>
  /** Pairs available in BOTH sources. 0 → selection must unlink. */
  overlapCount: number
}

function pairKey(groupKey: string, level: number | null): string {
  return `${groupKey}@${level ?? 'sfc'}`
}

export function buildPairs(
  groupsA: ReadonlyArray<LayerGroup>,
  groupsB: ReadonlyArray<LayerGroup>,
): PairingResult {
  const byKey = new Map<string, PairedLayer>()

  const ingest = (groups: ReadonlyArray<LayerGroup>, slot: SourceSlot) => {
    for (const group of groups) {
      for (const entry of group.entries) {
        const key = pairKey(group.key, entry.level)
        const existing = byKey.get(key)
        if (existing) {
          existing.perSource[slot] = entry.layer
          continue
        }
        byKey.set(key, {
          key,
          title: group.title,
          subtitle: group.subtitle ?? null,
          level: entry.level,
          levelUnit: group.levelUnit ?? null,
          perSource: { [slot]: entry.layer },
        })
      }
    }
  }
  ingest(groupsA, 'a')
  ingest(groupsB, 'b')

  const pairs = [...byKey.values()].sort((x, y) => {
    const byTitle = x.title.localeCompare(y.title)
    if (byTitle !== 0) return byTitle
    // Levels descending, single-level entries first.
    return (y.level ?? Number.POSITIVE_INFINITY) ===
      (x.level ?? Number.POSITIVE_INFINITY)
      ? 0
      : (y.level ?? Number.POSITIVE_INFINITY) >
          (x.level ?? Number.POSITIVE_INFINITY)
        ? -1
        : 1
  })
  const overlapCount = pairs.filter(
    (p) => p.perSource.a && p.perSource.b,
  ).length
  return { pairs, overlapCount }
}
