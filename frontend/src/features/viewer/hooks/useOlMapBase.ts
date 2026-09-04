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
 * OpenLayers map construction + lifecycle shared by the WMS viewers:
 * default basemap, resize handling, and bbox auto-fit. Accepts an external
 * `View` so the compare viewer's side-by-side maps can share one instance
 * (OL then syncs pan/zoom/rotation natively).
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import OlMap from 'ol/Map'
import View from 'ol/View'
import LayerGroup from 'ol/layer/Group'
import { fromLonLat } from 'ol/proj'
import { getCenter, getWidth } from 'ol/extent'
import { BASEMAPS, makeBasemapLayer } from '../ol-layers'
import {
  getViewerProjection,
  homeExtentFor,
  polarGraticuleFor,
  registerViewerProjections,
  viewerProjectionOf,
} from '../projections'
import type { RefObject } from 'react'
import type { BasemapLayer } from '../ol-layers'
import type { ViewerProjection } from '../projections'
import { makeOutlineBasemapLayer } from '@/lib/map/ol-outline'

// "Auto-fit done" flag on the shared View, so it survives a map remount (mode switch).
// Exported: a URL-restored camera pre-marks the View as framed.
export const AUTOFIT_KEY = 'fiab:autoFitted'

/** A viewer View: extent-constrained, pre-framed on the projection's home. */
export function createViewerView(
  projection: ViewerProjection = getViewerProjection('merc'),
): View {
  registerViewerProjections()
  // Pre-fit framing avoids a [0,0] world flash before tryFit() runs.
  const framing = projection.mercator
    ? { center: fromLonLat([12, 50]), zoom: 3 }
    : {
        center: getCenter(projection.homeExtent),
        resolution: getWidth(projection.homeExtent) / 1024,
      }
  return new View({
    ...framing,
    projection: projection.code,
    minZoom: projection.minZoom,
    // smoothExtentConstraint: false keeps pans strictly within the
    // world; without it, slight overshoot makes SkinnyWMS return
    // stretched-stripe images for out-of-bounds BBOXes.
    extent: projection.extent,
    smoothExtentConstraint: false,
    constrainResolution: false,
    // Only Mercator fills the window; the rest letterbox so the poles show.
    showFullExtent: !projection.mercator,
  })
}

export interface OlMapBaseOptions {
  /**
   * External shared View — pass the same instance to two maps to sync
   * their cameras. Default: a fresh `createViewerView()` per map.
   * Must be referentially stable for the lifetime of the map.
   */
  view?: View
  /** Change tears the map down and rebuilds it (single viewer: baseUrl). */
  resetKey: string
  /** Outline basemap palette when the view is not Web Mercator. */
  theme?: 'light' | 'dark'
  incLoading: () => void
  decLoading: () => void
}

export interface OlMapBase {
  mapRef: RefObject<OlMap | null>
  basemapLayerRef: RefObject<BasemapLayer | null>
  /**
   * Fit the view: unforced = one-shot initial fit to the projection's
   * home; forced = fit to the WMS bbox (falls back to the home).
   */
  tryFit: (force?: boolean) => void
  /** Provide the WMS-advertised bbox used by forced fits; triggers the
   *  initial unforced fit attempt. */
  setFitBbox: (bbox: [number, number, number, number] | null) => void
  /** Bumps each time the OL map is recreated — dep for layer-mounting hooks. */
  mapVersion: number
}

export function useOlMapBase(
  containerRef: RefObject<HTMLDivElement | null>,
  options: OlMapBaseOptions,
): OlMapBase {
  const { view, resetKey, theme = 'light', incLoading, decLoading } = options
  const mapRef = useRef<OlMap | null>(null)
  const basemapLayerRef = useRef<BasemapLayer | null>(null)
  const [mapVersion, setMapVersion] = useState(0)
  const bboxRef = useRef<[number, number, number, number] | null>(null)
  // Keep the external view in a ref so a caller passing an inline-created
  // View doesn't retrigger the map effect (it must stay referentially
  // stable anyway, but this makes the contract explicit).
  const viewRef = useRef(view)
  viewRef.current = view
  const themeRef = useRef(theme)
  themeRef.current = theme

  const tryFit = useCallback((force: boolean = false) => {
    const map = mapRef.current
    if (!map) return
    const olView = map.getView()
    // Skip re-fitting once the shared View is framed — keep the camera across mode switches.
    if (!force && olView.get(AUTOFIT_KEY)) return
    // Skip while smaller than the fit padding — the fit would go negative.
    const size = map.getSize()
    if (!size || size[0] <= 96 || size[1] <= 96) return
    // Forced ("Fit to globe") = WMS bbox; unforced = the projection's home.
    olView.set(AUTOFIT_KEY, true, true)
    const extent = homeExtentFor(
      viewerProjectionOf(olView),
      force ? bboxRef.current : null,
    )
    olView.fit(extent, { padding: [40, 40, 40, 40] })
  }, [])

  const setFitBbox = useCallback(
    (bbox: [number, number, number, number] | null) => {
      bboxRef.current = bbox
      tryFit()
    },
    [tryFit],
  )

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const olView = viewRef.current ?? createViewerView()
    const projection = viewerProjectionOf(olView)
    // Mount with the projection's default basemap; the basemap-swap
    // effect (useBasemap) adopts the user's choice afterwards.
    const basemap: BasemapLayer = projection.mercator
      ? makeBasemapLayer(BASEMAPS[0])
      : makeOutlineBasemapLayer(
          projection.code,
          projection.extent,
          themeRef.current,
          polarGraticuleFor(projection),
        )
    if (!(basemap instanceof LayerGroup)) {
      const source = basemap.getSource()
      source?.on('tileloadstart', incLoading)
      source?.on('tileloadend', decLoading)
      source?.on('tileloaderror', decLoading)
    }
    basemapLayerRef.current = basemap
    const map = new OlMap({
      target: container,
      layers: [basemap],
      view: olView,
      // Default is 1px: a real mouse almost always drifts more than that
      // between press and release, silently swallowing `singleclick`
      // (annotations, feature hits). 6px still pans responsively.
      moveTolerance: 6,
    })
    mapRef.current = map
    // Recreation signal for hooks that mount layers on the map — deps on
    // the stable mapRef alone strand them on a replaced instance.
    setMapVersion((v) => v + 1)
    // Sheets animate in from off-screen; the container is 0×0 at mount
    // time. Watch for resize and tell OL to recompute viewport size so
    // tiles render once the drawer settles. Auto-fit kicks in here too —
    // fit() needs valid pixel dimensions only available post-resize.
    const ro = new ResizeObserver(() => {
      map.updateSize()
      tryFit()
    })
    ro.observe(container)
    return () => {
      ro.disconnect()
      map.setTarget(undefined)
      // Detach from the shared View (setView unlistens the old view's
      // listeners) — else every discarded map leaks through it.
      map.setView(createViewerView(projection))
      mapRef.current = null
    }
  }, [containerRef, resetKey, tryFit, incLoading, decLoading])

  return { mapRef, basemapLayerRef, tryFit, setFitBbox, mapVersion }
}
