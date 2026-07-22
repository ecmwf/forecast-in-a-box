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
 * Warm the browser HTTP cache for every (time-aware active layer × time
 * step) at the current viewport, one hidden ImageLayer at a time. Same
 * source config as the visible layers, so URLs match and OL hits cache
 * when the user scrubs. Bandwidth-heavy — keep default off.
 */

import { useEffect } from 'react'
import ImageLayer from 'ol/layer/Image'
import { makeDataLayerSource } from '../ol-layers'
import type { RefObject } from 'react'
import type OlMap from 'ol/Map'
import type ImageWMS from 'ol/source/ImageWMS'
import type { ParsedLayer } from '../wms-capabilities'

const PREFETCH_LOAD_TIMEOUT_MS = 30_000

export function useTimeStepPrefetch(
  mapRef: RefObject<OlMap | null>,
  {
    enabled,
    baseUrl,
    layers,
    activeOrder,
    timeSteps,
  }: {
    enabled: boolean
    baseUrl: string
    layers: ReadonlyArray<ParsedLayer>
    activeOrder: ReadonlyArray<string>
    /** Raw TIME strings this server advertises. */
    timeSteps: ReadonlyArray<string>
  },
): void {
  useEffect(() => {
    if (!enabled) return
    const map = mapRef.current
    if (!map || timeSteps.length <= 1) return
    const timeAwareActive = activeOrder
      .map((name) => layers.find((l) => l.name === name))
      .filter((l): l is ParsedLayer => !!l && !!l.time && l.styles.length > 0)
    if (timeAwareActive.length === 0) return

    // Object-wrapped so TS-ESLint sees mutability across the await below.
    const state = { cancelled: false }
    const hiddenLayers: Array<ImageLayer<ImageWMS>> = []

    // Hidden ImageLayer per (layer × step), torn down once loaded.
    const prefetchOne = (layer: ParsedLayer, step: string) =>
      new Promise<void>((resolve) => {
        if (state.cancelled) return resolve()
        const source = makeDataLayerSource(baseUrl, {
          LAYERS: layer.name,
          STYLES: layer.styles[0].name,
          FORMAT: 'image/png',
          TRANSPARENT: 'TRUE',
          TIME: step,
        })
        const hidden = new ImageLayer({
          source,
          opacity: 0,
          zIndex: -1,
        })
        let settled = false
        let safetyTimer = 0
        const settle = () => {
          if (settled) return
          settled = true
          window.clearTimeout(safetyTimer)
          map.removeLayer(hidden)
          const i = hiddenLayers.indexOf(hidden)
          if (i >= 0) hiddenLayers.splice(i, 1)
          resolve()
        }
        source.once('imageloadend', settle)
        source.once('imageloaderror', settle)
        // Safety: if the load events never fire (server hung), don't leak.
        safetyTimer = window.setTimeout(settle, PREFETCH_LOAD_TIMEOUT_MS)
        hiddenLayers.push(hidden)
        map.addLayer(hidden)
      })

    ;(async () => {
      for (const layer of timeAwareActive) {
        for (const step of timeSteps) {
          if (state.cancelled) return
          await prefetchOne(layer, step)
        }
      }
    })()

    return () => {
      state.cancelled = true
      // Best-effort cleanup of any still-attached hidden layers.
      for (const h of hiddenLayers) map.removeLayer(h)
    }
  }, [enabled, baseUrl, activeOrder, layers, timeSteps, mapRef])
}
