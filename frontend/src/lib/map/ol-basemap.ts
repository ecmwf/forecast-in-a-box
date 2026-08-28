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
 * Shared OpenLayers basemap helper: Carto Positron vector tiles — Carto
 * watermarks keyless RASTER tiles ("API KEY REQUIRED", 2026-08); the
 * vector service is not (yet) enforced. Hosts are CSP-allowlisted.
 */

import VectorTileLayer from 'ol/layer/VectorTile'
import { fromLonLat } from 'ol/proj'
import { applyStyle as applyMapboxStyle } from 'ol-mapbox-style'
import type VectorTileSource from 'ol/source/VectorTile'
import { createLogger } from '@/lib/logger'

const log = createLogger('map')

export const CARTO_POSITRON_STYLE_URL =
  'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

/** Standard Web Mercator world extent (the projection asymptotes at ±85.0511°). */
export const WEB_MERCATOR_EXTENT: [number, number, number, number] = [
  ...fromLonLat([-180, -85.0511]),
  ...fromLonLat([180, 85.0511]),
] as [number, number, number, number]

/** Vector-tile layer from a Mapbox-style JSON URL (attribution rides in its TileJSON). */
export function makeVectorBasemapLayer(styleUrl: string): VectorTileLayer {
  // declutter: no label overlap; extent: one world so margins stay empty.
  const layer = new VectorTileLayer<VectorTileSource>({
    declutter: true,
    extent: WEB_MERCATOR_EXTENT,
  })
  // Empty CSS suppresses ol-mapbox-style's broken jsdelivr fontsource fetch; labels fall back to stack fonts.
  applyMapboxStyle(layer, styleUrl, { webfonts: '/empty-font.css' }).catch(
    (err) => log.error('Failed to apply vector basemap style', { error: err }),
  )
  return layer
}

/** Carto Positron as an OpenLayers vector-tile layer. */
export function makeCartoBasemapLayer(): VectorTileLayer {
  return makeVectorBasemapLayer(CARTO_POSITRON_STYLE_URL)
}
