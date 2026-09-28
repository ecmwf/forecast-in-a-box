/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Engine-agnostic globe camera math, OL handoff, and the shared camera store. */

import { fromLonLat, getPointResolution, toLonLat } from 'ol/proj'
import { containsCoordinate, getCenter } from 'ol/extent'
import { groundResolution } from '../projections'
import {
  EARTH_RADIUS_M,
  MAX_MERCATOR_LAT,
  MERCATOR_WORLD_M,
  lonLatToEquirectUnit,
  lonLatToMercatorUnit,
} from './sphere-math'
import type View from 'ol/View'
import type { Coordinate } from 'ol/coordinate'
import type { FlatProjectionId } from '../projection-ids'
import type { ViewerProjection } from '../projections'
import type {
  CameraMove,
  CameraOrigin,
  FlatCamera,
  FlatKind,
  GlobeCamera,
} from './engine'

/** Ground m/px at zoom 0 (OL's 256 px Web Mercator tile). */
export const EQUATOR_MPP_Z0 = MERCATOR_WORLD_M / 256

// Globe radius / viewport: resting fit, zoom-out floor, auto-exit point.
const FIT_RADIUS = 0.45
const MIN_RADIUS = 0.25
const EXIT_RADIUS = 1.5

export function groundMppFromZoom(zoom: number): number {
  return EQUATOR_MPP_Z0 / 2 ** zoom
}

export function zoomFromGroundMpp(mpp: number): number {
  return Math.log2(EQUATOR_MPP_Z0 / mpp)
}

/** Globe radius in px at the centre's ground scale. */
export function globeRadiusPx(zoom: number): number {
  return EARTH_RADIUS_M / groundMppFromZoom(zoom)
}

function zoomForRadius(px: number): number {
  return zoomFromGroundMpp(EARTH_RADIUS_M / px)
}

export function globeFitZoom(width: number, height: number): number {
  return zoomForRadius(FIT_RADIUS * Math.min(width, height))
}

export function globeMinZoom(width: number, height: number): number {
  return zoomForRadius(MIN_RADIUS * Math.min(width, height))
}

export function globeExitZoom(width: number, height: number): number {
  return zoomForRadius(EXIT_RADIUS * Math.max(width, height))
}

/** Rotate by a screen drag (px) at the centre's ground scale; north stays up. */
export function panGlobeCamera(
  camera: GlobeCamera,
  dxPx: number,
  dyPx: number,
): GlobeCamera {
  const degPerPx = 180 / (Math.PI * globeRadiusPx(camera.zoom))
  const lat = Math.max(-85, Math.min(85, camera.lat + dyPx * degPerPx))
  const lon =
    camera.lon -
    (dxPx * degPerPx) / Math.max(Math.cos((camera.lat * Math.PI) / 180), 0.2)
  return { ...camera, lat, lon: ((((lon + 180) % 360) + 360) % 360) - 180 }
}

/** Camera framing a WGS84 bbox (clamped to the resting fit and `maxZoom`). */
export function globeCameraForBbox(
  bbox: readonly [number, number, number, number],
  width: number,
  height: number,
  maxZoom: number,
): GlobeCamera {
  const [w, s, e, n] = bbox
  const lat = (s + n) / 2
  const spanDeg = Math.max((e - w) * Math.cos((lat * Math.PI) / 180), n - s)
  const spanM = (spanDeg * Math.PI * EARTH_RADIUS_M) / 180
  const zoom = zoomFromGroundMpp(spanM / (0.8 * Math.min(width, height)))
  return {
    lon: (w + e) / 2,
    lat,
    zoom: Math.min(maxZoom, Math.max(globeFitZoom(width, height), zoom)),
  }
}

/** Flat layouts the globe can bend from; null for polar/LAEA. */
export function flatKindOf(id: FlatProjectionId): FlatKind | null {
  return id === 'merc' || id === 'geo' ? id : null
}

/** Width of the whole flat world in px, for the morphable projections. */
export function worldWidthPx(view: View): number | null {
  const res = view.getResolution()
  if (res === undefined) return null
  const code = view.getProjection().getCode()
  if (code === 'EPSG:3857') return MERCATOR_WORLD_M / res
  if (code === 'EPSG:4326') return 360 / res
  return null
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

export function flatCameraOf(
  view: View,
  projection: FlatProjectionId,
): FlatCamera | null {
  const center = view.getCenter()
  const resolution = view.getResolution()
  if (!center || resolution === undefined) return null
  const [lon, lat] = toLonLat(center, view.getProjection())
  return { projection, lon, lat, resolution }
}

/** Same centre and centre ground scale as the flat view. */
export function globeCameraOf(view: View): GlobeCamera | null {
  const center = view.getCenter()
  const mpp = groundResolution(view)
  if (!center || mpp === null) return null
  const [lon, lat] = toLonLat(center, view.getProjection())
  return { lon, lat, zoom: zoomFromGroundMpp(mpp) }
}

/** Flat resolution matching the globe camera's centre ground scale. */
export function matchingFlatResolution(
  view: View,
  center: Coordinate,
  camera: GlobeCamera,
): number {
  const perUnit = getPointResolution(view.getProjection(), 1, center, 'm')
  const wanted =
    Number.isFinite(perUnit) && perUnit > 0
      ? groundMppFromZoom(camera.zoom) / perUnit
      : view.getMaxResolution()
  return Math.min(
    Math.max(wanted, view.getMinResolution()),
    view.getMaxResolution(),
  )
}

/** Point a flat view at a globe camera, constrained (out-of-extent → home centre). */
export function applyGlobeCamera(
  view: View,
  target: ViewerProjection,
  camera: GlobeCamera,
  size: readonly [number, number],
): void {
  view.setViewportSize([size[0], size[1]])
  const projection = view.getProjection()
  const lat = target.mercator
    ? Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, camera.lat))
    : camera.lat
  let center = fromLonLat([camera.lon, lat], projection)
  if (
    !center.every(Number.isFinite) ||
    !containsCoordinate(target.extent, center)
  ) {
    center = getCenter(target.homeExtent)
  }
  // Resolution first — the centre constraint depends on it.
  view.setResolution(matchingFlatResolution(view, center, camera))
  view.setCenter(center)
}

type CameraListener = (
  camera: GlobeCamera,
  origin: CameraOrigin,
  from: string,
  move?: CameraMove,
) => void

/** One camera for all globe panels; `from` lets a panel skip its own echo. */
export interface SharedGlobeCamera {
  get: () => GlobeCamera
  set: (
    camera: GlobeCamera,
    origin: CameraOrigin,
    from: string,
    move?: CameraMove,
  ) => void
  subscribe: (listener: CameraListener) => () => void
}

export function createSharedGlobeCamera(
  initial: GlobeCamera,
): SharedGlobeCamera {
  let current = initial
  const listeners = new Set<CameraListener>()
  return {
    get: () => current,
    set: (camera, origin, from, move) => {
      current = camera
      for (const listener of listeners) listener(camera, origin, from, move)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
