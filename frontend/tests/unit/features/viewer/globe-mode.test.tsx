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
import type { GlobeEngine } from '@/features/viewer/globe/engine'
import { globeCameraOf } from '@/features/viewer/globe/globe-camera'
import { createViewerView } from '@/features/viewer/hooks/useOlMapBase'
import { getViewerProjection } from '@/features/viewer/projections'
import { useGlobeMode } from '@/features/viewer/globe/useGlobeMode'

/** Just enough engine for the handoff: bends and unbends at once. */
const unbendingEngine = () =>
  ({
    size: () => [800, 600],
    morphIn: vi.fn(() => Promise.resolve()),
    morphOut: vi.fn(() => Promise.resolve()),
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
    await expect.poll(() => vi.mocked(engine.morphIn).mock.calls.length).toBe(1)
    const [, to] = vi.mocked(engine.morphIn).mock.calls[0]
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
    await expect
      .poll(() => vi.mocked(engine.morphOut).mock.calls.length)
      .toBe(1)
    // Unbent, but the flat map is still loading: the globe's frame stays up.
    await new Promise((r) => setTimeout(r, 300))
    expect(result.current.phase).toBe('leaving')
    expect(result.current.overlayVisible).toBe(true)

    act(() => rendered())
    await expect.poll(() => result.current.overlayVisible).toBe(false)
    await expect.poll(() => result.current.phase).toBe('flat')
  })
})
