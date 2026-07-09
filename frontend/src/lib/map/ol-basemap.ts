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
 * Shared OpenLayers basemap helper. Uses Carto Positron raster (XYZ) tiles — a single image
 * source, simpler/more reliable than the vector style for a small picker. The host is already
 * CSP-allowlisted (see `index.html` / `vite.config.ts`).
 */

import TileLayer from 'ol/layer/Tile'
import { fromLonLat } from 'ol/proj'
import XYZ from 'ol/source/XYZ'

/** Carto Positron raster tiles (light basemap). Host matches CSP `*.basemaps.cartocdn.com`. */
export const CARTO_RASTER_TILE_URL =
  'https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'

/** Standard Web Mercator world extent (the projection asymptotes at ±85.0511°). */
export const WEB_MERCATOR_EXTENT: [number, number, number, number] = [
  ...fromLonLat([-180, -85.0511]),
  ...fromLonLat([180, 85.0511]),
] as [number, number, number, number]

/** Carto Positron as an OpenLayers raster (XYZ) tile layer. */
export function makeCartoBasemapLayer(): TileLayer<XYZ> {
  return new TileLayer({
    source: new XYZ({
      url: CARTO_RASTER_TILE_URL,
      attributions: '© OpenStreetMap contributors, © CARTO',
      maxZoom: 20,
    }),
  })
}
