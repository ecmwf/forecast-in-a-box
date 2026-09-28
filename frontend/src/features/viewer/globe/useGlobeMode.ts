/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Flat ↔ globe handoff: flat → entering → globe → leaving → flat. */

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { AUTOFIT_KEY, createViewerView } from '../hooks/useOlMapBase'
import { getViewerProjection, viewerProjectionOf } from '../projections'
import {
  applyGlobeCamera,
  createSharedGlobeCamera,
  flatCameraOf,
  flatKindOf,
  globeFitZoom,
} from './globe-camera'
import type { RefObject } from 'react'
import type View from 'ol/View'
import type { FlatProjectionId } from '../projection-ids'
import type { CaptureResult } from '../geo/types'
import type { GlobeCamera, GlobeEngine } from './engine'
import type { SharedGlobeCamera } from './globe-camera'

export type GlobePhase = 'flat' | 'entering' | 'globe' | 'leaving'

/** The wrap; the engine flies to the wrap scale first. */
const MORPH_MS = 500
/** The unbend back to the flat map. */
const UNBEND_MS = 700
/** Longest hold of the flat end frame while the OL map under it renders. */
const FLAT_READY_CAP_MS = 2500
/** Globe overlay fade (CSS) — keep in step with GlobeView. */
export const GLOBE_FADE_MS = 200
const ENGINE_READY_CAP_MS = 10000
/** Longest wait for the flat map's pixels; without them the bend starts bare. */
const SEED_CAP_MS = 1000

const sleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms))

export interface GlobeMode {
  phase: GlobePhase
  /** Overlay opacity target (fades in once the morph starts). */
  overlayVisible: boolean
  camera: SharedGlobeCamera
  /** Globe panels register their engine (null on unmount). */
  registerEngine: (panel: string, engine: GlobeEngine | null) => void
  enter: () => void
  /** `instant` skips the morph (snap-back, context loss). */
  leave: (target: FlatProjectionId, instant?: boolean) => void
  /** Drop back to the flat map now (engine failure, lost context). */
  fail: () => void
}

