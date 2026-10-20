/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type OlImage from 'ol/Image'
import {
  cancellingImageLoader,
  clampGetMapBbox,
  loadRequestUrl,
  loadWasAborted,
} from '@/features/viewer/ol-layers'

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function fakeImage(): { wrapper: OlImage; img: HTMLImageElement } {
  const img = document.createElement('img')
  return { wrapper: { getImage: () => img } as unknown as OlImage, img }
}

function pngResponse(): Response {
  const bytes = Uint8Array.from(atob(PNG_1PX), (c) => c.charCodeAt(0))
  return new Response(new Blob([bytes], { type: 'image/png' }), {
    status: 200,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cancellingImageLoader', () => {
  it('aborts the previous in-flight request when superseded', async () => {
    const signals: Array<AbortSignal> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        signals.push(init.signal!)
        return new Promise<Response>((resolve, reject) => {
          init.signal!.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
          // First request never resolves on its own; later ones succeed.
          if (signals.length > 1) resolve(pngResponse())
        })
      }),
    )
    const load = cancellingImageLoader()
    const first = fakeImage()
    const second = fakeImage()

    load(first.wrapper, 'http://wms.test/?TIME=T00')
    expect(signals[0].aborted).toBe(false)
    load(second.wrapper, 'http://wms.test/?TIME=T06')
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)

    // Superseded: settles as a flagged blank pixel — a LOADED (not error)
    // state, so OL neither console.errors nor keeps `source.loading` (and
    // with it rendercomplete + the panel counters) hostage forever.
    await vi.waitFor(() => expect(second.img.src).toContain('blob:'))
    await vi.waitFor(() => expect(first.img.src).toContain('data:image/png'))
    expect(loadWasAborted(first.img)).toBe(true)
    expect(loadWasAborted(second.img)).toBe(false)

    // A later reuse of the element must shed the aborted flag.
    load(first.wrapper, 'http://wms.test/?TIME=T12')
    expect(loadWasAborted(first.img)).toBe(false)
  })

  it('keeps the request URL readable for TIME attribution', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    const load = cancellingImageLoader()
    const { wrapper, img } = fakeImage()
    load(wrapper, 'http://wms.test/?TIME=2026-07-06T00:00:00Z')
    expect(loadRequestUrl(img)).toBe(
      'http://wms.test/?TIME=2026-07-06T00:00:00Z',
    )
  })

  it('fails the image on HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 500 }))),
    )
    const load = cancellingImageLoader()
    const { wrapper, img } = fakeImage()
    load(wrapper, 'http://wms.test/?TIME=T00')
    await vi.waitFor(() => expect(img.src).toContain('data:image/gif'))
  })

  it('fetches the BBOX trimmed to the world, attributing the original URL', () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    const load = cancellingImageLoader()
    const { wrapper, img } = fakeImage()
    load(wrapper, WORLD_OVERSHOOT)
    expect(fetchMock).toHaveBeenCalledWith(
      WORLD_OVERSHOOT.replace(
        'BBOX=-20046021.04%2C-17271713.18%2C20046021.04%2C15275448.53',
        `BBOX=${encodeURIComponent(`${-W},-17271713.18,${W},15275448.53`)}`,
      ),
      expect.anything(),
    )
    expect(loadRequestUrl(img)).toBe(WORLD_OVERSHOOT)
  })
})

/** Mercator half-world (OL's EPSG:3857 HALF_SIZE). */
const W = Math.PI * 6378137

/** A request OL rounded 8.5 km past both world edges (seen in the app). */
const WORLD_OVERSHOOT =
  '/api/v1/lens/proxy/abc/wms?REQUEST=GetMap&VERSION=1.3.0&LAYERS=2t&WIDTH=1270&HEIGHT=1031&CRS=EPSG%3A3857&BBOX=-20046021.04%2C-17271713.18%2C20046021.04%2C15275448.53'

describe('clampGetMapBbox', () => {
  it('trims a Mercator box to the world edges, leaving other params', () => {
    const clamped = clampGetMapBbox(WORLD_OVERSHOOT)
    const bbox = new URL(clamped, 'http://x').searchParams.get('BBOX')
    expect(bbox?.split(',').map(Number)).toEqual([
      -W,
      -17271713.18,
      W,
      15275448.53,
    ])
    expect(clamped.replace(/BBOX=[^&]*/, '')).toBe(
      WORLD_OVERSHOOT.replace(/BBOX=[^&]*/, ''),
    )
  })

  it('returns boxes inside the world unchanged', () => {
    const inside = WORLD_OVERSHOOT.replace(
      /BBOX=[^&]*/,
      'BBOX=-1000%2C-1000%2C1000%2C1000',
    )
    expect(clampGetMapBbox(inside)).toBe(inside)
  })

  it('reads EPSG:4326 latitude first in WMS 1.3.0', () => {
    const geo =
      'http://wms.test/wms?VERSION=1.3.0&CRS=EPSG%3A4326&BBOX=-91%2C-180.5%2C91%2C180.5'
    const bbox = new URL(clampGetMapBbox(geo)).searchParams.get('BBOX')
    expect(bbox).toBe('-90,-180,90,180')
  })

  it('leaves other CRSs alone', () => {
    const polar =
      'http://wms.test/wms?VERSION=1.3.0&CRS=EPSG%3A32661&BBOX=-1e9%2C-1e9%2C1e9%2C1e9'
    expect(clampGetMapBbox(polar)).toBe(polar)
  })
})
