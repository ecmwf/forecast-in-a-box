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
 * Map annotations: labeled, colored pins bound to a source identity, so
 * they follow their source through slot swaps (sourceId null = shared).
 * Canvas-native vector features — the loupe and PNG exports include them
 * for free; full texts are baked into exports as a numbered notes strip.
 */

import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import GeoJSON from 'ol/format/GeoJSON'
import Point from 'ol/geom/Point'
import Translate from 'ol/interaction/Translate'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Fill, Stroke, Style, Text } from 'ol/style'
import CircleStyle from 'ol/style/Circle'
import type { RefObject } from 'react'
import type OlMap from 'ol/Map'
import type { FeatureLike } from 'ol/Feature'
import type { SourceSlot } from './layer-pairing'

/** Above data stacks and context overlays, below nothing that matters. */
const ANNOTATION_Z = 1600
/** On-map label truncation — full text lives in the sidebar and export. */
const LABEL_MAX_CHARS = 36

/** Curated pin palette — legible on both basemaps, themes, and exports. */
export const ANNOTATION_COLORS = {
  blue: 'rgba(37, 99, 235, 0.95)',
  orange: 'rgba(234, 88, 12, 0.95)',
  red: 'rgba(220, 38, 38, 0.95)',
  amber: 'rgba(217, 119, 6, 0.95)',
  green: 'rgba(22, 163, 74, 0.95)',
  purple: 'rgba(147, 51, 234, 0.95)',
  slate: 'rgba(30, 41, 59, 0.95)',
} as const
export type AnnotationColor = keyof typeof ANNOTATION_COLORS

/** Badge stays legible up to this many characters. */
export const ANNOTATION_LABEL_MAX = 4

export interface MapAnnotation {
  id: string
  /** Web-Mercator coordinate the pin anchors to. */
  coordinate: [number, number]
  /** Badge text — sticky (never renumbered), editable, duplicates OK. */
  label: string
  text: string
  color: AnnotationColor
  /** Source the pin belongs to; null = shared (shows on every surface). */
  sourceId: string | null
}

let annotationCounter = 0
export function nextAnnotationId(): string {
  annotationCounter += 1
  return `annotation-${annotationCounter}`
}

/** Slot's pin color — the attribution default until the user overrides. */
export function defaultAnnotationColor(
  slot: SourceSlot | null,
): AnnotationColor {
  return slot === 'a' ? 'blue' : slot === 'b' ? 'orange' : 'slate'
}

/** Next free integer label — skips taken ones, never reuses on delete. */
export function nextAnnotationLabel(
  annotations: ReadonlyArray<Pick<MapAnnotation, 'label'>>,
): string {
  const used = new Set(annotations.map((a) => a.label))
  let n = 1
  while (used.has(String(n))) n += 1
  return String(n)
}

export function isAnnotationFeature(feature: FeatureLike): boolean {
  return String(feature.getId() ?? '').startsWith('annotation-')
}

/** Should `annotation` render on a surface showing the `shownIds` sources?
 *  Shared pins always do; bound pins only where their source is on screen. */
export function annotationVisibleOn(
  annotation: Pick<MapAnnotation, 'sourceId'>,
  shownIds: ReadonlyArray<string>,
): boolean {
  return annotation.sourceId === null || shownIds.includes(annotation.sourceId)
}

