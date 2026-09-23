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
import type { CompareMapSource } from '@/features/viewer/geo/types'
import type { GlobeLayerSpec } from '@/features/viewer/globe/engine'
import type { ParsedLayer } from '@/features/viewer/wms-capabilities'
import {
  lonLatToMercatorUnit,
  lonLatToUnitSphere,
  unitSphereToLonLat,
} from '@/features/viewer/globe/sphere-math'
import {
  applyGlobeCamera,
  globeCameraForBbox,
  globeCameraOf,
  globeExitZoom,
  globeFitZoom,
  groundMppFromZoom,
  panGlobeCamera,
  zoomFromGroundMpp,
} from '@/features/viewer/globe/globe-camera'
import {
  flatClipTransform,
  pickLonLat,
  textureWidthFor,
} from '@/features/viewer/globe/engines/three/view-math'
import { worldGetMapUrl } from '@/features/viewer/globe/world-getmap'
import { globeLayerSpecs } from '@/features/viewer/globe/globe-layer-specs'
import { createViewerView } from '@/features/viewer/hooks/useOlMapBase'
import { getViewerProjection } from '@/features/viewer/projections'

describe('sphere math (MapLibre conventions)', () => {
  it('faces lon/lat 0 towards +Z and round-trips', () => {
    const [x, y, z] = lonLatToUnitSphere(0, 0)
    expect([x, y, z].map((v) => +v.toFixed(9))).toEqual([0, 0, 1])
    for (const [lon, lat] of [
      [12, 50],
      [-170, -33],
      [90, 89],
    ]) {
      const [rlon, rlat] = unitSphereToLonLat(lonLatToUnitSphere(lon, lat))
      expect(rlon).toBeCloseTo(lon, 9)
      expect(rlat).toBeCloseTo(lat, 9)
    }
  })

  it('maps Mercator into the unit square and clamps the poles', () => {
    expect(lonLatToMercatorUnit(0, 0)).toEqual([0.5, 0.5])
    expect(lonLatToMercatorUnit(-180, 90)[1]).toBeCloseTo(0, 6)
    expect(lonLatToMercatorUnit(180, -90)).toEqual([1, expect.closeTo(1, 6)])
  })
})

describe('globe camera', () => {
  it('converts zoom and ground scale both ways', () => {
    expect(zoomFromGroundMpp(groundMppFromZoom(3.7))).toBeCloseTo(3.7, 12)
  })

  it('keeps the auto-exit zoom well above the resting fit', () => {
    // Hysteresis: bending in lands at the fit, flattening needs >1 level more.
    expect(globeExitZoom(900, 600) - globeFitZoom(900, 600)).toBeGreaterThan(1)
  })

  it.each([
    ['merc', 0],
    ['merc', 45],
    ['merc', 70],
    ['geo', 0],
    ['geo', 45],
  ] as const)('round-trips a %s view at lat %d', (id, lat) => {
    const projection = getViewerProjection(id)
    const view = createViewerView(projection)
    const camera = { lon: 20, lat, zoom: 4 }
    applyGlobeCamera(view, projection, camera, [800, 600])
    const back = globeCameraOf(view)
    expect(back?.lon).toBeCloseTo(20, 6)
    expect(back?.lat).toBeCloseTo(lat, 6)
    expect(back?.zoom).toBeCloseTo(4, 2)
  })

  it('pans like a drag: right moves west, wrapping at the dateline', () => {
    const cam = { lon: 179, lat: 0, zoom: 2 }
    expect(panGlobeCamera(cam, 10, 0).lon).toBeLessThan(179)
    const wrapped = panGlobeCamera(cam, -200, 0).lon
    expect(wrapped).toBeLessThan(0)
    expect(wrapped).toBeGreaterThanOrEqual(-180)
  })

  it('frames a bbox on its centre, never tighter than the fit', () => {
    const cam = globeCameraForBbox([-20, 30, 40, 70], 800, 600, 6)
    expect(cam.lon).toBe(10)
    expect(cam.lat).toBe(50)
    expect(cam.zoom).toBeGreaterThanOrEqual(globeFitZoom(800, 600))
    expect(globeCameraForBbox([-180, -90, 180, 90], 800, 600, 6).zoom).toBe(
      globeFitZoom(800, 600),
    )
  })
})

