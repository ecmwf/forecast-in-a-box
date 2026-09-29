/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** EPSG:4326 GetMaps for globe textures: the layer's own area at a given detail. */

import { get as getProjection } from 'ol/proj'
import { getRequestParams, getRequestUrl } from 'ol/source/wms'
import { isWorldBbox } from '../wms-capabilities'
import type { GlobeLayerSpec } from './engine'

/** [west, south, east, north] in degrees. */
export type Region = readonly [number, number, number, number]

export const WORLD_REGION: Region = [-180, -90, 180, 90]

/** The layer's bbox; the world when (near-)global, 0–360 or dateline-crossing. */
export function layerRegion(spec: GlobeLayerSpec): Region {
  const b = spec.bbox
  if (
    !b ||
    isWorldBbox(b) ||
    b[0] < -180 ||
    b[2] > 180 ||
    b[0] >= b[2] ||
    b[1] >= b[3] ||
    b[2] - b[0] >= 359
  ) {
    return WORLD_REGION
  }
  return [b[0], Math.max(-90, b[1]), b[2], Math.min(90, b[3])]
}

/** Achievable px/degree: `ppd`, capped so neither side exceeds its pixel limit. */
export function regionScale(
  region: Region,
  ppd: number,
  [maxWidth, maxHeight]: readonly [number, number],
): number {
  const [w, s, e, n] = region
  return Math.min(ppd, maxWidth / (e - w), maxHeight / (n - s))
}

/** Image size of a region at `scale` px/degree; square pixels, as servers like SkinnyWMS letterbox others. */
export function regionSize(region: Region, scale: number): [number, number] {
  const [w, s, e, n] = region
  return [
    Math.max(1, Math.round((e - w) * scale)),
    Math.max(1, Math.round((n - s) * scale)),
  ]
}

/** GetMap for a region; OL builds it, so the 1.3.0 lat-first BBOX matches 2D 'geo'. */
export function regionGetMapUrl(
  spec: GlobeLayerSpec,
  region: Region,
  size: readonly [number, number],
): string {
  return getRequestUrl(
    spec.endpoint,
    [...region],
    [size[0], size[1]],
    getProjection('EPSG:4326')!,
    getRequestParams({ ...spec.params }, 'GetMap'),
  )
}
