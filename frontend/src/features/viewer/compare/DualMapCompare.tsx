/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Side-by-side comparison: two OpenLayers maps sharing ONE View instance,
 * which is all OL needs to sync pan/zoom/rotation natively. Layers and
 * basemaps cannot be shared across maps, so each panel owns its own. A
 * DOM crosshair mirrors the cursor position across both panels.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOlMapBase } from '../hooks/useOlMapBase'
import { useBasemap } from '../hooks/useBasemap'
import { useWmsLayerStack } from '../hooks/useWmsLayerStack'
import { useMeasure } from '../hooks/useMeasure'
import { useContextOverlays } from './overlays'
import type { ContextOverlay } from './overlays'
import type { MeasureMode } from '../hooks/useMeasure'
import { CompareSlotTag } from './CompareSlotTag'
import { LoupeOverlay } from './LoupeOverlay'
import type View from 'ol/View'
import type { CaptureResult, CompareMapSource } from './types'

const noop = () => {}

/** Cursor position as container fractions, mirrored across panels. */
type CrossPosition = { x: number; y: number } | null

export function DualMapCompare({
  view,
  a,
  b,
  basemapId,
  measureMode,
  measureClearNonce,
  overlays,
  onRegisterFit,
  onRegisterCapture,
}: {
  view: View
  a: CompareMapSource
  b: CompareMapSource
  basemapId: string
  measureMode: MeasureMode
  measureClearNonce: number
  overlays: ReadonlyArray<ContextOverlay>
  /** Register this component's fit-to-bbox action with the toolbar. */
  onRegisterFit: (fit: (() => void) | null) => void
  onRegisterCapture: (
    capture: (() => Promise<Array<CaptureResult>>) | null,
  ) => void
}) {
  const [cross, setCross] = useState<CrossPosition>(null)
  const fitsRef = useRef<Map<string, () => void>>(new Map())
  const capturesRef = useRef<Map<string, () => Promise<CaptureResult | null>>>(
    new Map(),
  )

  useEffect(() => {
    onRegisterCapture(async () => {
      const results = await Promise.all(
        [...capturesRef.current.values()].map((capture) => capture()),
      )
      return results.filter((r): r is CaptureResult => r !== null)
    })
    return () => onRegisterCapture(null)
  }, [onRegisterCapture])

  const registerCapture = useCallback(
    (slot: string, capture: (() => Promise<CaptureResult | null>) | null) => {
      if (capture) capturesRef.current.set(slot, capture)
      else capturesRef.current.delete(slot)
    },
    [],
  )

  const registerFit = useCallback(
    (slot: string, fit: (() => void) | null) => {
      if (fit) fitsRef.current.set(slot, fit)
      else fitsRef.current.delete(slot)
      onRegisterFit(
        fitsRef.current.size > 0
          ? () => fitsRef.current.forEach((f) => f())
          : null,
      )
    },
    [onRegisterFit],
  )

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-2 sm:grid-cols-2">
      <DualMapPanel
        source={a}
        view={view}
        cross={cross}
        onCross={setCross}
        basemapId={basemapId}
        measureMode={measureMode}
        measureClearNonce={measureClearNonce}
        overlays={overlays}
        onRegisterFit={registerFit}
        onRegisterCapture={registerCapture}
      />
      <DualMapPanel
        source={b}
        view={view}
        cross={cross}
        onCross={setCross}
        basemapId={basemapId}
        measureMode={measureMode}
        measureClearNonce={measureClearNonce}
        overlays={overlays}
        onRegisterFit={registerFit}
        onRegisterCapture={registerCapture}
      />
    </div>
  )
}

