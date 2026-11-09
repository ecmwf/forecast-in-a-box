/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** User vectors on the globe; labels and pins are canvas icons. */

import {
  CALLOUT_LABEL,
  LABEL_OFFSET_Y,
  MEASURE_COLORS,
  MEASURE_DASH,
  MEASURE_STROKE_WIDTH,
  OVERLAY_COLORS,
  OVERLAY_LABEL,
  OVERLAY_POINT_RADIUS,
  OVERLAY_POINT_STROKE_WIDTH,
  OVERLAY_STROKE_WIDTH,
  PIN_BADGE_FONT,
  PIN_LABEL_GAP,
  pinRadius,
  pinStrokeWidth,
} from '../vector-styles'
import type {
  AddLayerObject,
  GeoJSONSource,
  Map as MapLibreMap,
  PointLike,
} from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import type { LabelStyle } from '../vector-styles'
import type { GlobeLabel, GlobePin, GlobeVectorSpec } from './engine'

/** Global-state key for the vectors' opacity (0 while bending, 1 settled). */
export const VECTOR_OPACITY = 'fiabVectorOpacity'
const OPACITY = ['number', ['global-state', VECTOR_OPACITY], 1]

const SOURCES = {
  overlays: 'fiab-overlays',
  overlayLabels: 'fiab-overlay-labels',
  measurements: 'fiab-measurements',
  measurementLabels: 'fiab-measurement-labels',
  pins: 'fiab-pins',
} as const
const PIN_LAYER = 'fiab-pins'
const OVERLAY_LAYERS = [
  'fiab-overlay-fill',
  'fiab-overlay-line',
  'fiab-overlay-point',
]
/** Pin click slop (px), as on the flat map. */
const HIT_TOLERANCE = 8
/** Overlay hover slop (px), as on the flat map. */
const HOVER_TOLERANCE = 5

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const POLYGON = [
  'match',
  ['geometry-type'],
  ['Polygon', 'MultiPolygon'],
  true,
  false,
]
const POINT = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]

function labelLayer(id: string, source: string, overlap: boolean) {
  return {
    id,
    type: 'symbol',
    source,
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-offset': [0, LABEL_OFFSET_Y],
      // Overlay labels yield on collision; measurement results always show.
      'icon-allow-overlap': overlap,
      'icon-ignore-placement': overlap,
    },
    paint: { 'icon-opacity': OPACITY },
  }
}

/** Bottom to top: overlays, measurements, pins. */
const LAYERS = [
  {
    id: OVERLAY_LAYERS[0],
    type: 'fill',
    source: SOURCES.overlays,
    filter: POLYGON,
    paint: { 'fill-color': OVERLAY_COLORS.fill, 'fill-opacity': OPACITY },
  },
  {
    id: OVERLAY_LAYERS[1],
    type: 'line',
    source: SOURCES.overlays,
    filter: ['!', POINT],
    paint: {
      'line-color': OVERLAY_COLORS.stroke,
      'line-width': OVERLAY_STROKE_WIDTH,
      'line-opacity': OPACITY,
    },
  },
  {
    id: OVERLAY_LAYERS[2],
    type: 'circle',
    source: SOURCES.overlays,
    filter: POINT,
    paint: {
      'circle-radius': OVERLAY_POINT_RADIUS,
      'circle-color': OVERLAY_COLORS.point,
      'circle-stroke-color': 'white',
      'circle-stroke-width': OVERLAY_POINT_STROKE_WIDTH,
      'circle-opacity': OPACITY,
      'circle-stroke-opacity': OPACITY,
    },
  },
  labelLayer('fiab-overlay-label', SOURCES.overlayLabels, false),
  {
    id: 'fiab-measurement-fill',
    type: 'fill',
    source: SOURCES.measurements,
    filter: POLYGON,
    paint: { 'fill-color': MEASURE_COLORS.fill, 'fill-opacity': OPACITY },
  },
  {
    id: 'fiab-measurement-line',
    type: 'line',
    source: SOURCES.measurements,
    paint: {
      'line-color': MEASURE_COLORS.stroke,
      'line-width': MEASURE_STROKE_WIDTH,
      // MapLibre dashes are in line widths.
      'line-dasharray': MEASURE_DASH.map((d) => d / MEASURE_STROKE_WIDTH),
      'line-opacity': OPACITY,
    },
  },
  labelLayer('fiab-measurement-label', SOURCES.measurementLabels, true),
  {
    id: PIN_LAYER,
    type: 'symbol',
    source: SOURCES.pins,
    layout: {
      'icon-image': ['get', 'icon'],
      // Centre the disc on the point.
      'icon-anchor': 'left',
      'icon-offset': ['array', 'number', 2, ['get', 'offset']],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: { 'icon-opacity': OPACITY },
  },
] as unknown as ReadonlyArray<AddLayerObject>

interface Icon {
  image: ImageData
  pixelRatio: number
}

function fontPx(font: string): number {
  return Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 12)
}

function boxSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: LabelStyle,
) {
  ctx.font = style.font
  const [top, right, bottom, left] = style.padding
  return {
    width: Math.ceil(ctx.measureText(text).width) + left + right,
    height: Math.ceil(fontPx(style.font) * 1.2) + top + bottom,
  }
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: LabelStyle,
  x: number,
  y: number,
  size: { width: number; height: number },
) {
  ctx.fillStyle = style.background
  ctx.fillRect(x, y, size.width, size.height)
  if (style.border) {
    ctx.strokeStyle = style.border
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, size.width - 1, size.height - 1)
  }
  const [top, , bottom, left] = style.padding
  ctx.font = style.font
  ctx.fillStyle = style.color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + left, y + top + (size.height - top - bottom) / 2)
}

/** A canvas `width` x `height` CSS px at the device pixel ratio. */
function iconCanvas(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): Icon | null {
  const pixelRatio = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * pixelRatio)
  canvas.height = Math.ceil(height * pixelRatio)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(pixelRatio, pixelRatio)
  draw(ctx)
  return {
    image: ctx.getImageData(0, 0, canvas.width, canvas.height),
    pixelRatio,
  }
}

const measureCtx = () => document.createElement('canvas').getContext('2d')

function labelIcon(text: string, style: LabelStyle): Icon | null {
  const ctx = measureCtx()
  if (!ctx) return null
  const size = boxSize(ctx, text, style)
  return iconCanvas(size.width, size.height, (c) =>
    drawBox(c, text, style, 0, 0, size),
  )
}

/** The disc centre's distance from the pin image's left edge (CSS px). */
function pinDiscX(pin: GlobePin): number {
  return (
    pinRadius(pin.badge, pin.highlighted) +
    pinStrokeWidth(pin.highlighted) / 2 +
    1
  )
}

function pinIcon(pin: GlobePin): Icon | null {
  const radius = pinRadius(pin.badge, pin.highlighted)
  const stroke = pinStrokeWidth(pin.highlighted)
  const outer = radius + stroke / 2
  const discX = pinDiscX(pin)
  const ctx = measureCtx()
  if (!ctx) return null
  const box = pin.note ? boxSize(ctx, pin.note, CALLOUT_LABEL) : null
  const boxX = discX + radius + PIN_LABEL_GAP - CALLOUT_LABEL.padding[3]
  const width = Math.max(discX + outer + 1, box ? boxX + box.width : 0)
  const height = Math.max(2 * outer + 2, box?.height ?? 0)
  const cy = height / 2
  return iconCanvas(width, height, (c) => {
    c.beginPath()
    c.arc(discX, cy, radius, 0, 2 * Math.PI)
    c.fillStyle = pin.color
    c.fill()
    c.lineWidth = stroke
    c.strokeStyle = 'white'
    c.stroke()
    c.font = PIN_BADGE_FONT
    c.fillStyle = 'white'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(pin.badge, discX, cy)
    if (box) drawBox(c, pin.note, CALLOUT_LABEL, boxX, cy - box.height / 2, box)
  })
}

const pinIconId = (p: GlobePin) =>
  `fiab-pin:${p.color}|${p.highlighted ? 1 : 0}|${p.badge}|${p.note}`

function labelFeatures(
  labels: ReadonlyArray<GlobeLabel>,
  kind: string,
): Array<Feature> {
  return labels.map((l) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [l.lon, l.lat] },
    properties: { icon: `fiab-label:${kind}:${l.text}` },
  }))
}

