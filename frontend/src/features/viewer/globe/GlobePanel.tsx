/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** One globe panel: its engine, chrome, readout, crosshair and loupe. */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapLoadingBar } from '../components/MapLoadingBar'
import { PinnedLegendsBar } from '../components/PinnedLegendsBar'
import { PointerReadoutBadge } from '../components/PointerReadoutBadge'
import { CompareSlotTag } from '../geo/CompareSlotTag'
import { LoupeOverlay } from '../geo/LoupeOverlay'
import { MapNavControls } from '../geo/MapNavControls'
import { NAV_CLEARANCE } from '../geo/map-nav'
import { PanelCorner, SlotStatusBadges } from '../geo/SlotStatusBadges'
import { GLOBE_ENGINE } from './engine-entry'
import { globeDecorationSpecs, globeLayerSpecs } from './globe-layer-specs'
import { createValueStore, useValue } from './value-store'
import type { ComponentProps } from 'react'
import type { PinnedLegendItem } from '../components/PinnedLegendsBar'
import type { PointerReadout } from '../hooks/usePointerReadout'
import type { CompareMapSource } from '../geo/types'
import type { GlobeBasemapSpec, GlobeEngine, ViewportDraw } from './engine'
import type { SharedGlobeCamera } from './globe-camera'
import type { ValueStore } from './value-store'
import { cn } from '@/lib/utils'

export type CrossPosition = { x: number; y: number } | null

const NO_CROSS = createValueStore<CrossPosition>(null)

export interface GlobeLoupe {
  sizePx: number
  zoom: number
  latched: boolean
  /** Side-by-side: mirror onto both panels. */
  mirror: boolean
}

