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
import type { ParsedLayer } from '@/features/viewer/wms-capabilities'
import { buildPairs } from '@/features/viewer/geo/layer-pairing'
import { groupLayers } from '@/features/viewer/wms-capabilities'

const layer = (name: string, title: string): ParsedLayer => ({
  name,
  title,
  styles: [],
})

describe('buildPairs', () => {
  it('pairs identical surface parameters across sources', () => {
    const groups = groupLayers([
      layer('2t', '2 m temperature'),
      layer('msl', 'Mean sea level pressure'),
    ])
    const { pairs, overlapCount } = buildPairs(groups, groups)
    expect(pairs).toHaveLength(2)
    expect(overlapCount).toBe(2)
    for (const pair of pairs) {
      expect(pair.perSource.a?.name).toBe(pair.perSource.b?.name)
    }
  })

  it('keeps one-sided parameters selectable and counts only true overlap', () => {
    const a = groupLayers([
      layer('2t', '2 m temperature'),
      layer('tp', 'Total precipitation'),
    ])
    const b = groupLayers([
      layer('2t', '2 m temperature'),
      layer('10si', '10 m wind speed'),
    ])
    const { pairs, overlapCount } = buildPairs(a, b)
    expect(pairs).toHaveLength(3)
    expect(overlapCount).toBe(1)
    const tp = pairs.find((p) => p.perSource.a?.name === 'tp')
    expect(tp?.perSource.b).toBeUndefined()
  })

  it('pairs pressure-level entries per level', () => {
    const a = groupLayers([
      layer('q@pl_500', 'Specific humidity at 500 hPa'),
      layer('q@pl_850', 'Specific humidity at 850 hPa'),
    ])
    const b = groupLayers([
      layer('q@pl_500', 'Specific humidity at 500 hPa'),
      layer('q@pl_700', 'Specific humidity at 700 hPa'),
    ])
    const { pairs, overlapCount } = buildPairs(a, b)
    expect(pairs).toHaveLength(3)
    expect(overlapCount).toBe(1)
    const at500 = pairs.find((p) => p.level === 500)
    expect(at500?.perSource.a?.name).toBe('q@pl_500')
    expect(at500?.perSource.b?.name).toBe('q@pl_500')
  })

  it('reports zero overlap for disjoint layer sets', () => {
    const a = groupLayers([layer('2t', '2 m temperature')])
    const b = groupLayers([layer('tp', 'Total precipitation')])
    const { overlapCount } = buildPairs(a, b)
    expect(overlapCount).toBe(0)
  })
})
