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
import { layerRequestParams, toWmsEndpoint } from '../wms-capabilities'
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
