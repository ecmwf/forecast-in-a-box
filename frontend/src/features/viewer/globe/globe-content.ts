/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Globe scene for a host WebGL2 context: the texture store's images, drawn by the renderer. */

import { createGlobeRenderer } from './globe-render'
import { createTextureStore } from './globe-textures'
import type { BendUniforms, GlobeRenderer } from './globe-render'
import type { ViewState } from './globe-plan'
import type {
  FlatCamera,
  GlobeEngineEvents,
  GlobeLayerSpec,
  GlobeOutlineSpec,
  GlobeSeed,
} from './engine'

export interface GlobeContent {
  uniforms: BendUniforms
  setLayers: (specs: ReadonlyArray<GlobeLayerSpec>) => void
  setOutline: (spec: GlobeOutlineSpec | null) => void
  /** The outline's share of its own opacity (a stand-in for Carto fades with it). */
  setOutlineOpacity: (opacity: number) => void
  /** Not live: data layers keep their specs but fetch nothing (a hidden, warm globe). */
  setLive: (live: boolean) => void
  /** The server's own basemap images: z below the data (background) or above (reference). */
  setDecoration: (specs: ReadonlyArray<GlobeLayerSpec>) => void
  /** Bend the flat map's own pixels; null drops them. */
  setSeed: (
    seed: GlobeSeed | null,
    flat: FlatCamera,
    w: number,
    h: number,
  ) => void
  setSeedOpacity: (opacity: number) => void
  whenLoaded: () => Promise<void>
  /** Refetch sharper textures once the camera rests. */
  scheduleUpgrade: () => void
  /** Upgrade at once: entering, where the camera is already final. */
  upgradeNow: () => void
  /** Draw everything with the current uniforms into `gl` (host-owned state). */
  draw: (gl: WebGL2RenderingContext) => void
  /** Draw the seed image (above the host's own layers). */
  drawSeed: (gl: WebGL2RenderingContext) => void
  /** After a context loss: GL handles are dead, so every image is fetched again. */
  reset: () => void
  dispose: () => void
}

export function createGlobeContent({
  events,
  invalidate,
  view,
}: {
  events: GlobeEngineEvents
  invalidate: () => void
  /** Current camera and viewport (texture detail, scale bands). */
  view: () => ViewState
}): GlobeContent {
  // Each needs the other: the store the context's limits, the renderer the store's images.
  let render: GlobeRenderer | null = null
  const store = createTextureStore({
    events,
    invalidate,
    view,
    gpuMax: () => render?.maxTextureSize(),
    deleteTexture: (texture) => render?.deleteTexture(texture),
  })
  const renderer = createGlobeRenderer({
    store,
    invalidate,
    zoom: () => view().zoom,
  })
  render = renderer
  return {
    uniforms: renderer.uniforms,
    setLayers: store.setLayers,
    setOutline: renderer.setOutline,
    setOutlineOpacity: renderer.setOutlineOpacity,
    setLive: store.setLive,
    setDecoration: store.setDecoration,
    setSeed: renderer.setSeed,
    setSeedOpacity: renderer.setSeedOpacity,
    whenLoaded: store.whenLoaded,
    scheduleUpgrade: store.scheduleUpgrade,
    upgradeNow: store.upgradeNow,
    draw: renderer.draw,
    drawSeed: renderer.drawSeed,
    reset: () => {
      renderer.reset()
      store.reload()
    },
    dispose: () => {
      store.dispose()
      renderer.dispose()
    },
  }
}
