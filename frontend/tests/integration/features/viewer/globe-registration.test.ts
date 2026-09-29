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
// Either side of the antimeridian, and near the pole; open ocean, off the 30° graticule.
const EDGE_MARKERS: ReadonlyArray<Marker> = [
  { lon: 179.2, lat: -40.3, rgb: [255, 0, 0] },
  { lon: -179.3, lat: -39.7, rgb: [0, 0, 255] },
  { lon: 100, lat: 83, rgb: [0, 200, 0] },
]
const REGION: [number, number, number, number] = [-60, 20, -20, 55]
const REGION_MARKER: Marker = { lon: -50, lat: 40, rgb: [255, 160, 0] }
const CAMERA = { lon: -35, lat: 10, zoom: globeFitZoom(WIDTH, HEIGHT) }
const SOLID: Rgb = [40, 120, 200]
// One-degree bands at the pole: a smudge would mix them.
const POLAR_BANDS = [
  [89, 90, [255, 0, 0]],
  [88, 89, [0, 200, 0]],
  [87, 88, [0, 0, 255]],
] as const
// One-texel meridians 21 texels apart, so sampling phase drifts line to line; ~2.5× minified east–west near 65°N.
const LINE_LONS = Array.from({ length: 11 }, (_, i) => -60 + i * 5.25)

