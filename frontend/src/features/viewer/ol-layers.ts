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
 * OpenLayers layer factories and constants shared by the WMS viewers.
 *
 * INVARIANTS (breaking these silently kills swipe clipping and PNG export):
 * - Never set `className` on any layer. All canvas-renderer layers must
 *   share OL's single composited canvas — the compare viewer's
 *   prerender/postrender clipping and `querySelector('canvas')` PNG export
 *   both rely on it.
 * - Data/WMS sources keep `hidpi: false, ratio: 1, crossOrigin: 'anonymous'`
 *   (see makeDataLayerSource for why).
 */

import ImageLayer from 'ol/layer/Image'
import VectorTileLayer from 'ol/layer/VectorTile'
import ImageWMS from 'ol/source/ImageWMS'
import { fromLonLat } from 'ol/proj'
import { applyStyle as applyMapboxStyle } from 'ol-mapbox-style'
import { toWmsEndpoint } from './wms-capabilities'
import type { LoadFunction } from 'ol/Image'
import type VectorTileSource from 'ol/source/VectorTile'
import { createLogger } from '@/lib/logger'

const log = createLogger('viewer')

// External web basemap (Carto vector); the SkinnyWMS native basemap is separate.
export interface ExternalBasemapOption {
  type: 'vector'
  id: string
  labelKey: BasemapLabelKey
  // Mapbox-style JSON URL; ol-mapbox-style fetches it, builds the
  // source from its `sources` block, and applies styling.
  styleUrl: string
}

/** `visualise`-namespace keys — resolved with `t()` at render. */
type BasemapLabelKey = 'basemaps.cartoPositron' | 'basemaps.skinnywms'

// SkinnyWMS's own map — `background` as the base, borders overlaid.
export interface SkinnyWmsBasemapOption {
  type: 'skinnywms'
  id: string
  labelKey: BasemapLabelKey
}

export type BasemapOption = ExternalBasemapOption | SkinnyWmsBasemapOption

// Imagery basemaps (EOX cloudless, NASA GIBS) removed pending licensing
// review — the wms-image machinery lives in git history.
export const BASEMAPS: ReadonlyArray<ExternalBasemapOption> = [
  {
    type: 'vector',
    id: 'carto-positron-vector',
    labelKey: 'basemaps.cartoPositron',
    styleUrl: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  },
]

// Fixed identity; the actual layers come from the lens capabilities.
export const SKINNYWMS_BASEMAP: SkinnyWmsBasemapOption = {
  type: 'skinnywms',
  id: 'skinnywms-native',
  labelKey: 'basemaps.skinnywms',
}

export const DEFAULT_BASEMAP_ID = BASEMAPS[0].id
export const DEFAULT_LAYER_OPACITY = 0.85
// SkinnyWMS border overlay sits above every data layer.
export const REFERENCE_OVERLAY_Z = 1000

// Standard Web Mercator world extent (projection asymptotes at ±85.0511°);
// constrains panning to the basemap's coverage.
export const WEB_MERCATOR_EXTENT: [number, number, number, number] = [
  ...fromLonLat([-180, -85.0511]),
  ...fromLonLat([180, 85.0511]),
] as [number, number, number, number]

// Initial fit target — full longitude, latitude biased north so Antarctica
// is cropped and Scandinavia gets proper screen real estate. "Fit to
// globe" toolbar button overrides with the full WMS bbox.
export const INITIAL_VIEW_BBOX_WGS84: [number, number, number, number] = [
  -180, -55, 180, 85,
]

export type ExternalBasemapLayer = VectorTileLayer
export type BasemapLayer = ExternalBasemapLayer | ImageLayer<ImageWMS>

