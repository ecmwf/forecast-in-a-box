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
 * Fake globe engine for the GeoViewer globe tests. Type-only app imports, so
 * `vi.mock` factories can load it before any app module.
 */

import type {
  GlobeBasemapSpec,
  GlobeCamera,
  GlobeEngine,
  GlobeEngineEvents,
  GlobeLayerSpec,
} from '@/features/viewer/globe/engine'

/** What reached the engine; one module instance per test file. */
export const engineCalls = {
  layers: [] as Array<ReadonlyArray<GlobeLayerSpec>>,
  basemaps: [] as Array<GlobeBasemapSpec>,
  seeds: [] as Array<boolean>,
  live: [] as Array<boolean>,
  mounted: 0,
  destroyed: 0,
  camera: (): GlobeCamera => ({ lon: 0, lat: 0, zoom: 1 }),
  loaded: Promise.resolve(),
  captures: 0,
  events: null as GlobeEngineEvents | null,
  commits: 0,
}

function fakeEngine(): GlobeEngine {
  let camera: GlobeCamera = { lon: 0, lat: 0, zoom: 1 }
  let el: HTMLElement | null = null
  return {
    mount: (container, events) => {
      engineCalls.mounted++
      engineCalls.events = events
      el = document.createElement('div')
      el.dataset.testid = 'globe-canvas'
      container.append(el)
      return Promise.resolve()
    },
    setLayers: (specs) => engineCalls.layers.push(specs),
    setBasemap: (spec) => engineCalls.basemaps.push(spec),
    setLive: (live) => engineCalls.live.push(live),
    setCamera: (next) => {
      camera = next
      engineCalls.camera = () => camera
    },
    whenLoaded: () => engineCalls.loaded,
    bendIn: (_from, to, _ms, seed) => {
      camera = to
      engineCalls.seeds.push(seed !== null)
      return Promise.resolve()
    },
    bendOut: () => Promise.resolve(),
    pick: () => null,
    capture: () => {
      engineCalls.captures++
      return document.createElement('canvas')
    },
    drawViewport: () => {},
    size: () => [800, 600],
    destroy: () => {
      engineCalls.destroyed++
      el?.remove()
    },
  }
}

/** Stand-in for `@/features/viewer/globe/engine-entry`. */
export const engineEntryMock = {
  GLOBE_ENGINE: {
    requiredCrs: 'EPSG:4326',
    maxZoom: 6,
    load: () => Promise.resolve(fakeEngine),
  },
}

/** Stand-in for `@/features/viewer/globe/webgl-support`. */
export const webglSupportMock = {
  supportsGlobe: () => true,
  disableGlobe: () => {},
}