function DualMapPanel({
  source,
  view,
  cross,
  onCross,
  basemapId,
  measureMode,
  measureClearNonce,
  overlays,
  onRegisterFit,
  onRegisterCapture,
}: {
  source: CompareMapSource
  view: View
  cross: CrossPosition
  onCross: (pos: CrossPosition) => void
  basemapId: string
  measureMode: MeasureMode
  measureClearNonce: number
  overlays: ReadonlyArray<ContextOverlay>
  onRegisterFit: (slot: string, fit: (() => void) | null) => void
  onRegisterCapture: (
    slot: string,
    capture: (() => Promise<CaptureResult | null>) | null,
  ) => void
}) {
  const { t } = useTranslation('compare')
  const containerRef = useRef<HTMLDivElement>(null)
  const [loadingCount, setLoadingCount] = useState(0)
  const incLoading = useCallback(() => setLoadingCount((c) => c + 1), [])
  const decLoading = useCallback(
    () => setLoadingCount((c) => Math.max(0, c - 1)),
    [],
  )
  const { mapRef, basemapLayerRef, tryFit, setFitBbox } = useOlMapBase(
    containerRef,
    {
      view,
      resetKey: `${source.slot}:${source.baseUrl}`,
      incLoading: noop,
      decLoading: noop,
    },
  )
  useBasemap({
    mapRef,
    basemapLayerRef,
    baseUrl: source.baseUrl,
    decorationLayers: source.decorationLayers,
    basemapId,
    incLoading,
    decLoading,
  })
  useWmsLayerStack(mapRef, source.baseUrl, source.layers, {
    zBase: 100,
    masterOpacity: source.hiddenAtTime ? 0 : source.masterOpacity,
    activeOrder: source.activeOrder,
    layerOpacities: source.layerOpacities,
    resolveTime: source.resolveTime,
    incLoading,
    decLoading,
  })

  useMeasure(mapRef, measureMode, measureClearNonce)
  useContextOverlays(mapRef, overlays)

  useEffect(() => {
    setFitBbox(source.bbox)
  }, [source.bbox, setFitBbox])

  useEffect(() => {
    onRegisterFit(source.slot, () => tryFit(true))
    return () => onRegisterFit(source.slot, null)
  }, [source.slot, tryFit, onRegisterFit])

  useEffect(() => {
    onRegisterCapture(source.slot, () => {
      const map = mapRef.current
      if (!map) return Promise.resolve(null)
      return new Promise((resolve) => {
        map.once('rendercomplete', () => {
          const canvas = map
            .getTargetElement()
            .querySelector<HTMLCanvasElement>('canvas')
          resolve(
            canvas
              ? {
                  label: `${source.slot.toUpperCase()} · ${source.label}`,
                  dataUrl: canvas.toDataURL('image/png'),
                }
              : null,
          )
        })
        map.renderSync()
      })
    })
    return () => onRegisterCapture(source.slot, null)
  }, [source.slot, source.label, mapRef, onRegisterCapture])

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    onCross({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    })
  }

  return (
    <div
      className="relative min-h-0 overflow-hidden rounded-md border border-border bg-muted/20"
      onPointerMove={onPointerMove}
      onPointerLeave={() => onCross(null)}
    >
      <div ref={containerRef} className="absolute inset-0" />
      <LoupeOverlay containerRef={containerRef} />
      <CompareSlotTag
        slot={source.slot}
        label={source.label}
        loading={loadingCount > 0}
        timeLabel={source.timeLabel}
      />
      {source.hiddenAtTime && (
        <div className="absolute top-10 left-2 z-10 rounded-md border border-amber-500/40 bg-amber-50/95 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
          {t('timeline.gap', { slot: source.slot.toUpperCase() })}
        </div>
      )}
      {source.timeTag && (
        <div className="absolute top-10 left-2 z-10 rounded-md border border-border bg-background/90 px-2 py-1 font-mono text-xs font-medium shadow-sm backdrop-blur-sm">
          {t('timeline.offsetBadge', {
            slot: source.slot.toUpperCase(),
            tag: source.timeTag,
          })}
        </div>
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
    </div>
  )
}
