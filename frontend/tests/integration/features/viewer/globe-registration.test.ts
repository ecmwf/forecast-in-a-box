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

function spec(
  layerName: string,
  zIndex: number,
  bbox?: GlobeLayerSpec['bbox'],
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

describe('globe registration', () => {
  let container: HTMLDivElement
  let engine: GlobeEngine
  const requests: Array<URL> = []

  beforeEach(async () => {
    requests.length = 0
    const world = await markerPng([-180, -90, 180, 90], 4, WORLD_MARKERS, 8)
    const region = await markerPng(REGION, 10, [REGION_MARKER], 10)
    worker.use(
      http.get(ENDPOINT, ({ request }) => {
        const url = new URL(request.url)
        requests.push(url)
        const body =
          url.searchParams.get('LAYERS') === 'region' ? region : world
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
})
