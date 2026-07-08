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
import { parseGeojsonOverlay } from '@/features/viewer/compare/overlays'

const VALID = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'track' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [8.5, 47.4],
          [13.4, 52.5],
        ],
      },
    },
    {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [100.5, 13.7] },
    },
  ],
})

describe('parseGeojsonOverlay', () => {
  it('parses features, reprojected, with a stable overlay shape', () => {
    const overlay = parseGeojsonOverlay('tracks.geojson', VALID)
    expect(overlay.name).toBe('tracks.geojson')
    expect(overlay.featureCount).toBe(2)
    expect(overlay.visible).toBe(true)
    expect(overlay.source.getFeatures()).toHaveLength(2)
    // Reprojection to Web Mercator happened (coords no longer lon/lat).
    const [x] = overlay.source.getFeatures()[1].getGeometry()!.getExtent()
    expect(Math.abs(x)).toBeGreaterThan(180)
  })

  it('throws on junk and on empty collections', () => {
    expect(() => parseGeojsonOverlay('x', 'not json')).toThrow()
    expect(() =>
      parseGeojsonOverlay(
        'x',
        JSON.stringify({ type: 'FeatureCollection', features: [] }),
      ),
    ).toThrow()
  })
})
