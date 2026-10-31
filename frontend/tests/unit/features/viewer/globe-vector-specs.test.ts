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
import LineString from 'ol/geom/LineString'
import MultiPoint from 'ol/geom/MultiPoint'
import Point from 'ol/geom/Point'
import Polygon from 'ol/geom/Polygon'
import type { MapAnnotation } from '@/features/viewer/geo/annotations'
import type { Measurement } from '@/features/viewer/hooks/useMeasure'
import {
  globeVectorSpec,
  labelAnchors,
  shownOverlayFeatures,
} from '@/features/viewer/globe/globe-vector-specs'
import { parseGeojsonOverlay } from '@/features/viewer/geo/overlays'

const pin = (over: Partial<MapAnnotation>): MapAnnotation => ({
  id: 'annotation-1',
  lonLat: [5, 48],
  label: '1',
  text: 'Frontal zone',
  color: 'blue',
  sourceId: null,
  ...over,
})

const measurement = (over: Partial<Measurement>): Measurement => ({
  id: 'measurement-1',
  geometry: new LineString([
    [0, 40],
    [10, 50],
  ]),
  label: '1234 km',
  sourceId: null,
  ...over,
})

const OVERLAY = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Box' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-10, 40],
            [20, 40],
            [20, 60],
            [-10, 60],
            [-10, 40],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: '' },
      geometry: { type: 'Point', coordinates: [15, 78] },
    },
  ],
})

const spec = (over: Partial<Parameters<typeof globeVectorSpec>[0]>) =>
  globeVectorSpec({
    overlays: [],
    measurements: [],
    annotations: [],
    highlightId: null,
    shownIds: ['src-a'],
    ...over,
  })

describe('labelAnchors', () => {
  it('anchors where OpenLayers places point labels', () => {
    expect(labelAnchors(new Point([3, 4]))).toEqual([[3, 4]])
    expect(
      labelAnchors(
        new MultiPoint([
          [1, 2],
          [3, 4],
        ]),
      ),
    ).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(
      labelAnchors(
        new LineString([
          [0, 0],
          [10, 0],
        ]),
      ),
    ).toEqual([[5, 0]])
    const [[x, y]] = labelAnchors(
      new Polygon([
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ]),
    )
    expect(x).toBeCloseTo(5)
    expect(y).toBeCloseTo(5)
  })
})

describe('globeVectorSpec', () => {
  it('shows shared pins everywhere and bound pins only on their source', () => {
    const annotations = [
      pin({ id: 'shared' }),
      pin({ id: 'on-a', sourceId: 'src-a' }),
      pin({ id: 'on-b', sourceId: 'src-b' }),
    ]
    expect(spec({ annotations }).pins.map((p) => p.id)).toEqual([
      'shared',
      'on-a',
    ])
    expect(
      spec({ annotations, shownIds: ['src-b'] }).pins.map((p) => p.id),
    ).toEqual(['shared', 'on-b'])
  })

  it('resolves pin colour, truncates the note, and flags the highlight', () => {
    const [p] = spec({
      annotations: [pin({ text: 'x'.repeat(50) })],
      highlightId: 'annotation-1',
    }).pins
    expect(p).toMatchObject({
      lon: 5,
      lat: 48,
      badge: '1',
      color: 'rgba(37, 99, 235, 0.95)',
      highlighted: true,
    })
    expect(p.note).toBe(`${'x'.repeat(36)}…`)
  })

  it('draws visible overlays only, labelled from the chosen property', () => {
    const shown = { ...parseGeojsonOverlay('a.geojson', OVERLAY) }
    const hidden = { ...parseGeojsonOverlay('b.geojson', OVERLAY) }
    hidden.visible = false
    shown.labelProperty = 'name'
    const result = spec({ overlays: [shown, hidden] })
    expect(result.overlays.features).toHaveLength(2)
    // The point's empty name gets no label.
    expect(result.overlayLabels).toHaveLength(1)
    expect(result.overlayLabels[0]).toMatchObject({ text: 'Box' })
    expect(result.overlayLabels[0].lon).toBeCloseTo(5)
    expect(result.overlayLabels[0].lat).toBeCloseTo(50)
  })

  it('indexes overlay features into the visible overlays', () => {
    const hidden = { ...parseGeojsonOverlay('a.geojson', OVERLAY) }
    const shown = { ...parseGeojsonOverlay('b.geojson', OVERLAY) }
    hidden.visible = false
    const overlays = [hidden, shown]
    const features = shownOverlayFeatures(overlays)
    const indices = spec({ overlays }).overlays.features.map(
      (f) => f.properties?.index as number,
    )
    expect(indices).toEqual([0, 1])
    expect(indices.map((i) => features[i])).toEqual(shown.features)
  })

  it('places measurement results at the top centre, by source binding', () => {
    const result = spec({
      measurements: [
        measurement({}),
        measurement({ id: 'measurement-2', sourceId: 'src-b' }),
      ],
    })
    expect(result.measurements.features).toHaveLength(1)
    expect(result.measurementLabels).toEqual([
      { lon: 5, lat: 50, text: '1234 km' },
    ])
  })
})
