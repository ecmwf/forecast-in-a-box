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
 * User-uploaded GeoJSON context overlays (boundaries, tracks, points of
 * interest) drawn above the data layers on every compare panel. One
 * shared VectorSource per overlay — OL sources are shareable across
 * maps, layers are not, so each map mounts its own thin VectorLayer.
 */

import { useEffect } from 'react'
import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Fill, Stroke, Style } from 'ol/style'
import CircleStyle from 'ol/style/Circle'
import type { RefObject } from 'react'
import type OlMap from 'ol/Map'

/** Above data stacks (100/200 bands), below the reference overlay (1000). */
const OVERLAY_Z = 900

let overlayCounter = 0

export interface ContextOverlay {
  id: string
  name: string
  visible: boolean
  source: VectorSource
  featureCount: number
}

const OVERLAY_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(22, 163, 74, 0.95)', width: 2 }),
  fill: new Fill({ color: 'rgba(22, 163, 74, 0.08)' }),
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: 'rgba(22, 163, 74, 0.9)' }),
    stroke: new Stroke({ color: 'white', width: 1.5 }),
  }),
})

/**
 * Parse GeoJSON text into an overlay (features reprojected to the
 * viewer's Web-Mercator). Throws on unparsable input or zero features.
 */
export function parseGeojsonOverlay(
  name: string,
  text: string,
): ContextOverlay {
  const features = new GeoJSON().readFeatures(JSON.parse(text), {
    featureProjection: 'EPSG:3857',
  })
  if (features.length === 0) {
    throw new Error('GeoJSON contains no features')
  }
  overlayCounter += 1
  const source = new VectorSource({ features })
  return {
    id: `overlay-${overlayCounter}`,
    name,
    visible: true,
    source,
    featureCount: features.length,
  }
}

/** Mount one VectorLayer per overlay on this map. */
export function useContextOverlays(
  mapRef: RefObject<OlMap | null>,
  overlays: ReadonlyArray<ContextOverlay>,
): void {
  useEffect(() => {
    const map = mapRef.current
    if (!map || overlays.length === 0) return
    const layers = overlays.map(
      (overlay) =>
        new VectorLayer({
          source: overlay.source,
          style: OVERLAY_STYLE,
          zIndex: OVERLAY_Z,
          visible: overlay.visible,
        }),
    )
    for (const layer of layers) map.addLayer(layer)
    return () => {
      for (const layer of layers) map.removeLayer(layer)
    }
  }, [mapRef, overlays])
}