export function useGlobeMode({
  viewRef,
  onFlatView,
  panelCount,
  reducedMotion,
  exitTarget,
  initialCamera,
  onFailure,
  captureFlat,
  whenFlatRendered,
}: {
  viewRef: RefObject<View>
  /** Adopt a new flat View (GeoViewer's view + projection state). */
  onFlatView: (view: View, id: FlatProjectionId) => void
  /** Globe panels the current layout mounts (1 or 2). */
  panelCount: number
  reducedMotion: boolean
  /** Flat projection to leave to. */
  exitTarget: FlatProjectionId
  /** Start on the globe (URL restore); null starts flat. */
  initialCamera: GlobeCamera | null
  /** Engines never came up while entering. */
  onFailure: (err: unknown) => void
  /** The flat map's pixels per slot: the bend starts from them. */
  captureFlat: () => Promise<ReadonlyArray<CaptureResult>>
  /** Resolves once the OL map under the overlay has rendered its layers. */
  whenFlatRendered: () => Promise<void>
}): GlobeMode {
  const [phase, setPhase] = useState<GlobePhase>(
    initialCamera ? 'globe' : 'flat',
  )
  const [overlayVisible, setOverlayVisible] = useState(initialCamera !== null)
  const phaseRef = useRef(phase)
  const [camera] = useState(() =>
    createSharedGlobeCamera(initialCamera ?? { lon: 10, lat: 30, zoom: 1 }),
  )
  const enginesRef = useRef(new Map<string, GlobeEngine>())
  const readyWaitersRef = useRef<Array<() => void>>([])
  const panelCountRef = useRef(panelCount)
  const runRef = useRef(0)

  const registerEngine = useCallback(
    (panel: string, engine: GlobeEngine | null) => {
      if (engine) {
        enginesRef.current.set(panel, engine)
        // Warm: rest the hidden globe where the bend will end, so its tiles load.
        if (phaseRef.current === 'flat') {
          const flat = flatCameraOf(viewRef.current, 'merc')
          const [w, h] = engine.size()
          if (flat)
            camera.set(
              { lon: flat.lon, lat: flat.lat, zoom: globeFitZoom(w, h) },
              'program',
              'warm',
            )
        }
      } else {
        enginesRef.current.delete(panel)
      }
      if (enginesRef.current.size >= panelCountRef.current) {
        for (const resolve of readyWaitersRef.current.splice(0)) resolve()
      }
    },
    [camera, viewRef],
  )

  const engines = useCallback(
    (): Promise<Array<GlobeEngine>> =>
      new Promise((resolve, reject) => {
        const done = () => resolve([...enginesRef.current.values()])
        if (enginesRef.current.size >= panelCountRef.current) return done()
        readyWaitersRef.current.push(done)
        window.setTimeout(
          () => reject(new Error('Globe engine did not start')),
          ENGINE_READY_CAP_MS,
        )
      }),
    [],
  )

  const settle = useCallback((next: GlobePhase) => setPhase(next), [])

  const onFlatViewRef = useRef(onFlatView)
  const onFailureRef = useRef(onFailure)
  const reducedRef = useRef(reducedMotion)
  const captureFlatRef = useRef(captureFlat)
  const whenFlatRenderedRef = useRef(whenFlatRendered)

  const enter = useCallback(() => {
    if (phaseRef.current !== 'flat') return
    const view = viewRef.current
    const flatId = viewerProjectionOf(view).id
    const start = flatCameraOf(view, flatId)
    if (!start) return
    const run = ++runRef.current
    phaseRef.current = 'entering'
    setPhase('entering')
    void (async () => {
      try {
        const from = start
        const list = await engines()
        if (run !== runRef.current) return
        const [w, h] = list[0].size()
        const target: GlobeCamera = {
          lon: from.lon,
          lat: Math.max(-85, Math.min(85, from.lat)),
          zoom: globeFitZoom(w, h),
        }
        const morph = flatKindOf(flatId) !== null && !reducedRef.current
        const captures = await Promise.race([
          captureFlatRef.current().catch(() => []),
          sleep(SEED_CAP_MS).then((): Array<CaptureResult> => []),
        ])
        if (run !== runRef.current) return
        camera.set(target, 'program', 'mode')
        setOverlayVisible(true)
        const panels = [...enginesRef.current]
        await Promise.all(
          panels.map(([panel, e]) => {
            // One capture and one panel pair up whatever the slot says.
            const capture =
              captures.length === 1 && panels.length === 1
                ? captures[0]
                : captures.find((c) => c.slot === panel)
            return e.morphIn(
              from,
              target,
              morph ? MORPH_MS : 0,
              capture ? { image: capture.canvas } : null,
            )
          }),
        )
        if (run !== runRef.current) return
        settle('globe')
      } catch (err) {
        if (run !== runRef.current) return
        setOverlayVisible(false)
        settle('flat')
        onFailureRef.current(err)
      }
    })()
  }, [viewRef, engines, camera, settle])

  const leave = useCallback(
    (target: FlatProjectionId, instant = false) => {
      if (phaseRef.current !== 'globe') return
      const run = ++runRef.current
      phaseRef.current = 'leaving'
      setPhase('leaving')
      const list = [...enginesRef.current.values()]
      const size = list[0]?.size() ?? [1024, 768]
      const projection = getViewerProjection(target)
      const next = createViewerView(projection)
      applyGlobeCamera(next, projection, camera.get(), size)
      next.set(AUTOFIT_KEY, true, true)
      // OL remounts underneath and loads during the unbend.
      onFlatViewRef.current(next, target)
      const flat = flatCameraOf(next, target)
      const morph =
        !instant &&
        flat !== null &&
        flatKindOf(target) !== null &&
        !reducedRef.current
      void (async () => {
        if (morph)
          await Promise.all(list.map((e) => e.morphOut(flat, UNBEND_MS)))
        if (run !== runRef.current) return
        // Hold the globe's flat end frame until the OL map under it has drawn.
        if (!instant)
          await Promise.race([
            whenFlatRenderedRef.current().catch(() => {}),
            sleep(FLAT_READY_CAP_MS),
          ])
        if (run !== runRef.current) return
        setOverlayVisible(false)
        await sleep(instant ? 0 : GLOBE_FADE_MS)
        if (run !== runRef.current) return
        settle('flat')
      })()
    },
    [camera, settle],
  )

  const leaveRef = useRef(leave)
  const exitTargetRef = useRef(exitTarget)
  // The transitions read the latest values; refs sync after every commit.
  useLayoutEffect(() => {
    phaseRef.current = phase
    panelCountRef.current = panelCount
    onFlatViewRef.current = onFlatView
    onFailureRef.current = onFailure
    reducedRef.current = reducedMotion
    captureFlatRef.current = captureFlat
    whenFlatRenderedRef.current = whenFlatRendered
    leaveRef.current = leave
    exitTargetRef.current = exitTarget
  })

  const fail = useCallback(() => {
    if (phaseRef.current === 'globe') {
      leaveRef.current(exitTargetRef.current, true)
      return
    }
    if (phaseRef.current !== 'entering') return
    runRef.current++
    phaseRef.current = 'flat'
    setOverlayVisible(false)
    settle('flat')
  }, [settle])

  return {
    phase,
    overlayVisible,
    camera,
    registerEngine,
    enter,
    leave,
    fail,
  }
}
