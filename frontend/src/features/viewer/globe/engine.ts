/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Renderer-agnostic globe-engine seam (types only). */

import type { FlatProjectionId } from '../projection-ids'
import type { BboxAxisOrder } from '../projections'
import type { Bbox } from '../wms-capabilities'
import type { SourceSlot } from '../geo/layer-pairing'

/** Neutral camera; centre ground m/px = EQUATOR_MPP_Z0 / 2^zoom (MapLibre zoom = zoom − 1). */
export interface GlobeCamera {
  lon: number
  lat: number
  zoom: number
}

/** Morphable flat layouts: Web Mercator or equirectangular. */
export type FlatKind = 'merc' | 'geo'

/** OL view snapshot at a handoff; `resolution` in view units per px. */
export interface FlatCamera {
  projection: FlatProjectionId
  lon: number
  lat: number
  resolution: number
}

/** One WMS layer; raw params so an engine can request a world image or tiles. */
export interface GlobeLayerSpec {
  /** `${slot}:${layerName}` */
  key: string
  slot: SourceSlot
  layerName: string
  /** WMS endpoint (`toWmsEndpoint(baseUrl)`). */
  endpoint: string
  /** LAYERS / STYLES / FORMAT / TRANSPARENT / TIME / DIM_*. */
  params: Record<string, string>
  /** TIME on the request (load-result attribution). */
  time: string | null
  bboxAxisOrder: BboxAxisOrder
  bbox?: Bbox
  /** Per-layer × master; 0 keeps the texture but draws nothing. */
  opacity: number
  zIndex: number
}

export interface GlobeOutlineSpec {
  theme: 'light' | 'dark'
  opacity: number
}

/** Outline strokes, or a Mapbox-style vector basemap (`vectorBasemap` engines). */
export interface GlobeBasemapSpec extends GlobeOutlineSpec {
  kind: 'outline' | 'vector'
  styleUrl?: string
}

export interface GlobeEngineCapabilities {
  /** Flat kinds the engine can morph from; others crossfade. */
  morphFrom: ReadonlyArray<FlatKind>
  /** Data reaches the poles (Mercator tiles stop at ±85.05°). */
  poles: boolean
  minZoom: number
  maxZoom: number
  /** Can draw a vector (Mapbox-style) basemap on the globe. */
  vectorBasemap: boolean
}

export type CameraOrigin = 'user' | 'program'

export interface GlobeEngineEvents {
  onCameraChange: (camera: GlobeCamera, origin: CameraOrigin) => void
  onLayerLoad: (key: string, time: string | null, ok: boolean) => void
  onLoadingChange: (inFlight: number) => void
  onContextLost: () => void
}

export interface GlobeEngine {
  mount: (container: HTMLElement, events: GlobeEngineEvents) => Promise<void>
  setLayers: (specs: ReadonlyArray<GlobeLayerSpec>) => void
  setBasemap: (spec: GlobeBasemapSpec) => void
  getCamera: () => GlobeCamera
  setCamera: (camera: GlobeCamera) => void
  /** Resolves when layers already set have a first image (or failed). */
  whenLoaded: () => Promise<void>
  /** Animate from the OL view onto the globe camera. */
  morphIn: (
    from: FlatCamera,
    to: GlobeCamera,
    durationMs: number,
  ) => Promise<void>
  /** Animate from the current globe onto the OL view. */
  morphOut: (to: FlatCamera, durationMs: number) => Promise<void>
  /** Screen px (container-relative) → lon/lat, null off the globe. */
  pick: (px: readonly [number, number]) => { lon: number; lat: number } | null
  /** Render now and copy the frame into a 2D canvas. */
  capture: () => HTMLCanvasElement
  /** Render now and draw the CSS-px region from `origin` at `scale` (loupe). */
  drawViewport: (ctx: CanvasRenderingContext2D, opts: ViewportDraw) => void
  /** Container size in CSS px. */
  size: () => readonly [number, number]
  destroy: () => void
}

export interface ViewportDraw {
  originX: number
  originY: number
  /** Destination px per CSS px. */
  scale: number
}

export type GlobeEngineFactory = () => GlobeEngine
