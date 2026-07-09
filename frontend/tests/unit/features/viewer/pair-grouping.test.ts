/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import { buildPairs } from '@/features/viewer/compare/layer-pairing'
import { groupPairs } from '@/features/viewer/compare/pair-grouping'
import { groupLayers } from '@/features/viewer/wms-capabilities'
import type { ParsedLayer } from '@/features/viewer/wms-capabilities'

const layer = (name: string, title: string): ParsedLayer => ({
  name,
  title,
  styles: [],
})

const groupsA = groupLayers([
  layer('2t', '2 m temperature'),
  layer('q@pl_500', 'Specific humidity at 500 hPa'),
  layer('q@pl_850', 'Specific humidity at 850 hPa'),
  layer('tp', 'Total precipitation'),
])
const groupsB = groupLayers([
  layer('2t', '2 m temperature'),
  layer('q@pl_500', 'Specific humidity at 500 hPa'),
  layer('q@pl_700', 'Specific humidity at 700 hPa'),
])

describe('groupPairs', () => {
  const { pairs } = buildPairs(groupsA, groupsB)

  it('collapses level entries into one group per parameter', () => {
    const { singles, multiLevel, allLevels } = groupPairs(pairs)
    expect(singles.map((g) => g.title)).toEqual([
      '2 m temperature',
      'Total precipitation',
    ])
    expect(multiLevel).toHaveLength(1)
    expect(multiLevel[0].title).toBe('Specific humidity')
    // Levels descending, union of both sources.
    expect(multiLevel[0].entries.map((e) => e.level)).toEqual([850, 700, 500])
    expect(allLevels).toEqual([850, 700, 500])
  })

  it('filters by slot availability', () => {
    const onlyB = groupPairs(pairs, 'b')
    expect(onlyB.singles.map((g) => g.title)).toEqual(['2 m temperature'])
    expect(onlyB.multiLevel[0].entries.map((e) => e.level)).toEqual([700, 500])

    const onlyA = groupPairs(pairs, 'a')
    expect(onlyA.singles.map((g) => g.title)).toEqual([
      '2 m temperature',
      'Total precipitation',
    ])
    expect(onlyA.multiLevel[0].entries.map((e) => e.level)).toEqual([850, 500])
  })

  it("filters to pairs available in both sources with 'both'", () => {
    const both = groupPairs(pairs, 'both')
    // tp is A-only → gone; only the shared 500 hPa level survives.
    expect(both.singles.map((g) => g.title)).toEqual(['2 m temperature'])
    expect(both.multiLevel[0].entries.map((e) => e.level)).toEqual([500])
    for (const group of [...both.singles, ...both.multiLevel]) {
      for (const entry of group.entries) {
        expect(entry.perSource.a).toBeDefined()
        expect(entry.perSource.b).toBeDefined()
      }
    }
  })
})
