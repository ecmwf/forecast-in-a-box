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
  nextAnnotationLabel,
  parseAnnotationsGeojson,
} from '@/features/viewer/geo/annotations'

describe('annotationVisibleOn', () => {
  it('shared pins show on every surface', () => {
    expect(annotationVisibleOn({ sourceId: null }, ['run:x'])).toBe(true)
    expect(annotationVisibleOn({ sourceId: null }, [])).toBe(true)
  })

  it('bound pins show only where their source is on screen', () => {
    expect(annotationVisibleOn({ sourceId: 'run:x' }, ['run:x'])).toBe(true)
    expect(annotationVisibleOn({ sourceId: 'run:x' }, ['wms:y', 'run:x'])).toBe(
      true,
    )
    expect(annotationVisibleOn({ sourceId: 'run:x' }, ['wms:y'])).toBe(false)
    expect(annotationVisibleOn({ sourceId: 'run:x' }, [])).toBe(false)
  })
})

const pin = (
  id: string,
  sourceId: string | null,
  lonLat: [number, number] = [8.55, 47.37],
): MapAnnotation => ({
  id,
  coordinate: fromLonLat(lonLat) as [number, number],
  label: id,
  text: `note ${id}`,
  color: 'red',
  sourceId,
})

describe('annotations GeoJSON round-trip', () => {
  it('preserves label, color, text, source, and coordinates (WGS84 wire)', () => {
    const pins = [
      pin('1', 'run:model-x'),
      pin('2', 'wms:external', [-70.66, -33.45]),
      pin('3', null),
    ]
    const parsed = parseAnnotationsGeojson(annotationsToGeojson(pins))
    expect(parsed).toHaveLength(3)
    parsed.forEach((restored, i) => {
      expect(restored.text).toBe(pins[i].text)
      expect(restored.sourceId).toBe(pins[i].sourceId)
      expect(restored.label).toBe(pins[i].label)
      expect(restored.color).toBe('red')
      expect(restored.coordinate[0]).toBeCloseTo(pins[i].coordinate[0], 0)
      expect(restored.coordinate[1]).toBeCloseTo(pins[i].coordinate[1], 0)
    })
  })

  it('writes RFC 7946 lon/lat with label/color/source properties and a version stamp', () => {
    const collection = JSON.parse(
      annotationsToGeojson([pin('1', 'run:model-x')]),
    ) as {
      type: string
      'fiab:annotations': { version: number }
      features: Array<{
        geometry: { type: string; coordinates: [number, number] }
        properties: {
          label: string
          color: string
          text: string
          source: string
        }
      }>
    }
    expect(collection.type).toBe('FeatureCollection')
    // Foreign member (RFC 7946 §6.1) — future importers branch on this.
    expect(collection['fiab:annotations']).toEqual({ version: 3 })
    const feature = collection.features[0]
    expect(feature.geometry.type).toBe('Point')
    expect(feature.geometry.coordinates[0]).toBeCloseTo(8.55, 4)
    expect(feature.geometry.coordinates[1]).toBeCloseTo(47.37, 4)
    expect(feature.properties).toMatchObject({
      label: '1',
      color: 'red',
      text: 'note 1',
      source: 'run:model-x',
    })
  })

  it('maps legacy v2 slot files onto the current assignment', () => {
    const v2 = {
      type: 'FeatureCollection',
      features: (
        [
          ['on A', 'a'],
          ['on B', 'b'],
          ['shared', null],
        ] as const
      ).map(([text, slot], i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [i, i] },
        properties: { text, slot },
      })),
    }
    const parsed = parseAnnotationsGeojson(JSON.stringify(v2), {
      a: 'run:1',
      b: 'wms:2',
    })
    expect(parsed.map((p) => p.sourceId)).toEqual(['run:1', 'wms:2', null])
    // A slot without a current source degrades to shared.
    const soloParsed = parseAnnotationsGeojson(JSON.stringify(v2), {
      a: 'run:1',
      b: null,
    })
    expect(soloParsed.map((p) => p.sourceId)).toEqual(['run:1', null, null])
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
    // v1 file: no label (importer assigns) and slot-default color.
    expect(parsed[0]).toMatchObject({
      text: 'kept',
      sourceId: null,
      label: '',
      color: 'slate',
    })
  })

  it('throws on unparsable input and on collections without usable pins', () => {
    expect(() => parseAnnotationsGeojson('not json')).toThrow()
    expect(() =>
      parseAnnotationsGeojson(
        JSON.stringify({ type: 'FeatureCollection', features: [] }),
      ),
    ).toThrow()
  })

  // Raw JSON text: 1e999 parses to Infinity (stringify would null it).
  it('drops non-finite coordinates that would brick the camera on locate', () => {
    const mixed = `{"type":"FeatureCollection","features":[
      {"type":"Feature","properties":{"text":"inf"},"geometry":
        {"type":"Point","coordinates":[1e999,0]}},
      {"type":"Feature","properties":{"text":"nan"},"geometry":
        {"type":"Point","coordinates":["x","y"]}},
      {"type":"Feature","properties":{"text":"good"},"geometry":
        {"type":"Point","coordinates":[10,20]}}
    ]}`
    const parsed = parseAnnotationsGeojson(mixed)
    expect(parsed.map((p) => p.text)).toEqual(['good'])
    expect(parsed[0].coordinate.every(Number.isFinite)).toBe(true)

    const allBad = `{"type":"FeatureCollection","features":[
      {"type":"Feature","properties":{"text":"inf"},"geometry":
        {"type":"Point","coordinates":[1e999,0]}}
    ]}`
    expect(() => parseAnnotationsGeojson(allBad)).toThrow()
  })
})

describe('nextAnnotationLabel', () => {
  it('fills gaps left by deletes and ignores non-numeric labels', () => {
    expect(nextAnnotationLabel([])).toBe('1')
    expect(
      nextAnnotationLabel([{ label: '1' }, { label: '3' }, { label: 'X' }]),
    ).toBe('2')
    expect(nextAnnotationLabel([{ label: '1' }, { label: '2' }])).toBe('3')
  })
})