export function makeBasemapLayer(
  opt: ExternalBasemapOption,
): ExternalBasemapLayer {
  // Vector tiles (Mapbox-style JSON). declutter: no label overlap; extent: one world so margins stay empty.
  const layer = new VectorTileLayer<VectorTileSource>({
    declutter: true,
    extent: WEB_MERCATOR_EXTENT,
  })
  // Empty CSS suppresses ol-mapbox-style's broken jsdelivr fontsource fetch; labels fall back to stack fonts.
  applyMapboxStyle(layer, opt.styleUrl, { webfonts: '/empty-font.css' }).catch(
    (err) => log.error('Failed to apply vector basemap style', { error: err }),
  )
  return layer
}

/**
 * ImageWMS source for lens data layers (and SkinnyWMS decoration layers).
 * Single-image mode (vs. TileWMS) so OL atomically swaps to the new image
 * when params change — avoids the staggered per-tile sweep that flickers
 * during time-slider scrubbing.
 *
 * hidpi: false keeps Magics-rendered symbols (wind barbs, contour widths,
 * isobar labels) at full visual size on retina — the default 2× DPI request
 * halves them. ratio: 1 disables the 1.5× pan-slack oversampling for cleaner
 * cache keys. crossOrigin: 'anonymous' keeps the shared canvas untainted so
 * PNG export works.
 */
/** Decode failure → error state for real load failures. */
const FAILED_IMAGE_SRC = 'data:image/gif;base64,invalid'

/** Valid 1×1 transparent PNG — settles superseded wrappers as LOADED. */
const BLANK_IMAGE_SRC =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** The GetMap URL a load was issued for — `img.src` becomes a blob URL. */
export function loadRequestUrl(img: unknown): string | null {
  return img instanceof HTMLImageElement
    ? (img.dataset.fiabRequestUrl ?? null)
    : null
}

/** Did this load settle as a superseded (aborted) request? */
export function loadWasAborted(img: unknown): boolean {
  return img instanceof HTMLImageElement && img.dataset.fiabAborted === '1'
}

/** Fetch-based GetMap loader: a superseded request (pan/zoom/scrub) aborts
 *  the previous one — at most one in flight per source, always the latest. */
export function cancellingImageLoader(): LoadFunction {
  let inFlight: AbortController | null = null
  return (image, src) => {
    inFlight?.abort()
    const controller = new AbortController()
    inFlight = controller
    const img = image.getImage() as HTMLImageElement
    img.dataset.fiabRequestUrl = src
    delete img.dataset.fiabAborted
    fetch(src, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`GetMap ${res.status}`)
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const revoke = () => URL.revokeObjectURL(url)
        img.addEventListener('load', revoke, { once: true })
        img.addEventListener('error', revoke, { once: true })
        img.src = url
      })
      .catch(() => {
        if (controller.signal.aborted) {
          // Superseded. The source already replaced this wrapper, but OL
          // keeps `source.loading` true (blocking rendercomplete and the
          // panel loading counters) until it settles — settle it as a
          // blank LOADED pixel (an error src would console.error inside
          // OL), flagged so load accounting ignores it.
          img.dataset.fiabAborted = '1'
          img.src = BLANK_IMAGE_SRC
          return
        }
        img.src = FAILED_IMAGE_SRC
      })
  }
}

export function makeDataLayerSource(
  baseUrl: string,
  params: Record<string, string>,
): ImageWMS {
  return new ImageWMS({
    // OL appends its own params with the correct separator, so full
    // endpoints with an existing query string are safe here.
    url: toWmsEndpoint(baseUrl),
    params,
    serverType: 'mapserver',
    crossOrigin: 'anonymous',
    hidpi: false,
    ratio: 1,
    imageLoadFunction: cancellingImageLoader(),
  })
}

// SkinnyWMS's `background` layer as a basemap — ImageWMS, like the data layers.
export function makeSkinnyWmsBasemap(
  baseUrl: string,
  backgroundLayerName: string,
): ImageLayer<ImageWMS> {
  const source = makeDataLayerSource(baseUrl, {
    LAYERS: backgroundLayerName,
    STYLES: '',
    FORMAT: 'image/png',
    // Opaque — it's the base layer.
    TRANSPARENT: 'FALSE',
  })
  return new ImageLayer({ source, extent: WEB_MERCATOR_EXTENT })
}
