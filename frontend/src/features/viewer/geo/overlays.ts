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
 * User-uploaded GeoJSON context overlays (boundaries, tracks, points of
 * interest) drawn above the data layers on every compare panel. One
 * shared VectorSource per overlay — OL sources are shareable across
 * maps, layers are not, so each map mounts its own thin VectorLayer.
 */

import { useEffect, useState } from 'react'
import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Fill, Stroke, Style, Text } from 'ol/style'
import CircleStyle from 'ol/style/Circle'
import type { RefObject } from 'react'
import type OlMap from 'ol/Map'
import type { FeatureLike } from 'ol/Feature'

/** Above data stacks (100/200 bands), below the reference overlay (1000). */
const OVERLAY_Z = 900

let overlayCounter = 0

export interface ContextOverlay {
  id: string
  name: string
  visible: boolean
  source: VectorSource
  featureCount: number
  /** Property keys found in the file (label choices), frequency-ordered. */
  propertyKeys: Array<string>
  /** Property rendered as a permanent canvas label; null = none. */
  labelProperty: string | null
}

const OVERLAY_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(22, 163, 74, 0.95)', width: 2 }),
  fill: new Fill({ color: 'rgba(22, 163, 74, 0.08)' }),
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: 'rgba(22, 163, 74, 0.9)' }),
    stroke: new Stroke({ color: 'white', width: 1.5 }),
  }),
})

/**
 * Parse GeoJSON text into an overlay (features reprojected to the
 * viewer's Web-Mercator). Throws on unparsable input or zero features.
 */
export function parseGeojsonOverlay(
  name: string,
  text: string,
): ContextOverlay {
  const features = new GeoJSON().readFeatures(JSON.parse(text), {
    featureProjection: 'EPSG:3857',
  })
  if (features.length === 0) {
    throw new Error('GeoJSON contains no features')
  }
  overlayCounter += 1
  const source = new VectorSource({ features })
  return {
    id: `overlay-${overlayCounter}`,
    name,
    visible: true,
    source,
    featureCount: features.length,
    propertyKeys: collectPropertyKeys(source),
    labelProperty: null,
  }
}

/** Base style + a canvas Text label from the chosen property — part of
 *  the map pixels, so exports include it. */
function overlayStylesWithLabel(
  feature: FeatureLike,
  labelProperty: string | null,
): Array<Style> {
  const raw: unknown = labelProperty ? feature.get(labelProperty) : undefined
  const text =
    raw === undefined || raw === null || raw === '' ? null : String(raw)
  if (!text) return [OVERLAY_STYLE]
  return [
    OVERLAY_STYLE,
    new Style({
      text: new Text({
        text,
        font: '11px system-ui, sans-serif',
        offsetY: -12,
        overflow: true,
        fill: new Fill({ color: 'rgba(15, 23, 42, 0.95)' }),
        backgroundFill: new Fill({ color: 'rgba(255, 255, 255, 0.85)' }),
        padding: [2, 4, 1, 4],
      }),
    }),
  ]
}

/** Feature properties (sans geometry) under the cursor, for the hover
 *  inspection card. */
export interface OverlayHover {
  x: number
  y: number
  rows: Array<[string, string]>
  more: number
}

const HOVER_MAX_ROWS = 8

export function useOverlayHover(
  mapRef: RefObject<OlMap | null>,
  overlays: ReadonlyArray<ContextOverlay>,
): OverlayHover | null {
  const [hover, setHover] = useState<OverlayHover | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || overlays.length === 0) {
      setHover(null)
      return
    }
    const onMove = (evt: { pixel: Array<number> }) => {
      const feature = map.forEachFeatureAtPixel(evt.pixel, (f) => f, {
        hitTolerance: 5,
        layerFilter: (layer) => layer.get('contextOverlay') === true,
      })
      if (!feature) {
        setHover((prev) => (prev === null ? prev : null))
        return
      }
      const entries = Object.entries(feature.getProperties()).filter(
        ([key]) => key !== 'geometry',
      )
      setHover({
        x: evt.pixel[0],
        y: evt.pixel[1],
        rows: entries
          .slice(0, HOVER_MAX_ROWS)
          .map(([k, v]) => [k, v === null ? '—' : String(v)]),
        more: Math.max(0, entries.length - HOVER_MAX_ROWS),
      })
    }
    map.on('pointermove', onMove)
    return () => {
      map.un('pointermove', onMove)
      setHover(null)
    }
  }, [mapRef, overlays])
  return hover
}

/** Mount one VectorLayer per overlay on this map. */
export function useContextOverlays(
  mapRef: RefObject<OlMap | null>,
  overlays: ReadonlyArray<ContextOverlay>,
): void {
  useEffect(() => {
    const map = mapRef.current
    if (!map || overlays.length === 0) return
    const layers = overlays.map((overlay) => {
      const layer = new VectorLayer({
        source: overlay.source,
        style: overlay.labelProperty
          ? (feature) => overlayStylesWithLabel(feature, overlay.labelProperty)
          : OVERLAY_STYLE,
        zIndex: OVERLAY_Z,
        visible: overlay.visible,
      })
      // Marks the layer for the hover-inspection hit test.
      layer.set('contextOverlay', true)
      return layer
    })
    for (const layer of layers) map.addLayer(layer)
    return () => {
      for (const layer of layers) map.removeLayer(layer)
    }
  }, [mapRef, overlays])
}

/** Property keys present in the overlay, most frequent first — offered
 *  as permanent-label choices. */
export function collectPropertyKeys(source: VectorSource): Array<string> {
  const counts = new Map<string, number>()
  for (const feature of source.getFeatures()) {
    for (const key of Object.keys(feature.getProperties())) {
      if (key === 'geometry') continue
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map(([key]) => key)
}
