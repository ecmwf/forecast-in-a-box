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
} from '@/features/viewer/globe/sphere-math'
import {
  applyGlobeCamera,
  flatClipTransform,
  globeCameraForBbox,
  globeCameraOf,
  globeEntryCamera,
  globeFitZoom,
  globenessForProgress,
  groundMppFromZoom,
  panGlobeCamera,
  zoomFromGroundMpp,
} from '@/features/viewer/globe/globe-camera'
import { invertMat4 } from '@/features/viewer/globe/webgl/gl'
import {
  WORLD_REGION,
  layerRegion,
  regionGetMapUrl,
  regionScale,
  regionSize,
} from '@/features/viewer/globe/globe-getmap'
import { globeLayerSpecs } from '@/features/viewer/globe/globe-layer-specs'
import { createViewerView } from '@/features/viewer/hooks/useOlMapBase'
import { getViewerProjection } from '@/features/viewer/projections'

describe('sphere math (MapLibre conventions)', () => {
  it('faces lon/lat 0 towards +Z, east towards +X, north towards +Y', () => {
    const round = (v: ReadonlyArray<number>) => v.map((c) => +c.toFixed(9) || 0)
    expect(round(lonLatToUnitSphere(0, 0))).toEqual([0, 0, 1])
    expect(round(lonLatToUnitSphere(90, 0))).toEqual([1, 0, 0])
    expect(round(lonLatToUnitSphere(0, 90))).toEqual([0, 1, 0])
    expect(Math.hypot(...lonLatToUnitSphere(-170, -33))).toBeCloseTo(1, 12)
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

  it('enters at the flat scale; a whole-world view grows to the fit; capped', () => {
    const projection = getViewerProjection('merc')
    const view = createViewerView(projection)
    const [w, h] = [800, 600]
    const fit = globeFitZoom(w, h)
    const at = (zoom: number) => {
      applyGlobeCamera(view, projection, { lon: 10, lat: 50, zoom }, [w, h])
      return globeEntryCamera(view, w, h, 8)
    }
    const regional = at(fit + 2)
    expect(regional?.zoom).toBeCloseTo(fit + 2, 2)
    expect(regional?.lon).toBeCloseTo(10, 6)
    expect(regional?.lat).toBeCloseTo(50, 6)
    expect(at(fit - 1)?.zoom).toBeCloseTo(fit, 6)
    expect(at(9.5)?.zoom).toBe(8)
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

describe('unbend progress', () => {
  it('maps on-screen progress to a clip-space globeness', () => {
    expect(globenessForProgress(0, 40)).toBe(1)
    expect(globenessForProgress(1, 40)).toBe(0)
    // The projected point sits s of the way to its flat position, whatever the w ratio.
    for (const r of [0.05, 1, 40]) {
      for (const s of [0.1, 0.5, 0.9]) {
        const g = globenessForProgress(s, r)
        const flatWeight = ((1 - g) * r) / (g + (1 - g) * r)
        expect(flatWeight).toBeCloseTo(s, 12)
      }
    }
  })
})

describe('flat clip transform', () => {
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
})

describe('mat4 inverse', () => {
  it('inverts a translated perspective matrix and rejects a singular one', () => {
    // prettier-ignore
    const m = [
      2, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, -1.2, -1,
      1, 2, -2.2, 0,
    ]
    const inv = invertMat4(m)!
    // Column 3 of the inverse is the eye: (0,0,1,0) pulled back through m.
    const eye = [inv[8] / inv[11], inv[9] / inv[11], inv[10] / inv[11]]
    expect(eye[0]).toBeCloseTo(-0.5, 9)
    expect(eye[1]).toBeCloseTo(-2 / 3, 9)
    expect(eye[2]).toBeCloseTo(0, 9)
    expect(invertMat4(new Array<number>(16).fill(0))).toBeNull()
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

describe('globe GetMap', () => {
  it('requests the whole world lat-first in EPSG:4326, TIME kept', () => {
    const url = new URL(regionGetMapUrl(spec, WORLD_REGION, [2048, 1024]))
    const q = url.searchParams
    expect(q.get('REQUEST')).toBe('GetMap')
    expect(q.get('CRS')).toBe('EPSG:4326')
    expect(q.get('BBOX')).toBe('-90,-180,90,180')
    expect([q.get('WIDTH'), q.get('HEIGHT')]).toEqual(['2048', '1024'])
    expect(q.get('TIME')).toBe('2026-07-06T00:00:00Z')
  })

  it("requests only a regional layer's own box", () => {
    const region = layerRegion({ ...spec, bbox: [0, 50, 40, 72] })
    expect(region).toEqual([0, 50, 40, 72])
    const q = new URL(regionGetMapUrl(spec, region, [400, 220])).searchParams
    expect(q.get('BBOX')).toBe('50,0,72,40')
    // Global and dateline-crossing boxes fall back to the world.
    expect(layerRegion({ ...spec, bbox: [-180, -90, 180, 90] })).toBe(
      WORLD_REGION,
    )
    expect(layerRegion({ ...spec, bbox: [170, -10, -170, 10] })).toBe(
      WORLD_REGION,
    )
    // 0-360 longitudes (e.g. DWD ICON) and half-cell overhangs are global.
    expect(layerRegion({ ...spec, bbox: [0, -90, 360, 90] })).toBe(WORLD_REGION)
    expect(layerRegion({ ...spec, bbox: [-180.125, -90, 179.875, 90] })).toBe(
      WORLD_REGION,
    )
  })

  it('sizes a region to the wanted detail, capped per side', () => {
    const region = [0, 50, 40, 72] as const
    // 10 px/deg fits; 400 px/deg would exceed 4096 px across 40 degrees.
    expect(regionSize(region, regionScale(region, 10, [4096, 4096]))).toEqual([
      400, 220,
    ])
    expect(regionScale(region, 400, [4096, 4096])).toBeCloseTo(4096 / 40)
    // The world at the old maximum: 4096 x 2048.
    expect(
      regionSize(WORLD_REGION, regionScale(WORLD_REGION, 100, [4096, 4096])),
    ).toEqual([4096, 2048])
    // A server's MaxWidth/MaxHeight caps each side on its own.
    expect(regionScale(region, 400, [4096, 1100])).toBeCloseTo(1100 / 22)
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
