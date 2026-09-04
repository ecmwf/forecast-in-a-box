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
 * Slim view state in /visualise search params — a copied URL (or F5)
 * reproduces the view: layer stacks, valid time, time-link, camera,
 * basemap. Excluded: annotations/overlays (unbounded — export flows),
 * opacities, time clip, independent per-side instants.
 */

// The page imports this statically — keep OpenLayers out of the main chunk.
import { isProjectionId } from '../projection-ids'
import type { ProjectionId } from '../projection-ids'
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
  /** Style per layer, aligned with `layersA`/`layersB`; null = default. */
  stylesA?: ReadonlyArray<string | null>
  stylesB?: ReadonlyArray<string | null>
  /** Pinned model run (reference_time) per layer, aligned; null = latest. */
  runsA?: ReadonlyArray<string | null>
  runsB?: ReadonlyArray<string | null>
  /** True = per-side selection (unlinked). */
  unlinkedLayers?: boolean
  /** Shared-axis valid time, epoch ms. */
  timeMs?: number
  timeLink?: TimeLinkMode
  offsetMs?: number
  /** Camera; `zoom` is relative to `projection`. */
  camera?: ViewerCamera
  basemap?: string
  projection?: ProjectionId
}

/** Search-param projection; every key present so spreads strip stale values. */
export interface ViewerSearchState {
  la: string | undefined
  lb: string | undefined
  sa: string | undefined
  sb: string | undefined
  ra: string | undefined
  rb: string | undefined
  ul: true | undefined
  t: number | undefined
  tl: Exclude<TimeLinkMode, 'exact'> | undefined
  dt: number | undefined
  cam: string | undefined
  bm: string | undefined
  p: ProjectionId | undefined
}

/** Stack size cap — beyond this a URL stops being a view description. */
const MAX_URL_LAYERS = 12
/** Per-param budget keeping the whole URL comfortably under ~2 KB. */
const MAX_NAMES_CHARS = 1500

/** Two aligned comma lists; a comma drops a name, defaults a style. */
function encodeStack(
  names: ReadonlyArray<string>,
  styles: ReadonlyArray<string | null> | undefined,
): { names: string | undefined; styles: string | undefined } {
  const keptNames: Array<string> = []
  const keptStyles: Array<string> = []
  let length = 0
  for (const [i, name] of names.entries()) {
    if (name.length === 0 || name.includes(',')) continue
    if (
      keptNames.length >= MAX_URL_LAYERS ||
      length + name.length > MAX_NAMES_CHARS
    )
      break
    keptNames.push(name)
    length += name.length + 1
    const style = styles?.[i]
    keptStyles.push(style && !style.includes(',') ? style : '')
  }
  return {
    names: keptNames.length > 0 ? keptNames.join(',') : undefined,
    // Trailing defaults are dropped; all-default → absent.
    styles: keptStyles.some(Boolean)
      ? keptStyles.join(',').replace(/,+$/, '')
      : undefined,
  }
}

function decodeStack(
  names: string | undefined,
  styles: string | undefined,
): {
  names: Array<string> | undefined
  styles: Array<string | null> | undefined
} {
  if (!names) return { names: undefined, styles: undefined }
  const rawStyles = (styles ?? '').split(',')
  const seen = new Set<string>()
  const outNames: Array<string> = []
  const outStyles: Array<string | null> = []
  // Deduped: restore toggles once per name (first occurrence wins).
  for (const [i, name] of names.split(',').entries()) {
    if (!name || seen.has(name) || outNames.length >= MAX_URL_LAYERS) continue
    seen.add(name)
    outNames.push(name)
    outStyles.push(rawStyles[i] || null)
  }
  return {
    names: outNames.length > 0 ? outNames : undefined,
    styles: outStyles.some(Boolean) ? outStyles : undefined,
  }
}

// In-range values pass through — the modulo smears them with float error.
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
  const a = encodeStack(state.layersA ?? [], state.stylesA)
  const b = encodeStack(state.layersB ?? [], state.stylesB)
  const runA = encodeStack(state.layersA ?? [], state.runsA)
  const runB = encodeStack(state.layersB ?? [], state.runsB)
  return {
    la: state.layersA ? a.names : undefined,
    lb: state.layersB ? b.names : undefined,
    sa: state.layersA ? a.styles : undefined,
    sb: state.layersB ? b.styles : undefined,
    ra: state.layersA ? runA.styles : undefined,
    rb: state.layersB ? runB.styles : undefined,
    ul: state.unlinkedLayers === true ? true : undefined,
    t: state.timeMs !== undefined ? Math.round(state.timeMs) : undefined,
    tl:
      state.timeLink !== undefined && state.timeLink !== 'exact'
        ? state.timeLink
        : undefined,
    dt: offset === 0 ? undefined : offset,
    cam: state.camera ? encodeCamera(state.camera) : undefined,
    // The default basemap/projection are reported as undefined at the source.
    bm: state.basemap,
    p: state.projection,
  }
}

export function decodeViewerUrlState(
  search: Partial<ViewerSearchState>,
): ViewerUrlState {
  const a = decodeStack(search.la, search.sa)
  const b = decodeStack(search.lb, search.sb)
  return {
    layersA: a.names,
    layersB: b.names,
    stylesA: a.styles,
    stylesB: b.styles,
    runsA: decodeStack(search.la, search.ra).styles,
    runsB: decodeStack(search.lb, search.rb).styles,
    unlinkedLayers: search.ul === true ? true : undefined,
    timeMs: Number.isFinite(search.t) ? search.t : undefined,
    timeLink: search.tl,
    offsetMs:
      search.tl === 'offset' && Number.isFinite(search.dt)
        ? search.dt
        : undefined,
    camera: decodeCamera(search.cam),
    basemap: search.bm,
    projection: isProjectionId(search.p) ? search.p : undefined,
  }
}
