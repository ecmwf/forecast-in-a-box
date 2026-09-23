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

import { useCallback, useEffect, useRef, useState } from 'react'
import { AUTOFIT_KEY, createViewerView } from '../hooks/useOlMapBase'
import { getViewerProjection, viewerProjectionOf } from '../projections'
import {
  applyGlobeCamera,
  createSharedGlobeCamera,
  flatCameraOf,
  flatKindOf,
  globeExitZoom,
  globeFitZoom,
} from './globe-camera'
import type { RefObject } from 'react'
import type View from 'ol/View'
import type { FlatProjectionId } from '../projection-ids'
import type { GlobeCamera, GlobeEngine } from './engine'
import type { SharedGlobeCamera } from './globe-camera'

export type GlobePhase = 'flat' | 'entering' | 'globe' | 'leaving'

const MORPH_MS = 700
/** Globe overlay fade (CSS) — keep in step with GlobeView. */
export const GLOBE_FADE_MS = 200
/** Longest wait for first textures before bending anyway. */
const FIRST_LOAD_CAP_MS = 1500
const ENGINE_READY_CAP_MS = 10000
/** Quiet time after a transition before auto-enter may fire again. */
const AUTO_LOCKOUT_MS = 600

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
  /** Auto-enter may fire (not mid-transition, not just after one). */
  autoReady: () => boolean
}

export function useGlobeMode({
  viewRef,
  onFlatView,
  panelCount,
  reducedMotion,
  autoExit,
  exitTarget,
  initialCamera,
  onFailure,
}: {
  viewRef: RefObject<View>
  /** Adopt a new flat View (GeoViewer's view + projection state). */
  onFlatView: (view: View, id: FlatProjectionId) => void
  /** Globe panels the current layout mounts (1 or 2). */
  panelCount: number
  reducedMotion: boolean
  /** Zooming in past the flat-looking point leaves to `exitTarget`. */
  autoExit: boolean
  exitTarget: FlatProjectionId
  /** Start on the globe (URL restore); null starts flat. */
  initialCamera: GlobeCamera | null
  /** Engines never came up while entering. */
  onFailure: (err: unknown) => void
}): GlobeMode {
  const [phase, setPhase] = useState<GlobePhase>(
    initialCamera ? 'globe' : 'flat',
  )
  const [overlayVisible, setOverlayVisible] = useState(initialCamera !== null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const [camera] = useState(() =>
    createSharedGlobeCamera(initialCamera ?? { lon: 10, lat: 30, zoom: 1 }),
  )
  const enginesRef = useRef(new Map<string, GlobeEngine>())
  const readyWaitersRef = useRef<Array<() => void>>([])
  const panelCountRef = useRef(panelCount)
  panelCountRef.current = panelCount
  const lastSettledRef = useRef(0)
  const runRef = useRef(0)

  const registerEngine = useCallback(
    (panel: string, engine: GlobeEngine | null) => {
      if (engine) enginesRef.current.set(panel, engine)
      else enginesRef.current.delete(panel)
      if (enginesRef.current.size >= panelCountRef.current) {
        for (const resolve of readyWaitersRef.current.splice(0)) resolve()
      }
    },
    [],
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

  const settle = useCallback((next: GlobePhase) => {
    lastSettledRef.current = performance.now()
    setPhase(next)
  }, [])

  const onFlatViewRef = useRef(onFlatView)
  onFlatViewRef.current = onFlatView
  const onFailureRef = useRef(onFailure)
  onFailureRef.current = onFailure
  const reducedRef = useRef(reducedMotion)
  reducedRef.current = reducedMotion

  const enter = useCallback(() => {
    if (phaseRef.current !== 'flat') return
    const view = viewRef.current
    const flatId = viewerProjectionOf(view).id
    const from = flatCameraOf(view, flatId)
    if (!from) return
    const run = ++runRef.current
    phaseRef.current = 'entering'
    setPhase('entering')
    void (async () => {
      try {
        const list = await engines()
        if (run !== runRef.current) return
        const [w, h] = list[0].size()
        const target: GlobeCamera = {
          lon: from.lon,
          lat: Math.max(-85, Math.min(85, from.lat)),
          zoom: globeFitZoom(w, h),
        }
        camera.set(target, 'program', 'mode')
        await Promise.race([
          Promise.all(list.map((e) => e.whenLoaded())),
          sleep(FIRST_LOAD_CAP_MS),
        ])
        if (run !== runRef.current) return
        setOverlayVisible(true)
        const morph = flatKindOf(flatId) !== null && !reducedRef.current
        await Promise.all(
          list.map((e) => e.morphIn(from, target, morph ? MORPH_MS : 0)),
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
          await Promise.all(list.map((e) => e.morphOut(flat, MORPH_MS)))
        if (run !== runRef.current) return
        setOverlayVisible(false)
        await sleep(instant ? 0 : GLOBE_FADE_MS)
        if (run !== runRef.current) return
        settle('flat')
      })()
    },
    [camera, settle],
  )

  // Auto exit: zoomed in until the surface reads as flat.
  const leaveRef = useRef(leave)
  leaveRef.current = leave
  const exitTargetRef = useRef(exitTarget)
  exitTargetRef.current = exitTarget
  useEffect(() => {
    if (!autoExit) return
    return camera.subscribe((cam, origin) => {
      if (origin !== 'user' || phaseRef.current !== 'globe') return
      const engine = enginesRef.current.values().next().value
      if (!engine) return
      const [w, h] = engine.size()
      if (cam.zoom >= globeExitZoom(w, h))
        leaveRef.current(exitTargetRef.current)
    })
  }, [autoExit, camera])

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

  const autoReady = useCallback(
    () =>
      phaseRef.current === 'flat' &&
      performance.now() - lastSettledRef.current > AUTO_LOCKOUT_MS,
    [],
  )

  return {
    phase,
    overlayVisible,
    camera,
    registerEngine,
    enter,
    leave,
    fail,
    autoReady,
  }
}