/** PNG of `bbox` at `ppd` px/degree or an exact [width, height]; markers are whole-pixel squares (no AA). */
async function markerPng(
  bbox: readonly [number, number, number, number],
  scale: number | readonly [number, number],
  markers: ReadonlyArray<Marker>,
  side: number,
): Promise<ArrayBuffer> {
  const [w, s, e, n] = bbox
  const [width, height] =
    typeof scale === 'number' ? [(e - w) * scale, (n - s) * scale] : scale
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  for (const m of markers) {
    ctx.fillStyle = `rgb(${m.rgb.join(',')})`
    const x = ((m.lon - w) / (e - w)) * width
    const y = ((n - m.lat) / (n - s)) * height
    ctx.fillRect(Math.round(x - side / 2), Math.round(y - side / 2), side, side)
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return blob.arrayBuffer()
}

/** World PNG at `ppd` px/degree with one-texel meridian lines at `lons`, `lat0`..`lat1`. */
async function linesPng(
  ppd: number,
  lons: ReadonlyArray<number>,
  [lat0, lat1]: readonly [number, number],
): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(360 * ppd, 180 * ppd)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgb(0,0,0)'
  for (const lon of lons) {
    ctx.fillRect((lon + 180) * ppd, (90 - lat1) * ppd, 1, (lat1 - lat0) * ppd)
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return blob.arrayBuffer()
}

/** World PNG at `ppd` px/degree with full-width latitude bands. */
async function bandsPng(
  ppd: number,
  bands: ReadonlyArray<readonly [number, number, Rgb]>,
): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(360 * ppd, 180 * ppd)
  const ctx = canvas.getContext('2d')!
  for (const [south, north, rgb] of bands) {
    ctx.fillStyle = `rgb(${rgb.join(',')})`
    ctx.fillRect(0, (90 - north) * ppd, canvas.width, (north - south) * ppd)
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
  /** onLayerLoad outcomes, in order. */
  const loads: Array<boolean> = []

  beforeEach(async () => {
    requests.length = 0
    loads.length = 0
    const world = await markerPng([-180, -90, 180, 90], 4, WORLD_MARKERS, 8)
    const region = await markerPng(REGION, 10, [REGION_MARKER], 10)
    const solid = await solidPng([-180, -90, 180, 90], 4, SOLID)
    const lines = await linesPng(4, LINE_LONS, [45, 80])
    const bands = await bandsPng(4, POLAR_BANDS)
    worker.use(
      http.get(ENDPOINT, async ({ request }) => {
        const url = new URL(request.url)
        requests.push(url)
        const name = url.searchParams.get('LAYERS')
        // The world layer renders whatever BBOX is asked, like a real server.
        const [s, w, n, e] = (url.searchParams.get('BBOX') ?? '')
          .split(',')
          .map(Number)
        const size = [
          Number(url.searchParams.get('WIDTH')),
          Number(url.searchParams.get('HEIGHT')),
        ] as const
        const whole = w === -180 && e === 180 && s === -90 && n === 90
        const body =
          name === 'world' && !whole
            ? await markerPng([w, s, e, n], size, WORLD_MARKERS, 8)
            : name === 'edge'
              ? await markerPng([w, s, e, n], size, EDGE_MARKERS, 8)
              : name === 'region'
                ? region
                : name === 'solid'
                  ? solid
                  : name === 'lines'
                    ? lines
                    : name === 'bands'
                      ? bands
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
      onLayerLoad: (_key, _time, ok) => loads.push(ok),
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

  it('reads a marker back at the zoom ceiling, off centre', async () => {
    engine.setLayers([spec('world', 1)])
    await engine.whenLoaded()
    const m = WORLD_MARKERS[0]
    engine.setCamera({ lon: m.lon + 0.25, lat: m.lat + 0.15, zoom: 8 })
    // ~1 km: under two pixels at 611 m/px.
    expect(readoutError(engine, m)).toBeLessThan(0.01)
  })

  it('fetches the sharp view image with the world image when zoomed in', async () => {
    const m = WORLD_MARKERS[0]
    engine.setCamera({ lon: m.lon, lat: m.lat, zoom: 5 })
    engine.setLayers([spec('world', 1)])
    // Loaded only once the view image is in, not just the coarse world one.
    await engine.whenLoaded()
    const boxes = requests.map((u) => u.searchParams.get('BBOX'))
    expect(boxes).toContain('-90,-180,90,180')
    expect(boxes.some((b) => b !== '-90,-180,90,180')).toBe(true)
    expect(readoutError(engine, m)).toBeLessThan(0.05)
  })

  it('keeps latitudes sharp at the pole', async () => {
    engine.setCamera({ lon: 0, lat: 88, zoom: 3.6 })
    engine.setLayers([spec('bands', 1)])
    await engine.whenLoaded()
    // Mid-band pixels keep the band's colour; the mip smudge blends them.
    const f = frame(engine)
    let checked = 0
    const off: Array<string> = []
    for (let y = 0; y < HEIGHT; y += 2)
      for (let x = 0; x < WIDTH; x += 2) {
        const hit = engine.pick([x, y])
        if (!hit || hit.lat < 88.3 || hit.lat > 88.7) continue
        checked++
        if (!near(f.at(x, y), POLAR_BANDS[1][2], 12)) off.push(`${x},${y}`)
      }
    expect(checked).toBeGreaterThan(20)
    expect(off).toEqual([])
  })

  it('takes a bend over mid-flight, either way', async () => {
    engine.setLayers([spec('solid', 1)])
    await engine.whenLoaded()
    const flat = {
      projection: 'merc' as const,
      lon: -35,
      lat: 10,
      resolution: 20000,
    }
    const centre: [number, number] = [WIDTH / 2, HEIGHT / 2]
    const entering = engine.morphIn(flat, CAMERA, 600, null)
    await new Promise((r) => setTimeout(r, 250))
    await Promise.all([entering, engine.morphOut(flat, 600)])
    // The superseded entry did not finish onto the globe: flat, no readout.
    expect(engine.pick(centre)).toBeNull()
    const leaving = engine.morphOut(flat, 600)
    await engine.morphIn(flat, CAMERA, 600, null)
    await leaving
    expect(engine.pick(centre)).not.toBeNull()
    expect(near(frame(engine).at(...centre), SOLID, 3)).toBe(true)
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

  describe('after a time step', () => {
    const T1 = '2026-07-06T00:00:00Z'
    const T2 = '2026-07-06T06:00:00Z'
    const colours: Record<string, Rgb> = {
      [T1]: [220, 40, 40],
      [T2]: [40, 40, 220],
    }
    const isWorld = (u: URL) => u.searchParams.get('BBOX') === '-90,-180,90,180'
    let releaseWorld = () => {}
    const timed = (time: string): GlobeLayerSpec => {
      const base = spec('timed', 1)
      return { ...base, params: { ...base.params, TIME: time }, time }
    }
    /** On-screen pixels of each instant. */
    const instants = () => {
      const f = frame(engine)
      const count = { t1: 0, t2: 0 }
      for (let y = 4; y < HEIGHT; y += 8)
        for (let x = 4; x < WIDTH; x += 8) {
          const px = f.at(x, y)
          if (near(px, colours[T1], 30)) count.t1++
          else if (near(px, colours[T2], 30)) count.t2++
        }
      return count
    }

    beforeEach(async () => {
      const worldHeld = new Promise<void>((resolve) => {
        releaseWorld = resolve
      })
      worker.use(
        http.get(ENDPOINT, async ({ request }) => {
          const url = new URL(request.url)
          if (url.searchParams.get('LAYERS') !== 'timed') return
          requests.push(url)
          const time = url.searchParams.get('TIME') ?? ''
          // The new world image is slow; the view image of the new instant lands first.
          if (isWorld(url) && time === T2) await worldHeld
          const [s, w, n, e] = (url.searchParams.get('BBOX') ?? '')
            .split(',')
            .map(Number)
          const ppd = Number(url.searchParams.get('WIDTH')) / (e - w)
          return HttpResponse.arrayBuffer(
            await solidPng([w, s, e, n], ppd, colours[time]),
            { headers: { 'Content-Type': 'image/png' } },
          )
        }),
      )
      // Zoomed in: a view image over the world image.
      engine.setCamera({ lon: -45, lat: 70, zoom: 5 })
      engine.setLayers([timed(T1)])
      await engine.whenLoaded()
      expect(requests.some((u) => !isWorld(u))).toBe(true)
    })

    it('never shows two instants at once', async () => {
      engine.setLayers([timed(T2)])
      await expect
        .poll(() =>
          requests.some(
            (u) => !isWorld(u) && u.searchParams.get('TIME') === T2,
          ),
        )
        .toBe(true)
      await new Promise((r) => setTimeout(r, 500))
      // Until the new world image is in, the frame stays wholly on T1.
      const held = instants()
      expect(held.t1, JSON.stringify(held)).toBeGreaterThan(100)
      expect(held.t2, JSON.stringify(held)).toBe(0)
      // With a view image covering the screen, the world image is re-fetched small.
      const worldT2 = requests.find(
        (u) => isWorld(u) && u.searchParams.get('TIME') === T2,
      )!
      expect(Number(worldT2.searchParams.get('WIDTH'))).toBeLessThanOrEqual(
        1024,
      )

      releaseWorld()
      await expect
        .poll(() => {
          const c = instants()
          return c.t2 > 100 && c.t1 === 0
        })
        .toBe(true)
    })

    it('reports loaded only once its images are in', async () => {
      engine.setLayers([timed(T2)])
      let loaded = false
      void engine.whenLoaded().then(() => {
        loaded = true
      })
      await new Promise((r) => setTimeout(r, 500))
      // An export now would pair the T1 image with the T2 label.
      expect(loaded).toBe(false)
      releaseWorld()
      await expect.poll(() => loaded).toBe(true)
      const c = instants()
      expect(c.t1).toBe(0)
      expect(c.t2).toBeGreaterThan(100)
    })
  })

  it('keeps the shown image when a sharper copy fails, and backs off', async () => {
    // A server that refuses images wider than 1024 px, like a MaxWidth limit.
    const sharper = (u: URL) =>
      u.searchParams.get('LAYERS') === 'world' &&
      Number(u.searchParams.get('WIDTH')) > 1024
    worker.use(
      http.get(ENDPOINT, ({ request }) => {
        const url = new URL(request.url)
        if (!sharper(url)) return
        requests.push(url)
        return new HttpResponse(null, { status: 500 })
      }),
    )
    engine.setLayers([spec('world', 1)])
    await engine.whenLoaded()
    // The idle upgrade asks for a sharper world image and fails.
    await expect.poll(() => requests.filter(sharper).length).toBe(1)
    await new Promise((r) => setTimeout(r, 300))
    // The instant is served: the coarser image stays and nothing is reported failed.
    expect(loads).not.toContain(false)
    expect(readoutError(engine, WORLD_MARKERS[0])).toBeLessThan(0.3)
    // A camera move does not retry straight away.
    engine.setCamera({ ...CAMERA, lon: CAMERA.lon + 2 })
    await new Promise((r) => setTimeout(r, 800))
    expect(requests.filter(sharper)).toHaveLength(1)
  })

  it("asks for no image larger than the server's MaxWidth/MaxHeight", async () => {
    engine.setCamera({ lon: -45, lat: 15, zoom: 5 })
    engine.setLayers([{ ...spec('world', 1), maxImageSize: [2000, 2000] }])
    await engine.whenLoaded()
    // Sharper images still come, capped at the limit.
    await expect
      .poll(() =>
        requests.some((u) => Number(u.searchParams.get('WIDTH')) > 1024),
      )
      .toBe(true)
    await new Promise((r) => setTimeout(r, 500))
    for (const u of requests) {
      expect(Number(u.searchParams.get('WIDTH'))).toBeLessThanOrEqual(2000)
      expect(Number(u.searchParams.get('HEIGHT'))).toBeLessThanOrEqual(2000)
    }
  })

  it('fetches the view sharp across the antimeridian, in two halves', async () => {
    engine.setCamera({ lon: 180, lat: -40, zoom: 6 })
    engine.setLayers([spec('edge', 1)])
    await engine.whenLoaded()
    const boxes = requests.map((u) =>
      (u.searchParams.get('BBOX') ?? '').split(',').map(Number),
    )
    // Lat-first: south, west, north, east.
    expect(boxes.some(([s, , , e]) => e === 180 && s > -90)).toBe(true)
    expect(boxes.some(([s, w]) => w === -180 && s > -90)).toBe(true)
    for (const m of EDGE_MARKERS.slice(0, 2)) {
      expect(readoutError(engine, m)).toBeLessThan(0.05)
    }
  })

  it('asks for square pixels at a pole, which servers like SkinnyWMS need', async () => {
    engine.setCamera({ lon: 100, lat: 83, zoom: 6 })
    engine.setLayers([spec('edge', 1)])
    await engine.whenLoaded()
    await new Promise((r) => setTimeout(r, 500))
    // A non-square request comes back letterboxed from Magics, the data squeezed into a strip.
    for (const u of requests) {
      const [s, w, n, e] = (u.searchParams.get('BBOX') ?? '')
        .split(',')
        .map(Number)
      const width = Number(u.searchParams.get('WIDTH'))
      const height = Number(u.searchParams.get('HEIGHT'))
      expect(
        Math.abs((width / (e - w)) * (n - s) - height),
      ).toBeLessThanOrEqual(1)
    }
    expect(readoutError(engine, EDGE_MARKERS[2])).toBeLessThan(0.3)
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
    // Room for three first images (1024 px wide, with mipmaps), none of the sharper ones.
    textureLedger.budget = 11 * 2 ** 20
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
    // About 4 screen px per texel; read before the idle upgrade refetches.
    engine.setCamera({
      lon: marker.lon,
      lat: marker.lat,
      zoom: CAMERA.zoom + 2,
    })
    // Nearest sampling: no blended fringe around a marker.
    expect(blendedAround(engine, marker)).toBe(0)
    expect(readoutError(engine, marker, 2)).toBeLessThan(0.3)
  })

  it('keeps thin lines when the image is minified', async () => {
    engine.setBasemap({ kind: 'outline', theme: 'light', opacity: 0 })
    engine.setCamera({ lon: -35, lat: 65, zoom: CAMERA.zoom })
    engine.setLayers([spec('lines', 1)])
    await engine.whenLoaded()
    // Along the centre row every meridian shows; nearest sampling drops most.
    const f = frame(engine)
    const ground = f.at(WIDTH / 2 + 4, HEIGHT / 2)
    let runs = 0
    let inLine = false
    // The lines lie within ±45 px of the centre; the limb is far outside.
    for (let x = WIDTH / 2 - 120; x < WIDTH / 2 + 120; x++) {
      const line = f.at(x, HEIGHT / 2)[0] < ground[0] - 12
      if (line && !inLine) runs++
      inLine = line
    }
    expect(runs).toBe(LINE_LONS.length)
  })

  it('bends a transparent flat map over the globe ground, premultiplied', async () => {
    engine.setLayers([spec('solid', 1)])
    await engine.whenLoaded()
    // Left: empty (no ground painted); right: half-transparent magenta.
    const image = document.createElement('canvas')
    image.width = WIDTH
    image.height = HEIGHT
    const ctx = image.getContext('2d')!
    ctx.fillStyle = 'rgba(255,0,255,0.5)'
    ctx.fillRect(WIDTH / 2, 0, WIDTH / 2, HEIGHT)
    await engine.morphIn(
      { projection: 'merc', lon: -35, lat: 10, resolution: 20000 },
      CAMERA,
      0,
      { image },
    )
    const f = frame(engine)
    expect(near(f.at(WIDTH / 2 - 20, HEIGHT / 2), SOLID, 3)).toBe(true)
    const blend: Rgb = [
      Math.round((255 + SOLID[0]) / 2),
      Math.round(SOLID[1] / 2),
      Math.round((255 + SOLID[2]) / 2),
    ]
    expect(near(f.at(WIDTH / 2 + 20, HEIGHT / 2), blend, 4)).toBe(true)
  })

  it('fetches nothing while hidden and loads once live', async () => {
    engine.setLive(false)
    engine.setLayers([spec('world', 1)])
    engine.setLayers([
      {
        ...spec('world', 1),
        params: { ...spec('world', 1).params, TIME: 't1' },
      },
    ])
    await new Promise((r) => setTimeout(r, 400))
    expect(requests).toEqual([])
    // Entering wakes it, whatever called setLive last.
    await engine.morphIn(
      { projection: 'merc', lon: -35, lat: 10, resolution: 20000 },
      CAMERA,
      0,
      null,
    )
    await engine.whenLoaded()
    expect(requests.map((u) => u.searchParams.get('TIME'))).toEqual(['t1'])
    expect(readoutError(engine, WORLD_MARKERS[0])).toBeLessThan(0.3)
  })
})
