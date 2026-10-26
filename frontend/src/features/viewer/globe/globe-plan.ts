/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Which EPSG:4326 GetMaps a globe layer needs and how large: every sizing rule, pure. */

import { get as getProjection } from 'ol/proj'
import { getRequestParams, getRequestUrl } from 'ol/source/wms'
import { isWorldBbox } from '../wms-capabilities'
import { globeRadiusPx } from './globe-camera'
import type { GlobeLayerSpec } from './engine'

/** [west, south, east, north] in degrees; the east edge may pass 180 across the antimeridian. */
export type Region = readonly [number, number, number, number]

export const WORLD_REGION: Region = [-180, -90, 180, 90]

/** First request per layer at most this wide, then upgraded to on-screen detail. */
const FIRST_SIDE = 1024
const MAX_SIDE = 4096
/** Refetch when the wanted detail beats the shown one by this factor. */
const UPGRADE_FACTOR = 1.25

/** Camera and viewport the images are sized for. */
export interface ViewState {
  lon: number
  lat: number
  zoom: number
  width: number
  height: number
}

/** The layer's bbox; the world when (near-)global, 0-360 or dateline-crossing. */
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

/** Largest image sides: ours, the GPU's and the server's MaxWidth/MaxHeight. */
export function imageLimits(
  spec: GlobeLayerSpec,
  gpuMax = MAX_SIDE,
): [number, number] {
  const cap = Math.min(MAX_SIDE, gpuMax)
  const [w, h] = spec.maxImageSize ?? [cap, cap]
  return [Math.min(cap, w), Math.min(cap, h)]
}

/** px/degree giving one texel per screen px at the view centre. */
export const wantedScale = (zoom: number) =>
  (2 * Math.PI * globeRadiusPx(zoom)) / 360

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

/** GPU bytes of an image: RGBA plus a third for the mipmaps. */
export const bytesOf = (size: readonly [number, number]) =>
  Math.ceil((size[0] * size[1] * 4 * 4) / 3)

/** Largest scale up to `scale` whose image fits `free` bytes. */
export function fitScale(region: Region, scale: number, free: number): number {
  const need = (at: number) => bytesOf(regionSize(region, at))
  if (need(scale) <= free) return scale
  let fit = scale * Math.sqrt(Math.max(free, 0) / need(scale))
  // Sizes round to whole pixels, which can tip the estimate over.
  for (let i = 0; i < 32 && need(fit) > free; i++) fit *= 0.98
  return fit
}

/** One texel per screen px at the centre, within the size limits. */
export function targetScale(
  spec: GlobeLayerSpec,
  zoom: number,
  limits: readonly [number, number],
): number {
  return regionScale(layerRegion(spec), wantedScale(zoom), limits)
}

/** The first, quick image: at most FIRST_SIDE wide. */
export function firstScale(
  spec: GlobeLayerSpec,
  zoom: number,
  limits: readonly [number, number],
): number {
  const [w, , e] = layerRegion(spec)
  return Math.min(targetScale(spec, zoom, limits), FIRST_SIDE / (e - w))
}

/** World image scale asked for at `wanted`: the budget bounds it, but a first image always loads. */
export function worldScale(
  spec: GlobeLayerSpec,
  wanted: number,
  zoom: number,
  limits: readonly [number, number],
  free: number,
): number {
  return Math.max(
    fitScale(layerRegion(spec), wanted, free),
    Math.min(wanted, firstScale(spec, zoom, limits)),
  )
}

/** A sharper world image worth fetching, or null. */
export function worldUpgrade(
  spec: GlobeLayerSpec,
  zoom: number,
  limits: readonly [number, number],
  free: number,
  shownScale: number,
): number | null {
  const target = fitScale(
    layerRegion(spec),
    targetScale(spec, zoom, limits),
    free,
  )
  return target > shownScale * UPGRADE_FACTOR ? target : null
}

/** World image scale for a new instant: small when a view image covers the screen, else as sharp as shown. */
export function refetchScale(
  spec: GlobeLayerSpec,
  zoom: number,
  limits: readonly [number, number],
  shownScale: number,
  viewShown: boolean,
): number {
  const first = firstScale(spec, zoom, limits)
  if (viewShown) return first
  return Math.max(first, Math.min(shownScale, targetScale(spec, zoom, limits)))
}

