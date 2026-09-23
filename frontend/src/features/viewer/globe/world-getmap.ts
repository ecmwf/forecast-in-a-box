/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { get as getProjection } from 'ol/proj'
import { getRequestParams, getRequestUrl } from 'ol/source/wms'
import type { GlobeLayerSpec } from './engine'

/** Whole-world EPSG:4326 GetMap (width × width/2) — an exact sphere texture. */
export function worldGetMapUrl(spec: GlobeLayerSpec, width: number): string {
  // Built by OL so the 1.3.0 lat-first BBOX matches the 2D 'geo' requests.
  return getRequestUrl(
    spec.endpoint,
    [-180, -90, 180, 90],
    [width, width / 2],
    getProjection('EPSG:4326')!,
    getRequestParams({ ...spec.params }, 'GetMap'),
  )
}
