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
import type VectorTileSource from 'ol/source/VectorTile'
import { createLogger } from '@/lib/logger'

const log = createLogger('viewer')

// External web basemap (Carto vector); the SkinnyWMS native basemap is separate.
export interface ExternalBasemapOption {
  type: 'vector'
  id: string
  label: string
  // Mapbox-style JSON URL; ol-mapbox-style fetches it, builds the
  // source from its `sources` block, and applies styling.
  styleUrl: string
}

// SkinnyWMS's own map — `background` as the base, borders overlaid.
export interface SkinnyWmsBasemapOption {
  type: 'skinnywms'
  id: string
  label: string
}

// Public imagery served over plain WMS (satellite mosaics etc.).
export interface WmsImageBasemapOption {
  type: 'wms-image'
  id: string
  label: string
  url: string
  layerName: string
  attribution: string
}

export type BasemapOption =
  | ExternalBasemapOption
  | SkinnyWmsBasemapOption
  | WmsImageBasemapOption

export const BASEMAPS: ReadonlyArray<ExternalBasemapOption> = [
  {
    type: 'vector',
    id: 'carto-positron-vector',
    label: 'Carto Positron',
    styleUrl: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  },
]

// Curated public imagery basemaps — token-free, CORS-friendly, and
// allowlisted in the CSP (vite csp-loopback-hosts adds their hosts).
export const IMAGERY_BASEMAPS: ReadonlyArray<WmsImageBasemapOption> = [
  {
    type: 'wms-image',
    id: 'eox-sentinel2-cloudless',
    label: 'Sentinel-2 cloudless (EOX)',
    url: 'https://tiles.maps.eox.at/wms',
    layerName: 's2cloudless-2024_3857',
    attribution:
      'Sentinel-2 cloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data)',
  },
  {
    type: 'wms-image',
    id: 'gibs-bluemarble',
    label: 'Blue Marble (NASA)',
    url: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi',
    layerName: 'BlueMarble_ShadedRelief_Bathymetry',
    attribution: 'NASA EOSDIS Global Imagery Browse Services (GIBS)',
  },
]

// Fixed identity; the actual layers come from the lens capabilities.
export const SKINNYWMS_BASEMAP: SkinnyWmsBasemapOption = {
  type: 'skinnywms',
  id: 'skinnywms-native',
  label: 'SkinnyWMS (native)',
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
  // Vector tiles via Mapbox-style JSON. declutter: true prevents label
  // overlap at low zoom.
  const layer = new VectorTileLayer<VectorTileSource>({ declutter: true })
  applyMapboxStyle(layer, opt.styleUrl).catch((err) =>
    log.error('Failed to apply vector basemap style', { error: err }),
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
  })
}

/** Imagery WMS basemap — same single-image mode as the data layers. */
export function makeWmsImageBasemap(
  opt: WmsImageBasemapOption,
): ImageLayer<ImageWMS> {
  const source = makeDataLayerSource(opt.url, {
    LAYERS: opt.layerName,
    STYLES: '',
    FORMAT: 'image/jpeg',
    TRANSPARENT: 'FALSE',
  })
  source.setAttributions(opt.attribution)
  return new ImageLayer({ source })
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
  return new ImageLayer({ source })
}