/** The area on screen, with margin; its east edge may run past 180 deg across the antimeridian. */
export function visibleRegion(v: ViewState): Region {
  const ppd = (Math.PI * globeRadiusPx(v.zoom)) / 180
  const dLat = (v.height / 2 / ppd) * 1.5
  const s = Math.max(-90, v.lat - dLat)
  const n = Math.min(90, v.lat + dLat)
  // A pole in view shows every longitude.
  if (s <= -90 || n >= 90) return [-180, s, 180, n]
  const dLon =
    (v.width / 2 / (ppd * Math.max(0.1, Math.cos((v.lat * Math.PI) / 180)))) *
    1.5
  if (dLon >= 180) return [-180, s, 180, n]
  const w = v.lon - dLon
  return w < -180
    ? [w + 360, s, v.lon + dLon + 360, n]
    : [w, s, v.lon + dLon, n]
}

function intersect(a: Region, b: Region): Region | null {
  const r: Region = [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ]
  return r[0] < r[2] && r[1] < r[3] ? r : null
}

/** A view region clipped to a layer's; it continues across the antimeridian only where both do. */
export function overlap(view: Region, layer: Region): Region | null {
  if (view[2] <= 180) return intersect(view, layer)
  const east = intersect([view[0], view[1], 180, view[3]], layer)
  const west = intersect([-180, view[1], view[2] - 360, view[3]], layer)
  if (east && west) return [east[0], east[1], west[2] + 360, east[3]]
  return east ?? west
}

const within = (a: Region, b: Region) =>
  a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3]

/** `a` holds `b`, either written with or without the 360 deg shift. */
export const covers = (a: Region, b: Region) =>
  within(a, b) ||
  within(a, [b[0] + 360, b[1], b[2] + 360, b[3]]) ||
  within(a, [b[0] - 360, b[1], b[2] - 360, b[3]])

/** What a layer's view image should do. */
export type ViewPlan =
  | { kind: 'drop' }
  | { kind: 'keep' }
  | { kind: 'load'; region: Region; scale: number }

/** Drop the view image (the world image suffices), keep what is shown, or load `region` at `scale`. */
export function planViewImage({
  spec,
  view,
  limits,
  free,
  shown,
}: {
  spec: GlobeLayerSpec
  view: ViewState
  limits: readonly [number, number]
  free: number
  /** The shown view image, when it is of the current params. */
  shown: { region: Region; scale: number } | null
}): ViewPlan {
  const wanted = wantedScale(view.zoom)
  const worldCap = regionScale(layerRegion(spec), wanted, limits)
  if (wanted <= worldCap * UPGRADE_FACTOR) return { kind: 'drop' }
  const region = overlap(visibleRegion(view), layerRegion(spec))
  if (!region) return { kind: 'keep' }
  // Within budget the view image must still beat the world image.
  const scale = fitScale(region, regionScale(region, wanted, limits), free)
  if (scale <= worldCap * UPGRADE_FACTOR) return { kind: 'keep' }
  if (
    shown &&
    shown.scale * UPGRADE_FACTOR >= scale &&
    covers(shown.region, region)
  )
    return { kind: 'keep' }
  return { kind: 'load', region, scale }
}

/** The GetMaps for `region`: one, or two halves past 180 deg on a pixel grid anchored there; `region` is what they cover. */
export function requestParts(
  region: Region,
  scale: number,
): {
  parts: Array<{ region: Region; size: [number, number] }>
  region: Region
} {
  const [w, s, e, n] = region
  if (e <= 180)
    return { parts: [{ region, size: regionSize(region, scale) }], region }
  const height = Math.max(1, Math.round((n - s) * scale))
  const west = Math.max(1, Math.round((180 - w) * scale))
  const east = Math.max(1, Math.round((e - 180) * scale))
  return {
    parts: [
      { region: [180 - west / scale, s, 180, n], size: [west, height] },
      { region: [-180, s, east / scale - 180, n], size: [east, height] },
    ],
    region: [180 - west / scale, s, 180 + east / scale, n],
  }
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
