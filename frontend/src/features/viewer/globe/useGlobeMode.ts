/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Flat <-> globe handoff: flat -> entering -> globe -> leaving -> flat; either bend reverses mid-flight. */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { AUTOFIT_KEY, createViewerView } from '../hooks/useOlMapBase'
import { getViewerProjection, viewerProjectionOf } from '../projections'
import {
  applyGlobeCamera,
  clampCameraLat,
  createSharedGlobeCamera,
  flatCameraOf,
  flatKindOf,
  globeEntryCamera,
  globeFitZoom,
} from './globe-camera'
import { GLOBE_ENGINE } from './engine-entry'
import type { RefObject } from 'react'
import type View from 'ol/View'
import type { FlatProjectionId } from '../projection-ids'
import type { CaptureResult } from '../geo/types'
import type { GlobeCamera, GlobeEngine } from './engine'
import type { SharedGlobeCamera } from './globe-camera'
import { createLogger } from '@/lib/logger'

const log = createLogger('globe')

export type GlobePhase = 'flat' | 'entering' | 'globe' | 'leaving'

/** The bend onto the globe. */
const MORPH_MS = 500
/** The unbend back to the flat map. */
const UNBEND_MS = 700
/** Longest hold of the flat end frame while the OL map under it renders. */
const FLAT_READY_CAP_MS = 2500
/** The overlay's opacity fade; GlobeView's CSS transition takes it too. */
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
  /** The panels' size in CSS px (they share one); null before one mounts. */
  panelSize: () => readonly [number, number] | null
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
  /** Resolves once the OL maps on `view` have rendered their layers. */
  whenFlatRendered: (view: View) => Promise<void>
}): GlobeMode {
  const [phase, setPhase] = useState<GlobePhase>(
    initialCamera ? 'globe' : 'flat',
  )
  const [overlayVisible, setOverlayVisible] = useState(initialCamera !== null)
  const overlayShownRef = useRef(initialCamera !== null)
  const show = useCallback((visible: boolean) => {
    overlayShownRef.current = visible
    setOverlayVisible(visible)
  }, [])
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
          const [w, h] = engine.size()
          const target = globeEntryCamera(
            viewRef.current,
            w,
            h,
            GLOBE_ENGINE.maxZoom,
          )
          if (target) camera.set(target, 'warm')
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
        if (enginesRef.current.size >= panelCountRef.current)
          return resolve([...enginesRef.current.values()])
        const timer = window.setTimeout(() => {
          const waiters = readyWaitersRef.current
          waiters.splice(waiters.indexOf(done), 1)
          reject(new Error('Globe engine did not start'))
        }, ENGINE_READY_CAP_MS)
        function done() {
          window.clearTimeout(timer)
          resolve([...enginesRef.current.values()])
        }
        readyWaitersRef.current.push(done)
      }),
    [],
  )

  const settle = useCallback((next: GlobePhase) => setPhase(next), [])
  // Runs still in flight when the viewer goes away must not report into it.
  useEffect(
    () => () => {
      runRef.current++
    },
    [],
  )

  const onFlatViewRef = useRef(onFlatView)
  const onFailureRef = useRef(onFailure)
  const reducedRef = useRef(reducedMotion)
  const captureFlatRef = useRef(captureFlat)
  const whenFlatRenderedRef = useRef(whenFlatRendered)

  /** Back onto the globe from an unbend in flight, or its hold. */
  const reenter = useCallback(() => {
    const run = ++runRef.current
    phaseRef.current = 'entering'
    setPhase('entering')
    show(true)
    const view = viewRef.current
    const from = flatCameraOf(view, viewerProjectionOf(view).id)
    const list = [...enginesRef.current.values()]
    const ms = reducedRef.current ? 0 : MORPH_MS
    void (async () => {
      if (from)
        await Promise.all(
          list.map((e) => e.morphIn(from, camera.get(), ms, null)),
        )
      if (run !== runRef.current) return
      settle('globe')
    })()
  }, [viewRef, camera, settle, show])

  const enter = useCallback(() => {
    if (phaseRef.current === 'leaving') return reenter()
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
        // The flat map's own scale; only a whole-world view grows to the fit.
        const target: GlobeCamera = globeEntryCamera(
          view,
          w,
          h,
          GLOBE_ENGINE.maxZoom,
        ) ?? {
          lon: from.lon,
          lat: clampCameraLat(from.lat),
          zoom: globeFitZoom(w, h),
        }
        const morph = flatKindOf(flatId) !== null && !reducedRef.current
        const captures = await Promise.race([
          captureFlatRef.current().catch((err: unknown) => {
            log.warn('Flat map capture failed; bending without its pixels', err)
            return []
          }),
          sleep(SEED_CAP_MS).then((): Array<CaptureResult> => []),
        ])
        if (run !== runRef.current) return
        camera.set(target, 'mode')
        show(true)
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
        show(false)
        settle('flat')
        onFailureRef.current(err)
      }
    })()
  }, [viewRef, engines, camera, settle, show, reenter])

  const leave = useCallback(
    (target: FlatProjectionId, instant = false) => {
      const current = phaseRef.current
      if (current !== 'globe' && current !== 'entering') return
      const run = ++runRef.current
      // Nothing shown yet: just call the entry off.
      if (current === 'entering' && !overlayShownRef.current) {
        phaseRef.current = 'flat'
        settle('flat')
        return
      }
      phaseRef.current = 'leaving'
      setPhase('leaving')
      const list = [...enginesRef.current.values()]
      const size = list[0]?.size() ?? [1024, 768]
      // Mid-entry the flat map still under the globe is the one to return to.
      let next = viewRef.current
      if (current !== 'entering' || viewerProjectionOf(next).id !== target) {
        const projection = getViewerProjection(target)
        next = createViewerView(projection)
        applyGlobeCamera(next, projection, camera.get(), size)
        next.set(AUTOFIT_KEY, true, true)
        // OL remounts underneath and loads during the unbend.
        onFlatViewRef.current(next, target)
      }
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
            whenFlatRenderedRef
              .current(next)
              .catch((err: unknown) =>
                log.warn('Waiting for the flat map failed', err),
              ),
            sleep(FLAT_READY_CAP_MS),
          ])
        if (run !== runRef.current) return
        show(false)
        await sleep(instant ? 0 : GLOBE_FADE_MS)
        if (run !== runRef.current) return
        settle('flat')
      })()
    },
    [viewRef, camera, settle, show],
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
    show(false)
    settle('flat')
  }, [settle, show])

  const panelSize = useCallback(
    () => enginesRef.current.values().next().value?.size() ?? null,
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
    panelSize,
  }
}
