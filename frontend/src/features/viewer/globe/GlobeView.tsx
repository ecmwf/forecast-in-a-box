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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapLoadingBar } from '../components/MapLoadingBar'
import { PinnedLegendsBar } from '../components/PinnedLegendsBar'
import { PointerReadoutBadge } from '../components/PointerReadoutBadge'
import { CompareSlotTag } from '../geo/CompareSlotTag'
import { LoadErrorBadge, erroredTitles } from '../geo/SingleMapView'
import { LoupeOverlay } from '../geo/LoupeOverlay'
import { globeCameraForBbox, globeFitZoom } from './globe-camera'
import { globeLayerSpecs } from './globe-layer-specs'
import type { PinnedLegendItem } from '../components/PinnedLegendsBar'
import type { PointerReadout } from '../hooks/usePointerReadout'
import type {
  CaptureResult,
  CompareMapSource,
  FitBboxAction,
} from '../geo/types'
import type { GlobeBasemapSpec, GlobeEngine, ViewportDraw } from './engine'
import type { GlobeEngineEntry } from './engines/registry'
import type { SharedGlobeCamera } from './globe-camera'

type CrossPosition = { x: number; y: number } | null

export interface GlobeLoupe {
  sizePx: number
  zoom: number
  latched: boolean
  /** Side-by-side: mirror onto both panels. */
  mirror: boolean
}

export interface GlobeViewProps {
  /** Renderer; a change remounts the panels. */
  engine: GlobeEngineEntry
  layout: 'single' | 'side'
  /** One source per panel. */
  sources: ReadonlyArray<CompareMapSource>
  camera: SharedGlobeCamera
  /** Overlay opacity target (the handoff fades it). */
  visible: boolean
  /** Settled on the globe: show chrome, own fit/capture. */
  active: boolean
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
  onRegisterCapture: (
    capture: (() => Promise<Array<CaptureResult>>) | null,
  ) => void
}