export function GlobePanel({
  source,
  camera,
  active,
  live,
  basemap,
  loupe,
  pinnedLegends,
  onUnpinLegend,
  register,
  onFailure,
  onContextLost,
  onBasemapFailed,
  cross,
  mirrorLoupe,
  onZoom,
  onPan,
}: {
  source: CompareMapSource
  camera: SharedGlobeCamera
  active: boolean
  live: boolean
  basemap: GlobeBasemapSpec
  loupe: GlobeLoupe
  pinnedLegends: ReadonlyArray<PinnedLegendItem>
  onUnpinLegend: (key: string) => void
  register: (panel: string, engine: GlobeEngine | null) => void
  onFailure: (err: unknown) => void
  onContextLost: () => void
  onBasemapFailed: () => void
  /** Side-by-side: the shared crosshair; null in a single panel. */
  cross: ValueStore<CrossPosition> | null
  mirrorLoupe: boolean
  onZoom: (delta: number) => void
  onPan: (dx: number, dy: number) => void
}) {
  const { t } = useTranslation('visualise')
  const containerRef = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<GlobeEngine | null>(null)
  const [inFlight, setInFlight] = useState(0)
  const [errored, setErrored] = useState<ReadonlySet<string>>(() => new Set())
  const [pointer] = useState(() =>
    createValueStore<PointerReadout | null>(null),
  )
  const slot = source.slot

  // The native basemap is this panel's own server: expand it per source.
  const { decorationLayers, baseUrl, bboxAxisOrder, maxImageSize } = source
  const panelBasemap = useMemo<GlobeBasemapSpec>(
    () =>
      basemap.kind === 'wms'
        ? {
            ...basemap,
            layers: globeDecorationSpecs(
              { decorationLayers, baseUrl, slot, bboxAxisOrder, maxImageSize },
              basemap.opacity,
            ),
          }
        : basemap,
    [basemap, decorationLayers, baseUrl, slot, bboxAxisOrder, maxImageSize],
  )
  // Engine events read the latest props without remounting the engine.
  const latest = useRef({
    source,
    live,
    basemap: panelBasemap,
    onFailure,
    onContextLost,
    onBasemapFailed,
  })
  useLayoutEffect(() => {
    latest.current = {
      source,
      live,
      basemap: panelBasemap,
      onFailure,
      onContextLost,
      onBasemapFailed,
    }
  })
  const zBase = slot === 'a' ? 100 : 200

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let cancelled = false
    // Read via a function: TS keeps narrowing across the await.
    const isCancelled = () => cancelled
    let mounted: GlobeEngine | null = null
    GLOBE_ENGINE.load()
      .then(async (create) => {
        if (cancelled) return
        mounted = create()
        await mounted.mount(el, {
          onCameraChange: (cam) => camera.set(cam, slot),
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
          onBasemapFailed: () => latest.current.onBasemapFailed(),
        })
        if (isCancelled()) return
        mounted.setCamera(camera.get())
        mounted.setLive(latest.current.live)
        // Content before registering: the handoff's whenLoaded must see it.
        mounted.setLayers(globeLayerSpecs(latest.current.source, zBase))
        mounted.setBasemap(latest.current.basemap)
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
  }, [camera, register, slot, zBase])

  useEffect(() => {
    if (!engine) return
    // Moves made before this subscription (the warm camera) still count.
    engine.setCamera(camera.get())
    return camera.subscribe((cam, from, move) => {
      if (from !== slot) engine.setCamera(cam, move)
    })
  }, [engine, camera, slot])

  const specs = globeLayerSpecs(source, zBase)
  // Every commit: the engine diffs, so an unchanged stack costs nothing.
  useEffect(() => {
    engine?.setLayers(specs)
  })

  useEffect(() => {
    engine?.setBasemap(panelBasemap)
  }, [engine, panelBasemap])

  useEffect(() => {
    engine?.setLive(live)
  }, [engine, live])

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
    pointer.set(hit && { ...hit, x: hit.lon, y: hit.lat })
    cross?.set({ x: px[0] / rect.width, y: px[1] / rect.height })
  }
  const onPointerLeave = () => {
    pointer.set(null)
    cross?.set(null)
  }
  return (
    // Pointer tracking on the root: the loupe shield sits above the canvas.
    <div
      role="region"
      aria-label={t('globe.panel', { slot: slot.toUpperCase() })}
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
          <div
            className={cn(
              'pointer-events-none absolute top-2 left-2 z-10 flex',
              NAV_CLEARANCE,
            )}
          >
            <CompareSlotTag
              slot={slot}
              label={source.label}
              loading={loading}
              timeLabel={source.timeLabel}
              runLabel={source.runLabel}
              submittedAt={source.submittedAt}
            />
          </div>
          <PanelCorner side="left">
            <SlotStatusBadges source={source} erroredNames={erroredNames} />
          </PanelCorner>
          <MapNavControls onPan={onPan} onZoom={onZoom} />
          <MirroredLoupe
            containerRef={containerRef}
            store={mirrorLoupe ? cross : null}
            sizePx={loupe.sizePx}
            zoom={loupe.zoom}
            latched={loupe.latched}
            drawSource={drawLoupe}
          />
          <PinnedLegendsBar items={pinnedLegends} onUnpin={onUnpinLegend} />
          <GlobeReadout
            store={pointer}
            label={t('projections.short.globe')}
            crs={t('projections.globeCode')}
          />
          {cross && <Crosshair store={cross} />}
        </>
      )}
    </div>
  )
}

function GlobeReadout({
  store,
  label,
  crs,
}: {
  store: ValueStore<PointerReadout | null>
  label: string
  crs: string
}) {
  const pointer = useValue(store)
  return pointer ? (
    <PointerReadoutBadge
      pointer={pointer}
      label={label}
      crs={crs}
      metres={false}
    />
  ) : null
}

function Crosshair({ store }: { store: ValueStore<CrossPosition> }) {
  const cross = useValue(store)
  if (!cross) return null
  return (
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
  )
}

/** The loupe, mirrored from the other panel's pointer when `store` is set. */
function MirroredLoupe({
  store,
  ...props
}: { store: ValueStore<CrossPosition> | null } & Omit<
  ComponentProps<typeof LoupeOverlay>,
  'mirror'
>) {
  const mirror = useValue(store ?? NO_CROSS)
  return <LoupeOverlay mirror={mirror} {...props} />
}
