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
 * "Outline" basemap: Natural Earth 110m coastlines and country borders as
 * strokes plus a labelled graticule. Bundled vector data reprojects
 * freely, so it backs every non-Mercator view — and works offline.
 */

import Feature from 'ol/Feature'
import GeoJSON from 'ol/format/GeoJSON'
import Graticule from 'ol/layer/Graticule'
import LayerGroup from 'ol/layer/Group'
import VectorLayer from 'ol/layer/Vector'
import LineString from 'ol/geom/LineString'
import Point from 'ol/geom/Point'
import SimpleGeometry from 'ol/geom/SimpleGeometry'
import { transform } from 'ol/proj'
import VectorSource from 'ol/source/Vector'
import { Fill, Stroke, Style, Text } from 'ol/style'
import type { Extent } from 'ol/extent'

export type OutlineTheme = 'light' | 'dark'

interface OutlineData {
  coastlines: object
  countries: object
}

let outlineData: OutlineData | null = null
let outlineDataPromise: Promise<OutlineData> | null = null

/** Natural Earth data, code-split; resolved once and then served sync. */
export function loadOutlineData(): Promise<OutlineData> {
  outlineDataPromise ??= Promise.all([
    import('./data/coastlines-low.json'),
    import('./data/countries.geo.json'),
  ]).then(([coastlines, countries]) => {
    outlineData = {
      coastlines: coastlines.default,
      countries: countries.default,
    }
    return outlineData
  })
  return outlineDataPromise
}

/** Warm the data cache off the critical path (a later switch is instant). */
export function preloadOutlineData(): void {
  const run = () => void loadOutlineData().catch(() => {})
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run)
    return
  }
  window.setTimeout(run, 500)
}

interface Palette {
  coast: string
  border: string
  grid: string
  label: string
  labelPlate: string
}

const PALETTES: Record<OutlineTheme, Palette> = {
  light: {
    coast: 'rgba(51, 65, 85, 0.75)',
    border: 'rgba(100, 116, 139, 0.55)',
    grid: 'rgba(100, 116, 139, 0.35)',
    label: 'rgba(71, 85, 105, 0.95)',
    labelPlate: 'rgba(255, 255, 255, 0.7)',
  },
  dark: {
    coast: 'rgba(203, 213, 225, 0.7)',
    border: 'rgba(148, 163, 184, 0.5)',
    grid: 'rgba(148, 163, 184, 0.3)',
    label: 'rgba(203, 213, 225, 0.95)',
    labelPlate: 'rgba(15, 23, 42, 0.7)',
  },
}

/** Reprojected features, minus any that hit a singularity (antipode). */
function readFeatures(json: object, projection: string): Array<Feature> {
  // dataProjection pins the source: a `crs` alias (CRS84) has no proj4 link.
  return new GeoJSON()
    .readFeatures(json, {
      dataProjection: 'EPSG:4326',
      featureProjection: projection,
    })
    .filter((feature) => {
      const geometry = feature.getGeometry()
      return (
        geometry instanceof SimpleGeometry &&
        geometry.getFlatCoordinates().every(Number.isFinite)
      )
    })
}

/** Source filled from the cache now, or when the lazy data resolves. */
function dataSource(
  projection: string,
  pick: (data: OutlineData) => object,
): VectorSource {
  const source = new VectorSource()
  const fill = (data: OutlineData) =>
    source.addFeatures(readFeatures(pick(data), projection))
  if (outlineData) fill(outlineData)
  else void loadOutlineData().then(fill, () => {})
  return source
}

/** Polar-stereographic graticule geometry: which pole, outer latitude. */
export interface PolarGraticule {
  pole: 'north' | 'south'
  /** Latitude of the outermost parallel / meridian start (e.g. 19). */
  edgeLatitude: number
}

const hemi = (value: number, pos: string, neg: string) =>
  `${Math.abs(value)}° ${value < 0 ? neg : pos}`

/** Fixed 10°/30° polar graticule — OL's piles every lon label onto the pole. */
function polarGraticuleFeatures(
  projection: string,
  { pole, edgeLatitude }: PolarGraticule,
): Array<Feature> {
  const sign = pole === 'north' ? 1 : -1
  const edge = Math.ceil(Math.abs(edgeLatitude) / 10) * 10
  const toMap = (lon: number, lat: number) =>
    transform([lon, sign * lat], 'EPSG:4326', projection)
  const features: Array<Feature> = []
  for (let lat = edge; lat <= 80; lat += 10) {
    const ring: Array<Array<number>> = []
    for (let lon = -180; lon <= 180; lon += 2) ring.push(toMap(lon, lat))
    features.push(new Feature(new LineString(ring)))
    const label = new Feature(new Point(toMap(0, lat)))
    label.set('label', hemi(sign * lat, 'N', 'S'))
    features.push(label)
  }
  for (let lon = -180; lon < 180; lon += 30) {
    const line: Array<Array<number>> = []
    for (let lat = edge; lat <= 85; lat += 5) line.push(toMap(lon, lat))
    features.push(new Feature(new LineString(line)))
    const label = new Feature(new Point(toMap(lon, edge)))
    label.set('label', lon === 0 ? '0°' : hemi(lon, 'E', 'W'))
    features.push(label)
  }
  return features
}

/** Coast + borders + graticule for a projection; styles fixed per theme. */
export function makeOutlineBasemapLayer(
  projection: string,
  extent: Extent | undefined,
  theme: OutlineTheme,
  polar?: PolarGraticule,
): LayerGroup {
  const palette = PALETTES[theme]
  const labelStyle = new Text({
    font: '10px system-ui, sans-serif',
    fill: new Fill({ color: palette.label }),
    backgroundFill: new Fill({ color: palette.labelPlate }),
    padding: [1, 3, 0, 3],
  })
  const gridStroke = new Stroke({
    color: palette.grid,
    width: 0.8,
    lineDash: [2, 4],
  })
  const graticule = polar
    ? new VectorLayer({
        source: new VectorSource({
          features: polarGraticuleFeatures(projection, polar),
        }),
        declutter: true,
        style: (feature) => {
          const label: unknown = feature.get('label')
          if (typeof label !== 'string')
            return new Style({ stroke: gridStroke })
          labelStyle.setText(label)
          return new Style({ text: labelStyle })
        },
      })
    : new Graticule({
        strokeStyle: gridStroke,
        showLabels: true,
        lonLabelStyle: labelStyle,
        latLabelStyle: labelStyle,
        targetSize: 140,
        wrapX: false,
      })
  return new LayerGroup({
    extent,
    layers: [
      new VectorLayer({
        source: dataSource(projection, (d) => d.countries),
        style: new Style({
          stroke: new Stroke({ color: palette.border, width: 0.6 }),
        }),
      }),
      new VectorLayer({
        source: dataSource(projection, (d) => d.coastlines),
        style: new Style({
          stroke: new Stroke({ color: palette.coast, width: 1 }),
        }),
      }),
      graticule,
    ],
  })
}
