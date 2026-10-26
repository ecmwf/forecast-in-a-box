/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** CPU-side geometry: every vertex carries its sphere, equirect and Mercator position. */

import {
  lonLatToEquirectUnit,
  lonLatToMercatorUnit,
  lonLatToUnitSphere,
} from '../sphere-math'

export interface Geometry {
  sphere: Float32Array
  geo: Float32Array
  merc: Float32Array
  /** Triangles when present; line segments (pairs) otherwise. */
  index?: Uint32Array
}

function geometryOf(lonLats: ReadonlyArray<number>): Geometry {
  const n = lonLats.length / 2
  const sphere = new Float32Array(n * 3)
  const geo = new Float32Array(n * 2)
  const merc = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    const lon = lonLats[2 * i]
    const lat = lonLats[2 * i + 1]
    // Seam columns share one position: rasterisation is watertight only then.
    sphere.set(lonLatToUnitSphere(lon >= 180 ? lon - 360 : lon, lat), 3 * i)
    geo.set(lonLatToEquirectUnit(lon, lat), 2 * i)
    merc.set(lonLatToMercatorUnit(lon, lat), 2 * i)
  }
  return { sphere, geo, merc }
}

/** Lon/lat grid (1.4 deg x 1 deg), shared by the base and every layer. */
export function surfaceGeometry(nLon = 256, nLat = 180): Geometry {
  const lonLats: Array<number> = []
  for (let j = 0; j <= nLat; j++) {
    for (let i = 0; i <= nLon; i++) {
      lonLats.push(-180 + (360 * i) / nLon, 90 - (180 * j) / nLat)
    }
  }
  const index = new Uint32Array(nLon * nLat * 6)
  const row = nLon + 1
  let k = 0
  for (let j = 0; j < nLat; j++) {
    for (let i = 0; i < nLon; i++) {
      const a = j * row + i
      index.set([a, a + row, a + 1, a + 1, a + row, a + row + 1], k)
      k += 6
    }
  }
  return { ...geometryOf(lonLats), index }
}

/** Polylines (lon/lat pairs) as segments, densified so they follow the sphere. */
export function linesGeometry(
  lines: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
): Geometry {
  const lonLats: Array<number> = []
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [lon0, lat0] = line[i - 1]
      const [lon1, lat1] = line[i]
      // Antimeridian jumps are not segments.
      if (Math.abs(lon1 - lon0) > 180) continue
      const steps = Math.max(
        1,
        Math.ceil(Math.max(Math.abs(lon1 - lon0), Math.abs(lat1 - lat0)) / 2),
      )
      for (let s = 0; s < steps; s++) {
        const f0 = s / steps
        const f1 = (s + 1) / steps
        lonLats.push(
          lon0 + (lon1 - lon0) * f0,
          lat0 + (lat1 - lat0) * f0,
          lon0 + (lon1 - lon0) * f1,
          lat0 + (lat1 - lat0) * f1,
        )
      }
    }
  }
  return geometryOf(lonLats)
}

type Position = ReadonlyArray<number>

/** LineString / Polygon (and Multi*) coordinates of a GeoJSON object. */
export function geojsonLines(json: unknown): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = []
  const addLine = (coords: unknown) => {
    if (!Array.isArray(coords)) return
    out.push(
      (coords as Array<Position>)
        .filter((p) => Array.isArray(p) && p.length >= 2)
        .map((p) => [p[0], p[1]]),
    )
  }
  const visitGeometry = (geometry: unknown) => {
    if (!geometry || typeof geometry !== 'object') return
    const { type, coordinates } = geometry as {
      type?: string
      coordinates?: unknown
    }
    if (!Array.isArray(coordinates)) return
    if (type === 'LineString') addLine(coordinates)
    else if (type === 'MultiLineString' || type === 'Polygon')
      coordinates.forEach(addLine)
    else if (type === 'MultiPolygon')
      coordinates.forEach(
        (poly) => Array.isArray(poly) && poly.forEach(addLine),
      )
  }
  const root = json as {
    type?: string
    features?: Array<{ geometry?: unknown }>
  }
  if (root.type === 'FeatureCollection') {
    for (const feature of root.features ?? []) visitGeometry(feature.geometry)
  } else {
    visitGeometry(root)
  }
  return out
}

/** 30 deg graticule; meridians stop short of the poles. */
export function graticuleLines(): Array<Array<[number, number]>> {
  const lines: Array<Array<[number, number]>> = []
  for (let lon = -180; lon < 180; lon += 30) {
    const line: Array<[number, number]> = []
    for (let lat = -80; lat <= 80; lat += 2) line.push([lon, lat])
    lines.push(line)
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const line: Array<[number, number]> = []
    for (let lon = -180; lon <= 180; lon += 2) line.push([lon, lat])
    lines.push(line)
  }
  return lines
}
