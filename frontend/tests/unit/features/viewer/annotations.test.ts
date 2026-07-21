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
import { fromLonLat } from 'ol/proj'
import type { MapAnnotation } from '@/features/viewer/geo/annotations'
import {
  annotationVisibleOn,
  annotationsToGeojson,
  parseAnnotationsGeojson,
} from '@/features/viewer/geo/annotations'

describe('annotationVisibleOn', () => {
  it('single map shows everything', () => {
    expect(annotationVisibleOn({ slot: 'a' }, null)).toBe(true)
    expect(annotationVisibleOn({ slot: 'b' }, null)).toBe(true)
    expect(annotationVisibleOn({ slot: null }, null)).toBe(true)
  })

  it('side-by-side panels show own + shared pins only', () => {
    expect(annotationVisibleOn({ slot: 'a' }, 'a')).toBe(true)
    expect(annotationVisibleOn({ slot: null }, 'a')).toBe(true)
    expect(annotationVisibleOn({ slot: 'b' }, 'a')).toBe(false)
    expect(annotationVisibleOn({ slot: 'a' }, 'b')).toBe(false)
  })
})

const pin = (
  id: string,
  slot: 'a' | 'b' | null,
  lonLat: [number, number] = [8.55, 47.37],
): MapAnnotation => ({
  id,
  coordinate: fromLonLat(lonLat) as [number, number],
  text: `note ${id}`,
  slot,
})

describe('annotations GeoJSON round-trip', () => {
  it('preserves text, slot, and coordinates (via WGS84 wire format)', () => {
    const pins = [
      pin('1', 'a'),
      pin('2', 'b', [-70.66, -33.45]),
      pin('3', null),
    ]
    const parsed = parseAnnotationsGeojson(annotationsToGeojson(pins))
    expect(parsed).toHaveLength(3)
    parsed.forEach((restored, i) => {
      expect(restored.text).toBe(pins[i].text)
      expect(restored.slot).toBe(pins[i].slot)
      expect(restored.coordinate[0]).toBeCloseTo(pins[i].coordinate[0], 0)
      expect(restored.coordinate[1]).toBeCloseTo(pins[i].coordinate[1], 0)
    })
  })

  it('writes RFC 7946 lon/lat with numbering properties and a version stamp', () => {
    const collection = JSON.parse(annotationsToGeojson([pin('1', 'a')])) as {
      type: string
      'fiab:annotations': { version: number }
      features: Array<{
        geometry: { type: string; coordinates: [number, number] }
        properties: { number: number; text: string; slot: string }
      }>
    }
    expect(collection.type).toBe('FeatureCollection')
    // Foreign member (RFC 7946 §6.1) — future importers branch on this.
    expect(collection['fiab:annotations']).toEqual({ version: 1 })
    const feature = collection.features[0]
    expect(feature.geometry.type).toBe('Point')
    expect(feature.geometry.coordinates[0]).toBeCloseTo(8.55, 4)
    expect(feature.geometry.coordinates[1]).toBeCloseTo(47.37, 4)
    expect(feature.properties).toMatchObject({
      number: 1,
      text: 'note 1',
      slot: 'a',
    })
  })

  it('skips non-point and textless features, tolerates foreign slots', () => {
    const mixed = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: { text: 'kept', slot: 'garbage' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [1, 1] },
          properties: { text: '   ' },
        },
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: { text: 'a line' },
        },
      ],
    }
    const parsed = parseAnnotationsGeojson(JSON.stringify(mixed))
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ text: 'kept', slot: null })
  })

  it('throws on unparsable input and on collections without usable pins', () => {
    expect(() => parseAnnotationsGeojson('not json')).toThrow()
    expect(() =>
      parseAnnotationsGeojson(
        JSON.stringify({ type: 'FeatureCollection', features: [] }),
      ),
    ).toThrow()
  })
})
