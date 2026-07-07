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
 * Managed WMS layer stack for one (map × source) pair: reconciles the
 * ordered active-layer selection into OL ImageLayers. One ImageLayer per
 * active layer, single-image mode (see makeDataLayerSource) so OL
 * atomically swaps images when params change — no flicker while
 * time-scrubbing. Index 0 = topmost; effective opacity = master ×
 * per-layer.
 *
 * The compare viewer mounts two stacks on one map with disjoint `zBase`
 * bands (A: 100, B: 200) so the stacks interleave predictably; the
 * single-lens viewer passes `zBase: 0` which reproduces its historical
 * z-index math exactly.
 */

import { useEffect, useRef, useState } from 'react'
import ImageLayer from 'ol/layer/Image'
import { DEFAULT_LAYER_OPACITY, makeDataLayerSource } from '../ol-layers'
import type { RefObject } from 'react'
import type OlMap from 'ol/Map'
import type ImageWMS from 'ol/source/ImageWMS'
import type { ParsedLayer } from '../wms-capabilities'

interface ManagedLayer {
  layer: ImageLayer<ImageWMS>
  source: ImageWMS
}

export interface WmsLayerStackConfig {
  /** z-index band base; data layers get `zBase + stackPosition`. */
  zBase?: number
  /** Scales every layer of this stack (flicker/blend drive this). */
  masterOpacity: number
  /** Ordered active layer names, index 0 = top of stack. */
  activeOrder: ReadonlyArray<string>
  layerOpacities: ReadonlyMap<string, number>
  /**
   * Per-layer WMS TIME value (the raw string THIS server advertised), or
   * null to omit the param. Must be referentially stable (useCallback) —
   * it is an effect dependency.
   */
  resolveTime: (layer: ParsedLayer) => string | null
  incLoading: () => void
  decLoading: () => void
  /**
   * Bump `revision` state after each reconciliation. Costs one extra
   * consumer render per change — enable only when something must re-attach
   * to the OL layers imperatively (compare-viewer clip controllers).
   */
  trackRevision?: boolean
}

export interface WmsLayerStack {
  /** Current OL layers of this stack, top-first. Stable ref identity. */
  stackRef: RefObject<ReadonlyArray<ImageLayer<ImageWMS>>>
  /** Reconciliation counter; stays 0 unless `trackRevision` is set. */
  revision: number
}

export function useWmsLayerStack(
  mapRef: RefObject<OlMap | null>,
  baseUrl: string,
  layers: ReadonlyArray<ParsedLayer>,
  config: WmsLayerStackConfig,
): WmsLayerStack {
  const {
    zBase = 0,
    masterOpacity,
    activeOrder,
    layerOpacities,
    resolveTime,
    incLoading,
    decLoading,
    trackRevision = false,
  } = config

  const managedRef = useRef<Map<string, ManagedLayer>>(new Map())
  // The map instance the managed layers were added to. When the map is
  // rebuilt (resetKey change in useOlMapBase), the old layers died with it
  // — drop them so reconciliation re-adds everything to the new map.
  const attachedMapRef = useRef<OlMap | null>(null)
  const stackRef = useRef<ReadonlyArray<ImageLayer<ImageWMS>>>([])
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (attachedMapRef.current !== map) {
      managedRef.current.clear()
      attachedMapRef.current = map
    }
    const managed = managedRef.current

    const wantedNames = new Set<string>()
    activeOrder.forEach((layerName, idx) => {
      const layer = layers.find((l) => l.name === layerName)
      if (!layer || layer.styles.length === 0) return
      const style = layer.styles[0]
      wantedNames.add(layerName)

      const params: Record<string, string> = {
        LAYERS: layerName,
        STYLES: style.name,
        FORMAT: 'image/png',
        TRANSPARENT: 'TRUE',
      }
      const time = resolveTime(layer)
      if (time) params.TIME = time

      const perLayer = layerOpacities.get(layerName) ?? DEFAULT_LAYER_OPACITY
      const effectiveOpacity = perLayer * masterOpacity
      const z = zBase + (activeOrder.length - idx) // index 0 → highest z

      const existing = managed.get(layerName)
      if (existing) {
        existing.source.updateParams(params)
        existing.layer.setOpacity(effectiveOpacity)
        existing.layer.setZIndex(z)
      } else {
        const source = makeDataLayerSource(baseUrl, params)
        source.on('imageloadstart', incLoading)
        source.on('imageloadend', decLoading)
        source.on('imageloaderror', decLoading)
        const olLayer = new ImageLayer({
          source,
          opacity: effectiveOpacity,
          zIndex: z,
        })
        map.addLayer(olLayer)
        managed.set(layerName, { layer: olLayer, source })
      }
    })

    for (const [name, m] of managed) {
      if (!wantedNames.has(name)) {
        map.removeLayer(m.layer)
        managed.delete(name)
      }
    }

    stackRef.current = activeOrder.flatMap((name) => {
      const m = managed.get(name)
      return m ? [m.layer] : []
    })
    if (trackRevision) setRevision((r) => r + 1)
  }, [
    mapRef,
    baseUrl,
    layers,
    activeOrder,
    layerOpacities,
    masterOpacity,
    resolveTime,
    zBase,
    trackRevision,
    incLoading,
    decLoading,
  ])

  // Unmount: detach this stack's layers (the map may outlive the stack —
  // e.g. compare-viewer mode switches swap stacks on a persistent map).
  useEffect(
    () => () => {
      const map = attachedMapRef.current
      const managed = managedRef.current
      if (map) {
        for (const m of managed.values()) map.removeLayer(m.layer)
      }
      managed.clear()
      stackRef.current = []
    },
    [],
  )

  return { stackRef, revision }
}
