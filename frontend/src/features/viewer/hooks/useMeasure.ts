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
 * length/area (ol/sphere respects the projection). Finished measurements
 * are caller-owned WGS84 state, reprojected per map.
 */

import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import Draw, { createBox } from 'ol/interaction/Draw'
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom'
import Overlay from 'ol/Overlay'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Fill, Stroke, Style, Text } from 'ol/style'
import CircleStyle from 'ol/style/Circle'
import Point from 'ol/geom/Point'
import SimpleGeometry from 'ol/geom/SimpleGeometry'
import { getArea, getLength } from 'ol/sphere'
import { unByKey } from 'ol/Observable'
import {
  CALLOUT_LABEL,
  LABEL_OFFSET_Y,
  MEASURE_COLORS,
  MEASURE_DASH,
  MEASURE_STROKE_WIDTH,
} from '../vector-styles'
import type { RefObject } from 'react'
import type OlMap from 'ol/Map'
import type Geometry from 'ol/geom/Geometry'
import type { EventsKey } from 'ol/events'

export type MeasureMode = 'none' | 'line' | 'area' | 'box'

/** A finished measurement, projection-independent. */
export interface Measurement {
  id: string
  /** LineString (distance) or Polygon (area) in EPSG:4326. */
  geometry: Geometry
  /** Frozen geodesic result, e.g. "12.3 km". */
  label: string
  /** Owning source id; null = shared. */
  sourceId: string | null
}

let measurementCounter = 0
export function nextMeasurementId(): string {
  measurementCounter += 1
  return `measurement-${measurementCounter}`
}

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
  fill: new Fill({ color: MEASURE_COLORS.fill }),
  stroke: new Stroke({
    color: MEASURE_COLORS.stroke,
    width: MEASURE_STROKE_WIDTH,
    lineDash: [...MEASURE_DASH],
  }),
  image: new CircleStyle({
    radius: 4,
    fill: new Fill({ color: MEASURE_COLORS.stroke }),
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
        font: CALLOUT_LABEL.font,
        offsetY: LABEL_OFFSET_Y,
        fill: new Fill({ color: CALLOUT_LABEL.color }),
        backgroundFill: new Fill({ color: CALLOUT_LABEL.background }),
        backgroundStroke: new Stroke({ color: CALLOUT_LABEL.border }),
        padding: [...CALLOUT_LABEL.padding],
      }),
    }),
  ]
}

const TOOLTIP_CLASS =
  'rounded border border-border bg-background/95 px-1.5 py-0.5 font-mono text-xs shadow-sm whitespace-nowrap'

const REMOVE_CLASS =
  'flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border border-border bg-background/95 text-[10px] leading-none text-muted-foreground shadow-sm hover:text-foreground'

/** Canvas width of the frozen label — places the × just past its edge. */
function labelWidthPx(label: string): number {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return 60
  ctx.font = '12px system-ui, sans-serif'
  return ctx.measureText(label).width + 10
}

function measureText(geometry: Geometry, projection: string): string {
  if (geometry.getType() === 'Polygon') {
    return formatArea(getArea(geometry, { projection }))
  }
  return formatLength(getLength(geometry, { projection }))
}

export function useMeasure(
  mapRef: RefObject<OlMap | null>,
  mode: MeasureMode,
  /** Measurements to draw; memoize (effect dependency). */
  measurements: ReadonlyArray<Measurement>,
  handlers: {
    /** A finished sketch: WGS84 geometry and its frozen label. */
    onAdd: (geometry: Geometry, label: string) => void
    onRemove: (id: string) => void
  },
  /** Accessible name for each measurement's remove button. */
  removeLabel: string,
  /** useOlMapBase recreation counter; re-attach after a map rebuild. */
  mapVersion: number,
): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  // Finished measurements, reprojected into this map's view projection.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const projection = map.getView().getProjection().getCode()
    const features = measurements.flatMap((measurement) => {
      const geometry = measurement.geometry.clone()
      geometry.transform('EPSG:4326', projection)
      // Skip geometries that hit a projection singularity.
      if (
        !(geometry instanceof SimpleGeometry) ||
        !geometry.getFlatCoordinates().every(Number.isFinite)
      ) {
        return []
      }
      const feature = new Feature({ geometry })
      feature.setId(measurement.id)
      feature.set('measureLabel', measurement.label)
      return [feature]
    })
    const layer = new VectorLayer({
      source: new VectorSource({ features }),
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
    // A remove button per measurement, just past its label.
    const removes = features.map((feature) => {
      const label = feature.get('measureLabel') as string
      const extent = feature.getGeometry()?.getExtent() ?? [0, 0, 0, 0]
      const button = document.createElement('button')
      button.type = 'button'
      button.className = REMOVE_CLASS
      button.textContent = '×'
      button.title = removeLabel
      button.setAttribute('aria-label', removeLabel)
      const remove = new Overlay({
        element: button,
        positioning: 'center-left',
        offset: [labelWidthPx(label) / 2 + 6, -19],
      })
      remove.setPosition([
        (extent[0] + extent[2]) / 2,
        Math.max(extent[1], extent[3]),
      ])
      button.addEventListener('click', () =>
        handlersRef.current.onRemove(String(feature.getId())),
      )
      map.addOverlay(remove)
      return remove
    })
    return () => {
      map.removeLayer(layer)
      for (const overlay of removes) map.removeOverlay(overlay)
    }
  }, [mapRef, measurements, removeLabel, mapVersion])

  // Draw interaction with a live tooltip; finished sketches go to onAdd.
  useEffect(() => {
    const map = mapRef.current
    if (!map || mode === 'none') return

    const draw = new Draw({
      type:
        mode === 'line' ? 'LineString' : mode === 'box' ? 'Circle' : 'Polygon',
      // Box: two opposite corners; the geometry lands as a Polygon.
      geometryFunction: mode === 'box' ? createBox() : undefined,
      style: MEASURE_STYLE,
      // Vertex clicks must not leak into singleclick listeners (annotation edit/create).
      stopClick: true,
    })
    map.addInteraction(draw)
    // The finishing double-click must not also zoom the view away.
    const dblZoom = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof DoubleClickZoom)
    dblZoom?.setActive(false)

    let tooltip: Overlay | null = null
    let geometryKey: EventsKey | null = null
    const projection = map.getView().getProjection().getCode()
    const dropTooltip = () => {
      if (tooltip) map.removeOverlay(tooltip)
      tooltip = null
    }

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
      dropTooltip()
      const geometry = evt.feature.getGeometry()
      if (!geometry) return
      // Freeze the result; the canvas label is exported with the map.
      const label = measureText(geometry, projection)
      handlersRef.current.onAdd(
        geometry.clone().transform(projection, 'EPSG:4326'),
        label,
      )
    })

    return () => {
      unByKey(startKey)
      unByKey(endKey)
      if (geometryKey) unByKey(geometryKey)
      map.removeInteraction(draw)
      dblZoom?.setActive(true)
      // An unfinished sketch's tooltip would otherwise dangle.
      dropTooltip()
    }
  }, [mapRef, mode, mapVersion])
}
