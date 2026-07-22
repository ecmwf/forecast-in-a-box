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

import { useCallback, useEffect, useRef, useState } from 'react'
import ImageLayer from 'ol/layer/Image'
import {
  DEFAULT_LAYER_OPACITY,
  WEB_MERCATOR_EXTENT,
  isAbortedLoad,
  loadRequestUrl,
  makeDataLayerSource,
} from '../ol-layers'
import { toWmsEndpoint } from '../wms-capabilities'
import type { RefObject } from 'react'
import type OlMap from 'ol/Map'
import type ImageWMS from 'ol/source/ImageWMS'
import type { ImageSourceEvent } from 'ol/source/Image'
import type { ParsedLayer } from '../wms-capabilities'

interface ManagedLayer {
  layer: ImageLayer<ImageWMS>
  source: ImageWMS
  /** Last load failed — the layer is hidden so a stale image can never
   *  masquerade as the requested instant. */
  errored: boolean
  /** TIME of the most recently requested params (load-result fallback). */
  lastTime: string | null
  /** Serialized params last pushed to OL — updateParams always refetches,
   *  so identical params must never be pushed again. */
  paramsKey: string
}

/** TIME actually on the request URL — exact attribution even when the
 *  params moved on while this load was in flight. Null when the loaded
 *  result is already an ImageBitmap (no URL to read). */
function requestedTime(evt: ImageSourceEvent): string | null {
  const img = evt.image.getImage()
  if (!(img instanceof HTMLImageElement)) return null
  try {
    // The cancelling loader serves blob URLs — the request URL is stashed.
    return new URL(loadRequestUrl(img) ?? img.src).searchParams.get('TIME')
  } catch {
    return null
  }
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
  /** Per-request load outcome (feeds the GetMap failure cache). */
  onLoadResult?: (layerName: string, time: string | null, ok: boolean) => void
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
  /** Layers whose latest load failed (hidden until a load succeeds). */
  errorCount: number
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
    onLoadResult,
    trackRevision = false,
  } = config

  // Listeners are bound once per layer; a ref keeps them on the latest
  // callback without re-running the reconcile effect.
  const onLoadResultRef = useRef(onLoadResult)
  onLoadResultRef.current = onLoadResult

  const managedRef = useRef<Map<string, ManagedLayer>>(new Map())
  // The map instance the managed layers were added to. When the map is
  // rebuilt (resetKey change in useOlMapBase), the old layers died with it
  // — drop them so reconciliation re-adds everything to the new map.
  const attachedMapRef = useRef<OlMap | null>(null)
  const stackRef = useRef<ReadonlyArray<ImageLayer<ImageWMS>>>([])
  const [revision, setRevision] = useState(0)
  const [errorCount, setErrorCount] = useState(0)
  const syncErrorCount = useCallback(() => {
    setErrorCount(
      [...managedRef.current.values()].filter((m) => m.errored).length,
    )
  }, [])

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
      if (!layer) return
      wantedNames.add(layerName)

      const params: Record<string, string> = {
        LAYERS: layerName,
        // No advertised <Style> (NASA GIBS et al.) → empty = server default.
        STYLES: layer.styles[0]?.name ?? '',
        FORMAT: 'image/png',
        TRANSPARENT: 'TRUE',
      }
      const time = resolveTime(layer)
      if (time) params.TIME = time

      const perLayer = layerOpacities.get(layerName) ?? DEFAULT_LAYER_OPACITY
      const effectiveOpacity = perLayer * masterOpacity
      const z = zBase + (activeOrder.length - idx) // index 0 → highest z

      // baseUrl is part of the identity: a slot swap serves the SAME
      // layer names from the other server — params alone would not move.
      const paramsKey = `${baseUrl}|${JSON.stringify(params)}`
      const existing = managed.get(layerName)
      if (existing) {
        // Guarded: reconciles also run for opacity/order changes and
        // render churn — pushing identical params would refetch (and for
        // an errored layer, retry-loop against a failing server).
        if (existing.paramsKey !== paramsKey) {
          existing.paramsKey = paramsKey
          existing.lastTime = time
          existing.source.setUrl(toWmsEndpoint(baseUrl))
          existing.source.updateParams(params)
          // Hidden-on-error layers never re-request (OL culls invisible
          // layers) — unhide so the refreshed params get retried. No stale
          // frame: updateParams bumped the source revision, which clears
          // the renderer's cached image for unrendered layers.
          if (existing.errored) existing.layer.setVisible(true)
        }
        existing.layer.setOpacity(effectiveOpacity)
        existing.layer.setZIndex(z)
      } else {
        const source = makeDataLayerSource(baseUrl, params)
        const olLayer = new ImageLayer({
          source,
          opacity: effectiveOpacity,
          zIndex: z,
          // Clip to ±85° so a zoomed-out BBOX never goes out-of-bounds (→ stretched).
          extent: WEB_MERCATOR_EXTENT,
          // Scale limits: OL skips out-of-range steps instead of a blank GetMap.
          minResolution: layer.scale?.minRes,
          maxResolution: layer.scale?.maxRes,
        })
        const entry: ManagedLayer = {
          layer: olLayer,
          source,
          errored: false,
          lastTime: time,
          paramsKey,
        }
        source.on('imageloadstart', incLoading)
        source.on('imageloadend', (evt) => {
          decLoading()
          if (entry.errored) {
            entry.errored = false
            syncErrorCount()
          }
          entry.layer.setVisible(true)
          onLoadResultRef.current?.(
            layerName,
            requestedTime(evt) ?? entry.lastTime,
            true,
          )
        })
        // A failed load must never leave the previous image on screen —
        // it would masquerade as the newly requested instant.
        source.on('imageloaderror', (evt) => {
          decLoading()
          // Superseded loads are bookkeeping, not server failures.
          if (isAbortedLoad(evt.image.getImage())) return
          if (!entry.errored) {
            entry.errored = true
            syncErrorCount()
          }
          entry.layer.setVisible(false)
          onLoadResultRef.current?.(
            layerName,
            requestedTime(evt) ?? entry.lastTime,
            false,
          )
        })
        map.addLayer(olLayer)
        managed.set(layerName, entry)
      }
    })

    for (const [name, m] of managed) {
      if (!wantedNames.has(name)) {
        map.removeLayer(m.layer)
        managed.delete(name)
      }
    }
    syncErrorCount()

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
    syncErrorCount,
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

  return { stackRef, revision, errorCount }
}
