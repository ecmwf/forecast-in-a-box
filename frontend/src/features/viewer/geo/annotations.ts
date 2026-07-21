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
 * Map annotations: numbered pins with a short on-map label, recorded per
 * comparison slot. A pin placed on side-by-side panel A — or while
 * focused on A — belongs to A and renders only on A surfaces; combined-
 * view pins (slot null) render everywhere. Pins are canvas-native (vector features
 * with Text styles), so the loupe and PNG exports include them for free;
 * the full texts are baked into exports as a numbered notes strip.
 */

import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
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

export interface MapAnnotation {
  id: string
  /** Web-Mercator coordinate the pin anchors to. */
  coordinate: [number, number]
  text: string
  /** Panel the pin was placed on; null = single-map (shows everywhere). */
  slot: SourceSlot | null
}

let annotationCounter = 0
export function nextAnnotationId(): string {
  annotationCounter += 1
  return `annotation-${annotationCounter}`
}

export function isAnnotationFeature(feature: FeatureLike): boolean {
  return String(feature.getId() ?? '').startsWith('annotation-')
}

/** Should `annotation` render on a panel showing `panelSlot`?
 *  Single map (panelSlot null) shows everything; a side-by-side panel
 *  shows its own pins plus the shared (null-slot) ones. */
export function annotationVisibleOn(
  annotation: Pick<MapAnnotation, 'slot'>,
  panelSlot: SourceSlot | null,
): boolean {
  if (panelSlot === null) return true
  return annotation.slot === null || annotation.slot === panelSlot
}

const SLOT_PIN_COLOR: Record<'a' | 'b' | 'shared', string> = {
  a: 'rgba(37, 99, 235, 0.95)', // blue-600 — matches every A surface
  b: 'rgba(234, 88, 12, 0.95)', // orange-600 — matches every B surface
  shared: 'rgba(30, 41, 59, 0.95)', // slate-800
}

function pinStyles(number: number, text: string, slot: SourceSlot | null) {
  const color = SLOT_PIN_COLOR[slot ?? 'shared']
  const label =
    text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS)}…` : text
  const styles = [
    new Style({
      image: new CircleStyle({
        radius: 10,
        fill: new Fill({ color }),
        stroke: new Stroke({ color: 'white', width: 2 }),
      }),
      text: new Text({
        text: String(number),
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
          offsetX: 14,
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
 * pin always opens for editing; an empty-map click creates — but only
 * while the annotate tool is armed.
 */
export function useAnnotationLayer(
  mapRef: RefObject<OlMap | null>,
  annotations: ReadonlyArray<MapAnnotation>,
  panelSlot: SourceSlot | null,
  armed: boolean,
  handlers: {
    onCreate: (coordinate: [number, number], slot: SourceSlot | null) => void
    onEdit: (id: string) => void
  },
): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const armedRef = useRef(armed)
  armedRef.current = armed

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const visible = annotations.filter((a) => annotationVisibleOn(a, panelSlot))
    const source = new VectorSource({
      features: visible.map((a) => {
        const feature = new Feature({ geometry: new Point(a.coordinate) })
        feature.setId(a.id)
        // Numbering follows the full list, so a pin keeps its number on
        // every panel and in the sidebar/export.
        const number = annotations.findIndex((x) => x.id === a.id) + 1
        feature.setStyle(pinStyles(number, a.text, a.slot))
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
        handlersRef.current.onCreate(
          [evt.coordinate[0], evt.coordinate[1]],
          panelSlot,
        )
      }
    }
    map.on('singleclick', onClick)
    return () => {
      map.un('singleclick', onClick)
      map.removeLayer(layer)
    }
  }, [mapRef, annotations, panelSlot])
}
