/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import { fromLonLat } from 'ol/proj'
import type View from 'ol/View'
import type { GlobeCamera, GlobeEngine } from '@/features/viewer/globe/engine'
import { globeCameraOf } from '@/features/viewer/globe/globe-camera'
import { createViewerView } from '@/features/viewer/hooks/useOlMapBase'
import { getViewerProjection } from '@/features/viewer/projections'
import { useGlobeMode } from '@/features/viewer/globe/useGlobeMode'

/** Just enough engine for the handoff: bends and unbends at once. */
const unbendingEngine = () =>
  ({
    size: () => [800, 600],
    bendIn: vi.fn(() => Promise.resolve()),
    bendOut: vi.fn(() => Promise.resolve()),
  }) as unknown as GlobeEngine

describe('useGlobeMode', () => {
  it("enters at the flat map's own scale", async () => {
    const view = createViewerView(getViewerProjection('merc'))
    view.setCenter(fromLonLat([10, 50]))
    // About a country across: well inside the resting fit.
    view.setResolution(1500)
    const { result } = await renderHook(() =>
      useGlobeMode({
        viewRef: { current: view },
        onFlatView: () => {},
        panelCount: 1,
        reducedMotion: false,
        exitTarget: 'merc',
        initialCamera: null,
        onFailure: () => {},
        captureFlat: () => Promise.resolve([]),
        whenFlatRendered: () => Promise.resolve(),
      }),
    )
    const engine = unbendingEngine()
    act(() => result.current.registerEngine('a', engine))
    act(() => result.current.enter())
    await expect.poll(() => vi.mocked(engine.bendIn).mock.calls.length).toBe(1)
    const [, to] = vi.mocked(engine.bendIn).mock.calls[0]
    const flat = globeCameraOf(view)!
    expect(to.zoom).toBeCloseTo(flat.zoom, 6)
    expect(to.lon).toBeCloseTo(10, 6)
    expect(to.lat).toBeCloseTo(50, 6)
  })

  it('holds the globe over the flat map until that map has rendered', async () => {
    let rendered = () => {}
    const whenFlatRendered = () =>
      new Promise<void>((resolve) => {
        rendered = resolve
      })
    const view = createViewerView(getViewerProjection('merc'))
    const { result } = await renderHook(() =>
      useGlobeMode({
        viewRef: { current: view },
        onFlatView: () => {},
        panelCount: 1,
        reducedMotion: false,
        exitTarget: 'merc',
        initialCamera: { lon: 0, lat: 20, zoom: 1.5 },
        onFailure: () => {},
        captureFlat: () => Promise.resolve([]),
        whenFlatRendered,
      }),
    )
    const engine = unbendingEngine()
    act(() => result.current.registerEngine('a', engine))

    act(() => result.current.leave('merc'))
    await expect.poll(() => vi.mocked(engine.bendOut).mock.calls.length).toBe(1)
    // Unbent, but the flat map is still loading: the globe's frame stays up.
    await new Promise((r) => setTimeout(r, 300))
    expect(result.current.phase).toBe('leaving')
    expect(result.current.overlayVisible).toBe(true)

    act(() => rendered())
    await expect.poll(() => result.current.overlayVisible).toBe(false)
    await expect.poll(() => result.current.phase).toBe('flat')
  })

  it('waits for the new flat View even without a bend', async () => {
    let rendered = () => {}
    const waitedOn: Array<View> = []
    const adopted: Array<View> = []
    const { result } = await renderHook(() =>
      useGlobeMode({
        viewRef: { current: createViewerView(getViewerProjection('merc')) },
        onFlatView: (v) => adopted.push(v),
        panelCount: 1,
        // Reduced motion: no unbend to hide the flat map's loading behind.
        reducedMotion: true,
        exitTarget: 'merc',
        initialCamera: { lon: 0, lat: 20, zoom: 1.5 },
        onFailure: () => {},
        captureFlat: () => Promise.resolve([]),
        whenFlatRendered: (v) => {
          waitedOn.push(v)
          return new Promise<void>((resolve) => {
            rendered = resolve
          })
        },
      }),
    )
    act(() => result.current.registerEngine('a', unbendingEngine()))

    act(() => result.current.leave('geo'))
    await expect.poll(() => waitedOn.length).toBe(1)
    expect(waitedOn[0]).toBe(adopted[0])
    await new Promise((r) => setTimeout(r, 300))
    expect(result.current.overlayVisible).toBe(true)

    act(() => rendered())
    await expect.poll(() => result.current.phase).toBe('flat')
  })

  it('reports nothing into a viewer that has gone', async () => {
    const onFailure = vi.fn()
    const view = createViewerView(getViewerProjection('merc'))
    view.setCenter(fromLonLat([10, 50]))
    view.setResolution(1500)
    const { result, unmount } = await renderHook(() =>
      useGlobeMode({
        viewRef: { current: view },
        onFlatView: () => {},
        panelCount: 1,
        reducedMotion: false,
        exitTarget: 'merc',
        initialCamera: null,
        onFailure,
        captureFlat: () => Promise.resolve([]),
        whenFlatRendered: () => Promise.resolve(),
      }),
    )
    const engine = unbendingEngine()
    let fail = (_err: Error) => {}
    vi.mocked(engine.bendIn).mockReturnValue(
      new Promise((_, reject) => {
        fail = reject
      }),
    )
    act(() => result.current.registerEngine('a', engine))
    act(() => result.current.enter())
    await expect.poll(() => vi.mocked(engine.bendIn).mock.calls.length).toBe(1)

    await unmount()
    fail(new Error('engine lost'))
    await new Promise((r) => setTimeout(r, 50))
    expect(onFailure).not.toHaveBeenCalled()
  })

  describe('reversing mid-bend', () => {
    const deferred = () => {
      let resolve = () => {}
      const promise = new Promise<void>((r) => {
        resolve = r
      })
      return { promise, resolve }
    }
    const mode = async (initialCamera: GlobeCamera | null) => {
      const view = createViewerView(getViewerProjection('merc'))
      view.setCenter(fromLonLat([10, 50]))
      view.setResolution(1500)
      const { result } = await renderHook(() =>
        useGlobeMode({
          viewRef: { current: view },
          onFlatView: () => {},
          panelCount: 1,
          reducedMotion: false,
          exitTarget: 'merc',
          initialCamera,
          onFailure: () => {},
          captureFlat: () => Promise.resolve([]),
          whenFlatRendered: () => Promise.resolve(),
        }),
      )
      return result
    }

    it('turns an entry back to the flat map', async () => {
      const result = await mode(null)
      const bend = deferred()
      const engine = unbendingEngine()
      vi.mocked(engine.bendIn).mockReturnValue(bend.promise)
      act(() => result.current.registerEngine('a', engine))
      act(() => result.current.enter())
      await expect
        .poll(() => vi.mocked(engine.bendIn).mock.calls.length)
        .toBe(1)
      act(() => result.current.leave('merc'))
      await expect
        .poll(() => vi.mocked(engine.bendOut).mock.calls.length)
        .toBe(1)
      // The superseded entry finishing late must not land on the globe.
      act(() => bend.resolve())
      await expect.poll(() => result.current.phase).toBe('flat')
      await new Promise((r) => setTimeout(r, 300))
      expect(result.current.phase).toBe('flat')
    })

    it('turns an unbend back onto the globe', async () => {
      const result = await mode({ lon: 10, lat: 50, zoom: 7 })
      const unbend = deferred()
      const engine = unbendingEngine()
      vi.mocked(engine.bendOut).mockReturnValue(unbend.promise)
      act(() => result.current.registerEngine('a', engine))
      act(() => result.current.leave('merc'))
      await expect
        .poll(() => vi.mocked(engine.bendOut).mock.calls.length)
        .toBe(1)
      act(() => result.current.enter())
      await expect.poll(() => result.current.phase).toBe('globe')
      expect(vi.mocked(engine.bendIn).mock.calls[0][1]).toEqual({
        lon: 10,
        lat: 50,
        zoom: 7,
      })
      act(() => unbend.resolve())
      await new Promise((r) => setTimeout(r, 300))
      expect(result.current.phase).toBe('globe')
      expect(result.current.overlayVisible).toBe(true)
    })

    it('calls off an entry before anything shows', async () => {
      const result = await mode(null)
      // No engine yet: the entry is still waiting for one.
      act(() => result.current.enter())
      act(() => result.current.leave('merc'))
      expect(result.current.phase).toBe('flat')
      expect(result.current.overlayVisible).toBe(false)
      const engine = unbendingEngine()
      act(() => result.current.registerEngine('a', engine))
      await new Promise((r) => setTimeout(r, 100))
      expect(engine.bendIn).not.toHaveBeenCalled()
    })
  })
})
