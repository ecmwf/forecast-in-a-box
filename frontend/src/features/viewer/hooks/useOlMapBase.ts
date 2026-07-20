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

import { useCallback, useLayoutEffect, useRef } from 'react'
import OlMap from 'ol/Map'
import View from 'ol/View'
import { fromLonLat, transformExtent } from 'ol/proj'
import {
  BASEMAPS,
  INITIAL_VIEW_BBOX_WGS84,
  WEB_MERCATOR_EXTENT,
  makeBasemapLayer,
} from '../ol-layers'
import type { RefObject } from 'react'
import type { BasemapLayer } from '../ol-layers'

/** The default viewer View: Web-Mercator, world-constrained, Europe-framed. */
export function createViewerView(): View {
  return new View({
    // Pre-fit framing on Europe — avoids a [0,0] world flash before
    // tryFit() runs.
    center: fromLonLat([12, 50]),
    zoom: 3,
    projection: 'EPSG:3857',
    // smoothExtentConstraint: false keeps pans strictly within the
    // world; without it, slight overshoot makes SkinnyWMS return
    // stretched-stripe images for out-of-bounds BBOXes.
    extent: WEB_MERCATOR_EXTENT,
    smoothExtentConstraint: false,
    constrainResolution: false,
    // No showFullExtent: wheel fills the window (Maps-style, no void); fit-to-globe still frames the world.
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
  incLoading: () => void
  decLoading: () => void
}

export interface OlMapBase {
  mapRef: RefObject<OlMap | null>
  basemapLayerRef: RefObject<BasemapLayer | null>
  /**
   * Fit the view: unforced = one-shot initial fit to the Europe-biased
   * default; forced = fit to the WMS bbox (falls back to the default).
   */
  tryFit: (force?: boolean) => void
  /** Provide the WMS-advertised bbox used by forced fits; triggers the
   *  initial unforced fit attempt. */
  setFitBbox: (bbox: [number, number, number, number] | null) => void
}

export function useOlMapBase(
  containerRef: RefObject<HTMLDivElement | null>,
  options: OlMapBaseOptions,
): OlMapBase {
  const { view, resetKey, incLoading, decLoading } = options
  const mapRef = useRef<OlMap | null>(null)
  const basemapLayerRef = useRef<BasemapLayer | null>(null)
  const fittedRef = useRef(false)
  const bboxRef = useRef<[number, number, number, number] | null>(null)
  // Keep the external view in a ref so a caller passing an inline-created
  // View doesn't retrigger the map effect (it must stay referentially
  // stable anyway, but this makes the contract explicit).
  const viewRef = useRef(view)
  viewRef.current = view

  const tryFit = useCallback((force: boolean = false) => {
    const map = mapRef.current
    if (!map) return
    if (!force && fittedRef.current) return
    const size = map.getSize()
    if (!size || size[0] < 1 || size[1] < 1) return
    // Forced = "Fit to globe" button → full WMS bbox; unforced (initial
    // auto-fit) → Europe-centric default. Falls back to the default if
    // the WMS bbox isn't known yet.
    const targetWgs84 =
      force && bboxRef.current ? bboxRef.current : INITIAL_VIEW_BBOX_WGS84
    fittedRef.current = true
    const olView = map.getView()
    const extent = transformExtent(
      targetWgs84,
      'EPSG:4326',
      olView.getProjection(),
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
    // Mount with default basemap; the basemap-swap effect (useBasemap)
    // adopts the user's choice afterwards.
    const basemap = makeBasemapLayer(BASEMAPS[0])
    const source = basemap.getSource()
    source?.on('tileloadstart', incLoading)
    source?.on('tileloadend', decLoading)
    source?.on('tileloaderror', decLoading)
    basemapLayerRef.current = basemap
    const map = new OlMap({
      target: container,
      layers: [basemap],
      view: viewRef.current ?? createViewerView(),
      // Default is 1px: a real mouse almost always drifts more than that
      // between press and release, silently swallowing `singleclick`
      // (annotations, feature hits). 6px still pans responsively.
      moveTolerance: 6,
    })
    mapRef.current = map
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
      mapRef.current = null
    }
  }, [containerRef, resetKey, tryFit, incLoading, decLoading])

  return { mapRef, basemapLayerRef, tryFit, setFitBbox }
}
