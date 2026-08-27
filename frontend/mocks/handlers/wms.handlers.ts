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
 * Production reaches a lens only through the backend's same-origin proxy
 * (`/api/v1/lens/proxy/<id>/...`); requests routed there are keyed by
 * instance id. Tests that talk to a bare `http://localhost:<port>` origin
 * directly (exercising the viewer against an "external-style" WMS) are
 * keyed by port instead — both share the same mock registry via a
 * string key. GetMap and legend requests return a 1×1 transparent PNG —
 * tests assert on controls and state, never on rendered pixels.
 */

import { HttpResponse, delay, http } from 'msw'
import {
  getMapDelayFor,
  getMapFailsFor,
  recordGetMap,
  serveCapabilities,
} from '../data/wms.data'
import { API_ENDPOINTS } from '@/api/endpoints'

// Translucent 1×1 PNGs (red / blue) — GetMap alternates the color by
// port so two mock lenses are visually distinguishable and comparison
// partitions (swipe/spy) can be eyeballed in dev:mock: any red/blue
// blending would mean a leaking clip.
const PNG_RED = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4Y2OTBwAFDwHDQJlGHgAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)
const PNG_BLUE = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOwibqTBwAEKQHhtBh8ewAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)

const CORS = { 'Access-Control-Allow-Origin': '*' }

/** `id` from `/api/v1/lens/proxy/<id>/...`, when present. */
const LENS_PROXY_ID_RE = new RegExp(`${API_ENDPOINTS.lens.proxyBase}/([^/]+)/`)

/** Routing key for the mock registry: the lens instance id when the
 *  request went through the proxy path, else the origin's port (bare
 *  `http://host:port` test doubles). */
function wmsKeyFor(url: URL): string {
  const proxied = LENS_PROXY_ID_RE.exec(url.pathname)
  return proxied ? decodeURIComponent(proxied[1]) : url.port
}

function pngResponse(key: string) {
  const png = Number(key) % 2 === 0 ? PNG_RED : PNG_BLUE
  return new HttpResponse(png.slice().buffer, {
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
  http.get('*/wms', async ({ request }) => {
    const url = new URL(request.url)
    // WMS params are case-insensitive keys: OL sends REQUEST, we send request.
    const param = (key: string) =>
      url.searchParams.get(key) ?? url.searchParams.get(key.toUpperCase())
    const req = (param('request') ?? '').toLowerCase()
    const key = wmsKeyFor(url)

    if (req === 'getcapabilities') {
      const result = serveCapabilities(key)
      if (result.kind === 'unavailable') {
        return new HttpResponse(null, { status: 503, headers: CORS })
      }
      return new HttpResponse(result.xml, {
        headers: { ...CORS, 'Content-Type': 'text/xml' },
      })
    }
    // GetMap and anything else image-like. Registered failure TIMEs get
    // a WMS service exception (stale-capabilities servers do this).
    if (req === 'getmap') {
      recordGetMap(key, param('TIME'))
      const delayMs = getMapDelayFor(key)
      if (delayMs > 0) await delay(delayMs)
    }
    if (req === 'getmap' && getMapFailsFor(key, param('TIME'))) {
      return new HttpResponse('<ServiceExceptionReport/>', {
        headers: { ...CORS, 'Content-Type': 'text/xml' },
      })
    }
    return pngResponse(key)
  }),

  // Legend images — capabilities advertise them on the lens's internal bind
  // address; the viewer rebases them onto the browser-reachable origin.
  http.get('*/legend', () => pngResponse('0')),

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
