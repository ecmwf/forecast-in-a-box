/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Globe engines: static gating metadata, lazily loaded implementations. */

import type { GlobeEngineCapabilities, GlobeEngineFactory } from '../engine'
import type { GlobeEngineId } from '../engine-ids'

export interface GlobeEngineEntry {
  /** CRS every source must advertise for the globe to be offered. */
  requiredCrs: string
  capabilities: GlobeEngineCapabilities
  load: () => Promise<GlobeEngineFactory>
}

// Both drape EPSG:4326 layer textures on the sphere.
const SPHERE_CAPABILITIES: Omit<GlobeEngineCapabilities, 'vectorBasemap'> = {
  morphFrom: ['merc', 'geo'],
  poles: true,
  minZoom: -2,
  maxZoom: 6,
}

export const GLOBE_ENGINES = {
  three: {
    requiredCrs: 'EPSG:4326',
    capabilities: { ...SPHERE_CAPABILITIES, vectorBasemap: false },
    load: () =>
      import('./three/ThreeGlobeEngine').then((m) => m.createThreeGlobeEngine),
  },
  maplibre: {
    requiredCrs: 'EPSG:4326',
    capabilities: { ...SPHERE_CAPABILITIES, vectorBasemap: true },
    load: () =>
      import('./maplibre/MapLibreGlobeEngine').then(
        (m) => m.createMapLibreGlobeEngine,
      ),
  },
} as const satisfies Record<GlobeEngineId, GlobeEngineEntry>
