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
 * Real-WebGL registration: markers drawn at known lon/lat into EPSG:4326
 * GetMap images must be rendered where the pointer readout reports that
 * lon/lat.
 */

import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { worker } from '@tests/test-extend'
import type {
  GlobeEngine,
  GlobeLayerSpec,
} from '@/features/viewer/globe/engine'
import { GLOBE_ENGINE } from '@/features/viewer/globe/engine-entry'
import { globeFitZoom } from '@/features/viewer/globe/globe-camera'
import { textureLedger } from '@/features/viewer/globe/globe-content'

const ENDPOINT = 'http://localhost:9911/wms'
const WIDTH = 640
const HEIGHT = 480

type Rgb = readonly [number, number, number]
interface Marker {
  lon: number
  lat: number
  rgb: Rgb
}

// Open ocean, clear of the 30° graticule, within 35° of the camera.
const WORLD_MARKERS: ReadonlyArray<Marker> = [
  { lon: -45, lat: 15, rgb: [255, 0, 0] },
  { lon: -40, lat: 45, rgb: [0, 200, 0] },
  { lon: -15, lat: -15, rgb: [0, 0, 255] },
  { lon: -15, lat: 45, rgb: [255, 0, 255] },
  { lon: -35, lat: -35, rgb: [0, 200, 200] },
]
const REGION: [number, number, number, number] = [-60, 20, -20, 55]
const REGION_MARKER: Marker = { lon: -50, lat: 40, rgb: [255, 160, 0] }
const CAMERA = { lon: -35, lat: 10, zoom: globeFitZoom(WIDTH, HEIGHT) }
const SOLID: Rgb = [40, 120, 200]

/** PNG of `bbox` at `ppd` px/degree; markers are whole-pixel squares (no AA). */
async function markerPng(
  bbox: readonly [number, number, number, number],
  ppd: number,
  markers: ReadonlyArray<Marker>,
  side: number,
): Promise<ArrayBuffer> {
  const [w, s, e, n] = bbox
  const canvas = new OffscreenCanvas((e - w) * ppd, (n - s) * ppd)
  const ctx = canvas.getContext('2d')!
  for (const m of markers) {
    ctx.fillStyle = `rgb(${m.rgb.join(',')})`
    const x = (m.lon - w) * ppd
    const y = (n - m.lat) * ppd
    ctx.fillRect(x - side / 2, y - side / 2, side, side)
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return blob.arrayBuffer()
}

/** Solid PNG of `bbox` at `ppd` px/degree. */
async function solidPng(
  bbox: readonly [number, number, number, number],
  ppd: number,
  rgb: Rgb,
): Promise<ArrayBuffer> {
  const [w, s, e, n] = bbox
  const canvas = new OffscreenCanvas((e - w) * ppd, (n - s) * ppd)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = `rgb(${rgb.join(',')})`
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return blob.arrayBuffer()
}

function spec(
  layerName: string,
  zIndex: number,
  bbox?: GlobeLayerSpec['bbox'],
  scale?: GlobeLayerSpec['scale'],
): GlobeLayerSpec {
  return {
    key: `a:${layerName}`,
    slot: 'a',
    layerName,
    endpoint: ENDPOINT,
    params: {
      LAYERS: layerName,
      STYLES: '',
      FORMAT: 'image/png',
      TRANSPARENT: 'TRUE',
    },
    time: null,
    bboxAxisOrder: 'epsg',
    bbox,
    scale,
    opacity: 1,
    zIndex,
  }
}

const near = (a: Rgb, b: Rgb, tol: number) =>
  Math.abs(a[0] - b[0]) <= tol &&
  Math.abs(a[1] - b[1]) <= tol &&
  Math.abs(a[2] - b[2]) <= tol

/** Pixels of the captured frame, in CSS px. */
function frame(engine: GlobeEngine) {
  const canvas = engine.capture()
  const scale = canvas.width / WIDTH
  const { data } = canvas
    .getContext('2d')!
    .getImageData(0, 0, canvas.width, canvas.height)
  const at = (x: number, y: number): Rgb => {
    const i = (Math.round(y * scale) * canvas.width + Math.round(x * scale)) * 4
    return [data[i], data[i + 1], data[i + 2]]
  }
  /** Centroid (CSS px) of the pixels matching `rgb`. */
  const centroid = (rgb: Rgb, tol: number) => {
    let sx = 0
    let sy = 0
    let count = 0
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4
        if (!near([data[i], data[i + 1], data[i + 2]], rgb, tol)) continue
        sx += x + 0.5
        sy += y + 0.5
        count++
      }
    }
    return count ? { x: sx / count / scale, y: sy / count / scale } : null
  }
  return { at, centroid }
}

/** Readout at the marker's rendered centre, as degrees of great-circle offset. */
function readoutError(engine: GlobeEngine, m: Marker, tol = 12) {
  const c = frame(engine).centroid(m.rgb, tol)
  expect(c, `marker ${m.rgb.join(',')} rendered`).not.toBeNull()
  const hit = engine.pick([c!.x, c!.y])
  expect(hit, 'readout on the globe').not.toBeNull()
  const dLon = (hit!.lon - m.lon) * Math.cos((m.lat * Math.PI) / 180)
  return Math.hypot(dLon, hit!.lat - m.lat)
}

