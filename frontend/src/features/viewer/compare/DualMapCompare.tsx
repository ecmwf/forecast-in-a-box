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
import { DEFAULT_BASEMAP_ID } from '../ol-layers'
import { CompareSlotTag } from './CompareSlotTag'
import type View from 'ol/View'
import type { ParsedLayer } from '../wms-capabilities'
import type { CompareMapSource } from './types'

const noop = () => {}
const NO_DECORATIONS: ReadonlyArray<ParsedLayer> = []

/** Cursor position as container fractions, mirrored across panels. */
type CrossPosition = { x: number; y: number } | null

export function DualMapCompare({
  view,
  a,
  b,
  onRegisterFit,
}: {
  view: View
  a: CompareMapSource
  b: CompareMapSource
  /** Register this component's fit-to-bbox action with the toolbar. */
  onRegisterFit: (fit: (() => void) | null) => void
}) {
  const [cross, setCross] = useState<CrossPosition>(null)
  const fitsRef = useRef<Map<string, () => void>>(new Map())

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
        onRegisterFit={registerFit}
      />
      <DualMapPanel
        source={b}
        view={view}
        cross={cross}
        onCross={setCross}
        onRegisterFit={registerFit}
      />
    </div>
  )
}

function DualMapPanel({
  source,
  view,
  cross,
  onCross,
  onRegisterFit,
}: {
  source: CompareMapSource
  view: View
  cross: CrossPosition
  onCross: (pos: CrossPosition) => void
  onRegisterFit: (slot: string, fit: (() => void) | null) => void
}) {
  const { t } = useTranslation('compare')
  const containerRef = useRef<HTMLDivElement>(null)
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
    decorationLayers: NO_DECORATIONS,
    basemapId: DEFAULT_BASEMAP_ID,
    incLoading: noop,
    decLoading: noop,
  })
  useWmsLayerStack(mapRef, source.baseUrl, source.layers, {
    zBase: 100,
    masterOpacity: source.hiddenAtTime ? 0 : source.masterOpacity,
    activeOrder: source.activeOrder,
    layerOpacities: source.layerOpacities,
    resolveTime: source.resolveTime,
    incLoading: noop,
    decLoading: noop,
  })

  useEffect(() => {
    setFitBbox(source.bbox)
  }, [source.bbox, setFitBbox])

  useEffect(() => {
    onRegisterFit(source.slot, () => tryFit(true))
    return () => onRegisterFit(source.slot, null)
  }, [source.slot, tryFit, onRegisterFit])

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
      <CompareSlotTag slot={source.slot} label={source.label} />
      {source.hiddenAtTime && (
        <div className="absolute top-10 left-2 z-10 rounded-md border border-amber-500/40 bg-amber-50/95 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
          {t('timeline.gap', { slot: source.slot.toUpperCase() })}
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
