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
 * Distance / area measurement on a viewer map: an OL Draw interaction on
 * a dedicated vector layer, with a live tooltip showing the geodesic
 * length/area (ol/sphere respects the projection). Finished sketches stay
 * on the map with frozen tooltips until cleared. One instance per map —
 * side-by-side panels measure independently.
 */

import { useEffect, useRef } from 'react'
import Draw from 'ol/interaction/Draw'
import Overlay from 'ol/Overlay'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Fill, Stroke, Style, Text } from 'ol/style'
import CircleStyle from 'ol/style/Circle'
import Point from 'ol/geom/Point'
import { getArea, getLength } from 'ol/sphere'
import type { RefObject } from 'react'
import type OlMap from 'ol/Map'
import type Geometry from 'ol/geom/Geometry'
import type { EventsKey } from 'ol/events'
import { unByKey } from 'ol/Observable'

export type MeasureMode = 'none' | 'line' | 'area'

/** Geodesic length → "12.3 km" / "845 m". */
export function formatLength(meters: number): string {
  return meters >= 10_000
    ? `${(meters / 1000).toFixed(1)} km`
    : meters >= 1000
      ? `${(meters / 1000).toFixed(2)} km`
      : `${Math.round(meters)} m`
}

/** Geodesic area → "1 234 km²" / "0.42 km²" / "560 m²". */
export function formatArea(squareMeters: number): string {
  const km2 = squareMeters / 1e6
  if (km2 >= 100) {
    // Locale-independent thousands grouping with plain spaces.
    const grouped = String(Math.round(km2)).replace(
      /\B(?=(\d{3})+(?!\d))/g,
      ' ',
    )
    return `${grouped} km²`
  }
  if (km2 >= 0.01) return `${km2.toFixed(2)} km²`
  return `${Math.round(squareMeters)} m²`
}

const MEASURE_STYLE = new Style({
  fill: new Fill({ color: 'rgba(30, 41, 59, 0.12)' }),
  stroke: new Stroke({
    color: 'rgba(15, 23, 42, 0.9)',
    width: 2,
    lineDash: [6, 6],
  }),
  image: new CircleStyle({
    radius: 4,
    fill: new Fill({ color: 'rgba(15, 23, 42, 0.9)' }),
  }),
})

/**
 * Finished measurements carry their result as canvas-native Text (at the
 * top of the geometry's extent) instead of a DOM tooltip — so labels are
 * part of the map pixels and survive PNG export/print captures.
 */
function measureStyleWithLabel(
  label: string,
  geometry: Geometry,
): Array<Style> {
  const extent = geometry.getExtent()
  const anchor = new Point([
    (extent[0] + extent[2]) / 2,
    Math.max(extent[1], extent[3]),
  ])
  return [
    MEASURE_STYLE,
    new Style({
      geometry: anchor,
      text: new Text({
        text: label,
        font: '12px system-ui, sans-serif',
        offsetY: -12,
        fill: new Fill({ color: 'rgba(15, 23, 42, 0.95)' }),
        backgroundFill: new Fill({ color: 'rgba(255, 255, 255, 0.92)' }),
        backgroundStroke: new Stroke({ color: 'rgba(0, 0, 0, 0.15)' }),
        padding: [3, 5, 2, 5],
      }),
    }),
  ]
}

const TOOLTIP_CLASS =
  'rounded border border-border bg-background/95 px-1.5 py-0.5 font-mono text-xs shadow-sm whitespace-nowrap'

function measureText(geometry: Geometry, projection: string): string {
  if (geometry.getType() === 'Polygon') {
    return formatArea(getArea(geometry, { projection }))
  }
  return formatLength(getLength(geometry, { projection }))
}

export function useMeasure(
  mapRef: RefObject<OlMap | null>,
  mode: MeasureMode,
  clearNonce: number,
): void {
  const sourceRef = useRef<VectorSource | null>(null)
  const overlaysRef = useRef<Array<Overlay>>([])

  // Dedicated sketch layer — mounted while measuring or while results
  // remain on the map.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    sourceRef.current ??= new VectorSource()
    const layer = new VectorLayer({
      source: sourceRef.current,
      style: (feature) => {
        const label = feature.get('measureLabel') as string | undefined
        const geometry = feature.getGeometry()
        return label && geometry
          ? measureStyleWithLabel(label, geometry as Geometry)
          : MEASURE_STYLE
      },
      zIndex: 1500,
    })
    map.addLayer(layer)
    return () => {
      map.removeLayer(layer)
    }
  }, [mapRef])

  // Draw interaction per mode, with a live tooltip that freezes on finish.
  useEffect(() => {
    const map = mapRef.current
    const source = sourceRef.current
    if (!map || !source || mode === 'none') return

    const draw = new Draw({
      source,
      type: mode === 'line' ? 'LineString' : 'Polygon',
      style: MEASURE_STYLE,
    })
    map.addInteraction(draw)

    let tooltip: Overlay | null = null
    let geometryKey: EventsKey | null = null
    const projection = map.getView().getProjection().getCode()

    const startKey = draw.on('drawstart', (evt) => {
      const element = document.createElement('div')
      element.className = TOOLTIP_CLASS
      tooltip = new Overlay({
        element,
        offset: [0, -12],
        positioning: 'bottom-center',
        stopEvent: false,
      })
      map.addOverlay(tooltip)
      overlaysRef.current.push(tooltip)
      const geometry = evt.feature.getGeometry()
      if (!geometry) return
      geometryKey = geometry.on('change', () => {
        element.textContent = measureText(geometry, projection)
        const extent = geometry.getExtent()
        tooltip?.setPosition([
          (extent[0] + extent[2]) / 2,
          Math.max(extent[1], extent[3]),
        ])
      })
    })
    const endKey = draw.on('drawend', (evt) => {
      if (geometryKey) unByKey(geometryKey)
      geometryKey = null
      // Freeze the result into the feature (canvas-rendered label) and
      // drop the live DOM tooltip — exports then include the value.
      const geometry = evt.feature.getGeometry()
      if (geometry) {
        evt.feature.set('measureLabel', measureText(geometry, projection))
      }
      if (tooltip) {
        map.removeOverlay(tooltip)
        overlaysRef.current = overlaysRef.current.filter((o) => o !== tooltip)
      }
      tooltip = null
    })

    return () => {
      unByKey(startKey)
      unByKey(endKey)
      if (geometryKey) unByKey(geometryKey)
      map.removeInteraction(draw)
      // An unfinished sketch's tooltip would otherwise dangle.
      if (tooltip) {
        map.removeOverlay(tooltip)
        overlaysRef.current = overlaysRef.current.filter((o) => o !== tooltip)
      }
    }
  }, [mapRef, mode])

  // Clear results.
  useEffect(() => {
    if (clearNonce === 0) return
    const map = mapRef.current
    sourceRef.current?.clear()
    for (const overlay of overlaysRef.current) map?.removeOverlay(overlay)
    overlaysRef.current = []
  }, [clearNonce, mapRef])
}
