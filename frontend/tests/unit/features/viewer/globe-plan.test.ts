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
import type { GlobeLayerSpec } from '@/features/viewer/globe/engine'
import {
  WORLD_REGION,
  bytesOf,
  fitScale,
  imageLimits,
  layerRegion,
  planViewImage,
  refetchScale,
  regionGetMapUrl,
  regionScale,
  regionSize,
  requestParts,
  wantedScale,
  worldUpgrade,
} from '@/features/viewer/globe/globe-plan'

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

describe('globe image plan', () => {
  const limits: [number, number] = [4096, 4096]
  const view = (lon: number, lat: number, zoom: number) => ({
    lon,
    lat,
    zoom,
    width: 800,
    height: 600,
  })
  const plan = (
    v: ReturnType<typeof view>,
    free = Infinity,
    shown: Parameters<typeof planViewImage>[0]['shown'] = null,
  ) => planViewImage({ spec, view: v, limits, free, shown })

  it('takes the smallest of our, the GPU and the server image limits', () => {
    expect(imageLimits(spec)).toEqual([4096, 4096])
    expect(imageLimits(spec, 2048)).toEqual([2048, 2048])
    expect(imageLimits({ ...spec, maxImageSize: [2000, 1000] }, 16384)).toEqual(
      [2000, 1000],
    )
  })

  it('needs no view image while the world image is sharp enough', () => {
    expect(plan(view(10, 50, 2))).toEqual({ kind: 'drop' })
  })

  it('asks for the visible area at one texel per screen pixel', () => {
    const p = plan(view(10, 50, 6))
    expect(p.kind).toBe('load')
    if (p.kind !== 'load') return
    const [w, s, e, n] = p.region
    expect(w < 10 && e > 10 && s < 50 && n > 50).toBe(true)
    expect(p.scale).toBeCloseTo(wantedScale(6), 6)
  })

  it('keeps a shown view image that already covers the view as sharp', () => {
    const p = plan(view(10, 50, 6))
    if (p.kind !== 'load') throw new Error('expected a load')
    const shown = { region: [-40, 20, 60, 80] as const, scale: p.scale }
    expect(plan(view(10, 50, 6), Infinity, shown)).toEqual({ kind: 'keep' })
  })

  it('shrinks to the budget, never past it', () => {
    const free = 2e6
    const p = plan(view(10, 50, 6), free)
    if (p.kind !== 'load') throw new Error('expected a load')
    expect(p.scale).toBeLessThan(wantedScale(6))
    expect(bytesOf(regionSize(p.region, p.scale))).toBeLessThanOrEqual(free)
  })

  it('runs past 180° when the view crosses the antimeridian', () => {
    const p = plan(view(180, -40, 6))
    if (p.kind !== 'load') throw new Error('expected a load')
    expect(p.region[0]).toBeLessThan(180)
    expect(p.region[2]).toBeGreaterThan(180)
  })

  it('has nothing sharper than the world image around a pole', () => {
    // Every longitude in view: square pixels cap 360 deg at the world image's scale.
    expect(plan(view(100, 85, 6))).toEqual({ kind: 'keep' })
  })

  it('splits a region past 180° into two square-pixel halves', () => {
    expect(requestParts([10, 40, 30, 60], 10)).toEqual({
      parts: [{ region: [10, 40, 30, 60], size: [200, 200] }],
      region: [10, 40, 30, 60],
    })
    const { parts, region } = requestParts([170, -50, 200, -30], 7.3)
    expect(parts.map((part) => part.region[2] - part.region[0])).toEqual([
      expect.closeTo(10, 9),
      expect.closeTo(20, 1),
    ])
    for (const part of parts) {
      const [w, s, e, n] = part.region
      expect(part.size[0] / (e - w)).toBeCloseTo(part.size[1] / (n - s), 6)
    }
    expect(parts[0].region[2]).toBe(180)
    expect(parts[1].region[0]).toBe(-180)
    expect(region[0]).toBe(parts[0].region[0])
    expect(region[2]).toBeCloseTo(parts[1].region[2] + 360, 9)
  })

  it('re-fetches a new instant small under a view image, else as sharp as shown', () => {
    const first = 1024 / 360
    const target = regionScale(WORLD_REGION, wantedScale(6), limits)
    expect(refetchScale(spec, 6, limits, target, true)).toBeCloseTo(first, 9)
    expect(refetchScale(spec, 6, limits, target, false)).toBeCloseTo(target, 9)
  })

  it('upgrades the world image only when clearly sharper', () => {
    const target = regionScale(WORLD_REGION, wantedScale(6), limits)
    expect(worldUpgrade(spec, 6, limits, Infinity, 1024 / 360)).toBeCloseTo(
      target,
      9,
    )
    expect(worldUpgrade(spec, 6, limits, Infinity, target)).toBeNull()
  })

  it('fits the budget after rounding to whole pixels', () => {
    const free = bytesOf(regionSize(WORLD_REGION, 5))
    const scale = fitScale(WORLD_REGION, 11, free)
    expect(bytesOf(regionSize(WORLD_REGION, scale))).toBeLessThanOrEqual(free)
    expect(scale).toBeGreaterThan(4.5)
    expect(layerRegion(spec)).toBe(WORLD_REGION)
  })
})
