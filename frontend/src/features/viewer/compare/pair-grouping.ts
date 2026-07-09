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
 * Group paired layers for the compare browser the same way the embedded
 * viewer groups a single source: one entry per parameter, multi-level
 * parameters collapse their pressure levels into the group. Slot
 * availability filtering (All | A | B) happens here so the view stays a
 * dumb list.
 */

import type { PairedLayer, SourceSlot } from './layer-pairing'

export type SlotFilter = 'all' | 'both' | SourceSlot

export interface PairGroup {
  /** Shared group identity — the pair keys' common prefix (group key). */
  key: string
  title: string
  subtitle: string | null
  levelUnit: string | null
  /** Level entries, sorted descending; single-level groups have one with
   *  level null. */
  entries: Array<PairedLayer>
}

export interface PartitionedPairGroups {
  /** Surface / single-level parameters, sorted by title. */
  singles: Array<PairGroup>
  /** Pressure-level parameters, sorted by title. */
  multiLevel: Array<PairGroup>
  /** Union of pressure levels across all groups, descending. */
  allLevels: Array<number>
}

function matchesSlot(pair: PairedLayer, filter: SlotFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'both') {
    return pair.perSource.a !== undefined && pair.perSource.b !== undefined
  }
  return pair.perSource[filter] !== undefined
}

/** `<groupKey>@<level>` → `<groupKey>` (level suffix added by buildPairs). */
function groupKeyOf(pair: PairedLayer): string {
  const at = pair.key.lastIndexOf('@')
  return at > 0 ? pair.key.slice(0, at) : pair.key
}

export function groupPairs(
  pairs: ReadonlyArray<PairedLayer>,
  filter: SlotFilter = 'all',
): PartitionedPairGroups {
  const byKey = new Map<string, PairGroup>()
  for (const pair of pairs) {
    if (!matchesSlot(pair, filter)) continue
    const key = groupKeyOf(pair)
    const existing = byKey.get(key)
    if (existing) {
      existing.entries.push(pair)
      existing.levelUnit ??= pair.levelUnit
      continue
    }
    byKey.set(key, {
      key,
      title: pair.title,
      subtitle: pair.subtitle,
      levelUnit: pair.levelUnit,
      entries: [pair],
    })
  }

  const groups = [...byKey.values()]
  for (const group of groups) {
    group.entries.sort(
      (x, y) =>
        (y.level ?? Number.NEGATIVE_INFINITY) -
        (x.level ?? Number.NEGATIVE_INFINITY),
    )
  }
  // Level-bearing groups stay in the pressure section even when a filter
  // leaves a single entry — otherwise it lands under "surface" without
  // its level label.
  const isMulti = (g: PairGroup) => g.entries.some((e) => e.level !== null)

  const byTitle = (x: PairGroup, y: PairGroup) => x.title.localeCompare(y.title)
  const singles = groups.filter((g) => !isMulti(g)).sort(byTitle)
  const multiLevel = groups.filter(isMulti).sort(byTitle)

  const levels = new Set<number>()
  for (const group of multiLevel) {
    for (const entry of group.entries) {
      if (entry.level !== null) levels.add(entry.level)
    }
  }
  return {
    singles,
    multiLevel,
    allLevels: [...levels].sort((x, y) => y - x),
  }
}
