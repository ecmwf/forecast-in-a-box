/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * The bend's cut between world copies (the far side's meridian) must not streak outline lines
 * across the view: they cannot be culled like surfaces. Real WebGL, like globe-registration.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobeEngine } from '@/features/viewer/globe/engine'
import type * as Geometry from '@/features/viewer/globe/webgl/geometry'
import type * as OlOutline from '@/lib/map/ol-outline'
import { GLOBE_ENGINE } from '@/features/viewer/globe/engine-entry'
import { globeFitZoom } from '@/features/viewer/globe/globe-camera'

// One coastline across the cut at 40E (the flat centre is at 140W) and no graticule.
vi.mock('@/lib/map/ol-outline', async (importOriginal) => ({
  ...(await importOriginal<typeof OlOutline>()),
  loadOutlineData: () =>
    Promise.resolve({
      coastlines: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [35, 20],
                [45, 20],
              ],
            },
          },
        ],
      },
      countries: { type: 'FeatureCollection', features: [] },
    }),
}))
vi.mock('@/features/viewer/globe/webgl/geometry', async (importOriginal) => ({
  ...(await importOriginal<typeof Geometry>()),
  graticuleLines: () => [],
}))

const WIDTH = 640
const HEIGHT = 480
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('globe bend cut', () => {
  let engine: GlobeEngine
  let container: HTMLDivElement

  beforeEach(async () => {
    container = document.createElement('div')
    container.style.cssText = `position:relative;width:${WIDTH}px;height:${HEIGHT}px`
    document.body.appendChild(container)
    engine = (await GLOBE_ENGINE.load())()
    await engine.mount(container, {
      onCameraChange: () => {},
      onLayerLoad: () => {},
      onLoadingChange: () => {},
      onContextLost: () => {},
    })
    engine.setBasemap({ kind: 'outline', theme: 'light', opacity: 1 })
    // The outline data resolves asynchronously.
    await sleep(100)
  })

  afterEach(() => {
    engine.destroy()
    container.remove()
  })

  /** Pixels in the middle of the centre column that stand out from its median. */
  function streakPixels() {
    const canvas = engine.capture()
    const k = canvas.width / WIDTH
    const ctx = canvas.getContext('2d')!
    const x = Math.round((WIDTH / 2) * k)
    const y0 = Math.round(HEIGHT * 0.2 * k)
    const rows = Math.round(HEIGHT * 0.6 * k)
    const { data } = ctx.getImageData(x, y0, 1, rows)
    const lum = Array.from({ length: rows }, (_, i) => {
      const j = i * 4
      return data[j] + data[j + 1] + data[j + 2]
    })
    const median = [...lum].sort((a, b) => a - b)[Math.floor(rows / 2)]
    return lum.filter((v) => Math.abs(v - median) > 40).length
  }

  it('draws no outline streak across the view while bending', async () => {
    const camera = { lon: -140, lat: 0, zoom: globeFitZoom(WIDTH, HEIGHT) }
    const flat = {
      projection: 'merc' as const,
      lon: -140,
      lat: 0,
      resolution: 60000,
    }
    engine.setCamera(camera)
    await engine.morphOut(flat, 0)
    engine.setLive(false)
    const bending = engine.morphIn(flat, camera, 3000, null)
    // Early in the bend: lines on the far side are still drawn at full strength.
    const seen: Array<number> = []
    for (let i = 0; i < 6; i++) {
      await sleep(120)
      seen.push(streakPixels())
    }
    await bending
    expect(seen, JSON.stringify(seen)).toEqual(seen.map(() => 0))
  })
})
