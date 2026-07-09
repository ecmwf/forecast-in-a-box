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
import { transformExtent } from 'ol/proj'
import type { Bbox } from '@/components/base/fields/fields/geo-domain'
import { clampBboxLatitudeForMercator } from '@/components/base/fields/fields/geo-domain'

// Half the Web Mercator world span (EPSG:3857 bounds are ±this in both axes).
const MERCATOR_HALF = 20037508.342789244

/** The map's display transform (mirrors bboxToMercatorExtent in GeoDomainMap). */
function toDisplay(bbox: Bbox): Array<number> {
  return transformExtent(
    clampBboxLatitudeForMercator(bbox),
    'EPSG:4326',
    'EPSG:3857',
  )
}

describe('geodomain map projection', () => {
  it('round-trips a normal box through 4326→3857→4326 preserving W,S,E,N order', () => {
    const bbox: Bbox = [-10, 35, 30, 60]
    const back = transformExtent(toDisplay(bbox), 'EPSG:3857', 'EPSG:4326')
    // Within floating-point tolerance, and crucially no lon/lat swap.
    for (let i = 0; i < 4; i++) expect(back[i]).toBeCloseTo(bbox[i], 6)
  })

  it('yields a finite, in-world extent for a south-pole box (the guard)', () => {
    const extent = toDisplay([-180, -90, 180, 90])
    expect(extent.every((c) => Number.isFinite(c))).toBe(true)
    expect(extent[1]).toBeGreaterThan(-MERCATOR_HALF * 1.01)
    expect(extent[3]).toBeLessThan(MERCATOR_HALF * 1.01)
  })

  it('without the clamp, a south=-90 box escapes the world extent (why the guard exists)', () => {
    const raw = transformExtent([-180, -90, 180, 90], 'EPSG:4326', 'EPSG:3857')
    // Tolerant of OL returning -Infinity or a huge finite value for lat=-90.
    expect(!Number.isFinite(raw[1]) || raw[1] < -MERCATOR_HALF * 1.5).toBe(true)
  })
})