export interface GlobeVectors {
  /** Re-add sources, layers and images after a style (re)load. */
  install: (m: MapLibreMap, beforeId: string | undefined) => void
  set: (m: MapLibreMap | null, spec: GlobeVectorSpec) => void
  /** The annotation id of the pin at a canvas point, if any. */
  pinAt: (m: MapLibreMap, point: { x: number; y: number }) => string | null
  /** The `index` of the topmost overlay feature at a canvas point, if any. */
  overlayAt: (m: MapLibreMap, point: { x: number; y: number }) => number | null
}

function hitBox(
  { x, y }: { x: number; y: number },
  slop: number,
): [PointLike, PointLike] {
  return [
    [x - slop, y - slop],
    [x + slop, y + slop],
  ]
}

export function createGlobeVectors(): GlobeVectors {
  let spec: GlobeVectorSpec = {
    overlays: EMPTY,
    overlayLabels: [],
    measurements: EMPTY,
    measurementLabels: [],
    pins: [],
  }
  let installed: MapLibreMap | null = null
  /** Images we added to the current style. */
  const added = new Set<string>()

  function addIcon(m: MapLibreMap, id: string, make: () => Icon | null) {
    if (m.hasImage(id)) return
    const icon = make()
    if (!icon) return
    m.addImage(id, icon.image, { pixelRatio: icon.pixelRatio })
    added.add(id)
  }

  function apply(m: MapLibreMap) {
    const wanted = new Set<string>()
    const overlayLabels = labelFeatures(spec.overlayLabels, 'overlay')
    const measurementLabels = labelFeatures(spec.measurementLabels, 'measure')
    // Icons before data: the worker asks for them while parsing.
    spec.overlayLabels.forEach((l, i) => {
      const id = String(overlayLabels[i].properties?.icon)
      wanted.add(id)
      addIcon(m, id, () => labelIcon(l.text, OVERLAY_LABEL))
    })
    spec.measurementLabels.forEach((l, i) => {
      const id = String(measurementLabels[i].properties?.icon)
      wanted.add(id)
      addIcon(m, id, () => labelIcon(l.text, CALLOUT_LABEL))
    })
    const pins = spec.pins.map((pin): Feature => {
      const id = pinIconId(pin)
      wanted.add(id)
      addIcon(m, id, () => pinIcon(pin))
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pin.lon, pin.lat] },
        properties: { id: pin.id, icon: id, offset: [-pinDiscX(pin), 0] },
      }
    })
    const data: Record<keyof typeof SOURCES, FeatureCollection> = {
      overlays: spec.overlays,
      overlayLabels: { type: 'FeatureCollection', features: overlayLabels },
      measurements: spec.measurements,
      measurementLabels: {
        type: 'FeatureCollection',
        features: measurementLabels,
      },
      pins: { type: 'FeatureCollection', features: pins },
    }
    for (const key of Object.keys(SOURCES) as Array<keyof typeof SOURCES>) {
      m.getSource<GeoJSONSource>(SOURCES[key])?.setData(data[key])
    }
    // Tiles keep their own icon copies: drop stale images.
    for (const id of added) {
      if (wanted.has(id)) continue
      if (m.hasImage(id)) m.removeImage(id)
      added.delete(id)
    }
  }

  return {
    install: (m, beforeId) => {
      installed = m
      for (const id of added) if (!m.hasImage(id)) added.delete(id)
      for (const id of Object.values(SOURCES)) {
        if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: EMPTY })
      }
      for (const layer of LAYERS) {
        if (!m.getLayer(layer.id)) m.addLayer(layer, beforeId)
      }
      apply(m)
    },
    set: (m, next) => {
      spec = next
      if (m && m === installed) apply(m)
    },
    pinAt: (m, point) => {
      if (installed !== m || spec.pins.length === 0) return null
      const hit = m
        .queryRenderedFeatures(hitBox(point, HIT_TOLERANCE), {
          layers: [PIN_LAYER],
        })
        .at(0)
      const id: unknown = hit?.properties.id
      return typeof id === 'string' ? id : null
    },
    overlayAt: (m, point) => {
      if (installed !== m || spec.overlays.features.length === 0) return null
      const hit = m
        .queryRenderedFeatures(hitBox(point, HOVER_TOLERANCE), {
          layers: OVERLAY_LAYERS,
        })
        .at(0)
      const index: unknown = hit?.properties.index
      return typeof index === 'number' ? index : null
    },
  }
}
