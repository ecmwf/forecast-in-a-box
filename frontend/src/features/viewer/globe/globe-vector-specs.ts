/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Per-panel globe vectors, matching the flat map's. */

import GeoJSON from 'ol/format/GeoJSON'
import GeometryCollection from 'ol/geom/GeometryCollection'
import LineString from 'ol/geom/LineString'
import MultiLineString from 'ol/geom/MultiLineString'
import MultiPoint from 'ol/geom/MultiPoint'
import MultiPolygon from 'ol/geom/MultiPolygon'
import Point from 'ol/geom/Point'
import Polygon from 'ol/geom/Polygon'
import { ANNOTATION_COLORS, annotationVisibleOn } from '../geo/annotations'
import { overlayLabelText } from '../geo/overlays'
import { pinLabelText } from '../vector-styles'
import type { FeatureCollection } from 'geojson'
import type Feature from 'ol/Feature'
import type Geometry from 'ol/geom/Geometry'
import type { MapAnnotation } from '../geo/annotations'
import type { ContextOverlay } from '../geo/overlays'
import type { Measurement } from '../hooks/useMeasure'
import type { GlobeLabel, GlobeVectorSpec } from './engine'

const format = new GeoJSON()

const xy = (c: ArrayLike<number>): [number, number] => [c[0], c[1]]

/** Where OpenLayers anchors a point-placed label on `geometry`. */
export function labelAnchors(geometry: Geometry): Array<[number, number]> {
  if (geometry instanceof Point) return [xy(geometry.getCoordinates())]
  if (geometry instanceof MultiPoint) return geometry.getCoordinates().map(xy)
  if (geometry instanceof LineString) return [xy(geometry.getFlatMidpoint())]
  if (geometry instanceof MultiLineString) {
    return geometry.getLineStrings().map((l) => xy(l.getFlatMidpoint()))
  }
  if (geometry instanceof Polygon) {
    return [xy(geometry.getInteriorPoint().getCoordinates())]
  }
  if (geometry instanceof MultiPolygon) {
    return geometry
      .getPolygons()
      .map((p) => xy(p.getInteriorPoint().getCoordinates()))
  }
  if (geometry instanceof GeometryCollection) {
    return geometry.getGeometries().flatMap(labelAnchors)
  }
  return []
}

/** Visible overlay features, addressed by the globe's `index`. */
export function shownOverlayFeatures(
  overlays: ReadonlyArray<ContextOverlay>,
): Array<Feature> {
  return overlays.filter((o) => o.visible).flatMap((o) => o.features)
}

function collection(
  geometries: ReadonlyArray<Geometry | undefined>,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: geometries.flatMap((geometry, index) =>
      geometry
        ? [
            {
              type: 'Feature' as const,
              geometry: format.writeGeometryObject(geometry),
              properties: { index },
            },
          ]
        : [],
    ),
  }
}

export function globeVectorSpec({
  overlays,
  measurements,
  annotations,
  highlightId,
  shownIds,
}: {
  overlays: ReadonlyArray<ContextOverlay>
  measurements: ReadonlyArray<Measurement>
  annotations: ReadonlyArray<MapAnnotation>
  highlightId: string | null
  /** Source ids the panel shows. */
  shownIds: ReadonlyArray<string>
}): GlobeVectorSpec {
  const shownOverlays = overlays.filter((o) => o.visible)
  const overlayLabels = shownOverlays.flatMap((o) =>
    o.features.flatMap((feature): Array<GlobeLabel> => {
      const text = overlayLabelText(feature, o.labelProperty)
      const geometry = feature.getGeometry()
      if (!text || !geometry) return []
      return labelAnchors(geometry).map(([lon, lat]) => ({ lon, lat, text }))
    }),
  )
  const shownMeasurements = measurements.filter((m) =>
    annotationVisibleOn(m, shownIds),
  )
  return {
    overlays: collection(
      shownOverlayFeatures(overlays).map((f) => f.getGeometry()),
    ),
    overlayLabels,
    measurements: collection(shownMeasurements.map((m) => m.geometry)),
    // Top centre of the extent, as on the flat map.
    measurementLabels: shownMeasurements.map((m) => {
      const [minX, , maxX, maxY] = m.geometry.getExtent()
      return { lon: (minX + maxX) / 2, lat: maxY, text: m.label }
    }),
    pins: annotations
      .filter((a) => annotationVisibleOn(a, shownIds))
      .map((a) => ({
        id: a.id,
        lon: a.lonLat[0],
        lat: a.lonLat[1],
        badge: a.label,
        note: pinLabelText(a.text),
        color: ANNOTATION_COLORS[a.color],
        highlighted: a.id === highlightId,
      })),
  }
}
