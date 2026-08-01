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
 * URL view-state sync for the compare viewer: the one-shot layer-stack
 * restore and every live report (the page debounces them into the URL).
 * Camera and time seeds are consumed where those live — View creation
 * and useViewerTimeline.
 */

import { useEffect, useRef, useState } from 'react'
import { toLonLat } from 'ol/proj'
import { unByKey } from 'ol/Observable'
import { DEFAULT_BASEMAP_ID } from '../ol-layers'
import type { RefObject } from 'react'
import type View from 'ol/View'
import type { LensSource } from '../hooks/useLensSource'
import type { PairedLayer } from './layer-pairing'
import type { CompareSelection } from './useCompareSelection'
import type { ParsedLayer } from '../wms-capabilities'
import type { TimeLinkMode } from './time-link'
import type { ViewerUrlState } from './view-url-state'

// Unlinked lists can outlive their source — the URL carries served names only.
function servedNames(
  order: ReadonlyArray<string>,
  layers: ReadonlyArray<ParsedLayer>,
  catalogUnknown: boolean,
): ReadonlyArray<string> {
  if (catalogUnknown) return order
  return order.filter((name) => layers.some((l) => l.name === name))
}

export function useViewerUrlState({
  initial,
  onViewStateChange,
  viewRef,
  selection,
  pairing,
  sourceA,
  sourceB,
  hasB,
  activeOrderA,
  activeOrderB,
  currentEpoch,
  timeLinkMode,
  offsetMs,
  basemapId,
}: {
  /** Mount snapshot of the URL state; later changes are ignored. */
  initial: ViewerUrlState | null
  onViewStateChange?: (partial: Partial<ViewerUrlState>) => void
  viewRef: RefObject<View | null>
  selection: CompareSelection
  pairing: { pairs: ReadonlyArray<PairedLayer> }
  sourceA: LensSource
  sourceB: LensSource
  hasB: boolean
  activeOrderA: ReadonlyArray<string>
  activeOrderB: ReadonlyArray<string>
  currentEpoch: number | null
  timeLinkMode: TimeLinkMode
  offsetMs: number
  basemapId: string
}): void {
  // -------- One-shot layer restore (per slot) --------
  const pendingLayersRef = useRef<{
    a: ReadonlyArray<string>
    b: ReadonlyArray<string>
    unlinked: boolean
  } | null>(
    initial?.layersA?.length || initial?.layersB?.length
      ? {
          a: initial.layersA ?? [],
          b: initial.layersB ?? [],
          unlinked: initial.unlinkedLayers === true,
        }
      : null,
  )
  // Mirrors the ref as state so the report effect re-runs on completion.
  const [restorePending, setRestorePending] = useState({
    a: (pendingLayersRef.current?.a.length ?? 0) > 0,
    b: (pendingLayersRef.current?.b.length ?? 0) > 0,
  })
  useEffect(() => {
    const pending = pendingLayersRef.current
    if (!pending) return
    // Switch the selection model first — toggles must land per-side.
    if (pending.unlinked && selection.linkMode === 'linked') {
      selection.setLinkMode('unlinked')
      return
    }
    // Both slots can settle in one pass — stale isPairActive would re-toggle.
    const toggledNow = new Set<string>()
    for (const [slot, source] of [
      ['a', sourceA],
      ['b', sourceB],
    ] as const) {
      const names = pending[slot]
      if (names.length === 0 || source.loadingLayers) continue
      // B may still be starting; if it never runs the URL keeps the value.
      if (slot === 'b' && !hasB) continue
      const available = new Set(source.layers.map((l) => l.name))
      // Reverse: toggles prepend, so the first name ends up on top.
      for (const name of [...names].reverse()) {
        if (!available.has(name)) continue
        if (pending.unlinked) {
          if (!selection.isLayerActive(slot, name)) {
            selection.toggleLayer(slot, name)
          }
        } else {
          const pair = pairing.pairs.find(
            (p) => p.perSource[slot]?.name === name,
          )
          if (
            pair &&
            !toggledNow.has(pair.key) &&
            !selection.isPairActive(pair.key)
          ) {
            toggledNow.add(pair.key)
            selection.togglePair(pair.key)
          }
        }
      }
      pending[slot] = []
    }
    if (pending.a.length === 0 && pending.b.length === 0) {
      pendingLayersRef.current = null
    }
    setRestorePending((prev) => {
      const next = { a: pending.a.length > 0, b: pending.b.length > 0 }
      return prev.a === next.a && prev.b === next.b ? prev : next
    })
    // Meaningful bits only — selection/source identities churn every render.
  }, [
    sourceA.loadingLayers,
    sourceB.loadingLayers,
    hasB,
    pairing.pairs,
    selection.linkMode,
  ])

  // -------- Live report (page debounces into the URL) --------
  useEffect(() => {
    if (!onViewStateChange) return
    const partial: Partial<ViewerUrlState> = {
      // Auto-unlink is situational — persisting it would block the relink.
      unlinkedLayers:
        selection.linkMode === 'unlinked' && !selection.autoUnlinked,
      timeLink: timeLinkMode,
      offsetMs,
      basemap: basemapId === DEFAULT_BASEMAP_ID ? undefined : basemapId,
    }
    // Hold restored fields until slots settle — mid-load writes would strip them.
    if (!restorePending.a) {
      partial.layersA = servedNames(
        activeOrderA,
        sourceA.layers,
        sourceA.loadingLayers || sourceA.error !== null,
      )
    }
    if (!restorePending.b) {
      partial.layersB = servedNames(
        activeOrderB,
        sourceB.layers,
        sourceB.loadingLayers || sourceB.error !== null,
      )
    }
    if (!restorePending.a && !restorePending.b) {
      partial.timeMs = currentEpoch ?? undefined
    }
    onViewStateChange(partial)
  }, [
    onViewStateChange,
    activeOrderA,
    activeOrderB,
    sourceA.layers,
    sourceA.loadingLayers,
    sourceA.error,
    sourceB.layers,
    sourceB.loadingLayers,
    sourceB.error,
    selection.linkMode,
    selection.autoUnlinked,
    restorePending,
    currentEpoch,
    timeLinkMode,
    offsetMs,
    basemapId,
  ])
  useEffect(() => {
    const view = viewRef.current
    if (!onViewStateChange || !view) return
    const report = () => {
      const center = view.getCenter()
      const zoom = view.getZoom()
      if (!center || zoom === undefined) return
      const [lon, lat] = toLonLat(center)
      if (![lon, lat, zoom].every(Number.isFinite)) return
      onViewStateChange({ camera: { lon, lat, zoom } })
    }
    const keys = [
      view.on('change:center', report),
      view.on('change:resolution', report),
    ]
    return () => unByKey(keys)
  }, [onViewStateChange, viewRef])
}
