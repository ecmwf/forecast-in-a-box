/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** A source's active stack as engine specs (useWmsLayerStack's params, order, opacity). */

import { DEFAULT_LAYER_OPACITY } from '../ol-layers'
import {
  layerRequestParams,
  skinnyWmsBasemap,
  toWmsEndpoint,
} from '../wms-capabilities'
import type { CompareMapSource } from '../geo/types'
import type { GlobeLayerSpec } from './engine'

export function globeLayerSpecs(
  source: CompareMapSource,
  zBase: number,
): Array<GlobeLayerSpec> {
  const master = source.hiddenAtTime ? 0 : source.masterOpacity
  const endpoint = toWmsEndpoint(source.baseUrl)
  const { activeOrder } = source
  return activeOrder.flatMap((layerName, idx) => {
    const layer = source.layers.find((l) => l.name === layerName)
    if (!layer) return []
    const time = source.resolveTime(layer)
    return [
      {
        key: `${source.slot}:${layerName}`,
        slot: source.slot,
        layerName,
        endpoint,
        params: layerRequestParams(
          layer,
          source.layerSettings.get(layerName),
          time,
        ),
        time,
        bboxAxisOrder: source.bboxAxisOrder,
        bbox: layer.bbox,
        opacity:
          (source.layerOpacities.get(layerName) ?? DEFAULT_LAYER_OPACITY) *
          master,
        // Index 0 → highest z.
        zIndex: zBase + (activeOrder.length - idx),
      },
    ]
  })
}

/** Data z range; the native basemap sits below it and its reference lines above. */
const BACKGROUND_Z = 0
const REFERENCE_Z = 1000

/** The server's own basemap as engine specs: opaque background, reference lines. */
export function globeDecorationSpecs(
  source: CompareMapSource,
  opacity: number,
): Array<GlobeLayerSpec> {
  const { background, reference } = skinnyWmsBasemap(source.decorationLayers)
  if (!background) return []
  const endpoint = toWmsEndpoint(source.baseUrl)
  const common = {
    slot: source.slot,
    endpoint,
    time: null,
    bboxAxisOrder: source.bboxAxisOrder,
    opacity,
  }
  const specs: Array<GlobeLayerSpec> = [
    {
      ...common,
      key: `${source.slot}:basemap:background`,
      layerName: background.name,
      params: {
        ...layerRequestParams(background, undefined, null),
        TRANSPARENT: 'FALSE',
      },
      zIndex: BACKGROUND_Z,
    },
  ]
  if (reference.length > 0) {
    specs.push({
      ...common,
      key: `${source.slot}:basemap:reference`,
      layerName: reference.map((l) => l.name).join(','),
      params: {
        LAYERS: reference.map((l) => l.name).join(','),
        STYLES: '',
        FORMAT: 'image/png',
        TRANSPARENT: 'TRUE',
      },
      zIndex: REFERENCE_Z,
    })
  }
  return specs
}