describe('three engine view math', () => {
  it('puts the flat view centre at clip origin and the world at OL width', () => {
    const resolution = 50000 // m/px
    const t = flatClipTransform(
      { projection: 'merc', lon: 0, lat: 0, resolution },
      800,
      600,
    )!
    expect(t.cx).toBe(0.5)
    // Unit world width in clip units = world px / half the viewport.
    expect(t.kx).toBeCloseTo((2 * 40075016.686) / (resolution * 800), 3)
    expect(
      flatClipTransform(
        { projection: 'npole', lon: 0, lat: 90, resolution },
        800,
        600,
      ),
    ).toBeNull()
  })

  it('picks the camera centre at the viewport centre, null off-globe', () => {
    const camera = { lon: 30, lat: -20, zoom: 2 }
    const hit = pickLonLat([400, 300], [800, 600], camera)
    expect(hit?.lon).toBeCloseTo(30, 6)
    expect(hit?.lat).toBeCloseTo(-20, 6)
    expect(pickLonLat([2, 2], [800, 600], { ...camera, zoom: 0.5 })).toBeNull()
  })

  it('sizes textures to the globe, clamped to the device limit', () => {
    expect(textureWidthFor(10, 4096)).toBe(1024)
    expect(textureWidthFor(400, 4096)).toBe(4096)
    expect(textureWidthFor(400, 2048)).toBe(2048)
  })
})

const spec: GlobeLayerSpec = {
  key: 'a:2t',
  slot: 'a',
  layerName: '2t',
  endpoint: 'http://wms.test/wms',
  params: {
    LAYERS: '2t',
    STYLES: '',
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
    TIME: '2026-07-06T00:00:00Z',
  },
  time: '2026-07-06T00:00:00Z',
  bboxAxisOrder: 'xy',
  opacity: 1,
  zIndex: 101,
}

describe('world GetMap', () => {
  it('requests the whole world lat-first in EPSG:4326, TIME kept', () => {
    const url = new URL(worldGetMapUrl(spec, 2048))
    const q = url.searchParams
    expect(q.get('REQUEST')).toBe('GetMap')
    expect(q.get('CRS')).toBe('EPSG:4326')
    expect(q.get('BBOX')).toBe('-90,-180,90,180')
    expect([q.get('WIDTH'), q.get('HEIGHT')]).toEqual(['2048', '1024'])
    expect(q.get('TIME')).toBe('2026-07-06T00:00:00Z')
  })
})

describe('globe layer specs', () => {
  const layer = (name: string): ParsedLayer => ({
    name,
    title: name,
    styles: [],
    dimensions: [],
  })
  const source = (over: Partial<CompareMapSource>): CompareMapSource =>
    ({
      slot: 'a',
      baseUrl: 'http://wms.test',
      layers: [layer('t'), layer('msl')],
      activeOrder: ['msl', 't'],
      layerOpacities: new Map([['t', 0.5]]),
      layerSettings: new Map(),
      bboxAxisOrder: 'epsg',
      resolveTime: () => null,
      masterOpacity: 0.8,
      hiddenAtTime: false,
      ...over,
    }) as unknown as CompareMapSource

  it('orders top-first and multiplies opacity tiers', () => {
    const specs = globeLayerSpecs(source({}), 100)
    expect(specs.map((s) => [s.key, s.zIndex])).toEqual([
      ['a:msl', 102],
      ['a:t', 101],
    ])
    expect(specs[1].opacity).toBeCloseTo(0.4)
  })

  it('hides a source with no data at the valid time', () => {
    const specs = globeLayerSpecs(source({ hiddenAtTime: true }), 100)
    expect(specs.every((s) => s.opacity === 0)).toBe(true)
  })
})
