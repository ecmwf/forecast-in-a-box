/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Globe panels (one per shown source, one shared camera) overlaying the OL maps. */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { navEaseMs } from '../geo/map-nav'
import { isWorldBbox } from '../wms-capabilities'
import { GLOBE_ENGINE } from './engine-entry'
import {
  globeCameraForBbox,
  globeFitZoom,
  panGlobeCamera,
} from './globe-camera'
import { GLOBE_FADE_MS } from './useGlobeMode'
import { GlobePanel } from './GlobePanel'
import { createValueStore } from './value-store'
import type { PinnedLegendItem } from '../components/PinnedLegendsBar'
import type {
  CaptureResult,
  CompareMapSource,
  FitBboxAction,
} from '../geo/types'
import type { GlobeBasemapSpec, GlobeEngine } from './engine'
import type { SharedGlobeCamera } from './globe-camera'
import type { CrossPosition, GlobeLoupe } from './GlobePanel'
import { cn } from '@/lib/utils'

export interface GlobeViewProps {
  layout: 'single' | 'side'
  /** One source per panel. */
  sources: ReadonlyArray<CompareMapSource>
  camera: SharedGlobeCamera
  /** Overlay opacity target (the handoff fades it). */
  visible: boolean
  /** Settled on the globe: show chrome, own fit/capture. */
  active: boolean
  /** Entering, on or leaving the globe; a warm, hidden one fetches no data. */
  live: boolean
  basemap: GlobeBasemapSpec
  /** Hold-Z magnifier settings (toolbar). */
  loupe: GlobeLoupe
  pinnedLegends: ReadonlyArray<PinnedLegendItem & { slot?: string }>
  onUnpinLegend: (key: string) => void
  registerEngine: (panel: string, engine: GlobeEngine | null) => void
  onFailure: (err: unknown) => void
  onContextLost: () => void
  onRegisterFit: (fit: (() => void) | null) => void
  onRegisterFitBbox: (fit: FitBboxAction | null) => void
  /** The nav buttons' zoom step. */
  onZoom: (delta: number) => void
  onRegisterCapture: (
    capture: (() => Promise<Array<CaptureResult>>) | null,
  ) => void
}

export function GlobeView({
  layout,
  sources,
  camera,
  visible,
  active,
  live,
  basemap,
  loupe,
  pinnedLegends,
  onUnpinLegend,
  registerEngine,
  onFailure,
  onContextLost,
  onRegisterFit,
  onRegisterFitBbox,
  onZoom,
  onRegisterCapture,
}: GlobeViewProps) {
  const enginesRef = useRef(new Map<string, GlobeEngine>())
  // Pointer moves write here, not React state: only the crosshairs re-render.
  const [cross] = useState(() => createValueStore<CrossPosition>(null))
  const register = useCallback(
    (panel: string, engine: GlobeEngine | null) => {
      if (engine) enginesRef.current.set(panel, engine)
      else enginesRef.current.delete(panel)
      registerEngine(panel, engine)
    },
    [registerEngine],
  )

  const firstEngine = () => enginesRef.current.values().next().value
  const fitBbox = useCallback(
    (bbox: [number, number, number, number]) => {
      const engine = firstEngine()
      if (!engine) return
      const [w, h] = engine.size()
      camera.set(globeCameraForBbox(bbox, w, h, GLOBE_ENGINE.maxZoom), 'fit')
    },
    [camera],
  )
  const bbox = sources[0]?.bbox ?? null
  useEffect(() => {
    if (!active) return
    onRegisterFit(() => {
      const engine = firstEngine()
      if (!engine) return
      // Regional layers turn the globe to them; a world extent only resets the zoom.
      if (bbox && !isWorldBbox(bbox)) return fitBbox(bbox)
      const [w, h] = engine.size()
      camera.set({ ...camera.get(), zoom: globeFitZoom(w, h) }, 'fit')
    })
    onRegisterFitBbox(fitBbox)
    return () => {
      onRegisterFit(null)
      onRegisterFitBbox(null)
    }
  }, [active, bbox, camera, fitBbox, onRegisterFit, onRegisterFitBbox])

  const panBy = useCallback(
    (dx: number, dy: number) =>
      camera.set(panGlobeCamera(camera.get(), -dx, -dy), 'controls', {
        easeMs: navEaseMs(),
      }),
    [camera],
  )
  const side = layout === 'side'
  const captureMeta = sources.map((s) => ({
    slot: s.slot,
    label: side ? `${s.slot.toUpperCase()} · ${s.label}` : s.label,
    timeLabel: s.timeLabel,
  }))
  const captureMetaRef = useRef(captureMeta)
  useLayoutEffect(() => {
    captureMetaRef.current = captureMeta
  })
  useEffect(() => {
    if (!active) return
    onRegisterCapture(async () => {
      // The shown instant's images, as the flat maps wait for rendercomplete.
      await Promise.all(
        [...enginesRef.current.values()].map((e) => e.whenLoaded()),
      )
      return captureMetaRef.current.flatMap((m) => {
        const engine = enginesRef.current.get(m.slot)
        return engine ? [{ ...m, canvas: engine.capture() }] : []
      })
    })
    return () => onRegisterCapture(null)
  }, [active, onRegisterCapture])

  const panels = sources.map((source) => (
    <GlobePanel
      key={source.slot}
      source={source}
      camera={camera}
      active={active}
      live={live}
      basemap={basemap}
      loupe={loupe}
      pinnedLegends={pinnedLegends.filter(
        (item) => !side || item.slot === source.slot,
      )}
      onUnpinLegend={onUnpinLegend}
      register={register}
      onFailure={onFailure}
      onContextLost={onContextLost}
      cross={side ? cross : null}
      mirrorLoupe={side && loupe.mirror}
      onZoom={onZoom}
      onPan={panBy}
    />
  ))

  return (
    <div
      data-testid="globe-view"
      className={cn(
        'absolute inset-0 z-30 bg-background transition-opacity motion-reduce:transition-none',
        // Handoffs send input to the real map underneath.
        (!visible || !active) && 'pointer-events-none',
      )}
      style={{
        opacity: visible ? 1 : 0,
        transitionDuration: `${GLOBE_FADE_MS}ms`,
      }}
      // Hidden (warm, or faded out): out of the tab order and the a11y tree.
      inert={!visible}
    >
      {side ? (
        <div className="@container h-full min-h-0">
          <div className="grid h-full min-h-0 grid-cols-1 gap-2 @3xl:grid-cols-2">
            {panels}
          </div>
        </div>
      ) : (
        panels
      )}
    </div>
  )
}