/** Pixels around the marker that are neither its colour nor the background. */
function blendedAround(engine: GlobeEngine, m: Marker): number {
  const f = frame(engine)
  const c = f.centroid(m.rgb, 12)!
  const background = f.at(c.x + 14, c.y)
  let blended = 0
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const px = f.at(c.x + dx, c.y + dy)
      if (!near(px, m.rgb, 2) && !near(px, background, 2)) blended++
    }
  }
  return blended
}

describe('globe registration', () => {
  let container: HTMLDivElement
  let engine: GlobeEngine
  const requests: Array<URL> = []

  beforeEach(async () => {
    requests.length = 0
    const world = await markerPng([-180, -90, 180, 90], 4, WORLD_MARKERS, 8)
    const region = await markerPng(REGION, 10, [REGION_MARKER], 10)
    const solid = await solidPng([-180, -90, 180, 90], 4, SOLID)
    worker.use(
      http.get(ENDPOINT, async ({ request }) => {
        const url = new URL(request.url)
        requests.push(url)
        const name = url.searchParams.get('LAYERS')
        // The world layer renders whatever BBOX is asked, like a real server.
        const [s, w, n, e] = (url.searchParams.get('BBOX') ?? '')
          .split(',')
          .map(Number)
        const subWorld = name === 'world' && !(w === -180 && e === 180)
        const body = subWorld
          ? await markerPng(
              [w, s, e, n],
              Number(url.searchParams.get('WIDTH')) / (e - w),
              WORLD_MARKERS,
              8,
            )
          : name === 'region'
            ? region
            : name === 'solid'
              ? solid
              : world
        return HttpResponse.arrayBuffer(body, {
          headers: { 'Content-Type': 'image/png' },
        })
      }),
    )
    container = document.createElement('div')
    container.style.cssText = `position:relative;width:${WIDTH}px;height:${HEIGHT}px`
    document.body.appendChild(container)
    const create = await GLOBE_ENGINE.load()
    engine = create()
    await engine.mount(container, {
      onCameraChange: () => {},
      onLayerLoad: () => {},
      onLoadingChange: () => {},
      onContextLost: () => {},
    })
    engine.setCamera(CAMERA)
    engine.setBasemap({ kind: 'outline', theme: 'light', opacity: 1 })
  })

  afterEach(() => {
    engine.destroy()
    container.remove()
  })

  it('reads every world marker back at its own lon/lat', async () => {
    engine.setLayers([spec('world', 1)])
    await engine.whenLoaded()
    // WMS 1.3.0 EPSG:4326 is lat-first: south,west,north,east.
    expect(requests[0].searchParams.get('CRS')).toBe('EPSG:4326')
    expect(requests[0].searchParams.get('BBOX')).toBe('-90,-180,90,180')
    for (const m of WORLD_MARKERS) {
      expect(readoutError(engine, m)).toBeLessThan(0.3)
    }
  })

  it('places a regional layer on its bbox', async () => {
    engine.setLayers([spec('region', 2, REGION)])
    await engine.whenLoaded()
    expect(requests[0].searchParams.get('BBOX')).toBe('20,-60,55,-20')
    expect(readoutError(engine, REGION_MARKER)).toBeLessThan(0.3)
  })

  it('has no crack along the antimeridian', async () => {
    engine.setCamera({ ...CAMERA, lon: 180, lat: 0 })
    // The 180° meridian is also a graticule line: hide the outline strokes.
    engine.setBasemap({ kind: 'outline', theme: 'light', opacity: 0 })
    engine.setLayers([spec('solid', 1)])
    await engine.whenLoaded()
    const f = frame(engine)
    // The seam runs down the middle of the view: every pixel near it is the fill.
    const bad: Array<string> = []
    for (let y = HEIGHT / 2 - 150; y <= HEIGHT / 2 + 150; y += 3) {
      for (let dx = -3; dx <= 3; dx++) {
        const px = f.at(WIDTH / 2 + dx, y)
        if (!near(px, SOLID, 2))
          bad.push(`(${WIDTH / 2 + dx},${y})=${px.join(',')}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('has no crack along the antimeridian when zoomed in', async () => {
    engine.setCamera({ lon: -178.4, lat: 79.4, zoom: 5.2 })
    engine.setBasemap({ kind: 'outline', theme: 'light', opacity: 0 })
    engine.setLayers([spec('solid', 1)])
    await engine.whenLoaded()
    const f = frame(engine)
    const bad: Array<string> = []
    for (let y = 20; y < HEIGHT - 20; y += 2) {
      for (let x = 20; x < WIDTH - 20; x += 2) {
        const px = f.at(x, y)
        if (!near(px, SOLID, 2)) bad.push(`(${x},${y})=${px.join(',')}`)
      }
    }
    expect(bad).toEqual([])
  })

  it("bends the flat map's own pixels first", async () => {
    engine.setLayers([spec('solid', 1)])
    await engine.whenLoaded()
    const image = document.createElement('canvas')
    image.width = WIDTH
    image.height = HEIGHT
    const ctx = image.getContext('2d')!
    ctx.fillStyle = 'rgb(255,0,255)'
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    const from = {
      projection: 'merc' as const,
      lon: -35,
      lat: 10,
      resolution: 20000,
    }
    await engine.morphIn(from, CAMERA, 0, { image })
    // The seed covers the live layer until it fades.
    expect(
      near(frame(engine).at(WIDTH / 2, HEIGHT / 2), [255, 0, 255], 2),
    ).toBe(true)
    await new Promise((r) => setTimeout(r, 600))
    expect(near(frame(engine).at(WIDTH / 2, HEIGHT / 2), SOLID, 2)).toBe(true)
  })

  it('draws the native basemap under the data and its reference lines above', async () => {
    engine.setBasemap({
      kind: 'wms',
      theme: 'light',
      opacity: 1,
      layers: [spec('solid', 0), spec('region', 1000, REGION)],
    })
    engine.setLayers([spec('world', 1)])
    await engine.whenLoaded()
    const f = frame(engine)
    // Background where nothing else is drawn; data markers and the reference marker on top.
    expect(near(f.at(WIDTH / 2, HEIGHT / 2 + 60), SOLID, 2)).toBe(true)
    expect(readoutError(engine, WORLD_MARKERS[0])).toBeLessThan(0.3)
    expect(readoutError(engine, REGION_MARKER)).toBeLessThan(0.3)
  })

  it('hides a layer outside its scale band', async () => {
    // Band far below the current ground scale: the server would not draw it.
    engine.setLayers([spec('solid', 1, undefined, { minRes: 1, maxRes: 10 })])
    await engine.whenLoaded()
    expect(near(frame(engine).at(WIDTH / 2, HEIGHT / 2), SOLID, 2)).toBe(false)
    engine.setLayers([spec('solid', 1)])
    await engine.whenLoaded()
    expect(near(frame(engine).at(WIDTH / 2, HEIGHT / 2), SOLID, 2)).toBe(true)
  })

  it('fetches the visible area sharp once the world image is too coarse', async () => {
    engine.setCamera({ lon: -45, lat: 15, zoom: 6 })
    engine.setLayers([spec('world', 1)])
    await engine.whenLoaded()
    // The idle upgrade asks for a sub-world BBOX at screen resolution.
    await expect
      .poll(
        () =>
          requests.some((u) => {
            const bbox = u.searchParams.get('BBOX') ?? ''
            return bbox !== '' && bbox !== '-90,-180,90,180'
          }),
        { timeout: 5000 },
      )
      .toBe(true)
    await new Promise((r) => setTimeout(r, 300))
    expect(readoutError(engine, WORLD_MARKERS[0])).toBeLessThan(0.3)
  })

  it('recovers its layers after a WebGL context loss', async () => {
    engine.setLayers([spec('world', 1)])
    await engine.whenLoaded()
    const canvas = container.querySelector<HTMLCanvasElement>(
      '[data-testid="globe-canvas"]',
    )!
    const lose = canvas
      .getContext('webgl2')!
      .getExtension('WEBGL_lose_context')!
    const fetched = requests.length
    lose.loseContext()
    await new Promise((r) => setTimeout(r, 50))
    lose.restoreContext()
    // Textures died with the context: the image is fetched again, then drawn right.
    await expect
      .poll(() => requests.length, { timeout: 5000 })
      .toBeGreaterThan(fetched)
    await engine.whenLoaded()
    await new Promise((r) => setTimeout(r, 300))
    for (const m of WORLD_MARKERS) {
      expect(readoutError(engine, m)).toBeLessThan(0.3)
    }
  })

  it('keeps layer textures within the GPU budget', async () => {
    const budget = textureLedger.budget
    // Room for three first images (1024 px wide), none of the sharper ones.
    textureLedger.budget = 8 * 2 ** 20
    try {
      engine.setCamera({ lon: -45, lat: 15, zoom: 6 })
      engine.setLayers([
        spec('solid', 0),
        spec('world', 1),
        spec('region', 3, REGION),
      ])
      await engine.whenLoaded()
      await new Promise((r) => setTimeout(r, 800))
      expect(textureLedger.bytes).toBeLessThanOrEqual(textureLedger.budget)
      expect(
        requests.every((u) => Number(u.searchParams.get('WIDTH')) <= 1024),
      ).toBe(true)
      expect(readoutError(engine, WORLD_MARKERS[0])).toBeLessThan(0.3)
      engine.destroy()
      expect(textureLedger.bytes).toBe(0)
    } finally {
      textureLedger.budget = budget
    }
  })

  it('shows only server colours when magnified', async () => {
    engine.setLayers([spec('world', 1)])
    await engine.whenLoaded()
    const marker = WORLD_MARKERS[0]
    // Nearest sampling: no blended fringe around a marker.
    expect(blendedAround(engine, marker)).toBe(0)
    expect(readoutError(engine, marker, 2)).toBeLessThan(0.3)
  })
})
