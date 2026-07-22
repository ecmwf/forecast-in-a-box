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
  isAbortedLoad,
  loadRequestUrl,
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

    // Superseded: flagged and failed; fresh: blob URL, not flagged.
    await vi.waitFor(() => expect(isAbortedLoad(first.img)).toBe(true))
    expect(first.img.src).toContain('data:image/gif')
    await vi.waitFor(() => expect(second.img.src).toContain('blob:'))
    expect(isAbortedLoad(second.img)).toBe(false)
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

  it('fails the image on HTTP errors without the aborted flag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 500 }))),
    )
    const load = cancellingImageLoader()
    const { wrapper, img } = fakeImage()
    load(wrapper, 'http://wms.test/?TIME=T00')
    await vi.waitFor(() => expect(img.src).toContain('data:image/gif'))
    expect(isAbortedLoad(img)).toBe(false)
  })
})
