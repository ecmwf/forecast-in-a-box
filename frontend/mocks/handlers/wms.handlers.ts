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
 * MSW handlers for SkinnyWMS lens servers (the WMS endpoints behind lens
 * ports, not the backend lens-manager API — that's lens.handlers.ts).
 *
 * The viewer talks to lenses cross-origin with `crossOrigin: 'anonymous'`
 * image sources, so every response carries CORS headers. GetMap and legend
 * requests return a 1×1 transparent PNG — tests assert on controls and
 * state, never on rendered pixels.
 */

import { HttpResponse, http } from 'msw'
import { serveCapabilities } from '../data/wms.data'

// 1×1 transparent PNG.
const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)

const CORS = { 'Access-Control-Allow-Origin': '*' }

function pngResponse() {
  return new HttpResponse(PNG_1X1.slice().buffer, {
    headers: { ...CORS, 'Content-Type': 'image/png' },
  })
}

// Minimal valid Mapbox style so the Carto vector basemap fetch resolves
// offline. ol-mapbox-style's applyStyle(VectorTileLayer, …) requires at
// least one layer with a vector source to derive the layer's source
// config; the mock-tiles handler below answers any tile it requests.
const EMPTY_MAPBOX_STYLE = {
  version: 8,
  name: 'test-basemap',
  sources: {
    'test-vector': {
      type: 'vector',
      tiles: ['http://localhost/mock-tiles/{z}/{x}/{y}.pbf'],
      minzoom: 0,
      maxzoom: 0,
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#fff' } },
    {
      id: 'test-lines',
      type: 'line',
      source: 'test-vector',
      'source-layer': 'none',
      paint: {},
    },
  ],
}

export const wmsHandlers = [
  http.get('*/wms', ({ request }) => {
    const url = new URL(request.url)
    const req = (url.searchParams.get('request') ?? '').toLowerCase()
    const port = Number(url.port)

    if (req === 'getcapabilities') {
      const result = serveCapabilities(port)
      if (result.kind === 'unavailable') {
        return new HttpResponse(null, { status: 503, headers: CORS })
      }
      return new HttpResponse(result.xml, {
        headers: { ...CORS, 'Content-Type': 'text/xml' },
      })
    }
    // GetMap and anything else image-like.
    return pngResponse()
  }),

  // Legend images — capabilities advertise them on the lens's internal bind
  // address; the viewer rebases them onto the browser-reachable origin.
  http.get('*/legend', () => pngResponse()),

  // Carto vector basemap style requested by the viewer on mount.
  http.get('https://basemaps.cartocdn.com/*', () =>
    HttpResponse.json(EMPTY_MAPBOX_STYLE),
  ),

  // Empty vector tiles for the stub style above.
  http.get('*/mock-tiles/*', () =>
    HttpResponse.arrayBuffer(new ArrayBuffer(0), {
      headers: { ...CORS, 'Content-Type': 'application/x-protobuf' },
    }),
  ),
]
