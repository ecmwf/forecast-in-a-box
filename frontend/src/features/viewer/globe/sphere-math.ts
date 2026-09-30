/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Unit-sphere and unit-square flat-world coordinates, in MapLibre's conventions. */

/** Sphere radius (m) — MapLibre's value. */
export const EARTH_RADIUS_M = 6371008.8
/** Web Mercator world circumference (m), EPSG:3857. */
export const MERCATOR_WORLD_M = 2 * Math.PI * 6378137
/** Web Mercator's latitude limit. */
export const MAX_MERCATOR_LAT = 85.0511287798066

const D2R = Math.PI / 180

type Vec3 = [number, number, number]

/** Degrees -> point on the unit sphere. */
export function lonLatToUnitSphere(lon: number, lat: number): Vec3 {
  const cosLat = Math.cos(lat * D2R)
  return [
    cosLat * Math.sin(lon * D2R),
    Math.sin(lat * D2R),
    cosLat * Math.cos(lon * D2R),
  ]
}

/** Mercator unit world (MapLibre's MercatorCoordinate); poles clamp. */
export function lonLatToMercatorUnit(
  lon: number,
  lat: number,
): [number, number] {
  const phi = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * D2R
  return [
    (lon + 180) / 360,
    (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2,
  ]
}

/** Equirectangular unit world. */
export function lonLatToEquirectUnit(
  lon: number,
  lat: number,
): [number, number] {
  return [(lon + 180) / 360, (90 - lat) / 180]
}
