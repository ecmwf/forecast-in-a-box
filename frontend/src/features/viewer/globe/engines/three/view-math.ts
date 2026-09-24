/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Perspective camera on +Z looking at the unit sphere, camera centre facing it. */

import { groundMppFromZoom } from '../../globe-camera'
import {
  EARTH_RADIUS_M,
  MERCATOR_WORLD_M,
  lonLatToEquirectUnit,
  lonLatToMercatorUnit,
  unitSphereToLonLat,
} from '../../sphere-math'
import type { FlatCamera, GlobeCamera } from '../../engine'
import type { Vec3 } from '../../sphere-math'

export const FOV_DEG = 30
const TAN_HALF_FOV = Math.tan((FOV_DEG * Math.PI) / 360)
const D2R = Math.PI / 180

/** Camera distance (sphere radii) rendering the zoom's ground scale at the centre. */
export function cameraDistance(zoom: number, heightPx: number): number {
  return (
    1 +
    (heightPx * groundMppFromZoom(zoom)) / (2 * TAN_HALF_FOV * EARTH_RADIUS_M)
  )
}

/** Unit flat world → clip matching the OL view: clipX = kx(x − cx), clipY = ky(cy − y). */
export function flatClipTransform(
  flat: FlatCamera,
  widthPx: number,
  heightPx: number,
): { kx: number; ky: number; cx: number; cy: number } | null {
  let world: [number, number]
  let center: [number, number]
  if (flat.projection === 'merc') {
    world = [MERCATOR_WORLD_M, MERCATOR_WORLD_M]
    center = lonLatToMercatorUnit(flat.lon, flat.lat)
  } else if (flat.projection === 'geo') {
    world = [360, 180]
    center = lonLatToEquirectUnit(flat.lon, flat.lat)
  } else {
    return null
  }
  return {
    kx: (2 * world[0]) / (flat.resolution * widthPx),
    ky: (2 * world[1]) / (flat.resolution * heightPx),
    cx: center[0],
    cy: center[1],
  }
}

/** Model rotation inverse: camera-facing frame → world sphere. */
function toWorld(camera: GlobeCamera, [x, y, z]: Vec3): Vec3 {
  // rotX(-lat), then rotY(lon).
  const lat = -camera.lat * D2R
  const y1 = y * Math.cos(lat) - z * Math.sin(lat)
  const z1 = y * Math.sin(lat) + z * Math.cos(lat)
  const lon = camera.lon * D2R
  return [
    x * Math.cos(lon) + z1 * Math.sin(lon),
    y1,
    -x * Math.sin(lon) + z1 * Math.cos(lon),
  ]
}

/** Container px → lon/lat on the globe, null off the sphere. */
export function pickLonLat(
  px: readonly [number, number],
  size: readonly [number, number],
  camera: GlobeCamera,
): { lon: number; lat: number } | null {
  const [w, h] = size
  const d = cameraDistance(camera.zoom, h)
  const dir: Vec3 = [
    ((px[0] / w) * 2 - 1) * TAN_HALF_FOV * (w / h),
    (1 - (px[1] / h) * 2) * TAN_HALF_FOV,
    -1,
  ]
  const len = Math.hypot(...dir)
  const [dx, dy, dz] = dir.map((v) => v / len)
  // Ray (0, 0, d) + s·dir against the unit sphere.
  const b = d * dz
  const disc = b * b - (d * d - 1)
  if (disc < 0) return null
  const s = -b - Math.sqrt(disc)
  const [lon, lat] = unitSphereToLonLat(
    toWorld(camera, [s * dx, s * dy, d + s * dz]),
  )
  return { lon, lat }
}
