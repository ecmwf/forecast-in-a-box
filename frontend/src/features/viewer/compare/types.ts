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
  /** SkinnyWMS decoration layers (background/foreground) when lens-backed. */
  decorationLayers: ReadonlyArray<ParsedLayer>
  activeOrder: ReadonlyArray<string>
  layerOpacities: ReadonlyMap<string, number>
  /** Raw TIME string THIS server advertised for the current instant. */
  resolveTime: (layer: ParsedLayer) => string | null
  /** Base stack opacity: global × per-source tier (mode factors and
   *  time-gap hiding are applied by the map components on top). */
  masterOpacity: number
  /** True when the source lacks data at the selected valid time —
   *  its stack is hidden and the panel shows a gap badge. */
  hiddenAtTime: boolean
  /** Signed offset tag ("+2 h") when the shown instant differs from the
   *  requested one (nearest/offset time-link modes). */
  timeTag: string | null
  /** Human label of the instant this source displays ("06 Jul 12:00Z"). */
  timeLabel: string | null
  bbox: [number, number, number, number] | null
}

export type SingleMapMode = 'swipe' | 'flicker' | 'spy' | 'blend'
export type CompareMode = SingleMapMode | 'side'

/** Toolbar order — also the 1–5 keyboard shortcut order. */
export const COMPARE_MODES: readonly [
  CompareMode,
  CompareMode,
  CompareMode,
  CompareMode,
  CompareMode,
] = ['swipe', 'side', 'flicker', 'spy', 'blend']

export type SwipeOrientation = 'vertical' | 'horizontal'
export type SpyShape = 'circle' | 'rectangle'

/** Per-mode tuning owned by the viewer, edited in the toolbar action row. */
export interface CompareModeOptions {
  swipeOrientation: SwipeOrientation
  spyShape: SpyShape
  /** Spy lens radius / half-extent in CSS pixels. */
  spySizePx: number
  /** B-over-A weight in blend mode (0..1). */
  blend: number
}

/** One captured map for export: raw composited canvas + metadata. The
 *  export dialog bakes the title bar / legend strip on top. */
export interface CaptureResult {
  label: string
  /** Which source this capture shows; null = both (single-map modes). */
  slot: 'a' | 'b' | null
  canvas: HTMLCanvasElement
  timeLabel: string | null
}
