/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import type { ParsedLayer } from '../wms-capabilities'
import type { SourceSlot } from './layer-pairing'

/** Everything a compare map needs to render one source's stack. */
export interface CompareMapSource {
  slot: SourceSlot
  baseUrl: string
  label: string
  layers: ReadonlyArray<ParsedLayer>
  activeOrder: ReadonlyArray<string>
  layerOpacities: ReadonlyMap<string, number>
  /** Raw TIME string THIS server advertised for the current instant. */
  resolveTime: (layer: ParsedLayer) => string | null
  /** True when the source lacks data at the selected valid time —
   *  its stack is hidden and the panel shows a gap badge. */
  hiddenAtTime: boolean
  bbox: [number, number, number, number] | null
}

export type SingleMapMode = 'swipe' | 'flicker' | 'spy' | 'blend'
export type CompareMode = SingleMapMode | 'side'