function pinStyles(
  badge: string,
  text: string,
  color: AnnotationColor,
  highlighted: boolean,
) {
  const fill = ANNOTATION_COLORS[color]
  const label =
    text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS)}…` : text
  // Wider badges ("L1", "ABCD") grow the disc so the text stays inside.
  const radius = (highlighted ? 13 : 10) + Math.max(0, badge.length - 2) * 3.5
  const styles = [
    new Style({
      image: new CircleStyle({
        radius,
        fill: new Fill({ color: fill }),
        stroke: new Stroke({ color: 'white', width: highlighted ? 3 : 2 }),
      }),
      text: new Text({
        text: badge,
        font: 'bold 11px system-ui, sans-serif',
        fill: new Fill({ color: 'white' }),
      }),
    }),
  ]
  if (label) {
    styles.push(
      new Style({
        text: new Text({
          text: label,
          font: '12px system-ui, sans-serif',
          textAlign: 'left',
          // Clear the (possibly grown) disc.
          offsetX: radius + 4,
          fill: new Fill({ color: 'rgba(15, 23, 42, 0.95)' }),
          backgroundFill: new Fill({ color: 'rgba(255, 255, 255, 0.92)' }),
          backgroundStroke: new Stroke({ color: 'rgba(0, 0, 0, 0.15)' }),
          padding: [3, 5, 2, 5],
        }),
      }),
    )
  }
  return styles
}

/**
 * Mount the annotation pins on one map and translate clicks: an existing
 * pin always opens for editing (or drags to reposition); an empty-map
 * click creates — but only while the annotate tool is armed.
 */
export function useAnnotationLayer(
  mapRef: RefObject<OlMap | null>,
  annotations: ReadonlyArray<MapAnnotation>,
  /** Source ids this surface shows — memoize; it is an effect dependency. */
  shownIds: ReadonlyArray<string>,
  armed: boolean,
  handlers: {
    /** Creation context (source binding) lives in the caller's closure. */
    onCreate: (coordinate: [number, number]) => void
    onEdit: (id: string) => void
    onMove: (id: string, coordinate: [number, number]) => void
  },
  highlightId: string | null,
  /** useOlMapBase recreation counter — re-attach after a map rebuild. */
  mapVersion: number,
): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const armedRef = useRef(armed)
  armedRef.current = armed

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const visible = annotations.filter((a) => annotationVisibleOn(a, shownIds))
    const source = new VectorSource({
      features: visible.map((a) => {
        const feature = new Feature({ geometry: new Point(a.coordinate) })
        feature.setId(a.id)
        feature.setStyle(
          pinStyles(a.label, a.text, a.color, a.id === highlightId),
        )
        return feature
      }),
    })
    const layer = new VectorLayer({ source, zIndex: ANNOTATION_Z })
    map.addLayer(layer)

    const onClick = (evt: {
      pixel: Array<number>
      coordinate: Array<number>
    }) => {
      const hit = map.forEachFeatureAtPixel(
        evt.pixel,
        (feature) => feature.getId(),
        { hitTolerance: 8, layerFilter: (l) => l === layer },
      )
      if (typeof hit === 'string') {
        handlersRef.current.onEdit(hit)
        return
      }
      if (armedRef.current) {
        handlersRef.current.onCreate([evt.coordinate[0], evt.coordinate[1]])
      }
    }
    map.on('singleclick', onClick)

    // Drag repositions; a clean click still edits (no drag → singleclick).
    // Mounted only while pins exist — Translate hit-tests every pointermove.
    let translate: Translate | null = null
    if (visible.length > 0) {
      translate = new Translate({ layers: [layer], hitTolerance: 8 })
      translate.on('translateend', (evt) => {
        const feature = evt.features.item(0)
        const id = feature.getId()
        const geometry = feature.getGeometry()
        if (typeof id !== 'string' || !(geometry instanceof Point)) return
        const [x, y] = geometry.getCoordinates()
        handlersRef.current.onMove(id, [x, y])
      })
      map.addInteraction(translate)
    }

    return () => {
      if (translate) map.removeInteraction(translate)
      map.un('singleclick', onClick)
      map.removeLayer(layer)
    }
  }, [mapRef, annotations, shownIds, highlightId, mapVersion])
}

// -------- GeoJSON round-trip (RFC 7946: WGS84 lon/lat on the wire) --------

/** Bump when the export shape changes; readers branch on the foreign member. */
const ANNOTATIONS_FORMAT_VERSION = 3

/** Point FeatureCollection (label/text/color/source props) — plain GeoJSON,
 *  so exports open in any GIS tool; versioned via an RFC 7946 foreign member. */
export function annotationsToGeojson(
  annotations: ReadonlyArray<MapAnnotation>,
): string {
  const features = annotations.map((a) => {
    const feature = new Feature({ geometry: new Point(a.coordinate) })
    feature.setProperties({
      label: a.label,
      text: a.text,
      color: a.color,
      source: a.sourceId,
    })
    return feature
  })
  const collection = new GeoJSON().writeFeaturesObject(features, {
    featureProjection: 'EPSG:3857',
    decimals: 6,
  })
  return JSON.stringify({
    ...collection,
    'fiab:annotations': { version: ANNOTATIONS_FORMAT_VERSION },
  })
}

/** Browser download of the pins as a dated .geojson file. */
export function downloadAnnotationsGeojson(
  annotations: ReadonlyArray<MapAnnotation>,
): void {
  const blob = new Blob([annotationsToGeojson(annotations)], {
    type: 'application/geo+json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `annotations-${new Date().toISOString().slice(0, 10)}.geojson`
  link.click()
  URL.revokeObjectURL(url)
}

/** Pin data from annotations GeoJSON: Points with non-empty `text` only.
 *  v3 binds by `source` id; legacy `slot` maps through `slotIds` (foreign
 *  → shared); a missing `label` (v1) stays '' for the importer to assign.
 *  Throws when nothing usable. */
export function parseAnnotationsGeojson(
  text: string,
  slotIds: { a?: string | null; b?: string | null } = {},
): Array<Omit<MapAnnotation, 'id'>> {
  const features = new GeoJSON().readFeatures(JSON.parse(text), {
    featureProjection: 'EPSG:3857',
  })
  const parsed = features.flatMap<Omit<MapAnnotation, 'id'>>((feature) => {
    const geometry = feature.getGeometry()
    const noteText: unknown = feature.get('text')
    if (!(geometry instanceof Point)) return []
    if (typeof noteText !== 'string' || noteText.trim() === '') return []
    const sourceRaw: unknown = feature.get('source')
    const slotRaw: unknown = feature.get('slot')
    const slot = slotRaw === 'a' ? 'a' : slotRaw === 'b' ? 'b' : null
    const sourceId =
      typeof sourceRaw === 'string' && sourceRaw !== ''
        ? sourceRaw
        : slot !== null
          ? (slotIds[slot] ?? null)
          : null
    const labelRaw: unknown = feature.get('label')
    const colorRaw: unknown = feature.get('color')
    const [x, y] = geometry.getCoordinates()
    // Imported 1e999/string coords parse to Infinity/NaN — locating such
    // a pin poisons the shared camera.
    if (!Number.isFinite(x) || !Number.isFinite(y)) return []
    return [
      {
        coordinate: [x, y] as [number, number],
        label:
          typeof labelRaw === 'string'
            ? labelRaw.trim().slice(0, ANNOTATION_LABEL_MAX)
            : '',
        text: noteText.trim(),
        color:
          typeof colorRaw === 'string' && colorRaw in ANNOTATION_COLORS
            ? (colorRaw as AnnotationColor)
            : defaultAnnotationColor(slot),
        sourceId,
      },
    ]
  })
  if (parsed.length === 0) {
    throw new Error('No annotation features found')
  }
  return parsed
}
