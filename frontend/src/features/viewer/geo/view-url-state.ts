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
 * Slim view state carried in /visualise search params so a copied URL
 * (or F5) reproduces the view, not just the source pair: active layer
 * stacks, valid time, time-link policy, camera, basemap. Deliberately
 * excluded: annotations/overlays (unbounded — they have file export
 * flows), per-layer opacities, the time clip, and independent-mode
 * per-side instants.
 */

// Import discipline: VisualisePage uses this module statically while the
// viewer chunk stays lazy — nothing here may pull in OpenLayers.
import type { TimeLinkMode } from './time-link'

export interface ViewerCamera {
  lon: number
  lat: number
  zoom: number
}

export interface ViewerUrlState {
  /** Active layer NAMES per slot, top of the stack first. */
  layersA?: ReadonlyArray<string>
  layersB?: ReadonlyArray<string>
  /** True = per-side selection (unlinked). */
  unlinkedLayers?: boolean
  /** Shared-axis valid time, epoch ms. */
  timeMs?: number
  timeLink?: TimeLinkMode
  offsetMs?: number
  camera?: ViewerCamera
  basemap?: string
}

/** The search-param projection. Every key is always present (possibly
 *  undefined) so spreading over `prev` strips stale values. */
export interface ViewerSearchState {
  la: string | undefined
  lb: string | undefined
  ul: true | undefined
  t: number | undefined
  tl: Exclude<TimeLinkMode, 'exact'> | undefined
  dt: number | undefined
  cam: string | undefined
  bm: string | undefined
}

/** Stack size cap — beyond this a URL stops being a view description. */
const MAX_URL_LAYERS = 12
/** Per-param budget keeping the whole URL comfortably under ~2 KB. */
const MAX_NAMES_CHARS = 1500

/** WMS reserves the comma as the LAYERS separator, so names can't
 *  contain one — a name that somehow does is dropped, not split. */
function joinNames(names: ReadonlyArray<string>): string | undefined {
  const kept: Array<string> = []
  let length = 0
  for (const name of names) {
    if (name.length === 0 || name.includes(',')) continue
    if (kept.length >= MAX_URL_LAYERS || length + name.length > MAX_NAMES_CHARS)
      break
    kept.push(name)
    length += name.length + 1
  }
  return kept.length > 0 ? kept.join(',') : undefined
}

function splitNames(value: string | undefined): Array<string> | undefined {
  if (!value) return undefined
  // Deduped: restore toggles once per name.
  const names = [
    ...new Set(value.split(',').filter((n) => n.length > 0)),
  ].slice(0, MAX_URL_LAYERS)
  return names.length > 0 ? names : undefined
}

// In-range values pass through untouched — the modulo arithmetic would
// smear them with float error.
const wrapLon = (lon: number): number =>
  lon >= -180 && lon <= 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180

function encodeCamera(camera: ViewerCamera): string | undefined {
  const { lon, lat, zoom } = camera
  if (![lon, lat, zoom].every(Number.isFinite)) return undefined
  // ~1 km center precision; zoom to 2 decimals.
  return `${wrapLon(lon).toFixed(2)},${lat.toFixed(2)},${zoom.toFixed(2)}`
}

function decodeCamera(value: string | undefined): ViewerCamera | undefined {
  if (!value) return undefined
  const parts = value.split(',').map(Number)
  if (parts.length !== 3 || !parts.every(Number.isFinite)) return undefined
  const [lon, lat, zoom] = parts
  if (Math.abs(lat) > 90 || zoom < 0 || zoom > 28) return undefined
  return { lon: wrapLon(lon), lat, zoom }
}

export function encodeViewerUrlState(state: ViewerUrlState): ViewerSearchState {
  const offset =
    state.timeLink === 'offset' && state.offsetMs
      ? Math.round(state.offsetMs)
      : undefined
  return {
    la: state.layersA ? joinNames(state.layersA) : undefined,
    lb: state.layersB ? joinNames(state.layersB) : undefined,
    ul: state.unlinkedLayers === true ? true : undefined,
    t: state.timeMs !== undefined ? Math.round(state.timeMs) : undefined,
    tl:
      state.timeLink !== undefined && state.timeLink !== 'exact'
        ? state.timeLink
        : undefined,
    dt: offset === 0 ? undefined : offset,
    cam: state.camera ? encodeCamera(state.camera) : undefined,
    // The default basemap is reported as undefined at the source.
    bm: state.basemap,
  }
}

export function decodeViewerUrlState(
  search: Partial<ViewerSearchState>,
): ViewerUrlState {
  return {
    layersA: splitNames(search.la),
    layersB: splitNames(search.lb),
    unlinkedLayers: search.ul === true ? true : undefined,
    timeMs: Number.isFinite(search.t) ? search.t : undefined,
    timeLink: search.tl,
    offsetMs:
      search.tl === 'offset' && Number.isFinite(search.dt)
        ? search.dt
        : undefined,
    camera: decodeCamera(search.cam),
    basemap: search.bm,
  }
}