export function GlobeView({
  engine: entry,
  layout,
  sources,
  camera,
  visible,
  active,
  basemap,
  loupe,
  pinnedLegends,
  onUnpinLegend,
  registerEngine,
  onFailure,
  onContextLost,
  onRegisterFit,
  onRegisterFitBbox,
  onRegisterCapture,
}: GlobeViewProps) {
  const enginesRef = useRef(new Map<string, GlobeEngine>())
  const [cross, setCross] = useState<CrossPosition>(null)
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
      camera.set(
        globeCameraForBbox(bbox, w, h, entry.capabilities.maxZoom),
        'program',
        'fit',
      )
    },
    [camera, entry],
  )
  const bbox = sources[0]?.bbox ?? null
  useEffect(() => {
    if (!active) return
    onRegisterFit(() => {
      const engine = firstEngine()
      if (!engine) return
      if (bbox) return fitBbox(bbox)
      const [w, h] = engine.size()
      camera.set(
        { ...camera.get(), zoom: globeFitZoom(w, h) },
        'program',
        'fit',
      )
    })
    onRegisterFitBbox(fitBbox)
    return () => {
      onRegisterFit(null)
      onRegisterFitBbox(null)
    }
  }, [active, bbox, camera, fitBbox, onRegisterFit, onRegisterFitBbox])

  const side = layout === 'side'
  const captureMeta = sources.map((s) => ({
    slot: s.slot,
    label: side ? `${s.slot.toUpperCase()} · ${s.label}` : s.label,
    timeLabel: s.timeLabel,
  }))
  const captureKey = JSON.stringify(captureMeta)
  useEffect(() => {
    if (!active) return
    const meta: typeof captureMeta = JSON.parse(captureKey)
    onRegisterCapture(() =>
      Promise.resolve(
        meta.flatMap((m) => {
          const engine = enginesRef.current.get(m.slot)
          return engine ? [{ ...m, canvas: engine.capture() }] : []
        }),
      ),
    )
    return () => onRegisterCapture(null)
  }, [active, captureKey, onRegisterCapture])

  const panels = sources.map((source) => (
    <GlobePanel
      key={source.slot}
      engine={entry}
      source={source}
      camera={camera}
      active={active}
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
      loupeMirror={side && loupe.mirror ? cross : null}
      onCross={side ? setCross : undefined}
    />
  ))

  return (
    <div
      data-testid="globe-view"
      className="absolute inset-0 z-30 bg-background transition-opacity duration-200 motion-reduce:transition-none"
      style={{ opacity: visible ? 1 : 0 }}
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

function GlobePanel({
  engine: entry,
  source,
  camera,
  active,
  basemap,
  loupe,
  pinnedLegends,
  onUnpinLegend,
  register,
  onFailure,
  onContextLost,
  cross,
  loupeMirror,
  onCross,
}: {
  engine: GlobeEngineEntry
  source: CompareMapSource
  camera: SharedGlobeCamera
  active: boolean
  basemap: GlobeBasemapSpec
  loupe: GlobeLoupe
  pinnedLegends: ReadonlyArray<PinnedLegendItem>
  onUnpinLegend: (key: string) => void
  register: (panel: string, engine: GlobeEngine | null) => void
  onFailure: (err: unknown) => void
  onContextLost: () => void
  cross: CrossPosition
  loupeMirror: CrossPosition
  onCross?: (position: CrossPosition) => void
}) {
  const { t } = useTranslation('visualise')
  const containerRef = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<GlobeEngine | null>(null)
  const [inFlight, setInFlight] = useState(0)
  const [errored, setErrored] = useState<ReadonlySet<string>>(new Set())
  const [pointer, setPointer] = useState<PointerReadout | null>(null)
  const slot = source.slot

  // Engine events read the latest props without remounting the engine.
  const latest = useRef({ source, onFailure, onContextLost })
  latest.current = { source, onFailure, onContextLost }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let cancelled = false
    // Read via a function: TS keeps narrowing across the await.
    const isCancelled = () => cancelled
    let mounted: GlobeEngine | null = null
    entry
      .load()
      .then(async (create) => {
        if (cancelled) return
        mounted = create()
        await mounted.mount(el, {
          onCameraChange: (cam, origin) => camera.set(cam, origin, slot),
          onLayerLoad: (key, time, ok) => {
            const name = key.slice(key.indexOf(':') + 1)
            latest.current.source.onLoadResult?.(name, time, ok)
            setErrored((prev) => {
              if (prev.has(name) !== ok) return prev
              const next = new Set(prev)
              if (ok) next.delete(name)
              else next.add(name)
              return next
            })
          },
          onLoadingChange: setInFlight,
          onContextLost: () => latest.current.onContextLost(),
        })
        if (isCancelled()) return
        mounted.setCamera(camera.get())
        setEngine(mounted)
        register(slot, mounted)
      })
      .catch((err: unknown) => {
        if (!cancelled) latest.current.onFailure(err)
      })
    return () => {
      cancelled = true
      register(slot, null)
      mounted?.destroy()
    }
  }, [entry, camera, register, slot])

  useEffect(() => {
    if (!engine) return
    return camera.subscribe((cam, _origin, from) => {
      if (from !== slot) engine.setCamera(cam)
    })
  }, [engine, camera, slot])

  const zBase = slot === 'a' ? 100 : 200
  const specs = globeLayerSpecs(source, zBase)
  const specsKey = JSON.stringify(specs)
  useEffect(() => {
    engine?.setLayers(JSON.parse(specsKey))
  }, [engine, specsKey])

  useEffect(() => {
    engine?.setBasemap(basemap)
  }, [engine, basemap])

  const drawLoupe = useMemo(
    () =>
      engine
        ? (ctx: CanvasRenderingContext2D, opts: ViewportDraw) =>
            engine.drawViewport(ctx, opts)
        : undefined,
    [engine],
  )

  const erroredNames = useMemo(
    () => source.activeOrder.filter((name) => errored.has(name)),
    [source.activeOrder, errored],
  )
  const loading = inFlight > 0 || source.layersLoading

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px: [number, number] = [e.clientX - rect.left, e.clientY - rect.top]
    const hit = engine?.pick(px) ?? null
    setPointer(hit && { ...hit, x: hit.lon, y: hit.lat })
    onCross?.({ x: px[0] / rect.width, y: px[1] / rect.height })
  }
  const onPointerLeave = () => {
    setPointer(null)
    onCross?.(null)
  }

  return (
    // Pointer tracking on the root: the loupe shield sits above the canvas.
    <div
      className="relative h-full min-h-0 overflow-hidden rounded-md border border-border bg-muted/20"
      data-globe-panel={slot}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <div
        ref={containerRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
      />
      {active && (
        <>
          <MapLoadingBar loading={loading} slot={slot} />
          <div className="pointer-events-none absolute top-2 right-2 left-2 z-10 flex">
            <CompareSlotTag
              slot={slot}
              label={source.label}
              loading={loading}
              timeLabel={source.timeLabel}
              runLabel={source.runLabel}
              submittedAt={source.submittedAt}
            />
          </div>
          {source.hiddenAtTime && (
            <div className="absolute top-10 left-2 z-10 rounded-md border border-amber-500/40 bg-amber-50/95 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
              {t('timeline.gap', { slot: slot.toUpperCase() })}
            </div>
          )}
          {erroredNames.length > 0 && !source.hiddenAtTime && (
            <LoadErrorBadge
              slot={slot.toUpperCase()}
              side="left"
              layers={erroredTitles(erroredNames, source.layers)}
            />
          )}
          {source.timeTag && (
            <div className="absolute top-10 left-2 z-10 rounded-md border border-border bg-background/90 px-2 py-1 font-mono text-xs font-medium shadow-sm backdrop-blur-sm">
              {t('timeline.offsetBadge', {
                slot: slot.toUpperCase(),
                tag: source.timeTag,
              })}
            </div>
          )}
          <LoupeOverlay
            containerRef={containerRef}
            mirror={loupeMirror}
            sizePx={loupe.sizePx}
            zoom={loupe.zoom}
            latched={loupe.latched}
            drawSource={drawLoupe}
          />
          <PinnedLegendsBar items={pinnedLegends} onUnpin={onUnpinLegend} />
          {pointer && (
            <PointerReadoutBadge
              pointer={pointer}
              crs={t('projections.globe')}
              metres={false}
            />
          )}
          {cross && (
            <>
              <div
                className="pointer-events-none absolute inset-y-0 z-10 w-px bg-foreground/40"
                style={{ left: `${cross.x * 100}%` }}
              />
              <div
                className="pointer-events-none absolute inset-x-0 z-10 h-px bg-foreground/40"
                style={{ top: `${cross.y * 100}%` }}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
